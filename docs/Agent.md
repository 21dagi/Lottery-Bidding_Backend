# Lottery Platform — Backend Implementation Plan

**Stack:** NestJS (TypeScript) · PostgreSQL · TypeORM (or Prisma, see §2) · EventEmitter2 (in-process events) · Socket.IO Gateway (real-time) · Docker · Redis (cache / scheduler lock, optional now, required if you scale beyond 1 instance later)

This plan implements the rules in `Lottery_Lucky_Draw_Business_Logic.md` as a **modular, event-driven monolith**. It is written so each business capability is its own NestJS module, modules communicate through **domain events** rather than direct cross-calls wherever the business logic describes a reaction ("when X happens, do Y"), and the whole thing ships as a single Docker image plus a Postgres container.

---

## 1. Architectural Principles

1. **Modular monolith, not microservices.** One deployable NestJS app, one Postgres database, clean module boundaries. Splitting into services later is possible because modules never reach into each other's repositories directly — they talk through injected services or events.
2. **Event-driven side effects.** Any business reaction described in the spec ("owner approves deposit → wallet credited → user notified → audit logged") is modeled as: the **originating module performs its core write in a DB transaction**, then **emits a domain event**. Independent modules (notifications, audit, referral, websocket broadcast) **listen** and react. This keeps `DepositsService` from needing to know about Telegram, audit logs, or websockets at all.
3. **NestJS's built-in `@nestjs/event-emitter`** (wraps `eventemitter2`) is used — in-process, synchronous-or-async listeners, no external broker required. This matches your "simplest, single server" choice. The event names and payloads are designed so that swapping the emitter for Redis Pub/Sub or BullMQ later (if you horizontally scale) is a drop-in change, not a rewrite — see §9.
4. **Every state transition is a transaction + an event.** Never "emit event, then write DB" — always commit the DB write first (source of truth), emit second. Listeners must be idempotent (safe to double-process) since in-process delivery combined with app restarts is not guaranteed exactly-once for anything not yet persisted.
5. **Auditability and financial correctness are non-negotiable** (per Business Invariants §96 in the spec) — wallet balance is **never** a mutable column you decrement/increment directly; it's a materialized value derived from an **append-only `wallet_transactions` ledger**. This makes disputes, audits, and bugs recoverable.

---

## 2. Core Technology Choices

| Concern | Choice | Why |
|---|---|---|
| Framework | NestJS 10 + TypeScript | Modular DI, first-class events/websockets/scheduling, enterprise conventions |
| ORM | **Prisma** (recommended) or TypeORM | Prisma: type-safe queries, painless migrations, great with Postgres. TypeORM: more "Nest-native" decorators if you prefer entity classes. Plan below assumes Prisma; TypeORM equivalents noted where it matters. |
| Database | PostgreSQL 16 | Relational integrity for money/tickets, row-level locking (`SELECT ... FOR UPDATE`) needed for ticket purchase races |
| Events | `@nestjs/event-emitter` | In-process, zero infra, matches your "simplest" choice |
| Scheduled jobs (reservation expiry, deadline checks) | `@nestjs/schedule` (cron) | No Redis/queue dependency for a single instance |
| Real-time | `@nestjs/websockets` + Socket.IO | Live ticket grid updates, live admin dashboard counters |
| Auth (users) | Telegram `initData` HMAC validation → issue internal JWT | Telegram is the identity source per spec §4 |
| Auth (owner/admin) | Username+password → JWT (access + refresh), `bcrypt` hashing | Fully separate auth realm from users, per spec §2/§6 |
| Validation | `class-validator` + `class-transformer` | DTO-level input validation |
| File uploads | `@nestjs/platform-express` + `multer`, storage abstraction (local disk in dev, S3-compatible in prod) | Payment screenshots, prize images, payout evidence |
| API docs | `@nestjs/swagger` | Auto-generated OpenAPI for the two frontends |
| Rate limiting / security | `@nestjs/throttler`, `helmet`, `cors` | Basic hardening |
| Containerization | Docker + docker-compose | Per your "dockered" deployment choice |
| Testing | Jest (unit) + Supertest (e2e) | Nest default |

---

## 3. Domain Modules

```text
src/
├── main.ts
├── app.module.ts
│
├── common/
│   ├── decorators/          (CurrentUser, CurrentAdmin, Roles, ...)
│   ├── guards/              (TelegramAuthGuard, JwtAdminGuard, RolesGuard)
│   ├── interceptors/        (AuditInterceptor, TransformResponseInterceptor)
│   ├── filters/             (AllExceptionsFilter → consistent error shape)
│   ├── events/              (typed event name constants + payload interfaces)
│   └── utils/               (money helpers, crypto RNG helper, pagination)
│
├── config/                  (env schema + typed config service)
│
├── auth/
│   ├── telegram/            (initData verification, user auth issuing)
│   └── admin/                (owner login, JWT strategy, refresh tokens)
│
├── users/                   (profile, phone number requirement, ban state)
├── wallets/                 (ledger, balance projection, manual adjustments)
├── deposits/                (deposit lifecycle + pluggable verification provider)
├── media/                   (upload handling, storage abstraction)
│
├── lotteries/                (lottery CRUD, lifecycle state machine)
├── prizes/                  (cash / product prizes, attached to lotteries)
├── tickets/                  (ticket inventory, status machine)
├── reservations/             (10-minute hold, expiry sweep)
├── draw/                     (random draw engine, eligibility freeze)
├── winners/                  (winner records, payouts, product fulfillment)
│
├── referrals/                (referral links, reward rules, reward crediting)
├── notifications/            (Telegram bot sender + in-app notification store)
├── websocket/                 (Socket.IO gateway: ticket grid + admin dashboard)
├── audit/                    (append-only audit log, listens to almost everything)
│
└── admin-ops/                (thin controllers aggregating dashboard queries)
```

Each business module (`deposits`, `lotteries`, `tickets`, `reservations`, `draw`, `winners`, `referrals`) follows the same internal shape:

```text
<module>/
├── <module>.module.ts
├── controllers/
│   ├── <module>.user.controller.ts     (Telegram-facing endpoints, if any)
│   └── <module>.admin.controller.ts    (Owner Panel endpoints)
├── services/
│   └── <module>.service.ts             (business logic, DB transactions)
├── dto/
├── entities/ (or prisma schema block)
└── listeners/
    └── <module>.listener.ts            (reacts to OTHER modules' events)
```

---

## 4. Data Model (high level)

```text
users               (id, telegram_id, telegram_username, display_name, phone_number,
                      is_banned, ban_reason, created_at)

wallets              (id, user_id, cached_balance, updated_at)  -- cached_balance is a
                                                                  -- read-optimization only;
                                                                  -- source of truth is below

wallet_transactions  (id, wallet_id, type[DEPOSIT|PURCHASE|REFERRAL|ADMIN_ADJUST],
                       amount, balance_after, reference_type, reference_id,
                       reason, created_by_admin_id NULLABLE, created_at)   -- append-only

deposits             (id, user_id, amount, status[PENDING|APPROVED|REJECTED],
                       payment_evidence_media_id, verification_provider_response JSONB,
                       reviewed_by_admin_id, reviewed_at, created_at)

lotteries            (id, name, description, cover_media_id, ticket_quantity,
                       ticket_price, status[DRAFT|PUBLISHED|OPEN|LOCKED|DRAWN|
                       COMPLETED|CANCELLED], deadline_at, lock_reason,
                       created_by_admin_id, created_at)

prizes               (id, lottery_id, type[CASH|PRODUCT|VOUCHER|OTHER], name,
                       description, cash_amount NULLABLE, media_ids[], rank)

tickets              (id, lottery_id, ticket_number, status[AVAILABLE|SELECTED|
                       RESERVED|PAYMENT_PENDING|SOLD|WINNER|CANCELLED],
                       owner_user_id NULLABLE, sold_price NULLABLE, sold_at NULLABLE)
                       -- UNIQUE(lottery_id, ticket_number)

ticket_reservations  (id, ticket_id, user_id, reserved_at, expires_at, status[ACTIVE|
                       EXPIRED|CONVERTED|CANCELLED])

purchases            (id, user_id, lottery_id, ticket_ids[], total_amount,
                       wallet_transaction_id, created_at)   -- immutable purchase record

draws                (id, lottery_id, seed_commit_hash, seed_reveal, rng_algorithm,
                       executed_by_admin_id, executed_at)   -- see §7 for the seed-commit idea

winners              (id, draw_id, prize_id, ticket_id, user_id, payout_status
                       [PENDING|CONTACTED|PAID|DELIVERED], payout_evidence_media_id,
                       payout_notes, updated_by_admin_id, updated_at)

referrals            (id, referrer_user_id, referred_user_id, created_at)
referral_rewards     (id, referral_id, wallet_transaction_id, amount, rule_applied,
                       created_at)

notifications        (id, user_id NULLABLE, admin_id NULLABLE, channel[TELEGRAM|IN_APP],
                       type, payload JSONB, status[QUEUED|SENT|FAILED], created_at)

audit_logs           (id, actor_type[ADMIN|SYSTEM], actor_id, action, entity_type,
                       entity_id, before JSONB, after JSONB, reason, created_at)

media                (id, url, type, uploaded_by, related_entity_type, related_entity_id)

admin_users           (id, username, password_hash, role, created_at)  -- role reserved
                                                                        -- for future RBAC
```

**Key invariant enforced at the DB level, not just app level:**
- `tickets(lottery_id, ticket_number)` unique — a sold ticket number can never collide.
- Wallet balance is `SUM(wallet_transactions.amount) WHERE wallet_id = ...` — never a bare mutable column trusted as ground truth (cached_balance is just a fast-read cache refreshed inside the same transaction that appends a ledger row).

---

## 5. State Machines (enforced in service layer with guard checks, not just DB enums)

**Lottery:** `DRAFT → PUBLISHED → OPEN → LOCKED → DRAWN → COMPLETED`, with `OPEN → CANCELLED` as an alternate branch. Transition functions live in `LotteriesService` and reject illegal transitions (e.g. you cannot sell tickets on a `LOCKED` lottery — spec Invariant #12).

**Ticket:** `AVAILABLE → SELECTED → RESERVED → PAYMENT_PENDING → SOLD → WINNER`, with `RESERVED → AVAILABLE` on expiry and `PAYMENT_PENDING → AVAILABLE` on failed purchase (spec Invariant #6: failed purchase never creates ownership).

**Deposit:** `PENDING → APPROVED | REJECTED` (terminal, immutable once decided — spec Invariant #17).

**Winner payout:** `PENDING → CONTACTED → PAID` (cash) or `PENDING → CONTACTED → DELIVERED` (product).

---

## 6. Ticket Reservation & Purchase — Concurrency-Safe Flow

This is the highest-risk part of the system (money + race conditions). Design:

1. **Select** (client-only, no server call needed until reserve).
2. **Reserve** (`POST /tickets/reserve`, body: ticket numbers): inside a single DB transaction,
   `SELECT ... FOR UPDATE` the target ticket rows, verify each is `AVAILABLE`, flip to `RESERVED`,
   insert `ticket_reservations` rows with `expires_at = now() + 10 minutes`, commit.
   Emits `ticket.reserved` (payload: ticketIds, userId, expiresAt) → websocket gateway broadcasts
   grid update to everyone viewing that lottery.
3. **Expiry sweep**: a `@Cron('*/15 * * * * *')` job (every 15s) in `reservations/reservation-expiry.service.ts`
   finds `ticket_reservations` where `status = ACTIVE AND expires_at < now()`, flips them to `EXPIRED`,
   flips the ticket back to `AVAILABLE` in the same transaction, emits `ticket.reservation.expired` per ticket
   → websocket broadcast + optional "your reservation expired" in-app notification.
4. **Purchase** (`POST /tickets/purchase`): re-validates (server-side) that all reserved tickets still belong
   to the requesting user's active reservation and haven't expired, `SELECT ... FOR UPDATE` on the wallet row,
   checks sufficient balance, and **in one transaction**: appends a `wallet_transactions` PURCHASE row (negative
   amount), inserts a `purchases` row, flips tickets to `SOLD` with `owner_user_id` + `sold_price` (price at
   time of purchase, per spec §11 — never re-read the *current* lottery price after this point), marks the
   reservation `CONVERTED`. Emits `ticket.purchased` → notifications, websocket, and (if the buyer was referred)
   `referrals` module listens and applies the reward rule.
5. **Insufficient balance / already-sold / expired-reservation** → all rejected with clear error codes
   matching spec §95 (`INSUFFICIENT_BALANCE`, `TICKET_ALREADY_SOLD`, `RESERVATION_EXPIRED`).

> **Why a cron sweep instead of BullMQ delayed jobs?** You chose the simplest single-server event model.
> A 15-second sweep is more than tight enough for a 10-minute TTL and needs no Redis. §9 shows the exact
> swap if you later run multiple instances (cron sweeps must not double-run across replicas without a
> Postgres advisory lock, noted there).

---

## 7. Draw Engine — "Enterprise-grade" Fairness & Auditability

You asked for an enterprise-appropriate decision without a specific mechanism in mind. Recommendation:
**server-side CSPRNG with a pre-committed seed hash**, which is the standard "enterprise/verifiable" pattern
used by reputable raffle platforms without needing blockchain infrastructure:

1. **On lock**, the eligible ticket set is frozen (spec Invariant #13) — a snapshot list of `SOLD` ticket IDs
   is persisted (`draws.eligible_ticket_snapshot`), so it can never silently change even if something else
   mutates later.
2. **Before drawing**, the system generates a cryptographically secure random seed
   (`crypto.randomBytes(32)`), stores only its **SHA-256 hash** as `draws.seed_commit_hash`, and this commit
   is visible to the owner (and optionally published) *before* the draw button is pressed — proving the
   result wasn't chosen after the fact.
3. **On draw**, the seed is revealed, `draws.seed_reveal` stored, and used to seed a deterministic PRNG
   (e.g. seeded Fisher–Yates or `seedrandom` over the frozen snapshot) to select winners per prize. Anyone
   with the seed and snapshot can independently recompute the same result — that's the "auditable" property.
4. Draw execution runs inside a transaction, emits `draw.completed` and one `winner.selected` event per
   winner, which `notifications`, `websocket`, and `audit` all react to independently.
5. Multiple prizes per lottery are drawn without replacement across prizes but the same user can still win
   multiple prizes if they own multiple eligible tickets (spec §17) — the algorithm draws distinct **tickets**,
   not distinct **users**.

---

## 8. Deposit Verification — Pluggable Provider Interface

You said verification is manual today but you *may* plug in a validation API later that returns structured
JSON. Build the interface now so that's a config change, not a rewrite:

```ts
// deposits/verification/payment-verification.provider.ts
export interface PaymentVerificationResult {
  status: 'AUTO_APPROVED' | 'AUTO_REJECTED' | 'NEEDS_MANUAL_REVIEW' | 'ERROR';
  confidence?: number;
  extractedAmount?: number;
  extractedReference?: string;
  raw: Record<string, unknown>;   // full provider JSON, stored as-is in deposits.verification_provider_response
}

export interface PaymentVerificationProvider {
  verify(input: { depositId: string; screenshotUrl: string; claimedAmount: number }):
    Promise<PaymentVerificationResult>;
}
```

- **Default implementation (ship today):** `ManualReviewProvider` — always returns
  `NEEDS_MANUAL_REVIEW`, i.e. today's exact manual flow (owner reviews screenshot, approves/rejects in
  Owner Panel). No behavior change from a pure-manual system.
- **Swap-in later:** implement `ExternalApiVerificationProvider` calling your chosen service, mapped to the
  same interface. Selected via `PAYMENT_VERIFICATION_PROVIDER=manual|external` env var + Nest's
  `useFactory` provider — zero changes to `DepositsService` or controllers either way.
- Either way, **the owner's approve/reject action remains the authoritative state transition** for
  `PENDING → APPROVED/REJECTED` unless/until you explicitly decide to trust `AUTO_APPROVED` — that's a
  business decision to make later, not a technical one; the field is there when you're ready.
- Approving a deposit emits `deposit.approved` → `wallets` module listens, appends a `DEPOSIT`
  `wallet_transactions` row, updates cached balance → emits `wallet.credited` → `notifications` +
  `websocket` + `audit` react independently. Rejecting emits `deposit.rejected` → notification only, wallet
  untouched (spec §99).

---

## 9. Domain Events Reference

All event names are typed constants in `common/events/event-names.ts`, payloads are typed interfaces in
the same folder, imported by both emitter and listener sides (compile-time safety, no stringly-typed
mismatches).

| Event | Emitted by | Listened to by |
|---|---|---|
| `user.registered` | users | notifications, audit |
| `user.banned` | users | notifications, audit |
| `deposit.submitted` | deposits | notifications (admin alert), websocket (admin dashboard) |
| `deposit.approved` | deposits | wallets, notifications, audit, websocket |
| `deposit.rejected` | deposits | notifications, audit |
| `wallet.credited` / `wallet.debited` | wallets | notifications, audit, websocket |
| `wallet.admin_adjusted` | wallets | notifications, audit (reason required — Invariant #14) |
| `lottery.published` / `lottery.locked` / `lottery.cancelled` | lotteries | notifications, websocket, audit |
| `ticket.reserved` | reservations | websocket |
| `ticket.reservation.expired` | reservations | websocket, notifications |
| `ticket.purchased` | tickets | wallets (deduct), referrals, notifications, websocket, audit |
| `draw.completed` | draw | notifications, audit |
| `winner.selected` | draw | notifications, websocket, audit |
| `winner.payout_updated` | winners | notifications, audit |
| `referral.reward_credited` | referrals | wallets, notifications, audit |
| `admin.action_performed` | (generic, raised by an `AuditInterceptor` on admin-mutating routes) | audit |

**Scaling path (not needed for your current single-instance choice, documented for future-you):**
because listeners only ever depend on the typed payload and never on `EventEmitter2` internals directly,
swapping `@nestjs/event-emitter` for a Redis-Pub/Sub-backed emitter or BullMQ event queue later is a
change confined to `common/events/` + `app.module.ts` — service and listener code doesn't change.

---

## 10. Notifications Module

- **Two channels**, both real per your answer: **Telegram Bot API** (via a bot the owner registers,
  `TELEGRAM_BOT_TOKEN` env var, using `node-telegram-bot-api` or `grammy`) and **in-app** (persisted
  `notifications` row, fetched by the Mini App on load / via websocket push).
- `NotificationsService.dispatch(event)` fans out to both channels; each channel has its own small adapter
  (`TelegramChannel`, `InAppChannel`) so adding e.g. email/SMS later is one more adapter.
- Every dispatch is persisted in `notifications` with `status` so failed Telegram sends (user blocked the
  bot, etc.) are visible to the owner and don't silently vanish.

## 11. Real-Time Layer (WebSocket Gateway)

- `websocket/lottery.gateway.ts` — namespace `/ws/lottery`, clients join room `lottery:<id>` when viewing
  a lottery's ticket grid. Broadcasts `ticket:update` (ticketId, newStatus) on every reservation/expiry/
  purchase event, and `reservation:countdown` isn't pushed per-second — client renders its own countdown
  from `expires_at`, server is just the source of truth for status flips.
- `websocket/admin-dashboard.gateway.ts` — namespace `/ws/admin`, JWT-authenticated (admin only), pushes
  live counters (pending deposits count, tickets sold, active lotteries) so the Owner Dashboard (spec §7)
  updates without polling.
- Both gateways are thin — they only subscribe to domain events and re-emit over sockets; they contain no
  business logic.

## 12. Auth

**Telegram (user) side:**
- Mini App sends Telegram's `initData` string on every request (header) or once to obtain a session JWT.
- Backend validates the HMAC signature using the bot token per Telegram's documented algorithm, extracts
  `telegram_id`, `username`, `first_name/last_name`, upserts the `users` row, checks `is_banned` (reject
  immediately per spec §5), then issues a short-lived internal JWT for subsequent calls.
- `TelegramAuthGuard` enforces this on all user-facing routes; a separate lightweight guard enforces
  "phone number required" (spec §4) before ticket-purchase-related endpoints.

**Owner/Admin side:**
- Fully separate: username + bcrypt-hashed password → access JWT (short TTL) + refresh JWT (httpOnly
  cookie or rotated refresh token). `JwtAdminGuard` + a `RolesGuard` scaffold now (`admin_users.role`
  column exists, only one role — `OWNER` — is used today) so delegated admin roles (spec §3.1, explicitly
  flagged as future) slot in without a schema change later.
- **Every admin-mutating controller method** is wrapped by an `AuditInterceptor` that captures
  actor/action/entity/before/after and emits `admin.action_performed`, satisfying spec Invariant #20
  ("owner actions must be traceable") without hand-writing audit calls in every service method.

## 13. API Surface (representative, not exhaustive)

```text
POST   /auth/telegram                     exchange initData → JWT
POST   /auth/admin/login
POST   /auth/admin/refresh

GET    /me                                 profile + wallet summary
PATCH  /me/phone

GET    /lotteries                          list (published/open/completed)
GET    /lotteries/:id                      detail incl. prizes + ticket grid state
POST   /admin/lotteries                    create
PATCH  /admin/lotteries/:id
POST   /admin/lotteries/:id/publish
POST   /admin/lotteries/:id/lock
POST   /admin/lotteries/:id/cancel

POST   /tickets/reserve
POST   /tickets/purchase
GET    /me/tickets

POST   /wallet/deposits                    submit deposit + evidence media id
GET    /me/deposits
POST   /admin/deposits/:id/approve
POST   /admin/deposits/:id/reject
POST   /admin/wallets/:userId/adjust        manual adjust, reason required

POST   /admin/lotteries/:id/draw
GET    /lotteries/:id/winners
PATCH  /admin/winners/:id/payout

POST   /media/upload
GET    /me/referrals
GET    /admin/dashboard
GET    /admin/audit-logs
```

Full OpenAPI spec generated via `@nestjs/swagger`, served at `/api/docs`, consumed by both frontends for
typed client generation (see the frontend plans).

## 14. Docker & Infrastructure

```text
docker/
├── Dockerfile                 (multi-stage: build → slim runtime, node:20-alpine)
├── docker-compose.yml         (api, postgres, redis[optional], nginx[optional reverse proxy])
└── .env.example
```

- `docker-compose.yml` services: `api` (the Nest app), `db` (postgres:16-alpine with a named volume),
  optionally `redis` (kept in the compose file but **unused by the app today** — reserved for §9's scaling
  path and for the queue-based enhancement noted in §6, so turning it on later needs no infra rework).
- Migrations run as a release step (`prisma migrate deploy` or TypeORM migration run) before the app
  container starts serving traffic.
- Health check endpoint `/health` (via `@nestjs/terminus`) for container orchestration readiness/liveness.

## 15. Testing Strategy

- **Unit tests** per service, especially: reservation expiry edge cases, purchase race conditions
  (simulate concurrent purchase attempts on the same ticket), wallet ledger math, draw determinism (same
  seed + snapshot → same result).
- **E2E tests** (Supertest) for the full user journey (spec §97) and full deposit journey (spec §99)
  against a test Postgres instance (docker-compose test override).
- **Concurrency test**: fire N parallel `purchase` requests for the same ticket, assert exactly one
  succeeds and the rest get `TICKET_ALREADY_SOLD`.

## 16. Suggested Build Phases

1. **Foundation** — project scaffold, config, Postgres + Prisma schema, auth (Telegram + admin), users,
   audit module skeleton, Docker Compose dev environment.
2. **Wallet & Deposits** — ledger, deposit submission/approval flow, media upload, pluggable verification
   interface (manual provider only for now), notifications skeleton (in-app only first).
3. **Lotteries, Prizes, Tickets** — lottery CRUD/state machine, prize CRUD, ticket inventory generation,
   admin CRUD endpoints, public read endpoints.
4. **Reservations & Purchase** — the concurrency-critical flow in §6, expiry cron, websocket ticket-grid
   gateway.
5. **Draw & Winners** — draw engine (§7), winners module, payout tracking, product fulfillment states.
6. **Referrals** — referral link generation, reward rule engine, event wiring.
7. **Notifications hardening** — Telegram Bot channel, admin dashboard websocket, notification retry/failure
   visibility.
8. **Owner Dashboard aggregation endpoints, audit log browsing, polish, rate limiting, Swagger, e2e suite,
   production Docker hardening.**

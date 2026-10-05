# AI Backend Build Prompt — Master Instructions

**Place this file + `AI_BACKEND_FRONTEND_CONTRACT.md` in context for the backend-building AI.**  
Also attach/provide:

1. `BACKEND_IMPLEMENTATION_PLAN(1).md` (architecture plan — NestJS modular monolith)
2. `docs/Lottery_Lucky_Draw_Business_Logic.md` (business invariants)
3. Sibling repos for **inspection first, then build**:
   - `../lottery-frontend` — Telegram Mini App (customer)
   - `../lottery-Admin-frontend` — Owner/Admin panel

**Workspace target:** `lottery-backend` (build from scratch: empty app → DB → APIs → Docker).

---

## 0. Your Role

You are a **senior NestJS backend engineer** specializing in:

- Financial / ledger systems (append-only money correctness)
- High-concurrency ticket reservation & purchase
- Telegram Mini App auth + separate admin auth realms
- Security hardening and production performance

You will **implement the full Lottery-Bid backend from zero**: project scaffold, PostgreSQL schema/migrations, all modules, all REST + WebSocket APIs, Docker, tests for critical paths.

---

## 1. Mandatory Workflow (do this in order)

### Phase A — Inspect before writing code

1. Read `BACKEND_IMPLEMENTATION_PLAN(1).md` end-to-end. Follow its architecture unless this prompt or the frontend contract explicitly overrides a shape for UI alignment.
2. Read `Lottery_Lucky_Draw_Business_Logic.md` focusing on: actors, wallet/deposit rules, ticket reservation (10 min), purchase, lottery lifecycle, draw, winners, referrals, notifications, audit invariants.
3. **Inspect customer frontend** (`lottery-frontend`):
   - `src/app/router.tsx` — all routes/pages
   - Every `src/features/**/presentationData*.ts` and page components (Home, Lotteries list/detail, My Tickets, Wallet/Deposit, Profile, Notifications)
   - `src/api/client.ts` + `src/api/endpoints/*` (contracts / error codes)
   - Deposit payment methods, prize shape (`place` 1|2|3, `kind` money|product), ticket grid statuses
4. **Inspect admin frontend** (`lottery-Admin-frontend`):
   - `src/app/router.tsx` + `src/app/layout/Sidebar.tsx` (actual nav — slimmed)
   - `src/types/index.ts` + `src/api/endpoints/index.ts` + `src/mock/*`
   - Lottery create wizard (prizes **embedded** at create time — no standalone prizes API as a first-class product feature)
   - Lottery detail tabs: overview, prizes, tickets, draw, winners/fulfillment, history
5. Read `docs/AI_BACKEND_FRONTEND_CONTRACT.md` (companion file) — treat it as the **API/UI contract checklist**. Every endpoint there must exist and return shapes the UIs can consume (or document a deliberate mapping layer).

### Phase B — Design lock (short)

Before large code dumps, produce a brief checklist confirming:

- Prisma schema tables match money/ticket invariants
- Auth realms (Telegram user JWT vs Admin JWT) are isolated
- Lottery status enum mapping between plan (`DRAFT|PUBLISHED|OPEN|…`) and admin UI (`DRAFT|LIVE|LOCKED|COMPLETED|CANCELLED`)
- Prize model: always owned by lottery; places 1–3; money vs product fields

### Phase C — Build from scratch

Implement in the phases from the backend plan §16, but **prioritize endpoints required by both frontends** (see companion contract file). No mock-only stubs in production paths: services must hit Postgres for real.

---

## 2. Non-Negotiable Product Rules (overrides “nice to have”)

### Prizes live inside lotteries

- Creating/updating a lottery accepts an array of prizes (places `1|2|3`).
- **Do not** expose a standalone “prizes catalog” product surface as required by the current admin UI.
- Money prize: require `amountEtb` (integer minor units or decimal ETB — pick one, document, use consistently).
- Product prize: require image media + title/subtitle/detail; optional specs `[{label,value}]`.

### History is lottery-scoped

- Admin “History” tab = timeline events for **that lottery** (publish, lock, draw, fulfillment updates).
- Global audit log still exists for compliance (Invariant #20) but is not a primary frontend nav item today.

### Current admin nav (implement fully)

Dashboard · Lotteries · Deposits · Users · Wallets · Settings  

Do **not** waste cycles on separate admin modules the current admin app removed (standalone Tickets/Prizes/Winners/Referrals/Media/Notifications/Transactions/Audit pages). Still implement **domain modules** for tickets/prizes/winners/referrals/notifications/audit **as backend internals** with APIs nested under lotteries / users / me where needed.

### Customer app surfaces (implement fully)

Home · Lotteries (live/finished) · Lottery detail (prizes + ticket grid + reserve/purchase) · My Tickets (active/won/history) · Wallet + Deposit flow · Profile (phone) · Notifications

---

## 3. Stack (locked to the implementation plan)

| Concern | Choice |
|---|---|
| Framework | NestJS 10+ · TypeScript |
| ORM | **Prisma** + PostgreSQL 16 |
| Events | `@nestjs/event-emitter` (domain events after DB commit) |
| Jobs | `@nestjs/schedule` (reservation expiry every ~15s) |
| Realtime | Socket.IO (`/ws/lottery`, `/ws/admin`) |
| Auth users | Telegram `initData` HMAC → internal JWT |
| Auth admin | Username/password · bcrypt · access JWT + refresh (httpOnly cookie) |
| Validation | class-validator / zod-equivalent DTO validation |
| Uploads | Multer + storage abstraction (local → S3-compatible) |
| Docs | Swagger at `/api/docs` |
| Security | helmet, CORS allowlist, throttler, parameterized queries only |
| Containers | Docker multi-stage + docker-compose (api + postgres) |

Money: **append-only `wallet_transactions` ledger**. `wallets.cached_balance` is a read cache updated in the **same transaction** as the ledger insert — never trust balance mutations alone.

---

## 4. Security Requirements (must be excellent)

1. **Separate auth realms** — user JWT must never authorize `/admin/*`; admin JWT must never authorize user purchase routes.
2. **Telegram initData** — verify HMAC exactly per Telegram docs; reject expired `auth_date`; ban check on every authenticated request.
3. **Admin passwords** — bcrypt cost ≥ 12; refresh token rotation; revoke on logout.
4. **IDOR prevention** — every user-scoped read/write filters by `userId` from JWT, never from client body alone.
5. **Ticket races** — `SELECT … FOR UPDATE` on ticket rows and wallet row inside purchase/reserve transactions.
6. **Deposit immutability** — once APPROVED/REJECTED, no reopen; approve credits wallet once (idempotent guard).
7. **Admin adjust** — non-empty `reason` required (DB CHECK + DTO); always audited.
8. **Uploads** — MIME allowlist, size caps, no executable types; store outside web root or private bucket; serve via signed URL or authenticated proxy.
9. **Secrets** — env-only; never commit `.env`; validate with Joi/Zod at boot.
10. **Rate limits** — stricter on `/auth/*`, `/tickets/reserve`, `/tickets/purchase`, `/wallet/deposits`.
11. **Error shape** — stable `{ statusCode, code, message }` with codes matching frontend expectations (`INSUFFICIENT_BALANCE`, `TICKET_ALREADY_SOLD`, `RESERVATION_EXPIRED`, `USER_BANNED`, `UNAUTHORIZED`).
12. **CORS** — explicit origins for Mini App host + Admin host.
13. **Draw fairness** — seed-commit hash before reveal; persist eligible ticket snapshot at lock; deterministic PRNG; audit trail.
14. **SQL** — Prisma only / no string-concat SQL.

---

## 5. Performance Requirements (must be excellent)

1. Indexes on: `tickets(lottery_id, ticket_number)` UNIQUE, `tickets(lottery_id, status)`, `ticket_reservations(expires_at, status)`, `deposits(status, created_at)`, `wallet_transactions(wallet_id, created_at)`, `users(telegram_id)` UNIQUE.
2. Lottery detail ticket grid: paginate or return compact status map; do not N+1 prizes/media.
3. Dashboard aggregates: single SQL/CTE or materialized counters updated via events — avoid scanning all tables on every request in production path; OK to start with efficient aggregate queries + cache headers/short Redis later.
4. WebSocket: push status diffs only; clients own countdown UI from `expiresAt`.
5. Reservation expiry cron: batch updates in transactions; use Postgres advisory lock if ever multi-instance.
6. Connection pooling via Prisma; keep transactions short.
7. Compress JSON responses; enable Nest compression where appropriate.
8. Media: don’t inline binaries in JSON — return URLs.

---

## 6. Domain Events (implement as plan §9)

After successful DB commit, emit typed events. Listeners (notifications, audit, websocket, referrals, wallets) must be **idempotent**.

Critical flows:

- `deposit.approved` → wallet credit ledger → notify user → admin WS counters  
- `ticket.reserved` / expired / purchased → lottery room WS updates  
- `draw.completed` / `winner.selected` → notify + audit + lottery history row  
- Admin mutations → audit interceptor  

**Order rule:** write DB → commit → emit. Never emit-then-write.

---

## 7. Deliverables Checklist

When finished, `lottery-backend` must contain:

- [ ] NestJS app with module layout matching the plan (`auth`, `users`, `wallets`, `deposits`, `media`, `lotteries`, `prizes`, `tickets`, `reservations`, `draw`, `winners`, `referrals`, `notifications`, `websocket`, `audit`, `admin-ops`, `settings`)
- [ ] Prisma schema + migrations from empty DB
- [ ] docker-compose (api + postgres) + Dockerfile + `.env.example`
- [ ] Swagger `/api/docs`
- [ ] All endpoints listed in `AI_BACKEND_FRONTEND_CONTRACT.md`
- [ ] Seed script: one OWNER admin, optional demo lottery
- [ ] Unit tests: wallet ledger math, reservation expiry, purchase concurrency (one winner), draw determinism
- [ ] E2E smoke: telegram auth (mocked HMAC), deposit approve→balance, reserve→purchase, lock→commit→reveal draw
- [ ] README: how to run, env vars, how frontends point to API

---

## 8. Explicit Anti-Patterns (forbidden)

- Static fake data in production services (presentation mocks are frontend-only)
- Mutable wallet balance without ledger rows
- Cross-module repository peeking (use services/events)
- Drawing without committed seed hash + eligible snapshot
- Allowing ticket purchase on LOCKED/CANCELLED/COMPLETED lotteries
- Reducing ticket quantity after sales started
- Trusting client-supplied prices at purchase (use reserved/sold price rules from business spec)
- Building microservices — this is a **modular monolith**

---

## 9. How to Use Companion Files

| File | Use |
|---|---|
| `BACKEND_IMPLEMENTATION_PLAN(1).md` | Architecture, modules, concurrency, draw, deposits provider, Docker |
| `Lottery_Lucky_Draw_Business_Logic.md` | Invariants and business edge cases |
| `AI_BACKEND_FRONTEND_CONTRACT.md` | **Page-by-page UI needs + concrete API list + DTO field mapping** |
| `lottery-frontend` / `lottery-Admin-frontend` | Source of truth for response field names the UI already expects |

If plan status names differ from admin UI (`OPEN` vs `LIVE`, `PUBLISHED` vs publish→LIVE), implement **canonical DB enums from the plan** and expose **API serializers** that match frontend enums — or update frontend later; prefer serializers so DB stays rigorous.

---

## 10. First Commands You Should Run

```bash
# inside lottery-backend
npx @nestjs/cli new . --skip-git   # or scaffold manually if folder not empty of docs only
# add prisma, modules, docker-compose
# prisma migrate dev
# npm run start:dev
```

Then implement Phase 1 (foundation + auth) before wallets, then lotteries/tickets, then draw.

**Start now:** inspect both frontends + both docs, then scaffold Nest + Prisma + Docker, then implement APIs per `AI_BACKEND_FRONTEND_CONTRACT.md` without leaving critical paths as stubs.

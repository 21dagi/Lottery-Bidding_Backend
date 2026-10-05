# Backend Job 1 of 2 — Foundation, Auth, Money & Deposits

**Job ID:** `BACKEND-JOB-1`  
**Repo:** `lottery-backend` (build from scratch — DB included)  
**Depends on:** nothing (this is the first job)  
**Produces for Job 2:** working Nest app, Prisma schema foundation, auth, wallets, deposits, media, settings, Docker

---

## How to use this prompt

Paste this entire file into a backend-focused AI agent, and also attach:

1. `BACKEND_IMPLEMENTATION_PLAN(1).md` (architecture — Nest modular monolith)
2. `docs/Lottery_Lucky_Draw_Business_Logic.md` (business invariants for wallet/deposit/user)
3. Sibling folders for **read-only inspection**:
   - `../lottery-frontend` (customer Mini App)
   - `../lottery-Admin-frontend` (owner panel)

**Do not** implement lotteries, tickets, reservations, purchase, draw, winners, or lottery websockets in this job. Those are **Job 2**.

---

## 1. Mission (Job 1 only)

Create a production-grade NestJS + PostgreSQL backend foundation so that:

- A **Telegram user** can authenticate, view profile/wallet, submit a deposit with screenshot, and see ledger history.
- An **admin/owner** can log in, review deposits (approve/reject), list/ban users, adjust wallets (with reason), and configure payment settings.
- Money is always correct via an **append-only ledger**.
- Security and performance baselines are in place before lottery complexity is added.

When Job 1 is done, Job 2 can add lotteries/tickets/draw on top of this foundation without rewriting auth or money.

---

## 2. Mandatory inspect-first steps (before coding)

1. Read the Backend Implementation Plan §§1–5, §8, §10, §12, §14 (architecture, data model overview, deposits provider, notifications sketch, auth, Docker).
2. Inspect customer frontend:
   - `lottery-frontend/src/features/wallet/*`
   - `lottery-frontend/src/features/wallet/depositPresentation.ts` (payment methods)
   - `lottery-frontend/src/features/profile/*`
   - `lottery-frontend/src/api/client.ts` (error codes)
3. Inspect admin frontend:
   - `lottery-Admin-frontend/src/features/deposits/*`
   - `lottery-Admin-frontend/src/features/users/*`
   - `lottery-Admin-frontend/src/features/wallets/*`
   - `lottery-Admin-frontend/src/features/settings/*`
   - `lottery-Admin-frontend/src/api/endpoints/index.ts` (auth, users, wallets, deposits, settings, dashboard stub ok)
   - `lottery-Admin-frontend/src/types/index.ts` (`Deposit`, `PlatformUser`, `Wallet`, `Settings`, `PaymentMethodId`)

Align response field names with those UIs where possible.

---

## 3. Stack (locked)

| Concern | Choice |
|---|---|
| Runtime | NestJS 10+ · TypeScript · Node 20 |
| DB | PostgreSQL 16 · **Prisma** |
| Events | `@nestjs/event-emitter` (emit **after** DB commit) |
| Auth user | Telegram `initData` HMAC → JWT |
| Auth admin | username/password · bcrypt (≥12) · access JWT + refresh httpOnly cookie |
| Validation | DTO validation (`class-validator` or Zod pipes) |
| Uploads | Multer + storage interface (local disk now, S3-ready) |
| Security | helmet, CORS allowlist, `@nestjs/throttler` |
| Docs | Swagger `/api/docs` |
| Containers | Dockerfile + docker-compose (`api` + `db`) |
| Tests | Jest unit + Supertest e2e for money paths |

---

## 4. Project structure to create

```text
lottery-backend/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   ├── common/          # guards, filters, decorators, events, money utils
│   ├── auth/
│   │   ├── telegram/
│   │   └── admin/
│   ├── users/
│   ├── wallets/
│   ├── deposits/
│   ├── media/
│   ├── settings/
│   ├── notifications/   # skeleton: persist in-app rows; Telegram adapter stub OK
│   ├── audit/           # append-only logs + AuditInterceptor on admin mutations
│   ├── admin-ops/       # thin dashboard aggregates (users/deposits/wallets only)
│   └── health/
└── README.md
```

Follow the plan’s modular monolith rules: modules talk via services/events, not each other’s repositories.

---

## 5. Prisma models required in Job 1

Implement at least:

### `AdminUser`
`id`, `username` (unique), `passwordHash`, `displayName`, `role` (`OWNER`), `createdAt`

### `User`
`id`, `telegramId` (unique), `telegramUsername?`, `displayName`, `phoneNumber?`, `isBanned`, `banReason?`, `createdAt`

### `Wallet`
`id`, `userId` (unique), `cachedBalance` (Decimal), `updatedAt`  
**Note:** `cachedBalance` is a **read cache only**. Source of truth = ledger.

### `WalletTransaction` (append-only)
`id`, `walletId`, `type` (`DEPOSIT|REFERRAL|ADMIN_ADJUST|PURCHASE` — PURCHASE unused until Job 2),  
`amount` (signed Decimal), `balanceAfter`, `referenceType?`, `referenceId?`, `reason?`,  
`createdByAdminId?`, `createdAt`  
**Never update/delete rows.**

### `Deposit`
`id`, `userId`, `amount`, `method` (`telebirr|cbe|mpesa|awash|abyssinia|amole`),  
`status` (`PENDING|APPROVED|REJECTED`), `mediaId` (screenshot),  
`verificationProviderResponse` Json?, `reviewedByAdminId?`, `reviewedAt?`, `rejectionReason?`, `createdAt`

### `Media`
`id`, `url`, `mimeType`, `sizeBytes`, `uploadedByType` (`USER|ADMIN`), `uploadedById`,  
`relatedEntityType?`, `relatedEntityId?`, `createdAt`

### `Notification`
`id`, `userId?`, `adminId?`, `channel` (`TELEGRAM|IN_APP`), `type`, `payload` Json,  
`status` (`QUEUED|SENT|FAILED`), `error?`, `createdAt`

### `AuditLog`
`id`, `actorType` (`ADMIN|SYSTEM`), `actorId`, `action`, `entityType`, `entityId`,  
`before` Json?, `after` Json?, `reason?`, `createdAt`

### `AppSettings` (single row or key-value)
Store bot username, support contact, payment instructions, and payment account list (methods enabled + pay-to label/value) matching admin Settings UI.

### Indexes (Job 1)
- `users(telegram_id)` unique  
- `deposits(status, created_at)`  
- `wallet_transactions(wallet_id, created_at)`  
- `admin_users(username)` unique  

> Leave Prisma models for lotteries/tickets/draws empty or omit until Job 2 — do not half-implement them here.

---

## 6. APIs you MUST implement (Job 1 scope)

### Auth — User
```text
POST /auth/telegram
  body: { initData: string, startParam?: string }
  → { data: { accessToken, user } }
  Verify Telegram HMAC; upsert user; create wallet if new; reject if banned.
```

### Auth — Admin
```text
POST /auth/admin/login     { username, password } → { data: { accessToken, admin } } + Set-Cookie refresh
POST /auth/admin/refresh   → new access token
POST /auth/admin/logout
GET  /auth/admin/me
```

### Me / Profile / Wallet (user JWT)
```text
GET   /me
PATCH /me/phone                      { phoneNumber }
GET   /me/wallet                     { balanceEtb, ... }
GET   /me/wallet/transactions        ?type&page&pageSize
GET   /me/deposits
POST  /me/deposits                   { amountEtb, method, mediaId }
GET   /me/notifications
POST  /me/notifications/:id/read
POST  /me/notifications/read-all
```

### Payments config (public or user JWT)
```text
GET /payments/methods
  → enabled methods from settings + paymentInstructions
  (matches deposit picker: telebirr, cbe, mpesa, awash, abyssinia, amole)
```

### Media
```text
POST /media/upload     multipart file (user or admin JWT)
GET  /media/:id        authorized
```
Constraints: image MIME allowlist, max size (e.g. 5MB), no executables.

### Admin — Users
```text
GET  /admin/users?q=&status=ACTIVE|BANNED
GET  /admin/users/:id
POST /admin/users/:id/ban      { reason }   // required
POST /admin/users/:id/unban
```

### Admin — Wallets
```text
GET  /admin/wallets
POST /admin/wallets/:userId/adjust   { amountEtb, reason }  // reason required, amount ≠ 0
```

### Admin — Deposits
```text
GET  /admin/deposits?status=PENDING|APPROVED|REJECTED
POST /admin/deposits/:id/approve
POST /admin/deposits/:id/reject    { reason }  // required
```
Queue default: PENDING oldest-first.

### Admin — Settings
```text
GET /admin/settings
PUT /admin/settings
```
Shape must match admin UI (`botUsername`, `supportContact`, `paymentInstructions`, `paymentAccounts[]`).

### Admin — Dashboard (partial OK)
```text
GET /admin/dashboard
```
For Job 1 return real counts for: `totalUsers`, `activeUsers`, `bannedUsers`, `pendingDeposits`, `walletBalancesTotal`, deposit trend if easy.  
Lottery/ticket fields may be `0` placeholders **documented** for Job 2 to fill.

### Health
```text
GET /health
```

### Docs
```text
GET /api/docs   (Swagger)
```

---

## 7. Domain logic rules (Job 1)

### Wallet ledger (non-negotiable)
1. Every balance change inserts a `WalletTransaction` then updates `cachedBalance` in the **same DB transaction**.
2. `cachedBalance` must equal `SUM(amount)` for that wallet after every write (assert in tests).
3. Deposit approve: `PENDING → APPROVED` once; credit positive `DEPOSIT` ledger row; emit `deposit.approved` then let wallet listener credit **or** credit inside deposits service then emit `wallet.credited` — pick one pattern and keep listeners idempotent.
4. Deposit reject: wallet untouched; reason stored; notify user.
5. Admin adjust: require non-empty reason; signed amount; audit log.

### Deposits
- Status terminal after approve/reject (Invariant #17).
- Pluggable `PaymentVerificationProvider` interface with `ManualReviewProvider` default (plan §8).
- Owner approve/reject remains authoritative.

### Auth security
- User JWT cannot access `/admin/*`.
- Admin JWT cannot access user purchase routes (future) or forge user ids.
- Throttle `/auth/*` and `/me/deposits`.
- Ban check on every user-authenticated request → `403 USER_BANNED`.

### Events to emit (Job 1)
`user.registered`, `user.banned`, `deposit.submitted`, `deposit.approved`, `deposit.rejected`,  
`wallet.credited`, `wallet.debited`, `wallet.admin_adjusted`, `admin.action_performed`  
Notifications + audit listeners react; Telegram channel may be stubbed but **in-app notification rows must persist**.

---

## 8. Response & error contract

Success envelope:
```json
{ "data": { }, "message": "optional" }
```

Errors:
```json
{ "statusCode": 400, "code": "REASON_REQUIRED", "message": "..." }
```

Codes to support now: `UNAUTHORIZED`, `USER_BANNED`, `VALIDATION_ERROR`, `REASON_REQUIRED`, `CONFLICT`, `NOT_FOUND`.

(Job 2 will add `INSUFFICIENT_BALANCE`, `TICKET_ALREADY_SOLD`, `RESERVATION_EXPIRED`, etc.)

---

## 9. Security checklist (Job 1)

- [ ] Env validation at boot (JWT secrets, DB URL, bot token, CORS origins)
- [ ] bcrypt cost ≥ 12 for admin passwords
- [ ] Refresh token rotation / httpOnly Secure cookie flags documented
- [ ] Helmet + CORS allowlist (Mini App origin + Admin origin)
- [ ] Upload MIME/size validation
- [ ] IDOR: user can only read own wallet/deposits/notifications
- [ ] Admin mutating routes wrapped by AuditInterceptor
- [ ] Parameterized Prisma queries only
- [ ] Rate limiting on auth + deposit submit

---

## 10. Performance checklist (Job 1)

- [ ] Indexes listed in §5
- [ ] Short transactions for approve/adjust
- [ ] Pagination on lists (users, deposits, transactions)
- [ ] Media returned as URLs, never base64 in JSON
- [ ] Connection pooling via Prisma

---

## 11. Seed & Docker

**Seed:**
- Admin user `owner` / strong password from env (`ADMIN_BOOTSTRAP_PASSWORD`)
- Default `AppSettings` with the six payment methods (Telebirr/CBE enabled by default as in admin mocks)

**Docker:**
- `docker-compose.yml`: `db` (postgres:16) + `api`
- Migrate on start (`prisma migrate deploy`)
- `.env.example` documenting all vars

---

## 12. Tests required before marking Job 1 done

1. **Ledger math:** deposit approve increases balance; reject does not; admin adjust with reason works; missing reason fails.
2. **Idempotency:** double-approve same deposit does not double-credit.
3. **Auth isolation:** user token rejected on `/admin/deposits`.
4. **Ban:** banned user gets `USER_BANNED`.
5. **E2E smoke:** telegram auth (HMAC mocked) → upload → create deposit → admin login → approve → `GET /me/wallet` shows new balance.

---

## 13. Explicitly OUT OF SCOPE for Job 1

Do **not** implement:

- Lotteries / prizes CRUD  
- Ticket inventory, reserve, purchase  
- Draw commit/reveal  
- Winners / fulfillment  
- Lottery Socket.IO rooms  
- Referral reward engine (optional: store `referredBy` on user only)  
- Full dashboard lottery metrics  

If you must touch schema for FKs Job 2 will need, only add empty stub comments in README — prefer Job 2 migrations.

---

## 14. Definition of Done (Job 1)

- [ ] `docker compose up` brings API + Postgres healthy  
- [ ] Swagger shows all Job 1 routes  
- [ ] Admin frontend deposit/users/wallets/settings endpoints exist and match DTO shapes  
- [ ] Customer wallet/deposit/profile endpoints exist  
- [ ] README section **“Handoff to Job 2”** lists: how to run, env vars, what schema exists, what events exist, dashboard fields still stubbed  
- [ ] All §12 tests green  

**Stop here.** Do not start Job 2 in the same session unless the human explicitly asks.

---

## 15. First actions

1. Inspect frontends + plan sections listed above.  
2. Scaffold Nest + Prisma + Docker.  
3. Implement schema + auth + wallets + deposits + media + settings + audit/notifications skeleton.  
4. Seed + tests + handoff notes for Job 2.

# Lottery Backend (Jobs 1 + 2)

NestJS + Supabase PostgreSQL modular monolith with **domain events** (`DB commit → emit → listeners`).

| Job | Scope |
|---|---|
| **1** | Auth, users, wallet ledger, deposits, media, settings, audit/notifications |
| **2** | Lotteries+prizes, tickets reserve/purchase, draw commit/reveal, winners, websockets, referrals |

## Quick start (Supabase Postgres)

1. Create a free project at [supabase.com](https://supabase.com) → **New project**.
2. Open **Project Settings → Database → Connection string**.
3. Copy into `.env`:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` (add `?pgbouncer=true&sslmode=require`)
   - **Session / direct** (port `5432`) → `DIRECT_URL` (add `?sslmode=require`)
4. Install deps, migrate, seed, run:

```bash
cp .env.example .env
# paste DATABASE_URL + DIRECT_URL from Supabase
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/health`
- WS: `/ws/lottery` (user JWT), `/ws/admin` (admin JWT)

Default admin: `owner` / `ChangeMeOwner!123`

## Event-driven architecture

Services **never emit before commit**. Pattern:

1. Interactive Prisma transaction (with `SELECT … FOR UPDATE` on tickets/wallet)
2. Commit succeeds
3. `DomainEventsService.emitAfterCommit(...)` / `emitManyAfterCommit(...)`
4. Idempotent `@OnEvent` listeners react:

| Listener | Events |
|---|---|
| `NotificationsService` | deposit / ticket / winner / wallet |
| `LotteryHistoryListener` | draw commit/reveal, winner payout |
| `LotteryGateway` / `AdminDashboardGateway` | ticket grid + admin counters |
| `ReferralsListener` | `ticket.purchased`, `deposit.approved` |
| `AuditService` | admin actions + money events |

## Concurrency notes

- **Reserve / purchase:** `FOR UPDATE` on ticket (+ wallet) rows inside a transaction
- **Reservation TTL:** 10 minutes; expiry cron every 15s with Postgres advisory lock
- **Draw:** lock freezes sold snapshot → commit stores SHA-256(seed) → reveal runs deterministic Fisher–Yates (HMAC-SHA256)

## Job 2 API highlights

- User: `GET /lotteries`, `GET /lotteries/:id`, `POST /tickets/reserve`, `POST /tickets/purchase`, `GET /me/tickets`, `GET /me/home`, `GET /me/referrals`
- Admin: `POST /admin/lotteries` (prizes embedded), publish/lock/cancel, `…/draw/commit|reveal`, `…/winners/:id/fulfill`
- Errors: `LOTTERY_NOT_OPEN`, `TICKET_ALREADY_SOLD`, `RESERVATION_EXPIRED`, `INSUFFICIENT_BALANCE`, `PHONE_REQUIRED`

## Deferred (when network is good)

1. Paste Supabase URLs into `.env`
2. `npm install` (+ prefer non-OneDrive path if TAR errors)
3. `npx prisma generate && npx prisma migrate deploy && npm run prisma:seed`
4. `npm run build && npm test && npm run start:dev`
5. Frontends: `VITE_USE_MOCKS=false` + `VITE_API_URL=http://localhost:3000`

# AI Backend — Frontend Contract & Functional API Map

**Companion to:** `AI_BACKEND_MASTER_PROMPT.md`  
**Purpose:** After inspecting both frontends, implement every capability below as real Postgres-backed APIs. No static presentation data on the server.

**Currency:** ETB  
**Locales on customer app:** EN / AM (API returns data; i18n stays client-side)

---

## A. System Context

```text
Telegram Mini App (lottery-frontend)
        │  Telegram initData → JWT
        ▼
   NestJS API + Postgres + Socket.IO
        ▲
        │  Admin username/password → JWT + refresh cookie
Owner Panel (lottery-Admin-frontend)
```

Both frontends currently use mocks / presentation data. Your job is to make APIs that replace those mocks 1:1 in capability.

---

## B. Customer App — Page-by-Page Backend Needs

### B1. Shell / Auth / Profile

**UI:** App loads inside Telegram; profile shows display name, phone requirement.

| Need | API |
|---|---|
| Exchange Telegram initData for session | `POST /auth/telegram` body `{ initData }` → `{ accessToken, user }` |
| Current user + wallet summary | `GET /me` |
| Set/update phone (required before purchase) | `PATCH /me/phone` `{ phoneNumber }` |
| Ban enforcement | Any authenticated call returns `403 USER_BANNED` |

**User fields for UI:** `id`, `telegramId`, `username`, `displayName`, `phoneNumber` (nullable until set), `isBanned`, `createdAt`, `wallet: { balanceEtb }`.

---

### B2. Home Dashboard

**UI shows:** wallet balance, active ticket entries, featured live lotteries, recent ledger rows.

| Need | API |
|---|---|
| Home aggregate (preferred) | `GET /me/home` → `{ balanceEtb, activeEntries[], featuredLotteries[], recentLedger[] }` |
| Or compose from | `GET /me` + `GET /me/tickets?status=active` + `GET /lotteries?status=live` + `GET /me/wallet/transactions?limit=10` |

**activeEntries item:** `{ lotteryId, lotteryTitle, ticketNumber, closesAt, status }`  
**featuredLotteries:** subset of lottery list cards (see B3)  
**ledger item:** `{ id, type, title, amountEtb, createdAt, meta }` where type ∈ `TICKET_PURCHASE|DEPOSIT|REFERRAL|ADMIN_ADJUST`

---

### B3. Lotteries List (`/lotteries`)

**UI tabs:** `live` | `finished`

| Need | API |
|---|---|
| List | `GET /lotteries?tab=live\|finished&page&pageSize` |

**List card fields (align with presentation):**

```ts
{
  id: string
  title: string
  seriesLabel: string
  status: 'live' | 'finished'   // API serializer from internal OPEN/COMPLETED etc.
  ticketPriceEtb: number
  rewardLabel: string           // derived from 1st prize title
  sold: number
  total: number
  closesAt: string              // ISO
  coverUrl: string
}
```

---

### B4. Lottery Detail (`/lotteries/:id`)

**UI:** countdown from `closesAt`, prize podium (places 1–3), ticket grid, reserve confirm, purchase.

| Need | API |
|---|---|
| Detail | `GET /lotteries/:id` |
| Reserve | `POST /tickets/reserve` `{ lotteryId, ticketNumbers: number[] }` |
| Purchase | `POST /tickets/purchase` `{ lotteryId, reservationId }` or `{ lotteryId, ticketNumbers }` (server re-validates reservation) |
| Finished archive | `GET /lotteries/:id/archive` (winners, proofs, timeline) — for finished draws |

**Detail payload:**

```ts
{
  id, title, seriesLabel, description,
  status: 'OPEN' | 'LOCKED' | 'COMPLETED' | ...,
  ticketPriceEtb, closesAt, totalTickets, soldCount, reservedCount,
  soldPercent: number,
  coverUrl,
  prizes: PrizeDTO[],
  // tickets: either full array for small N or
  ticketStatuses: { number: number, status: 'AVAILABLE'|'RESERVED'|'SOLD' }[],
  myReservation?: { id, ticketNumbers, expiresAt }
}
```

**PrizeDTO (must match customer + admin UI):**

```ts
{
  id: string
  place: 1 | 2 | 3
  kind: 'money' | 'product'
  title: string
  subtitle: string
  detail: string
  amountEtb?: number          // required if money
  imageUrl?: string           // required if product
  specs?: { label: string; value: string }[]
  fulfillmentNote?: string
}
```

**Reserve response:** `{ reservationId, expiresAt, tickets: [...] }`  
**Errors:** `TICKET_ALREADY_SOLD`, `RESERVATION_EXPIRED`, `LOTTERY_NOT_OPEN`, `PHONE_REQUIRED`, `USER_BANNED`  
**Purchase errors:** `INSUFFICIENT_BALANCE`, plus above  
**Business:** 10-minute hold; failed purchase never creates ownership; sold price frozen at purchase time.

**WebSocket:** join `lottery:<id>` on `/ws/lottery` with user JWT; events `ticket:update`.

---

### B5. My Tickets (`/tickets`)

**UI tabs:** active | won | history

| Need | API |
|---|---|
| Active groups by lottery | `GET /me/tickets?tab=active` |
| Won claims | `GET /me/tickets?tab=won` |
| Non-winning / expired / cancelled history | `GET /me/tickets?tab=history` |

**Active group:** `{ lotteryId, title, coverUrl, statusLabel, ticketNumbers[], closesAt, totalPaidEtb }`  
**Won claim:** `{ winnerId, lotteryTitle, place, prizeTitle, prizeKind, ticketNumber, fulfillmentStatus, evidenceUrl? }`  
**History entry:** `{ ticketNumber, lotteryTitle, reason: 'expired'|'cancelled'|'not_drawn' }`

---

### B6. Wallet (`/wallet`) + Deposit (`/wallet/deposit`)

**UI deposit steps:** choose method → amount → upload proof → submit.

Payment methods used in UI: `telebirr|cbe|mpesa|awash|abyssinia|amole`

| Need | API |
|---|---|
| Balance + ledger | `GET /me/wallet` → `{ balanceEtb, transactions[] }` |
| Filter ledger | `GET /me/wallet/transactions?type=&page=` |
| Public payment config | `GET /payments/methods` → enabled methods + pay-to label/value + instructions (from Settings) |
| Upload evidence | `POST /media/upload` multipart → `{ id, url }` |
| Submit deposit | `POST /me/deposits` `{ amountEtb, method, mediaId }` |
| My deposits | `GET /me/deposits` |

**Min amount:** enforce server-side (e.g. ≥ 50 ETB, configurable).  
**Deposit status:** `PENDING|APPROVED|REJECTED` — terminal after decision.

---

### B7. Notifications

| Need | API |
|---|---|
| In-app list | `GET /me/notifications?unreadOnly=` |
| Mark read | `POST /me/notifications/:id/read` or `POST /me/notifications/read-all` |
| Push | Socket user channel optional; Telegram Bot channel for important events |

---

### B8. Referrals (profile / future UI)

Customer API stubs exist conceptually; implement:

| Need | API |
|---|---|
| My referral code/link | `GET /me/referrals` |
| Attach referrer on register | handled in `POST /auth/telegram` if start_param present |

Reward crediting listens to first qualifying deposit/purchase per business rules.

---

## C. Admin App — Page-by-Page Backend Needs

### C1. Auth

| Need | API |
|---|---|
| Login | `POST /auth/admin/login` `{ username, password }` → `{ accessToken, admin }` + refresh cookie |
| Refresh | `POST /auth/admin/refresh` |
| Logout | `POST /auth/admin/logout` |
| Me | `GET /auth/admin/me` |

Admin: `{ id, username, displayName, role: 'OWNER' }`

---

### C2. Dashboard

| Need | API |
|---|---|
| Aggregate | `GET /admin/dashboard` |

**Shape expected by current admin UI:**

```ts
{
  liveLotteries: number
  finishedLotteries: number
  totalUsers: number
  activeUsers: number
  bannedUsers: number
  pendingDeposits: number
  ticketsSold: number
  walletBalancesTotal: number
  pendingFulfillments: number
  salesTrend: { date: string; sales: number; deposits: number }[]
}
```

**WebSocket `/ws/admin`:** `deposits:pending_count`, dashboard counter patches.

---

### C3. Lotteries List / Create / Detail

#### List

`GET /admin/lotteries` → paginated lotteries including nested `prizes[]`, sold counts, status.

Admin status enum used in UI: `DRAFT | LIVE | LOCKED | COMPLETED | CANCELLED`  
(Map from plan’s `DRAFT|PUBLISHED|OPEN|LOCKED|DRAWN|COMPLETED|CANCELLED` via serializer.)

#### Create (critical — prizes embedded)

`POST /admin/lotteries`

```ts
{
  title: string
  seriesLabel: string
  description: string
  ticketPriceEtb: number
  totalTickets: number
  closesAt: string
  coverMediaId?: string
  publish?: boolean          // if true → LIVE/OPEN immediately
  prizes: {
    place: 1 | 2 | 3
    kind: 'money' | 'product'
    title: string
    subtitle: string
    detail: string
    amountEtb?: number       // money
    imageMediaId?: string    // product
    specs?: { label: string; value: string }[]
    fulfillmentNote?: string
  }[]                        // 1–3 items; unique places
}
```

**On create:** generate ticket inventory `1..totalTickets` as AVAILABLE in same transaction.  
**Validation:** money requires amountEtb > 0; product requires image; places unique.

#### Lifecycle

```text
POST /admin/lotteries/:id/publish
POST /admin/lotteries/:id/lock
POST /admin/lotteries/:id/cancel
PATCH /admin/lotteries/:id          // only safe fields while DRAFT / before sales
```

Lock freezes eligible sold set for draw. Cannot sell after lock. Cannot reduce quantity after sales start.

#### Detail

`GET /admin/lotteries/:id` → full lottery + prizes + winners + history timeline + commitHash/revealedSeed if any.

#### Tickets (nested, not a global admin page)

`GET /admin/lotteries/:id/tickets?status=`  
(or `GET /admin/tickets?lotteryId=` — admin UI uses lottery-scoped query)

#### Draw (commit → reveal)

```text
POST /admin/lotteries/:id/draw/commit   → { commitHash }
POST /admin/lotteries/:id/draw/reveal   → { commitHash, revealedSeed, winners[] }
```

Matches admin DrawPanel UX. Persist draw row, winners, lottery history events.

#### Winners / fulfillment (nested)

```text
POST /admin/lotteries/:id/winners/:winnerId/fulfill
  { status: 'PENDING'|'PAID'|'DELIVERED'|'CREDITED'|'FAILED', evidenceMediaId? }
```

Append lottery history event on update.

#### Lottery history

Returned on detail as `history: { id, at, title, detail, tone }[]`  
Also write to global `audit_logs` for the same actions.

---

### C4. Deposits Queue

```text
GET  /admin/deposits?status=PENDING|APPROVED|REJECTED
POST /admin/deposits/:id/approve
POST /admin/deposits/:id/reject   { reason }   // reason required
```

**Deposit DTO:** `id, userId, userName, amount, method, status, screenshotUrl, createdAt, reviewedAt?, rejectionReason?`  
Approve → ledger DEPOSIT credit (once). Oldest PENDING first for queue UX.

Verification provider interface from plan §8: default `ManualReviewProvider`.

---

### C5. Users

```text
GET  /admin/users?q=&status=ACTIVE|BANNED
GET  /admin/users/:id
POST /admin/users/:id/ban     { reason }  // required
POST /admin/users/:id/unban
```

---

### C6. Wallets

```text
GET  /admin/wallets
POST /admin/wallets/:userId/adjust   { amountEtb, reason }  // reason required, amount ≠ 0
```

Show projected balance is client-side; server validates and appends ledger `ADMIN_ADJUST`.

---

### C7. Settings

```text
GET /admin/settings
PUT /admin/settings
```

**Shape:**

```ts
{
  botUsername: string
  supportContact: string
  paymentInstructions: string
  paymentAccounts: {
    method: 'telebirr'|'cbe'|'mpesa'|'awash'|'abyssinia'|'amole'
    label: string
    value: string
    enabled: boolean
  }[]
}
```

Customer `GET /payments/methods` reads the enabled subset.

---

### C8. Media

```text
POST /media/upload          // admin or user JWT
GET  /media/:id             // authorized
```

Used for: deposit screenshots, lottery covers, product prize images, payout evidence.

---

### C9. Optional / internal (no primary admin nav, still build)

| Capability | Endpoint |
|---|---|
| Global audit browse | `GET /admin/audit-logs?actor=&action=&entityType=&entityId=&from=&to=` |
| Referral rules | `GET/PUT /admin/referrals/rules` |
| Referral rewards list | `GET /admin/referrals/rewards` |
| Notification failure log | `GET /admin/notifications` |

Implement modules now; expose admin routes for future UI without blocking MVP.

---

## D. Canonical Error Codes

Align with customer `ApiError` expectations:

| Code | When |
|---|---|
| `UNAUTHORIZED` | Missing/invalid JWT or initData |
| `USER_BANNED` | Banned user |
| `PHONE_REQUIRED` | Purchase/reserve without phone |
| `INSUFFICIENT_BALANCE` | Purchase |
| `TICKET_ALREADY_SOLD` | Reserve/purchase race |
| `RESERVATION_EXPIRED` | Purchase after TTL |
| `LOTTERY_NOT_OPEN` | Sales closed |
| `VALIDATION_ERROR` | DTO failures |
| `REASON_REQUIRED` | Admin adjust / reject / ban without reason |
| `CONFLICT` | Illegal state transition |

Response envelope preferred by both UIs:

```ts
{ data: T, message?: string }
// errors:
{ statusCode: number, code: string, message: string }
```

---

## E. State Machine Mapping Cheatsheet

### Lottery (DB canonical → Admin UI)

| DB (plan) | Admin UI | Customer list tab |
|---|---|---|
| DRAFT | DRAFT | hidden |
| PUBLISHED / OPEN | LIVE | live |
| LOCKED | LOCKED | live or hidden from buy |
| DRAWN / COMPLETED | COMPLETED | finished |
| CANCELLED | CANCELLED | hidden / finished archive optional |

### Ticket (simplify for UI if needed)

Plan: `AVAILABLE|SELECTED|RESERVED|PAYMENT_PENDING|SOLD|WINNER|CANCELLED`  
Customer/Admin grids primarily show: `AVAILABLE|RESERVED|SOLD` (map others into these for display).

### Deposit

`PENDING → APPROVED|REJECTED` (immutable)

### Winner fulfillment

Cash: `PENDING → CONTACTED → PAID` (UI also uses `CREDITED`)  
Product: `PENDING → CONTACTED → DELIVERED`  
Expose statuses admin UI already uses: `PENDING|PAID|DELIVERED|CREDITED|FAILED`

---

## F. Concurrency & Money — Implementation Reminders

1. **Reserve:** transaction + `FOR UPDATE` ticket rows; only AVAILABLE → RESERVED; write reservation TTL 10m.  
2. **Expiry cron:** every 15s; ACTIVE reservations past `expires_at` → EXPIRED; tickets → AVAILABLE; emit WS.  
3. **Purchase:** validate reservation ownership + not expired; `FOR UPDATE` wallet; ledger debit; tickets SOLD; reservation CONVERTED; emit events.  
4. **Deposit approve:** single transition; ledger credit; idempotent if already approved.  
5. **Draw:** on lock snapshot sold ticket IDs; commit SHA-256(seed); on reveal run deterministic selection per prize place without replacement across tickets.

---

## G. Inspection Paths (tell the AI to open these first)

### Customer (`lottery-frontend`)

```text
src/app/router.tsx
src/features/home/presentationData.ts
src/features/lotteries/presentationData.ts
src/features/lotteries/finishedDrawPresentation.ts
src/features/lotteries/LotteryDetailPage.tsx
src/features/my-tickets/presentationData.ts
src/features/wallet/depositPresentation.ts
src/features/wallet/DepositPage.tsx
src/api/client.ts
```

### Admin (`lottery-Admin-frontend`)

```text
src/app/router.tsx
src/app/layout/Sidebar.tsx
src/types/index.ts
src/api/endpoints/index.ts
src/mock/data.ts
src/mock/index.ts
src/features/lotteries/LotteryCreateWizard.tsx
src/features/lotteries/LotteryDetailPage.tsx
src/features/draw/DrawPanel.tsx
src/features/deposits/DepositsQueuePage.tsx
src/features/settings/SettingsPage.tsx
```

---

## H. Acceptance Criteria (backend AI must self-verify)

1. Fresh `docker compose up` → migrate → seed admin → API healthy.  
2. Swagger lists all routes in sections B–C.  
3. Admin can create lottery with 3 prizes (mix money/product) and see tickets generated.  
4. User can auth (test harness), deposit (pending), admin approve → balance increases via ledger.  
5. User reserve → second user fails same tickets → first purchases → WS observers see SOLD.  
6. After lock: commit hash visible; reveal creates winners; lottery history entries exist.  
7. No endpoint depends on in-memory mock arrays for business data.  
8. Load test note: document indexes and `FOR UPDATE` strategy in README.

---

## I. What “Done” Means

The backend is done when **both frontends can turn off mocks** (`VITE_USE_MOCKS=false`) and every screen listed above loads and mutates against this API without inventing new product concepts. Prefer adapting serializers to existing frontend field names over forcing large frontend rewrites—unless a rename is required for security clarity.

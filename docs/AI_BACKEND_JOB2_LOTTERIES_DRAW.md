# Backend Job 2 of 2 — Lotteries, Tickets, Draw, Realtime & Completion

**Job ID:** `BACKEND-JOB-2`  
**Repo:** `lottery-backend`  
**Depends on:** **Job 1 completed** (`AI_BACKEND_JOB1_FOUNDATION.md`)  
**Produces:** full lottery product API so both frontends can disable mocks

---

## How to use this prompt

Paste this entire file into a backend-focused AI agent **after Job 1 is merged/working**, and attach:

1. `BACKEND_IMPLEMENTATION_PLAN(1).md` (especially §§5–7, §9, §11, §13, §15–16)
2. `docs/Lottery_Lucky_Draw_Business_Logic.md` (lottery, tickets, reservation, draw, winners, referrals)
3. Job 1 handoff notes / existing `lottery-backend` code
4. Sibling frontends for inspection:
   - `../lottery-frontend`
   - `../lottery-Admin-frontend`

**Do not** rewrite Job 1 money/auth from scratch. Extend it. If Job 1 is missing something critical, fix minimally, then continue.

---

## 1. Mission (Job 2 only)

Implement the entire **lottery trading loop** with enterprise-grade concurrency, fairness, and realtime:

1. Admin creates a lottery **with prizes embedded** (places 1–3, money or product).
2. System generates ticket inventory.
3. Users browse live/finished lotteries, view prizes, reserve tickets (10 min), purchase from wallet.
4. Admin locks → seed-commit → reveal draw → winners created.
5. Admin updates fulfillment (paid/delivered) with evidence; lottery **history** timeline updates.
6. Socket.IO updates ticket grids + admin counters.
7. Referrals hook into purchase/deposit events; dashboard lottery metrics become real.

**Performance + security are mandatory** (see §§8–9).

---

## 2. Mandatory inspect-first steps

### Customer app (contracts to satisfy)
```text
lottery-frontend/src/app/router.tsx
lottery-frontend/src/features/home/presentationData.ts
lottery-frontend/src/features/lotteries/presentationData.ts
lottery-frontend/src/features/lotteries/finishedDrawPresentation.ts
lottery-frontend/src/features/lotteries/LotteryDetailPage.tsx
lottery-frontend/src/features/my-tickets/presentationData.ts
lottery-frontend/src/features/tickets/*
```

### Admin app (contracts to satisfy)
```text
lottery-Admin-frontend/src/app/router.tsx
lottery-Admin-frontend/src/app/layout/Sidebar.tsx
lottery-Admin-frontend/src/types/index.ts
lottery-Admin-frontend/src/api/endpoints/index.ts
lottery-Admin-frontend/src/features/lotteries/LotteryCreateWizard.tsx
lottery-Admin-frontend/src/features/lotteries/LotteryDetailPage.tsx
lottery-Admin-frontend/src/features/draw/DrawPanel.tsx
lottery-Admin-frontend/src/features/dashboard/DashboardPage.tsx
```

### Critical product rules from frontends
- **No standalone Prizes admin module.** Prizes are created inside `POST /admin/lotteries`.
- **No standalone Tickets/Winners admin pages.** Nested under lottery detail.
- **History is lottery-scoped** (`lottery.history[]` timeline), plus global audit from Job 1.
- Prize shape: `place: 1|2|3`, `kind: 'money'|'product'`, money → `amountEtb`, product → image + specs.

---

## 3. Modules to add (on top of Job 1)

```text
src/
├── lotteries/          # CRUD, lifecycle state machine, history events
├── prizes/             # nested under lotteries (no public “prize catalog” product API)
├── tickets/            # inventory, purchase orchestration
├── reservations/       # 10-minute holds + expiry cron
├── draw/               # seed-commit / reveal engine
├── winners/            # winner records + fulfillment
├── referrals/          # rules + reward crediting via events
└── websocket/          # /ws/lottery + /ws/admin gateways
```

Complete Job 1 stubs: fill `GET /admin/dashboard` lottery/ticket fields; wire Telegram notifications for lottery events if bot token present.

---

## 4. Prisma models to add (Job 2 migration)

### `Lottery`
`id`, `title`, `seriesLabel`, `description`, `coverMediaId?`,  
`ticketQuantity`, `ticketPrice` (Decimal),  
`status` enum **canonical DB values from plan**:  
`DRAFT | PUBLISHED | OPEN | LOCKED | DRAWN | COMPLETED | CANCELLED`,  
`deadlineAt` / `closesAt`, `lockReason?`, `createdByAdminId`, `createdAt`, `updatedAt`

**API serializers** must also support admin UI labels:
- `LIVE` ⇐ `PUBLISHED` or `OPEN`
- `COMPLETED` ⇐ `DRAWN` or `COMPLETED`

### `Prize`
`id`, `lotteryId`, `place` (1–3, unique per lottery), `kind` (`money|product`),  
`title`, `subtitle`, `detail`, `amountEtb?`, `imageMediaId?`,  
`specs` Json?, `fulfillmentNote?`

### `Ticket`
`id`, `lotteryId`, `ticketNumber` (int),  
`status` (`AVAILABLE|SELECTED|RESERVED|PAYMENT_PENDING|SOLD|WINNER|CANCELLED`),  
`ownerUserId?`, `soldPrice?`, `soldAt?`  
**UNIQUE (`lotteryId`, `ticketNumber`)**

### `TicketReservation`
`id`, `ticketId`, `userId`, `reservedAt`, `expiresAt`,  
`status` (`ACTIVE|EXPIRED|CONVERTED|CANCELLED`)

### `Purchase`
`id`, `userId`, `lotteryId`, `ticketIds` (or join table), `totalAmount`,  
`walletTransactionId`, `createdAt` — immutable

### `Draw`
`id`, `lotteryId`, `eligibleTicketSnapshot` Json (sold ticket ids at lock),  
`seedCommitHash`, `seedReveal?`, `rngAlgorithm`, `executedByAdminId?`, `executedAt?`

### `Winner`
`id`, `drawId`, `prizeId`, `ticketId`, `userId`,  
`payoutStatus` (`PENDING|CONTACTED|PAID|DELIVERED|CREDITED|FAILED`),  
`payoutEvidenceMediaId?`, `payoutNotes?`, `updatedByAdminId?`, `updatedAt`

### `LotteryHistoryEvent`
`id`, `lotteryId`, `at`, `title`, `detail`, `tone` (`neutral|accent|success|danger`)  
(Admin History tab reads this.)

### `Referral` / `ReferralReward` / `ReferralRule` (settings)
As in the implementation plan.

### Indexes (mandatory)
- `tickets(lottery_id, ticket_number)` UNIQUE  
- `tickets(lottery_id, status)`  
- `ticket_reservations(status, expires_at)`  
- `lotteries(status, deadline_at)`  
- `winners(lottery/draw, payout_status)`  

---

## 5. State machines (enforce in services)

### Lottery transitions
```text
DRAFT → PUBLISHED/OPEN (publish)
OPEN → LOCKED (lock) → DRAWN (reveal) → COMPLETED
OPEN → CANCELLED
```
Reject illegal transitions. No sales when not OPEN. No quantity reduction after sales started.

### Ticket
```text
AVAILABLE → RESERVED → SOLD → WINNER
RESERVED → AVAILABLE (expiry)
```
Failed purchase never leaves ownership (Invariant #6).

### Winner fulfillment
Cash: toward `PAID` / `CREDITED`  
Product: toward `DELIVERED`  
Admin UI statuses: `PENDING|PAID|DELIVERED|CREDITED|FAILED`

---

## 6. APIs you MUST implement (Job 2)

### Public / User — Lotteries & tickets
```text
GET  /lotteries?tab=live|finished&page&pageSize
GET  /lotteries/:id
GET  /lotteries/:id/archive          # finished: winners, proofs, timeline
POST /tickets/reserve                { lotteryId, ticketNumbers: number[] }
POST /tickets/purchase               { lotteryId, reservationId }  # or equivalent
GET  /me/tickets?tab=active|won|history
GET  /me/home                        # optional aggregate: balance + active entries + featured + ledger
GET  /me/referrals
```

**`GET /lotteries/:id` must include:** prizes[], ticketStatuses (or compact grid), sold/reserved counts, closesAt, myReservation if any.

**Reserve:** 10-minute TTL; `SELECT … FOR UPDATE` on tickets; only AVAILABLE.  
**Purchase:** re-check reservation ownership + expiry; `FOR UPDATE` wallet; ledger `PURCHASE` debit; mark SOLD with frozen `soldPrice`; convert reservation.

Error codes to add:
`INSUFFICIENT_BALANCE`, `TICKET_ALREADY_SOLD`, `RESERVATION_EXPIRED`, `LOTTERY_NOT_OPEN`, `PHONE_REQUIRED`

### Admin — Lotteries
```text
GET  /admin/lotteries
POST /admin/lotteries                # body includes prizes[] (1–3 places)
GET  /admin/lotteries/:id            # + prizes, winners, history, draw fields
PATCH /admin/lotteries/:id           # safe edits only
POST /admin/lotteries/:id/publish
POST /admin/lotteries/:id/lock
POST /admin/lotteries/:id/cancel
GET  /admin/lotteries/:id/tickets?status=
GET  /admin/tickets?lotteryId=&status=   # if admin client uses this
```

**Create body (align with admin wizard):**
```ts
{
  title, seriesLabel, description,
  ticketPriceEtb, totalTickets, closesAt,
  coverMediaId?, publish?: boolean,
  prizes: [{
    place: 1|2|3,
    kind: 'money'|'product',
    title, subtitle, detail,
    amountEtb?, imageMediaId?,
    specs?: { label: string; value: string }[],
    fulfillmentNote?
  }]
}
```
On create (same transaction): insert lottery + prizes + generate tickets `1..N` AVAILABLE + history event “Draft created” / “Published”.

### Admin — Draw (matches DrawPanel)
```text
POST /admin/lotteries/:id/draw/commit   → { commitHash }
POST /admin/lotteries/:id/draw/reveal   → { commitHash, revealedSeed, winners[] }
```

**Commit:** generate CSPRNG seed, store only SHA-256 hash; visible before reveal.  
**Reveal:** store seed; deterministic selection over **frozen sold snapshot** from lock; one winner ticket per prize place without replacement across tickets; same user may win multiple places if they own multiple tickets; write winners + history; emit events.

### Admin — Fulfillment
```text
POST /admin/lotteries/:id/winners/:winnerId/fulfill
  { status, evidenceMediaId? }
```
Append lottery history event.

### Admin — Dashboard complete
Fill Job 1 placeholders:
`liveLotteries`, `finishedLotteries`, `ticketsSold`, `pendingFulfillments`, `salesTrend` (ticket sales + deposits).

### Referrals / optional admin
```text
GET/PUT /admin/referrals/rules
GET /admin/referrals/rewards
GET /admin/audit-logs?...            # already scaffolded in Job 1 — ensure lottery actions appear
```

---

## 7. Concurrency design (must be excellent)

### Reserve
1. Begin transaction.  
2. `SELECT tickets … WHERE id IN (…) FOR UPDATE`.  
3. Assert all AVAILABLE and lottery OPEN.  
4. Set RESERVED; insert ACTIVE reservations with `expiresAt = now()+10m`.  
5. Commit → emit `ticket.reserved` → WS broadcast.

### Expiry cron (`*/15 * * * * *`)
Find ACTIVE reservations with `expiresAt < now()` in batches; set EXPIRED; tickets AVAILABLE; emit `ticket.reservation.expired`.  
If multi-instance later: Postgres advisory lock (document in README).

### Purchase
1. Transaction.  
2. Lock reservation + tickets + wallet row.  
3. Validate ownership, ACTIVE, not expired, lottery still OPEN (or allow until lock per business rule — default: only OPEN).  
4. Ensure `cachedBalance >= total`.  
5. Insert PURCHASE ledger (negative), update cache, insert Purchase, tickets SOLD, reservation CONVERTED.  
6. Commit → emit `ticket.purchased` → referrals/notifications/WS/audit.

### Parallel purchase test
N concurrent purchases for the same ticket → **exactly one** success; others `TICKET_ALREADY_SOLD`.

---

## 8. Draw fairness (must be excellent)

1. On **lock**: persist `eligibleTicketSnapshot` = all SOLD ticket IDs (immutable).  
2. On **commit**: `seed = randomBytes(32)`; store `sha256(seed)` only.  
3. On **reveal**: store seed; seed deterministic PRNG; shuffle/select distinct tickets for each prize place sorted by place.  
4. Anyone with snapshot + seed can recompute — add a small pure function + unit test proving determinism.  
5. Never draw without commit hash.

---

## 9. WebSockets

### `/ws/lottery`
- Auth: user JWT  
- Client joins room `lottery:<id>`  
- Server emits `ticket:update` `{ ticketNumber, status, expiresAt? }` on reserve/expiry/purchase  
- Do **not** push per-second countdowns

### `/ws/admin`
- Auth: admin JWT  
- Emit `deposits:pending_count`, dashboard counter patches, optional `lottery:sales`  
- Thin gateways: listen to domain events only

---

## 10. Domain events to add

| Event | Emit after | Listeners |
|---|---|---|
| `lottery.published` / `locked` / `cancelled` | lotteries | notifications, WS, audit, history |
| `ticket.reserved` | reservations | WS |
| `ticket.reservation.expired` | reservations | WS, notifications |
| `ticket.purchased` | tickets | referrals, notifications, WS, audit |
| `draw.completed` | draw | notifications, audit |
| `winner.selected` | draw | notifications, WS, audit |
| `winner.payout_updated` | winners | notifications, audit, history |
| `referral.reward_credited` | referrals | wallets, notifications, audit |

Rule: **DB commit first, emit second.** Listeners idempotent.

---

## 11. Security requirements (Job 2)

- [ ] Phone required before reserve/purchase (`PHONE_REQUIRED`)  
- [ ] Banned users blocked  
- [ ] IDOR: users only purchase/reserve as themselves  
- [ ] Admin-only for draw/lifecycle/fulfill  
- [ ] Rate-limit reserve/purchase harder than reads  
- [ ] Do not trust client ticket price — use lottery price at reservation/purchase server-side  
- [ ] Upload evidence for fulfillment via media module (Job 1)  
- [ ] Audit every admin lifecycle/draw/fulfill action  

---

## 12. Performance requirements (Job 2)

- [ ] All indexes in §4  
- [ ] Ticket grid endpoint avoids N+1 (single query / status map)  
- [ ] Pagination for admin ticket lists on large inventories  
- [ ] Short lock scope on FOR UPDATE  
- [ ] Dashboard aggregates via efficient SQL (CTE/group by), not loading all tickets into Node  
- [ ] WS fan-out by room, not global broadcast of all lotteries  

---

## 13. Tests required before marking Job 2 done

1. **Create lottery** with 3 prizes (money/product mix) → N tickets AVAILABLE.  
2. **Reserve race:** two users reserve overlapping tickets → only valid set succeeds.  
3. **Purchase concurrency:** parallel purchase same ticket → one winner.  
4. **Expiry:** reserved ticket returns AVAILABLE after TTL (accelerate clock / set past expiresAt in test).  
5. **Insufficient balance** purchase fails without selling tickets.  
6. **Draw determinism:** same snapshot + seed → same winners.  
7. **Commit-before-reveal:** reveal without commit fails.  
8. **E2E journey:** publish → user reserve+purchase → lock → commit → reveal → fulfill winner → history entries present.  
9. **Dashboard** returns non-zero live/sold metrics after journey.

---

## 14. Explicitly OUT OF SCOPE / do not reopen

- Replacing Prisma with another ORM  
- Microservices split  
- Standalone admin pages for Prizes/Tickets/Winners (backend nested APIs only)  
- Blockchain draws  
- Auto-approving deposits without owner (unless settings flag — default off)

---

## 15. Definition of Done (Job 2 = platform backend complete)

- [ ] Job 1 flows still green  
- [ ] All Job 2 routes in Swagger  
- [ ] Admin can run full create → publish → lock → draw → fulfill against API  
- [ ] Customer can list/detail/reserve/purchase/my-tickets against API  
- [ ] Sockets update a second client on reserve/purchase  
- [ ] Frontends can set `VITE_USE_MOCKS=false` and point at this API (document env)  
- [ ] README updated: full architecture, how to run e2e, concurrency notes, seed  
- [ ] §13 tests green  

---

## 16. First actions

1. Confirm Job 1 app boots; read handoff notes.  
2. Inspect lottery UIs listed above.  
3. Add Prisma migration for lottery domain.  
4. Implement lotteries+prizes create path first (admin wizard blocker).  
5. Implement reserve/purchase/expiry next (money leaves wallet).  
6. Implement lock/commit/reveal/winners/history.  
7. Wire websockets + dashboard + referrals.  
8. Run full test suite and write frontend connection notes.

**Start only after Job 1 Definition of Done is satisfied.**

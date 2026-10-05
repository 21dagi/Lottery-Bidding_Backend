# Backend AI prompts — which file to use

The backend build is split into **two jobs**. Use these prompts (not a single mega-prompt):

| Order | File | Scope |
|---|---|---|
| **1st** | [`AI_BACKEND_JOB1_FOUNDATION.md`](./AI_BACKEND_JOB1_FOUNDATION.md) | Nest scaffold, Docker, Prisma, Telegram+Admin auth, users, wallet ledger, deposits, media, settings, audit/notifications skeleton, partial dashboard |
| **2nd** | [`AI_BACKEND_JOB2_LOTTERIES_DRAW.md`](./AI_BACKEND_JOB2_LOTTERIES_DRAW.md) | Lotteries+embedded prizes, tickets, 10m reserve, purchase, draw commit/reveal, winners/fulfillment, lottery history, websockets, referrals, full dashboard |

## What to attach each time

**Job 1 agent:**
1. `AI_BACKEND_JOB1_FOUNDATION.md`
2. `BACKEND_IMPLEMENTATION_PLAN(1).md`
3. `Lottery_Lucky_Draw_Business_Logic.md`
4. Access to `lottery-frontend` + `lottery-Admin-frontend` (inspect wallet/deposit/users/settings)

**Job 2 agent (after Job 1 done):**
1. `AI_BACKEND_JOB2_LOTTERIES_DRAW.md`
2. Same plan + business logic docs
3. Existing `lottery-backend` code from Job 1
4. Access to both frontends (inspect lotteries/tickets/draw pages)

## Older reference files (optional)

- `AI_BACKEND_MASTER_PROMPT.md` — earlier combined brief (superseded by the two jobs)
- `AI_BACKEND_FRONTEND_CONTRACT.md` — page/API map reference (jobs already embed the needed contracts)

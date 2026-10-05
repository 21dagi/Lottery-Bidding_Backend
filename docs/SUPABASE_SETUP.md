# Supabase setup — lottery-bid

Project: **lottery-bid**  
Project ID: `wnmqiwflylfphcyvplbb`  
Region pooler: `aws-0-eu-west-1.pooler.supabase.com`

## Connection strings (`.env`)

```env
# Runtime (transaction pooler :6543)
DATABASE_URL=postgresql://postgres.wnmqiwflylfphcyvplbb:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require&sslaccept=accept_invalid_certs

# Migrations (session pooler :5432)
DIRECT_URL=postgresql://postgres.wnmqiwflylfphcyvplbb:YOUR_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&sslaccept=accept_invalid_certs
```

URL-encode special characters in the password (`@` → `%40`).

## After URLs are set

```bash
cd lottery-backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

Seed creates:

- Admin `owner` / `ChangeMeOwner!123` (or `ADMIN_BOOTSTRAP_PASSWORD`)
- Demo users telegramId `100001` (Ada), `100002` (Belay), `100003` (Chala)
- Live + finished demo lotteries, pending deposit, notifications

## Auth model

### Mini App (Telegram)

1. Client sends Telegram `initData` → `POST /auth/telegram`
2. Backend verifies **HMAC** with `TELEGRAM_BOT_TOKEN` (mock usernames cannot forge this)
3. Identity is **`telegram_id`** from the signed payload (username is display-only)
4. If the user has no phone → Mini App shows the phone gate modal → `PATCH /me/phone`
5. Ticket reserve/purchase also require phone server-side (`PHONE_REQUIRED`)

Browser-only demos (no Telegram) use `POST /auth/dev/login` in development only.

### Admin web

- Real credential login: `POST /auth/admin/login` (username + password, bcrypt)
- JWT access + httpOnly refresh cookie
- `VITE_USE_MOCKS=false` — all features hit the live API

## Frontends

- Mini app: `VITE_USE_MOCKS=false`, API `http://localhost:3000`
- Admin: `public/env.js` mocks **false**, base URL **without** `/api`

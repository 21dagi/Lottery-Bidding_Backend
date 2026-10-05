#!/bin/sh
set -e
# DIRECT_URL must be set in env for migrate (Supabase session/direct connection)
npx prisma migrate deploy
npx prisma db seed || true
exec node dist/main.js

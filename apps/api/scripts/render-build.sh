#!/usr/bin/env bash
# Build for a free test server on Render (also fine for any host without a separate release step).
# Installs, compiles, applies database migrations, loads the base data (markets, roles, categories, super admin),
# and — only when DEMO_SEED_ALLOW=yes with a private DEMO_PASSWORD — the demo shop.
set -euo pipefail
npm ci --include=dev
npx prisma generate
npm run build
npx prisma migrate deploy
npx tsx scripts/lock-data-api.ts   # Supabase: tables never reachable through its public REST API
SEED_ONLY_IF_EMPTY=yes npm run db:seed   # first deploy only (a set-up database is left alone)
npx tsx scripts/category-pictures.ts   # drawn tile pictures for categories that have none (uploads are kept)
if [ "${DEMO_SEED_ALLOW:-}" = "yes" ]; then
  npm run db:seed:demo
fi

# Edge Functions Deployment (Single Source of Truth)

This project currently has two Supabase function trees:

- Canonical: `backend/supabase/functions`
- Mirror: `supabase/functions`

To avoid drift and production inconsistencies, always edit/deploy from the canonical path.

## 1) Sync mirror after function changes

```bash
./scripts/sync-supabase-functions.sh
./scripts/check-supabase-drift.sh
```

## 2) Deploy functions from canonical root

```bash
cd backend
supabase functions deploy payments
supabase functions deploy heat-sync
supabase functions deploy kiosk-bootstrap
supabase functions deploy stripe-webhook
# Optional if used:
supabase functions deploy health-check
```

Or use the helper script:

```bash
# deploy only
./scripts/deploy-supabase-functions.sh

# deploy + push secrets from file
./scripts/deploy-supabase-functions.sh --with-secrets backend/supabase/.secrets/functions.env
```

## 3) Recommended secrets

Set secrets in the target Supabase project before deployment:

```bash
cd backend
supabase secrets set N8N_PAYMENT_INIT_WEBHOOK=...
supabase secrets set N8N_API_KEY=...
supabase secrets set N8N_HEAT_SYNC_URL=...
supabase secrets set HEAT_SYNC_SECRET=...
supabase secrets set N8N_PAYMENT_CONFIRMED_WEBHOOK=...
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_WEBHOOK_SECRET=...
```

## 4) Why this matters

- Frontend deploy scripts do not deploy Supabase Edge Functions.
- If `supabase/functions` and `backend/supabase/functions` diverge, runtime behavior becomes unpredictable.
- Keeping `backend/supabase/functions` as source reduces hidden regressions.

# Stripe Webhook Edge Function

Handles Stripe payment webhooks, verifies signatures, updates database, and triggers n8n workflows.

## 🚀 Quick Start

### 1. Install Supabase CLI

```bash
npm install -g supabase
```

### 2. Login to Supabase

```bash
supabase login
```

### 3. Link to your project

```bash
supabase link --project-ref xwaymumbkmwxqifihuvn
```

### 4. Set environment secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
supabase secrets set SUPABASE_URL=https://xwaymumbkmwxqifihuvn.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
supabase secrets set N8N_PAYMENT_CONFIRMED_WEBHOOK=https://automation.surfjudging.cloud/webhook/payment_confirmed
supabase secrets set N8N_API_KEY=rplaraise@surfjudging
```

### 5. Test locally

```bash
supabase functions serve stripe-webhook
```

Test with Stripe CLI:
```bash
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook
stripe trigger checkout.session.completed
```

### 6. Deploy to production

```bash
supabase functions deploy stripe-webhook
```

Your function will be available at:
```
https://xwaymumbkmwxqifihuvn.supabase.co/functions/v1/stripe-webhook
```

## 🔧 Configure Stripe Webhook

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. URL: `https://xwaymumbkmwxqifihuvn.supabase.co/functions/v1/stripe-webhook`
4. Events to send:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Save and copy the **Signing secret**
6. Update the secret: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx`

## 🧪 Testing

### Test with real Stripe webhook

1. Create a payment via your `payment_init` workflow
2. Complete the checkout
3. Check Supabase logs:
```bash
supabase functions logs stripe-webhook
```

### Verify in database

```sql
SELECT * FROM payments WHERE status = 'completed' ORDER BY paid_at DESC LIMIT 5;
SELECT * FROM events WHERE paid = true ORDER BY id DESC LIMIT 5;
```

## 📊 What it does

1. ✅ Receives webhook from Stripe
2. ✅ Verifies signature (security)
3. ✅ Updates `payments` table (status → completed)
4. ✅ Updates `events` table (paid → true, status → active)
5. ✅ Triggers n8n workflow for emails/notifications
6. ✅ Logs everything for debugging

## 🔐 Security

- Webhook signature verification with Stripe SDK
- Service role key for database access
- HTTPS only endpoint
- All secrets stored securely in Supabase

## 📝 Logs

View logs in real-time:
```bash
supabase functions logs stripe-webhook --tail
```

## 🐛 Troubleshooting

**Function not deploying?**
```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

**Secrets not updating?**
```bash
supabase secrets list
supabase secrets unset SECRET_NAME
supabase secrets set SECRET_NAME=new_value
```

**Logs not showing?**
Add more console.log statements and redeploy.

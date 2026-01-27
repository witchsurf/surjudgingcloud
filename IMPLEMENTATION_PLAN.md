# Payment Confirmation Webhook - Implementation Plan

## Goal

Implement a secure webhook endpoint that receives Stripe payment confirmations, updates the database, and triggers post-payment workflows (email notifications, event activation, configuration pre-fill).

---

## User Review Required

> [!IMPORTANT]
> **Stripe Webhook Endpoint URL**: The webhook will be accessible at:
> ```
> https://automation.surfjudging.cloud/webhook/payment_confirm
> ```
> This URL must be configured in your Stripe Dashboard under **Developers → Webhooks**.

> [!WARNING]
> **Webhook Signing Secret**: You'll need to add the Stripe webhook signing secret to your n8n environment variables as `STRIPE_WEBHOOK_SECRET`. This is critical for security.

---

## Proposed Changes

### n8n Workflow: `payment_confirm`

**Webhook URL**: `https://automation.surfjudging.cloud/webhook/payment_confirm`

**Expected Events from Stripe**:
- `checkout.session.completed` (session finalized, payment may still be processing)
- `payment_intent.succeeded` (payment confirmed)
- `payment_intent.payment_failed` (payment failed)

---

#### **Node 1: Webhook Trigger**

**Type**: Webhook  
**Path**: `/webhook/payment_confirm`  
**Method**: POST  
**Authentication**: None (Stripe signature verification handled in next node)

---

#### **Node 2: Verify Stripe Signature** (Code)

**Purpose**: Security - verify the webhook came from Stripe

```javascript
const crypto = require('crypto');

const signature = $json.headers['stripe-signature'];
const payload = $json.body;
const secret = $env.STRIPE_WEBHOOK_SECRET;

// Stripe signature format: t=timestamp,v1=signature
const elements = signature.split(',');
const signatureHash = elements.find(e => e.startsWith('v1=')).split('=')[1];
const timestamp = elements.find(e => e.startsWith('t=')).split('=')[1];

// Construct signed payload
const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;

// Compute expected signature
const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(signedPayload)
  .digest('hex');

// Verify
if (signatureHash !== expectedSignature) {
  throw new Error('Invalid Stripe signature');
}

// Check timestamp to prevent replay attacks (5 minutes tolerance)
const currentTime = Math.floor(Date.now() / 1000);
if (currentTime - parseInt(timestamp) > 300) {
  throw new Error('Webhook timestamp too old');
}

return [{
  json: {
    ...payload,
    verified: true
  }
}];
```

---

#### **Node 3: Parse Event Type** (Switch)

**Route based on** `$json.type`:

| Event Type | Route To |
|------------|----------|
| `checkout.session.completed` | Handle Checkout Session |
| `payment_intent.succeeded` | Handle Payment Success |
| `payment_intent.payment_failed` | Handle Payment Failure |
| Other | Log & Ignore |

---

#### **Node 4a: Handle Checkout Session** (Code)

Extract session details:

```javascript
const session = $json.data.object;

return [{
  json: {
    event_type: 'checkout_completed',
    session_id: session.id,
    payment_status: session.payment_status, // 'paid', 'unpaid', 'no_payment_required'
    amount_total: session.amount_total,
    currency: session.currency,
    customer_email: session.customer_details?.email,
    metadata: session.metadata // custom data passed during session creation
  }
}];
```

---

#### **Node 4b: Handle Payment Success** (Code)

Extract payment intent details:

```javascript
const paymentIntent = $json.data.object;

return [{
  json: {
    event_type: 'payment_succeeded',
    payment_intent_id: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: paymentIntent.status,
    metadata: paymentIntent.metadata
  }
}];
```

---

#### **Node 5: Query Payment Record** (HTTP Request to Supabase)

**Method**: GET  
**URL**: 
```
https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/payments?transaction_ref=eq.{{ $json.session_id || $json.payment_intent_id }}&select=*
```

**Headers**:
- `apikey`: `{{ $env.SUPABASE_SERVICE_ROLE_KEY }}`
- `Accept`: `application/vnd.pgrst.object+json` (return single object)

---

#### **Node 6: Check if Already Processed** (If)

**Condition**: `$json.status === 'completed'`

**True** → Return (idempotency - already processed)  
**False** → Continue to update

---

#### **Node 7: Update Payment Status** (HTTP Request to Supabase)

**Method**: PATCH  
**URL**: 
```
https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/payments?id=eq.{{ $('Query Payment Record').first().json.id }}
```

**Headers**:
- `apikey`: `{{ $env.SUPABASE_SERVICE_ROLE_KEY }}`
- `Content-Type`: `application/json`
- `Prefer`: `return=representation`

**Body** (Expression):
```javascript
({
  status: $json.event_type === 'payment_succeeded' ? 'completed' : 'failed',
  paid_at: new Date().toISOString(),
  metadata: $json.metadata
})
```

---

#### **Node 8: Update Event Status** (HTTP Request to Supabase)

**Method**: PATCH  
**URL**: 
```
https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/events?id=eq.{{ $('Query Payment Record').first().json.event_id }}
```

**Headers**:
- `apikey`: `{{ $env.SUPABASE_SERVICE_ROLE_KEY }}`
- `Content-Type`: `application/json`

**Body** (Expression):
```javascript
({
  paid: true,
  status: 'active'
})
```

---

#### **Node 9: Send Confirmation Email** (Send Email)

**To**: `{{ $('Query Payment Record').first().json.customer_email || 'organizer@surfjudging.cloud' }}`

**Subject**: `Payment Confirmed - Event #{{ $('Query Payment Record').first().json.event_id }}`

**HTML Body**:
```html
<h1>Payment Confirmed!</h1>
<p>Your payment for Event #{{ $('Query Payment Record').first().json.event_id }} has been successfully processed.</p>

<h2>Payment Details</h2>
<ul>
  <li>Amount: {{ $('Query Payment Record').first().json.amount / 100 }} {{ $('Query Payment Record').first().json.currency.toUpperCase() }}</li>
  <li>Status: Completed</li>
  <li>Transaction ID: {{ $('Query Payment Record').first().json.transaction_ref }}</li>
</ul>

<p>Your event is now <strong>active</strong> and ready to configure!</p>
<p><a href="https://surfjudging.cloud/events/{{ $('Query Payment Record').first().json.event_id }}">Go to Event Dashboard</a></p>
```

---

#### **Node 10: (Optional) Pre-fill Event Config** (Code)

Create demo participants, default heat configs:

```javascript
const eventId = $('Query Payment Record').first().json.event_id;

// This would call additional Supabase endpoints to:
// 1. Insert demo participants
// 2. Create default heat_configs
// 3. Initialize heat_timers

return [{
  json: {
    event_id: eventId,
    config_initialized: true
  }
}];
```

---

#### **Node 11: Log Webhook** (HTTP Request to Supabase - Audit Table)

Store webhook events for debugging:

**Method**: POST  
**URL**: `https://xwaymumbkmwxqifihuvn.supabase.co/rest/v1/webhook_logs`

**Body**:
```javascript
({
  event_type: $json.type,
  payload: $json,
  processed_at: new Date().toISOString(),
  status: 'success'
})
```

---

## Verification Plan

### 1. Stripe Dashboard Setup

1. Go to **Stripe Dashboard** → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. URL: `https://automation.surfjudging.cloud/webhook/payment_confirm`
4. Events to send:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copy the **Signing secret** and add to n8n environment as `STRIPE_WEBHOOK_SECRET`

### 2. Test with Stripe CLI

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local/staging n8n
stripe listen --forward-to https://automation.surfjudging.cloud/webhook/payment_confirm

# Trigger test event
stripe trigger checkout.session.completed
```

### 3. Manual Test

1. Create a payment via `payment_init` workflow
2. Complete the Stripe checkout
3. Verify:
   - Payment status updated to `completed` in `payments` table
   - Event status updated to `active` in `events` table
   - Confirmation email received
   - Webhook logged in audit table

### 4. Idempotency Test

Replay the same webhook twice and verify the second call doesn't duplicate data.

---

## Security Considerations

1. **Signature Verification**: Always verify Stripe signatures before processing
2. **Timestamp Check**: Reject webhooks older than 5 minutes (replay attack prevention)
3. **HTTPS Only**: Ensure webhook endpoint is HTTPS
4. **Rate Limiting**: Add rate limiting to webhook endpoint (n8n settings or reverse proxy)
5. **Secret Rotation**: Document process for rotating `STRIPE_WEBHOOK_SECRET`

---

## Error Handling

- **Failed Signature**: Return 401, log the attempt
- **Database Error**: Retry 3 times with exponential backoff, then send to DLQ
- **Email Error**: Log but don't fail the workflow (non-critical)
- **Duplicate Webhook**: Return 200 OK (idempotency handled)


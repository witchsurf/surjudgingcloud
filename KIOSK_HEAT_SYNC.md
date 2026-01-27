# Kiosk & Heat_Sync Workflows - Documentation

## Overview

This documentation describes the kiosk-bootstrap and heat-sync workflows integrated into the SurfJudging application. These N8N workflows provide real-time heat configuration initialization and synchronization capabilities through Supabase Edge Functions.

---

## Architecture

```
Frontend (React)
    ↓
useRealtimeSync Hook
    ↓
Supabase Edge Functions
    ├─→ kiosk-bootstrap
    └─→ heat-sync
        ↓
    N8N Workflows
        ↓
   Supabase Database
    (heat_realtime_config)
```

---

## Components

### 1. N8N Workflows

#### kiosk-bootstrap
- **Purpose**: Initialize kiosk configuration for a heat
- **Webhook URL**: `https://automation.surfjudging.cloud/webhook/kiosk/bootstrap`
- **Method**: POST
- **Authentication**: x-api-key header
- **Input**:
  ```json
  {
    "eventId": 1,
    "heat_id": "competition_division_r1_h1"
  }
  ```
- **Output**:
  ```json
  {
    "heat_id": "competition_division_r1_h1",
    "event_id": 1,
    "judges": [{ "id": "j1", "name": "Judge 1" }],
    "surfers": [{ "id": "s1", "name": "Surfer 1", "color": "red" }],
    "timer": {
      "isRunning": false,
      "startTime": null,
      "duration": 20
    },
    "config": { /* AppConfig */ },
    "status": "waiting"
  }
  ```

#### heat-sync
- **Purpose**: Synchronize heat state changes to database
- **Webhook URL**: `https://automation.surfjudging.cloud/webhook/heat/sync`
- **Method**: POST
- **Authentication**: x-heat-sync-secret header
- **Input**:
  ```json
  {
    "heat_id": "competition_division_r1_h1",
    "status": "running",
    "timer_start_time": "2025-12-17T22:00:00Z",
    "timer_duration_minutes": 20,
    "config_data": { /* AppConfig */ }
  }
  ```
- **Output**:
  ```json
  {
    "success": true,
    "heat_id": "competition_division_r1_h1"
  }
  ```

---

### 2. Supabase Edge Functions

#### `/functions/v1/kiosk-bootstrap`

Located at: `/backend/supabase/functions/kiosk-bootstrap/index.ts`

**Purpose**: Wrapper for N8N kiosk-bootstrap workflow

**Usage**:
```typescript
const { data, error } = await supabase.functions.invoke('kiosk-bootstrap', {
  body: {
    eventId: 1,
    heat_id: 'competition_division_r1_h1'
  }
});
```

**Environment Variables**:
- `N8N_KIOSK_BOOTSTRAP_URL` or `WEBHOOK_URL/webhook/kiosk/bootstrap`
- `PAYMENT_API_KEY` - N8N API key for authentication

#### `/functions/v1/heat-sync`

Located at: `/backend/supabase/functions/heat-sync/index.ts`

**Purpose**: Wrapper for N8N heat-sync workflow

**Usage**:
```typescript
const { error } = await supabase.functions.invoke('heat-sync', {
  body: {
    heat_id: 'competition_division_r1_h1',
    status: 'running',
    timer_start_time: new Date().toISOString(),
    timer_duration_minutes: 20
  }
});
```

**Environment Variables**:
- `N8N_HEAT_SYNC_URL` or `WEBHOOK_URL/webhook/heat/sync`
- `HEAT_SYNC_SECRET` - Webhook validation secret

---

### 3. Frontend Integration

#### useRealtimeSync Hook

Located at: `/frontend/src/hooks/useRealtimeSync.ts`

**New Functions**:

##### `initializeKiosk(eventId, heatId)`
Initializes kiosk configuration for a heat.

```typescript
const { initializeKiosk } = useRealtimeSync();

try {
  const kioskConfig = await initializeKiosk(1, 'competition_division_r1_h1');
  console.log('Kiosk initialized:', kioskConfig);
} catch (error) {
  console.error('Kiosk initialization failed:', error);
}
```

##### `syncHeatViaWebhook(heatId, updates)`
Syncs heat updates via webhook (alternative to direct database update).

```typescript
const { syncHeatViaWebhook } = useRealtimeSync();

try {
  await syncHeatViaWebhook('competition_division_r1_h1', {
    status: 'running',
    timer_start_time: new Date().toISOString(),
    timer_duration_minutes: 20
  });
  console.log('Heat synced successfully');
} catch (error) {
  console.error('Heat sync failed:', error);
}
```

---

## Environment Variables

### Required in `/infra/.env`:

```bash
# N8N Webhook URLs
WEBHOOK_URL=https://automation.surfjudging.cloud
N8N_KIOSK_BOOTSTRAP_URL=https://automation.surfjudging.cloud/webhook/kiosk/bootstrap
N8N_HEAT_SYNC_URL=https://automation.surfjudging.cloud/webhook/heat/sync

# Authentication
PAYMENT_API_KEY=your-n8n-api-key
HEAT_SYNC_SECRET=generate-random-secret
```

### Generate HEAT_SYNC_SECRET:

```bash
openssl rand -base64 32
```

---

## Deployment

### 1. Activate N8N Workflows

**Via N8N Web Interface**:
1. Go to https://automation.surfjudging.cloud
2. Login with credentials
3. Navigate to Workflows
4. Click on `kiosk-bootstrap` → Activate
5. Click on `heat-sync` → Activate

**Via SSH**:
```bash
ssh root@195.35.2.170
sqlite3 /var/lib/docker/volumes/infra_n8n_data/_data/database.sqlite
UPDATE workflow_entity SET active=1 WHERE name IN ('kiosk-bootstrap', 'heat-sync');
.quit
```

### 2. Deploy Edge Functions

```bash
cd backend/supabase

# Deploy kiosk-bootstrap
npx supabase functions deploy kiosk-bootstrap

# Deploy heat-sync
npx supabase functions deploy heat-sync

# Verify
npx supabase functions list
```

### 3. Set Environment Variables

```bash
npx supabase secrets set HEAT_SYNC_SECRET=$(openssl rand -base64 32)
npx supabase secrets set WEBHOOK_URL=https://automation.surfjudging.cloud
npx supabase secrets set PAYMENT_API_KEY=your-n8n-api-key
```

---

## Testing

### Test kiosk-bootstrap locally:

```bash
cd backend/supabase
npx supabase functions serve kiosk-bootstrap --env-file ../../infra/.env

# In another terminal:
curl -X POST http://localhost:54321/functions/v1/kiosk-bootstrap \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"eventId": 1, "heat_id": "test_heat_1"}'
```

### Test heat-sync locally:

```bash
cd backend/supabase
npx supabase functions serve heat-sync --env-file ../../infra/.env

# In another terminal:
curl -X POST http://localhost:54321/functions/v1/heat-sync \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "heat_id": "test_heat_1",
    "status": "running",
    "timer_start_time": "2025-12-17T22:00:00Z",
    "timer_duration_minutes": 20
  }'
```

---

## Database Schema

### heat_realtime_config table

```sql
CREATE TABLE heat_realtime_config (
  heat_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'waiting',
  timer_start_time TIMESTAMP WITH TIME ZONE,
  timer_duration_minutes INTEGER DEFAULT 20,
  config_data JSONB DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT DEFAULT 'system'
);
```

---

## Troubleshooting

### Edge Function returns 401 Unauthorized
- Check that `PAYMENT_API_KEY` is set correctly
- Verify N8N webhook accepts the API key

### N8N workflow not executing
1. Check workflow is active in N8N
2. Verify webhook URL is accessible
3. Check N8N execution logs: https://automation.surfjudging.cloud

### Heat sync fails
- Verify `HEAT_SYNC_SECRET` matches in both N8N and Edge Function
- Check database permissions on `heat_realtime_config` table
- View Supabase Edge Function logs

---

## Next Steps

1. ✅ Create Edge Functions
2. ✅ Update frontend hooks
3. ⏸️ Integrate into AdminInterface component
4. ⏸️ Test end-to-end flow
5. ⏸️ Deploy to production

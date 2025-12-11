# 🚀 Deployment Guide - Surf Judging System

This guide covers deploying your surf judging application with proper security configuration.

## 📋 Table of Contents
- [Prerequisites](#prerequisites)
- [Security Configuration](#security-configuration)
- [Database Migrations](#database-migrations)
- [Environment Variables](#environment-variables)
- [Deployment Steps](#deployment-steps)
- [Post-Deployment Checklist](#post-deployment-checklist)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node.js 18+ and npm
- Supabase project (cloud or self-hosted)
- Domain name with SSL certificate (for production)
- Stripe account (for payments)

---

## Security Configuration

### 🔒 **CRITICAL: Apply Security Migrations First**

The application includes critical security fixes that MUST be applied before deployment:

```bash
# Navigate to your project
cd judging

# Apply all migrations in order
supabase db push

# Or manually apply migrations:
psql -h YOUR_DB_HOST -U postgres -d YOUR_DB_NAME -f supabase/migrations/20251109000000_fix_security_policies.sql
psql -h YOUR_DB_HOST -U postgres -d YOUR_DB_NAME -f supabase/migrations/20251109000001_consolidate_triggers.sql
```

### What These Migrations Fix:

1. **Row-Level Security (RLS) Policies**
   - ❌ Before: Any authenticated user could access ANY event data
   - ✅ After: Users can only access their own events or paid/public events
   - ✅ After: Judges can only score during active heats
   - ✅ After: Only event owners can override scores

2. **Database Performance**
   - Adds composite indexes for faster queries
   - Optimizes heat lookups by event/division/status

3. **Race Condition Prevention**
   - Consolidates 5+ overlapping triggers into one unified trigger
   - Adds proper database locking to prevent conflicts
   - Uses `SKIP LOCKED` and `NOWAIT` for concurrent safety

---

## Database Migrations

### Verify Migrations Applied Successfully

```bash
# Check applied migrations
supabase migration list

# Or via SQL:
psql -c "SELECT * FROM supabase_migrations.schema_migrations ORDER BY version;"
```

### Expected Migrations

You should see these migrations applied:
- `20251109000000_fix_security_policies.sql` - Security fixes
- `20251109000001_consolidate_triggers.sql` - Trigger consolidation
- All previous migrations in `supabase/migrations/`

---

## Environment Variables

### Frontend (.env)

Create `.env` file in project root:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Optional: Analytics
VITE_GA_TRACKING_ID=UA-XXXXXXXXX-X
```

### Supabase Edge Functions

Set these secrets in Supabase Dashboard > Edge Functions > Secrets:

```bash
# Required for Stripe payments
STRIPE_SECRET_KEY=sk_live_...

# Required for CORS security (comma-separated list)
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Automatically set by Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Setting Supabase Secrets

```bash
# Via Supabase CLI
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set ALLOWED_ORIGINS=https://yourdomain.com

# Or via Dashboard: Settings > Edge Functions > Secrets
```

---

## Deployment Steps

### 1. **Database Setup**

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Apply all migrations
supabase db push

# Verify RLS policies are active
supabase db execute "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';"
```

### 2. **Deploy Edge Functions**

```bash
# Deploy payment function
supabase functions deploy payments

# Verify deployment
supabase functions list
```

### 3. **Build Frontend**

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Output will be in dist/ folder
```

### 4. **Deploy Frontend**

#### Option A: Vercel

```bash
npm install -g vercel
vercel --prod
```

#### Option B: Netlify

```bash
npm install -g netlify-cli
netlify deploy --prod --dir=dist
```

#### Option C: Static Hosting (Supabase Storage, S3, etc.)

```bash
# Upload dist/ folder to your static host
aws s3 sync dist/ s3://your-bucket-name --acl public-read
```

### 5. **Configure CORS**

After deployment, add your production domain to `ALLOWED_ORIGINS`:

```bash
supabase secrets set ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

---

## Post-Deployment Checklist

### ✅ Security Verification

- [ ] RLS policies are enabled on all tables
- [ ] Test that users can't access other users' events
- [ ] Test that judges can only score during active heats
- [ ] Verify CORS only allows your domains
- [ ] Check that scores can't be inserted when heat is not running
- [ ] Confirm score overrides only work for event owners

### ✅ Functionality Testing

- [ ] Create new event and verify it appears in database
- [ ] Import participants via CSV
- [ ] Generate tournament bracket
- [ ] Start a heat and test real-time sync
- [ ] Submit scores from multiple judge accounts
- [ ] Test score override functionality
- [ ] Close heat and verify auto-transition to next heat
- [ ] Test offline mode (disconnect internet)
- [ ] Test payment flow (Stripe/Orange Money/Wave)

### ✅ Performance Checks

- [ ] Check database query performance
- [ ] Verify real-time subscriptions work
- [ ] Monitor localStorage usage (should stay under 80%)
- [ ] Check expired data is being cleaned up
- [ ] Verify no console errors in browser

### ✅ Monitoring Setup

```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'postgres';

-- Check slow queries
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Check table sizes
SELECT schemaname, tablename,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Troubleshooting

### Issue: "Permission denied for table scores"

**Cause:** RLS policies not applied correctly

**Fix:**
```bash
# Reapply security migration
supabase db reset
supabase db push

# Or manually check policies
SELECT * FROM pg_policies WHERE tablename = 'scores';
```

### Issue: "CORS policy blocked"

**Cause:** Request origin not in ALLOWED_ORIGINS

**Fix:**
```bash
# Update allowed origins
supabase secrets set ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Redeploy edge function
supabase functions deploy payments
```

### Issue: "Heat won't advance to next"

**Cause:** Trigger consolidation not applied or deadlock

**Fix:**
```bash
# Check trigger status
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%heat%';

# Reapply trigger migration
psql -f supabase/migrations/20251109000001_consolidate_triggers.sql

# Check for locks
SELECT * FROM pg_locks WHERE NOT granted;
```

### Issue: "localStorage full error"

**Cause:** Too much cached data

**Fix:**
```javascript
// In browser console:
import { clearExpiredItems, getStorageInfo } from './src/utils/secureStorage';

// Check usage
console.log(getStorageInfo());

// Clear expired items
clearExpiredItems();
```

### Issue: "Scores not syncing"

**Cause:** Offline mode or Supabase connection issue

**Fix:**
1. Check network connectivity
2. Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
3. Check browser console for errors
4. Manually trigger sync:
```javascript
// In SyncStatus component, click "Sync Now" button
```

---

## Performance Optimization

### Database Indexes

The security migration adds these indexes automatically:
- `idx_heats_event_division_status` - Fast heat lookups
- `idx_heat_entries_heat_id_position` - Fast entry lookups
- `idx_scores_heat_judge` - Fast score queries
- `idx_participants_event_category_seed` - Fast participant queries

### Real-time Optimization

```sql
-- Check realtime connections
SELECT * FROM realtime.messages LIMIT 10;

-- Monitor subscription count
SELECT count(*) FROM realtime.subscription;
```

### localStorage Management

```javascript
// Monitor storage usage
import { getStorageInfo } from './src/utils/secureStorage';
console.log(getStorageInfo());

// Should be < 80% for optimal performance
// If higher, expired data will be auto-cleaned
```

---

## Security Best Practices

### 1. **Rotate Secrets Regularly**

```bash
# Every 90 days, rotate:
supabase secrets set STRIPE_SECRET_KEY=sk_live_NEW_KEY
```

### 2. **Monitor Failed Login Attempts**

```sql
-- Check auth logs
SELECT * FROM auth.audit_log_entries
WHERE action = 'user_signedup'
ORDER BY created_at DESC
LIMIT 100;
```

### 3. **Enable Supabase Rate Limiting**

In Supabase Dashboard > Settings > API:
- Enable rate limiting
- Set reasonable limits (e.g., 100 req/min per IP)

### 4. **Regular Backups**

```bash
# Backup database daily
pg_dump -h YOUR_DB_HOST -U postgres -d YOUR_DB_NAME > backup_$(date +%Y%m%d).sql

# Or use Supabase automated backups (Pro plan)
```

---

## Production Checklist

Before going live:

- [ ] SSL certificate installed and working
- [ ] All environment variables set in production
- [ ] Security migrations applied
- [ ] CORS configured with production domains
- [ ] Rate limiting enabled
- [ ] Monitoring/logging set up
- [ ] Backup strategy in place
- [ ] Test payment flow with real money (small amount)
- [ ] Load testing completed
- [ ] Mobile responsiveness verified
- [ ] Cross-browser testing done (Chrome, Firefox, Safari)
- [ ] User documentation written
- [ ] Support channels established

---

## Support

For issues or questions:
1. Check [Supabase Docs](https://supabase.com/docs)
2. Review application logs in Supabase Dashboard
3. Check browser console for frontend errors
4. Review this guide's troubleshooting section

---

## Changelog

- **2025-11-09**: Initial deployment guide created
  - Added security migration instructions
  - Added trigger consolidation guide
  - Added CORS configuration
  - Added troubleshooting section

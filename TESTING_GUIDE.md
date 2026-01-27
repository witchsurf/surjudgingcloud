# 🧪 Migration Testing Guide

Complete step-by-step guide to test the security and performance migrations.

---

## 📋 Prerequisites

Before testing, ensure you have:
- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] PostgreSQL client installed (`psql`)
- [ ] Local Supabase project running OR connection to remote Supabase
- [ ] Database credentials ready

---

## 🚀 Quick Start - Automated Testing

### Step 1: Link to Your Supabase Project

```bash
# Navigate to project directory
cd /Users/laraise/Desktop/judging

# Link to your Supabase project
supabase link --project-ref YOUR_PROJECT_REF

# Or if using local Supabase:
supabase start
```

### Step 2: Apply Migrations

```bash
# Apply all migrations (includes our new security fixes)
supabase db push

# You should see output like:
# Applying migration 20251109000000_fix_security_policies.sql...
# Applying migration 20251109000001_consolidate_triggers.sql...
# Migrations complete!
```

### Step 3: Run Automated Tests

```bash
# Run the test suite
supabase db execute -f supabase/migrations/TEST_MIGRATIONS.sql

# Or using psql directly:
psql postgresql://postgres:YOUR_PASSWORD@YOUR_HOST:5432/postgres -f supabase/migrations/TEST_MIGRATIONS.sql
```

### Expected Output

You should see:
```
========================================
TEST 1: Checking Helper Functions
========================================
✓ user_has_event_access exists
✓ user_is_judge_for_heat exists
TEST 1: PASSED ✓

========================================
TEST 2: Checking RLS Policies
========================================
✓ Old permissive policies removed
✓ Found 24 new secure policies
✓ scores_insert_accessible policy exists
✓ events_read_own_or_paid policy exists
TEST 2: PASSED ✓

... (more tests)

========================================
✅ ALL TESTS PASSED!
========================================
```

---

## 🔍 Manual Testing Steps

If automated tests fail or you want to verify manually:

### Test 1: Verify Migrations Applied

```sql
-- Check migration history
SELECT * FROM supabase_migrations.schema_migrations
WHERE version LIKE '20251109%'
ORDER BY version;

-- Expected: Both migrations should be present
-- 20251109000000
-- 20251109000001
```

### Test 2: Verify Helper Functions

```sql
-- Test user_has_event_access function
SELECT proname, pronargs
FROM pg_proc
WHERE proname IN ('user_has_event_access', 'user_is_judge_for_heat');

-- Expected: 2 rows returned
```

### Test 3: Verify RLS Policies

```sql
-- List all policies on scores table
SELECT policyname, permissive, cmd, qual::text
FROM pg_policies
WHERE tablename = 'scores';

-- Expected policies:
-- scores_read_accessible (SELECT)
-- scores_insert_accessible (INSERT)
-- scores_update_accessible (UPDATE)

-- Check for old permissive policies (should return 0)
SELECT COUNT(*)
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true');

-- Expected: 0 (or very few remaining on non-critical tables)
```

### Test 4: Verify Indexes

```sql
-- Check if performance indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_heats_event_division_status',
    'idx_heat_entries_heat_id_position',
    'idx_scores_heat_judge',
    'idx_participants_event_category_seed'
  );

-- Expected: 4 rows returned
```

### Test 5: Verify Triggers

```sql
-- Check trigger consolidation
SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger
WHERE tgname LIKE '%heat%'
  AND tgname NOT LIKE 'pg_%';

-- Should NOT see:
-- trg_advance_on_finished
-- trg_auto_transition_heats
-- trg_normalize_close
-- trg_gala_ondine_auto_transition

-- Should see:
-- trg_unified_heat_transition (on heat_realtime_config)
-- trg_sync_heat_status (on heats)
```

### Test 6: Test RLS Enforcement

```sql
-- Create test users and event
BEGIN;

-- Simulate User A creating an event
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'user-a-uuid';

INSERT INTO events (name, organizer, start_date, end_date, price, user_id, paid)
VALUES ('User A Event', 'Organizer A', CURRENT_DATE, CURRENT_DATE + 1, 10000, 'user-a-uuid', false);

-- User A should see their event
SELECT COUNT(*) FROM events WHERE name = 'User A Event';
-- Expected: 1

-- Simulate User B trying to access User A's event
SET LOCAL request.jwt.claim.sub TO 'user-b-uuid';

-- User B should NOT see User A's unpaid event
SELECT COUNT(*) FROM events WHERE name = 'User A Event';
-- Expected: 0

ROLLBACK;
```

### Test 7: Test Score Insertion Rules

```sql
BEGIN;

-- Create test heat
INSERT INTO heats (id, event_id, competition, division, round, heat_number, status)
VALUES ('TEST_HEAT', 1, 'Test', 'OPEN', 1, 1, 'waiting');

-- Create heat realtime config with status = 'waiting'
INSERT INTO heat_realtime_config (heat_id, status)
VALUES ('TEST_HEAT', 'waiting');

-- Try to insert score when heat is NOT running (should fail)
INSERT INTO scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp)
VALUES ('test-score', 'TEST_HEAT', 'Test', 'OPEN', 1, 'J1', 'Judge 1', 'ROUGE', 1, 7.5, NOW());
-- Expected: ERROR (RLS policy violation)

-- Update heat to running
UPDATE heat_realtime_config SET status = 'running' WHERE heat_id = 'TEST_HEAT';

-- Try again (should succeed if you have proper event access)
INSERT INTO scores (id, heat_id, competition, division, round, judge_id, judge_name, surfer, wave_number, score, timestamp)
VALUES ('test-score', 'TEST_HEAT', 'Test', 'OPEN', 1, 'J1', 'Judge 1', 'ROUGE', 1, 7.5, NOW());
-- Expected: Success (if you own the event or it's paid)

ROLLBACK;
```

### Test 8: Test Heat Transition

```sql
BEGIN;

-- Create test event and heats
INSERT INTO events (name, organizer, start_date, end_date, price, paid)
VALUES ('Transition Test', 'Test Org', CURRENT_DATE, CURRENT_DATE + 1, 10000, true)
RETURNING id;
-- Note the event_id

-- Create two heats
INSERT INTO heats (id, event_id, competition, division, round, heat_number, status)
VALUES
  ('TRANS_TEST_R1_H1', YOUR_EVENT_ID, 'Transition Test', 'OPEN', 1, 1, 'running'),
  ('TRANS_TEST_R1_H2', YOUR_EVENT_ID, 'Transition Test', 'OPEN', 1, 2, 'waiting');

-- Create realtime configs
INSERT INTO heat_realtime_config (heat_id, status)
VALUES
  ('TRANS_TEST_R1_H1', 'running'),
  ('TRANS_TEST_R1_H2', 'waiting');

-- Check initial state
SELECT id, status FROM heats WHERE id LIKE 'TRANS_TEST%';
-- Expected: H1=running, H2=waiting

-- Trigger transition by marking H1 as finished
UPDATE heat_realtime_config SET status = 'finished' WHERE heat_id = 'TRANS_TEST_R1_H1';

-- Wait a moment for trigger to execute, then check
SELECT id, status FROM heats WHERE id LIKE 'TRANS_TEST%';
-- Expected: H1=closed, H2=open (or waiting)

-- Check active heat pointer
SELECT active_heat_id FROM active_heat_pointer WHERE event_name = 'Transition Test';
-- Expected: TRANS_TEST_R1_H2

ROLLBACK;
```

---

## 🎯 Performance Testing

### Test Index Usage

```sql
-- Enable query plan output
\timing on

-- Test 1: Heat lookup by event/division/status (should use index)
EXPLAIN ANALYZE
SELECT * FROM heats
WHERE event_id = 1 AND division = 'OPEN' AND status = 'waiting';

-- Look for: "Index Scan using idx_heats_event_division_status"
-- Execution time should be < 1ms for small tables

-- Test 2: Score lookup by heat and judge (should use index)
EXPLAIN ANALYZE
SELECT * FROM scores
WHERE heat_id = 'some_heat_id' AND judge_id = 'J1';

-- Look for: "Index Scan using idx_scores_heat_judge"

-- Test 3: Participant lookup (should use index)
EXPLAIN ANALYZE
SELECT * FROM participants
WHERE event_id = 1 AND category = 'OPEN'
ORDER BY seed;

-- Look for: "Index Scan using idx_participants_event_category_seed"
```

### Benchmark Query Performance

```sql
-- Create test function to measure performance
CREATE OR REPLACE FUNCTION benchmark_query(p_iterations INTEGER)
RETURNS TABLE(iteration INTEGER, duration_ms NUMERIC) AS $$
DECLARE
  v_start TIMESTAMP;
  v_end TIMESTAMP;
  i INTEGER;
BEGIN
  FOR i IN 1..p_iterations LOOP
    v_start := clock_timestamp();

    -- Your query here
    PERFORM * FROM heats
    WHERE event_id = 1 AND division = 'OPEN' AND status = 'waiting';

    v_end := clock_timestamp();

    iteration := i;
    duration_ms := EXTRACT(MILLISECONDS FROM v_end - v_start);
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Run benchmark
SELECT AVG(duration_ms), MIN(duration_ms), MAX(duration_ms)
FROM benchmark_query(100);

-- Expected: Average < 1ms for small tables, < 5ms for large tables
```

---

## ✅ Success Criteria

All tests should pass with these results:

| Test | Expected Result | Status |
|------|----------------|--------|
| **Migrations Applied** | Both 20251109* migrations in history | ☐ |
| **Helper Functions** | 2 functions exist | ☐ |
| **RLS Policies** | 20+ new policies, 0 old permissive | ☐ |
| **Indexes** | 4 new indexes exist | ☐ |
| **Triggers** | Old triggers gone, 2 new unified | ☐ |
| **RLS Enforcement** | User isolation working | ☐ |
| **Score Rules** | Can't score when heat not running | ☐ |
| **Heat Transition** | Auto-advance works | ☐ |
| **Query Performance** | Indexes being used | ☐ |

---

## 🐛 Troubleshooting

### Issue: Migrations fail to apply

```bash
# Check current schema state
supabase db dump -f current_schema.sql

# Reset and reapply (WARNING: destructive)
supabase db reset
supabase db push
```

### Issue: Tests fail with "function does not exist"

```sql
-- Grant execute permissions
GRANT EXECUTE ON FUNCTION user_has_event_access(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION user_is_judge_for_heat(text) TO authenticated;
```

### Issue: RLS blocks everything

```sql
-- Temporarily disable RLS for debugging (NEVER in production!)
ALTER TABLE scores DISABLE ROW LEVEL SECURITY;

-- Re-enable after fixing
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
```

### Issue: Triggers not firing

```sql
-- Check if triggers are enabled
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE '%heat%';

-- tgenabled values:
-- O = enabled
-- D = disabled

-- Enable trigger if disabled
ALTER TABLE heat_realtime_config ENABLE TRIGGER trg_unified_heat_transition;
```

### Issue: Index not being used

```sql
-- Force analyze table statistics
ANALYZE heats;
ANALYZE scores;
ANALYZE participants;

-- Check if index is valid
SELECT indexname, indisvalid, indisready
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname LIKE 'idx_%';

-- Rebuild index if invalid
REINDEX INDEX idx_heats_event_division_status;
```

---

## 📊 Test Results Log

Use this template to record your test results:

```
Date: ___________
Environment: [Local / Staging / Production]
Tested By: ___________

✓ Migrations applied successfully
✓ Automated test suite passed
✓ Manual RLS tests passed
✓ Performance tests passed
✓ Heat transition tests passed

Issues Found:
- None

Notes:
- All tests passed on first run
- Query performance improved significantly
- No production issues expected
```

---

## 🚀 Next Steps After Testing

Once all tests pass:

1. **Apply to Staging** (if you have one)
   ```bash
   supabase link --project-ref staging-project-ref
   supabase db push
   ```

2. **Run Tests on Staging**
   ```bash
   supabase db execute -f supabase/migrations/TEST_MIGRATIONS.sql
   ```

3. **Monitor for 24 Hours**
   - Check error logs
   - Monitor performance
   - Verify user reports

4. **Apply to Production**
   ```bash
   supabase link --project-ref production-project-ref
   supabase db push
   ```

5. **Verify Production**
   - Run abbreviated test suite
   - Check key user flows
   - Monitor for issues

---

## 📞 Support

If you encounter issues during testing:

1. Check the error message carefully
2. Review the troubleshooting section above
3. Check Supabase logs in Dashboard
4. Verify environment variables are set
5. Try the manual test steps instead of automated

---

**Ready to test?** Start with Step 1: Link to Supabase Project!

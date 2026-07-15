#!/usr/bin/env node

/**
 * HP-Photocopy-DB
 * 
 * Logic to "photocopy" the database from Cloud to HP Local Server.
 * Must be run while the Mac is connected to BOTH Internet and the HP LAN.
 * 
 * IMPROVED: Uses full ID parity and wipes local state before sync to ensure integrity.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load env from frontend/.env.local and infra envs if not already in process.env
function loadEnv() {
  const envFiles = [
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../../infra/.env'),
    path.resolve(__dirname, '../../infra/.env.local'),
  ];
  for (const envPath of envFiles) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
          const match = line.match(/^([^#=]+)=(.*)$/);
          if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) process.env[key] = value;
          }
        });
      }
    } catch (err) {
      console.error(`⚠️ Could not load env file ${envPath}:`, err.message);
    }
  }
}

loadEnv();

function parseArgs(argv) {
  const options = {
    eventIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--event-id' || arg === '--event') {
      const value = argv[index + 1];
      index += 1;
      if (!value) throw new Error(`${arg} requires a value`);
      options.eventIds.push(...value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite));
    } else if (arg.startsWith('--event-id=')) {
      const value = arg.slice('--event-id='.length);
      options.eventIds.push(...value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite));
    } else if (arg === '-h' || arg === '--help') {
      console.log(`Usage: node scripts/hp-photocopy-db.mjs [--event-id 17]`);
      process.exit(0);
    }
  }

  const envEventId = process.env.SURF_SYNC_EVENT_ID || process.env.SURF_EVENT_ID;
  if (!options.eventIds.length && envEventId) {
    options.eventIds.push(...envEventId.split(',').map((item) => Number(item.trim())).filter(Number.isFinite));
  }

  options.eventIds = Array.from(new Set(options.eventIds));
  return options;
}

const options = parseArgs(process.argv.slice(2));

const CLOUD_URL = process.env.VITE_SUPABASE_URL_CLOUD;
const CLOUD_KEY = process.env.VITE_SUPABASE_ANON_KEY_CLOUD;
const LOCAL_URL = process.env.VITE_SUPABASE_URL_LAN;
// Use SERVICE_ROLE_KEY for the local client to bypass RLS policies during administrative copy
const LOCAL_KEY = process.env.SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY_LAN;

if (!CLOUD_URL || !CLOUD_KEY || !LOCAL_URL || !LOCAL_KEY) {
  console.error('❌ Error: Supabase credentials missing in environment.');
  process.exit(1);
}

const cloud = createClient(CLOUD_URL, CLOUD_KEY);
const local = createClient(LOCAL_URL, LOCAL_KEY);

let globalError = false;

function chunkArray(items, size) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function dedupeActiveHeatPointers(rows) {
  const latestByKey = new Map();

  for (const row of rows || []) {
    const key = row.event_id != null ? `event:${row.event_id}` : `name:${row.event_name || ''}`;
    const current = latestByKey.get(key);
    const rowTs = new Date(row.updated_at || 0).getTime();
    const currentTs = current ? new Date(current.updated_at || 0).getTime() : -Infinity;

    if (!current || rowTs >= currentTs) {
      latestByKey.set(key, row);
    }
  }

  return Array.from(latestByKey.values());
}

function normalizeEventNameForLegacyLocalKey(eventName) {
  return String(eventName || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function dedupeLegacyLocalPointerConflicts(rows) {
  const latestByNormalizedName = new Map();

  for (const row of rows || []) {
    const key = normalizeEventNameForLegacyLocalKey(row.event_name);
    const current = latestByNormalizedName.get(key);
    const rowTs = new Date(row.updated_at || 0).getTime();
    const currentTs = current ? new Date(current.updated_at || 0).getTime() : -Infinity;

    if (!current || rowTs >= currentTs) {
      latestByNormalizedName.set(key, row);
    }
  }

  return Array.from(latestByNormalizedName.values());
}

async function fetchPagedRows(client, tableName, queryBuilder, pageSize = 1000) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilder(client.from(tableName)).range(from, to);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function syncTable(tableName, rows, onConflict = 'id', batchSize = 500) {
  if (!rows || rows.length === 0) {
    console.log(`  - No rows to sync for ${tableName}`);
    return;
  }
  process.stdout.write(`  - Upserting ${rows.length} rows to ${tableName}... `);

  for (const batch of chunkArray(rows, batchSize)) {
    const { error } = await local.from(tableName).upsert(batch, { onConflict });
    if (error) {
      console.log('❌ Failed');
      console.error(`    Error in ${tableName}:`, error.message);
      globalError = true;
      return;
    }
  }

  console.log('✅ Done');
}

async function syncActiveHeatPointers(rows) {
  if (!rows || rows.length === 0) {
    console.log('  - No rows to sync for active_heat_pointer');
    return;
  }

  process.stdout.write(`  - Upserting ${rows.length} rows to active_heat_pointer... `);

  for (const row of rows) {
    const podiumId = String(row.podium_id || 'A').trim().toUpperCase() || 'A';
    let { error } = await local.rpc('upsert_active_heat_pointer', {
      p_event_id: row.event_id ?? null,
      p_event_name: row.event_name ?? null,
      p_active_heat_id: row.active_heat_id ?? null,
      p_updated_at: row.updated_at ?? null,
      p_podium_id: podiumId
    });

    if (error) {
      ({ error } = await local.rpc('upsert_active_heat_pointer', {
        p_event_id: row.event_id ?? null,
        p_event_name: row.event_name ?? null,
        p_active_heat_id: row.active_heat_id ?? null,
        p_updated_at: row.updated_at ?? null
      }));
    }

    if (!error) {
      continue;
    }

    let includePodiumInFallback = true;
    let existingByEventId = row.event_id != null
      ? await local.from('active_heat_pointer').select('*').eq('event_id', row.event_id).eq('podium_id', podiumId).maybeSingle()
      : { data: null, error: null };

    if (existingByEventId.error && /podium_id/i.test(existingByEventId.error.message || '')) {
      includePodiumInFallback = false;
      existingByEventId = row.event_id != null
        ? await local.from('active_heat_pointer').select('*').eq('event_id', row.event_id).maybeSingle()
        : { data: null, error: null };
    }

    if (existingByEventId.error) {
      console.log('❌ Failed');
      console.error('    Error in active_heat_pointer:', existingByEventId.error.message);
      globalError = true;
      return;
    }

    if (existingByEventId.data) {
      let updateQuery = local
        .from('active_heat_pointer')
        .update({
          event_name: row.event_name,
          active_heat_id: row.active_heat_id,
          updated_at: row.updated_at
        })
        .eq('event_id', row.event_id);
      if (includePodiumInFallback) updateQuery = updateQuery.eq('podium_id', podiumId);
      ({ error } = await updateQuery);
    } else {
      let existingByName = row.event_name
        ? await local.from('active_heat_pointer').select('*').eq('event_name', row.event_name).eq('podium_id', podiumId).maybeSingle()
        : { data: null, error: null };

      if (existingByName.error && /podium_id/i.test(existingByName.error.message || '')) {
        includePodiumInFallback = false;
        existingByName = row.event_name
          ? await local.from('active_heat_pointer').select('*').eq('event_name', row.event_name).maybeSingle()
          : { data: null, error: null };
      }

      if (existingByName.error) {
        console.log('❌ Failed');
        console.error('    Error in active_heat_pointer:', existingByName.error.message);
        globalError = true;
        return;
      }

      if (existingByName.data) {
        let updateQuery = local
          .from('active_heat_pointer')
          .update({
            event_id: row.event_id,
            active_heat_id: row.active_heat_id,
            updated_at: row.updated_at
          })
          .eq('event_name', row.event_name);
        if (includePodiumInFallback) updateQuery = updateQuery.eq('podium_id', podiumId);
        ({ error } = await updateQuery);
      } else {
        ({ error } = await local.from('active_heat_pointer').insert(includePodiumInFallback ? row : {
          event_id: row.event_id,
          event_name: row.event_name,
          active_heat_id: row.active_heat_id,
          updated_at: row.updated_at
        }));
      }
    }

    if (error) {
      console.log('❌ Failed');
      console.error(
        '    Error in active_heat_pointer:',
        `${error.message} | row=${JSON.stringify({
          event_id: row.event_id,
          event_name: row.event_name,
          active_heat_id: row.active_heat_id
        })}`
      );
      globalError = true;
      return;
    }
  }

  console.log('✅ Done');
}

import { execSync } from 'child_process';

async function main() {
  console.log('======================================================');
  console.log('📦 HP Database Photocopy (Cloud -> Local) - PRO MODE');
  console.log(`☁️ Cloud: ${CLOUD_URL}`);
  console.log(`🏠 Local: ${LOCAL_URL}`);
  console.log('======================================================');

  const forceDestructive = process.argv.includes('--force-destructive');

  try {
    // 0. Pre-flight check (Ping Local)
    process.stdout.write(`🔍 Checking local server reachability (${LOCAL_URL})... `);
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000);
      await fetch(LOCAL_URL, { signal: controller.signal, mode: 'no-cors' });
      clearTimeout(id);
      console.log('✅ OK');
    } catch (e) {
      console.log('❌ Unreachable');
      process.exit(1);
    }

    // 0.1 Check for unsynced local data to prevent accidental erasure
    process.stdout.write('🔍 Checking for unsynced local data... ');
    let hasUnsynced = false;
    try {
      const { data: unsyncedScores, error: unsyncedErr } = await local
        .from('scores')
        .select('id')
        .eq('synced', false)
        .limit(1);

      if (unsyncedErr) throw unsyncedErr;
      if (unsyncedScores && unsyncedScores.length > 0) {
        hasUnsynced = true;
      }
      console.log(hasUnsynced ? '⚠️ FOUND UNSYNCED DATA' : '✅ CLEAN');
    } catch (err) {
      console.log('⚠️ UNABLE TO CHECK (continuing with caution)', err.message);
    }

    if (hasUnsynced && !forceDestructive) {
      console.error('\n======================================================');
      console.error('❌ DANGER: UNSYNCED SCORES FOUND IN LOCAL DATABASE!');
      console.error('There are scores in the local database that have not been synced to the Cloud.');
      console.error('Running photocopy will PERMANENTLY ERASE these scores.');
      console.error('Please sync local scores to the Cloud first.');
      console.error('If you are ABSOLUTELY SURE you want to proceed and erase them, re-run with:');
      console.error('  node scripts/hp-photocopy-db.mjs --force-destructive');
      console.error('======================================================\n');
      process.exit(1);
    }

    // 0.2 Perform automated pg_dump backup on the HP Box via SSH
    const hpUser = process.env.SURF_HP_USER || 'admin-surfjudging';
    const hpProfile = process.env.SURF_HP_PROFILE || 'home';
    let hpHost = process.env.SURF_HP_HOST;
    if (!hpHost) {
      hpHost = hpProfile === 'home' ? '10.0.0.14' : '192.168.1.2';
    }
    const hpBaseDir = process.env.SURF_HP_BASE_DIR || '/home/admin-surfjudging/surjudgingcloud';
    const backupTimestamp = Math.floor(Date.now() / 1000);
    const backupFilename = `pre_photocopy_${backupTimestamp}.sql`;

    console.log(`📦 Creating pre-flight safety backup on HP Host (${hpHost})...`);
    try {
      const sshCmd = `ssh -o ConnectTimeout=5 ${hpUser}@${hpHost} "mkdir -p ${hpBaseDir}/infra/backups && docker exec surfjudging_postgres pg_dump -U postgres -d postgres > ${hpBaseDir}/infra/backups/${backupFilename}"`;
      execSync(sshCmd, { stdio: 'ignore', timeout: 8000 });
      console.log(`✅ Backup successfully created on HP Host: ${hpBaseDir}/infra/backups/${backupFilename}`);
    } catch (backupErr) {
      console.warn(`⚠️ Backup via SSH failed (is SSH key config correct?): ${backupErr.message}`);
      console.warn('Proceeding with caution...');
    }

    // 1. Sync Judges Registry (UPSERT by ID)
    console.log('🏁 Syncing Judges Registry...');
    const { data: judges, error: jErr } = await cloud.from('judges').select('*');
    if (jErr) throw jErr;
    await syncTable('judges', judges);

    // 2. Identify Events to sync
    console.log('🔍 Identifying events to photocopy...');
    let query = cloud.from('events').select('*');
    if (options.eventIds.length > 0) {
      query = query.in('id', options.eventIds);
    }
    const { data: events, error: eErr } = await query;
    if (eErr) throw eErr;
    
    if (events && events.length > 0) {
      const eventIds = events.map(e => e.id);
      console.log(`   Found ${events.length} events to sync: ${eventIds.join(', ')}`);

      // 3. GET ALL DATA FROM CLOUD FIRST
      console.log('☁️ Fetching all data from Cloud...');
      const { data: heats } = await cloud.from('heats').select('*').in('event_id', eventIds);
      const heatIds = heats?.map(h => h.id) || [];

      const entries = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_entries', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      
      // Exhaustive participant fetch: Get everyone referenced in heats, 
      // even if they are technically listed in a different event_id (shared participants).
      const participantIdsFromEntries = [...new Set(entries?.map(e => e.participant_id).filter(id => id) || [])];
      const participantFilters = [`event_id.in.(${eventIds.join(',')})`];
      if (participantIdsFromEntries.length > 0) {
        participantFilters.push(`id.in.(${participantIdsFromEntries.join(',')})`);
      }
      
      const { data: participants } = await cloud.from('participants')
        .select('*')
        .or(participantFilters.join(','));

      const mappings = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_slot_mappings', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const configs = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_configs', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const timers = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_timers', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const rtConfigs = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_realtime_config', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const heatEntryOverrides = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_entry_overrides', (query) => query.select('*').in('heat_id', heatIds)).catch((error) => {
            console.warn('⚠️ heat_entry_overrides not available yet, skipping:', error.message);
            return [];
          })
        : [];
      const heatJudgeAssignments = heatIds.length
        ? await fetchPagedRows(cloud, 'heat_judge_assignments', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const activeHeatPointersRaw = eventIds.length
        ? await fetchPagedRows(cloud, 'active_heat_pointer', (query) => query.select('*').in('event_id', eventIds))
        : [];
      const activeHeatPointers = dedupeLegacyLocalPointerConflicts(
        dedupeActiveHeatPointers(activeHeatPointersRaw)
      );
      
      // ROBUST CASTING: Ensure durations are integers even if cloud sends floats as strings
      const rtConfigsFixed = rtConfigs.map(rtc => ({
        ...rtc,
        timer_duration_minutes: (rtc.timer_duration_minutes !== null && rtc.timer_duration_minutes !== undefined) 
          ? Math.round(parseFloat(rtc.timer_duration_minutes) || 20) 
          : 20
      })) || [];

      const scores = heatIds.length
        ? await fetchPagedRows(cloud, 'scores', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const overrides = heatIds.length
        ? await fetchPagedRows(cloud, 'score_overrides', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const interferences = heatIds.length
        ? await fetchPagedRows(cloud, 'interference_calls', (query) => query.select('*').in('heat_id', heatIds))
        : [];
      const lastConfigs = eventIds.length
        ? await fetchPagedRows(cloud, 'event_last_config', (query) => query.select('*').in('event_id', eventIds))
        : [];

      // 4. CLEAN LOCAL DATA (to ensure ID parity on fresh insert)
      console.log('♻️ Cleaning local event data for clean sync...');
      if (heatIds.length > 0) {
        await local.from('scores').delete().in('heat_id', heatIds);
        await local.from('score_overrides').delete().in('heat_id', heatIds);
        await local.from('interference_calls').delete().in('heat_id', heatIds);
        await local.from('heat_judge_assignments').delete().in('heat_id', heatIds);
        await local.from('heat_entry_overrides').delete().in('heat_id', heatIds);
        await local.from('heat_entries').delete().in('heat_id', heatIds);
        await local.from('heat_slot_mappings').delete().in('heat_id', heatIds);
        await local.from('heat_configs').delete().in('heat_id', heatIds);
        await local.from('heat_timers').delete().in('heat_id', heatIds);
        await local.from('heat_realtime_config').delete().in('heat_id', heatIds);
      }
      await local.from('active_heat_pointer').delete().in('event_id', eventIds);
      await local.from('participants').delete().in('id', participants.map(p => p.id));
      await local.from('heats').delete().in('event_id', eventIds);
      await local.from('event_last_config').delete().in('event_id', eventIds);
      await local.from('events').delete().in('id', eventIds);

      // 5. INSERT ALL DATA IN ORDER
      console.log('🚀 Loading data into Local HP Server...');
      await syncTable('events', events);
      await syncTable('participants', participants);
      await syncTable('heats', heats);
      await syncTable('heat_entries', entries);
      await syncTable('heat_entry_overrides', heatEntryOverrides);
      await syncTable('heat_slot_mappings', mappings);
      await syncTable('heat_configs', configs, 'heat_id'); // heat_configs might use heat_id as PK or unique
      await syncTable('heat_timers', timers);
      await syncTable('heat_realtime_config', rtConfigsFixed, 'heat_id');
      if (heatJudgeAssignments.length > 0) {
        process.stdout.write(`  - Inserting ${heatJudgeAssignments.length} rows to heat_judge_assignments... `);
        let assignmentError = null;
        for (const batch of chunkArray(heatJudgeAssignments, 500)) {
          const { error } = await local.from('heat_judge_assignments').insert(batch);
          if (error) {
            assignmentError = error;
            break;
          }
        }
        if (assignmentError) {
          console.log('❌ Failed');
          console.error('    Error in heat_judge_assignments:', assignmentError.message);
          globalError = true;
        } else {
          console.log('✅ Done');
        }
      } else {
        console.log('  - No rows to sync for heat_judge_assignments');
      }
      
      if (scores && scores.length > 0) {
        // Use RPC if available for scores to avoid heavy REST traffic
        process.stdout.write(`  - Transferring ${scores.length} scores... `);
        const { error: sErr } = await local.from('scores').insert(scores.map(s => {
          // ensure no conflicts if we just deleted, insert is safer
          return s;
        }));
        if (sErr) {
          console.log('❌ Failed');
          console.error('    Error in scores:', sErr.message);
        } else {
          console.log('✅ Done');
        }
      }

      await syncTable('score_overrides', overrides);
      await syncTable('interference_calls', interferences);
      await syncTable('event_last_config', lastConfigs, 'event_id');
      await syncActiveHeatPointers(activeHeatPointers);
    }

    if (globalError) {
      console.log('======================================================');
      console.log('⚠️  PHOTOCOPY COMPLETED WITH ERRORS');
      console.log('======================================================');
      process.exit(1);
    } else {
      console.log('======================================================');
      console.log('✅ PHOTOCOPY COMPLETED SUCCESSFULLY');
      console.log('======================================================');
    }
  } catch (err) {
    console.error('❌ FATAL ERROR:', err.message || err);
    process.exit(1);
  }
}

main();

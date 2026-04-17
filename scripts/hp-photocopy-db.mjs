#!/usr/bin/env node

/**
 * HP-Photocopy-DB
 * 
 * Logic to "photocopy" the database from Cloud to HP Local Server.
 * Must be run while the Mac is connected to BOTH Internet and the HP LAN.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load env from frontend/.env.local if not already in process.env
function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, '../frontend/.env.local');
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
    console.error('⚠️ Could not load .env.local automatically:', err.message);
  }
}

loadEnv();

const CLOUD_URL = process.env.VITE_SUPABASE_URL_CLOUD;
const CLOUD_KEY = process.env.VITE_SUPABASE_ANON_KEY_CLOUD;
const LOCAL_URL = process.env.VITE_SUPABASE_URL_LAN;
const LOCAL_KEY = process.env.VITE_SUPABASE_ANON_KEY_LAN;
const USER_EMAIL = process.env.VITE_DEV_USER_EMAIL;

if (!CLOUD_URL || !CLOUD_KEY || !LOCAL_URL || !LOCAL_KEY) {
  console.error('❌ Error: Supabase credentials missing in environment.');
  console.log('Ensure VITE_SUPABASE_URL_CLOUD and VITE_SUPABASE_URL_LAN are set.');
  process.exit(1);
}

const cloud = createClient(CLOUD_URL, CLOUD_KEY);
const local = createClient(LOCAL_URL, LOCAL_KEY);

async function syncTable(tableName, rows) {
  if (!rows || rows.length === 0) {
    console.log(`  - No rows to sync for ${tableName}`);
    return;
  }
  process.stdout.write(`  - Upserting ${rows.length} rows to ${tableName}... `);
  
  const { error } = await local.from(tableName).upsert(rows);
  
  if (error) {
    console.log('❌ Failed');
    console.error(`    Error in ${tableName}:`, error.message);
  } else {
    console.log('✅ Done');
  }
}

async function main() {
  console.log('======================================================');
  console.log('📦 HP Database Photocopy (Cloud -> Local)');
  console.log(`☁️ Cloud: ${CLOUD_URL}`);
  console.log(`🏠 Local: ${LOCAL_URL}`);
  console.log('======================================================');

  try {
    // 1. Get Owner user id (if email provided)
    let userIdFilter = null;
    if (USER_EMAIL) {
      console.log(`🔍 Finding user ID for ${USER_EMAIL}...`);
      // Note: We can only filter via the 'events' table or similar as we don't have auth access here
      const { data: eventData } = await cloud.from('events').select('user_id').eq('organizer', 'SFS').limit(1);
      if (eventData && eventData[0]) {
        // userIdFilter = eventData[0].user_id; // risky if wrong event
      }
    }

    // 2. Sync Judges Registry (Critical Fix)
    console.log('🏁 Syncing Judges Registry...');
    const { data: judges, error: jErr } = await cloud.from('judges').select('*');
    if (jErr) throw jErr;
    await syncTable('judges', judges);

    // 3. Sync Events
    console.log('🏁 Syncing Events...');
    const { data: events, error: eErr } = await cloud.from('events').select('*');
    if (eErr) throw eErr;
    await syncTable('events', events);

    if (events && events.length > 0) {
      const eventIds = events.map(e => e.id);

      // 4. Sync Participants
      console.log('🏁 Syncing Participants...');
      const { data: participants, error: pErr } = await cloud.from('participants').select('*').in('event_id', eventIds);
      if (pErr) throw pErr;
      await syncTable('participants', participants);

      // 5. Sync Heats
      console.log('🏁 Syncing Heats...');
      const { data: heats, error: hErr } = await cloud.from('heats').select('*').in('event_id', eventIds);
      if (hErr) throw hErr;
      await syncTable('heats', heats);

      if (heats && heats.length > 0) {
        const heatIds = heats.map(h => h.id);

        // 6. Sync Heat Entries
        console.log('🏁 Syncing Heat Entries...');
        const { data: entries, error: enErr } = await cloud.from('heat_entries').select('*').in('heat_id', heatIds);
        if (enErr) throw enErr;
        await syncTable('heat_entries', entries);

        // 7. Sync Mappings
        console.log('🏁 Syncing Heat Slot Mappings...');
        const { data: mappings, error: mErr } = await cloud.from('heat_slot_mappings').select('*').in('heat_id', heatIds);
        if (mErr) throw mErr;
        await syncTable('heat_slot_mappings', mappings);

        // 8. Sync Scores (using RPC if available, or straight upsert)
        console.log('🏁 Syncing Scores...');
        const { data: scores, error: sErr } = await cloud.from('scores').select('*').in('heat_id', heatIds);
        if (sErr) throw sErr;
        if (scores && scores.length > 0) {
          process.stdout.write(`  - Upserting ${scores.length} scores via RPC... `);
          const { error: rpcErr } = await local.rpc('bulk_sync_scores', { p_scores: scores });
          if (rpcErr) {
            console.log('⚠️ RPC failed, trying normal upsert...');
            await syncTable('scores', scores);
          } else {
            console.log('✅ Done');
          }
        }
      }
      
      // 9. Sync Last Config (Snapshot)
      console.log('🏁 Syncing Event Last Config...');
      const { data: configs, error: cErr } = await cloud.from('event_last_config').select('*').in('event_id', eventIds);
      if (cErr) throw cErr;
      await syncTable('event_last_config', configs);
    }

    console.log('======================================================');
    console.log('✅ DATABASE PHOTOCOPY COMPLETED SUCCESSFULLY');
    console.log('======================================================');
  } catch (err) {
    console.error('❌ FATAL ERROR during photocopy:', err.message || err);
    process.exit(1);
  }
}

main();

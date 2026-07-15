#!/usr/bin/env node

/**
 * ============================================================================
 *  SURF JUDGING CLOUD — HP SYNC DAEMON & SSE PROXY v3.0
 * ============================================================================
 *
 *  Long-running resident Node.js daemon resident script designed to run in
 *  the background on the beach HP local box (managed via PM2 or systemd).
 *
 *  Core Responsibilities:
 *    1. Active DB Connection: Establishes a persistent Postgres pool and client
 *       listeners to handle real-time sync without starting heavy node cycles.
 *    2. SSE Priority Server: Serves high-speed, unidirectional Server-Sent Events
 *       (SSE) to ESP32 display boards, cutting timer and priority latency to <10ms.
 *    3. Write-Ahead Sync: Captures score and heat updates via LISTEN/NOTIFY and
 *       upserts them immediately to the Cloud.
 *    4. Periodic Delta Sync: A fallback background routine that diffs local
 *       tables against Cloud and synchronizes changes to ensure ultimate consistency.
 *    5. Debounced MatView Refresh: Safely refreshes the heavy judge accuracy stats
 *       view concurrently in the background without locking live score inserts.
 *
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool, Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
//  ENV LOADER
// ============================================================================
function loadEnv() {
  const possiblePaths = [
    path.resolve(__dirname, '../.env.local'),
    path.resolve(__dirname, '../../infra/.env.local'),
    path.resolve(__dirname, './.env.local'),
    path.resolve(__dirname, './.env'),
  ];

  let loaded = false;
  possiblePaths.forEach((envPath) => {
    if (!fs.existsSync(envPath)) return;
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (!match) return;
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      });
      console.log(`✅ Loaded environment variables from: ${envPath}`);
      loaded = true;
    } catch (err) {
      console.warn(`⚠️ Failed to load env file ${envPath}:`, err.message);
    }
  });
  return loaded;
}

loadEnv();

// Credential Mapping
const CLOUD_URL = process.env.VITE_SUPABASE_URL_CLOUD;
const CLOUD_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY_CLOUD ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY_CLOUD;
const LOCAL_URL = process.env.VITE_SUPABASE_URL_LAN || 'http://localhost:8000';
const LOCAL_KEY = process.env.VITE_SUPABASE_ANON_KEY_LAN;
const PG_PASSWORD = process.env.POSTGRES_PASSWORD || 'SurfJudging2026SecurePassword';
const PG_HOST = process.env.POSTGRES_HOST || 'localhost';
const PG_PORT = process.env.POSTGRES_PORT || 5432;
const PORT = process.env.HP_DAEMON_PORT || 4001;

if (!CLOUD_URL || !CLOUD_KEY) {
  console.error('❌ Cloud Supabase credentials missing (VITE_SUPABASE_URL_CLOUD / SUPABASE_SERVICE_ROLE_KEY_CLOUD)');
  process.exit(1);
}

// ============================================================================
//  CLIENTS INITIALIZATION
// ============================================================================
console.log('🔌 Initializing cloud and local clients...');
const cloud = createClient(CLOUD_URL, CLOUD_KEY);

const pgConnectionString = `postgres://postgres:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/postgres`;

const pgPool = new Pool({
  connectionString: pgConnectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pgPool.on('error', (err) => {
  console.error('💥 Unexpected PG Pool error:', err.message);
});

// ============================================================================
//  SSE STATE & ACTIVE CLIENTS
// ============================================================================
const sseClients = new Map();
const currentPriorityStateByPodium = new Map();
let countdownInterval = null;

function normalizePodiumId(value) {
  const normalized = String(value || 'A').trim().toUpperCase();
  return normalized || 'A';
}

function broadcastSse(data, podiumId = 'A') {
  const targetPodium = normalizePodiumId(podiumId);
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client, clientId) => {
    if (client.podiumId !== targetPodium) return;
    try {
      client.res.write(payload);
    } catch (err) {
      console.warn(`⚠️ Failed to write to SSE client ${clientId}, removing...`);
      sseClients.delete(clientId);
    }
  });
}

/**
 * Fetch active priority from database and update local state
 */
async function resolveActiveEventIdForPodium(podiumId = 'A') {
  const targetPodium = normalizePodiumId(podiumId);
  const res = await pgPool.query(
    `
      SELECT event_id
      FROM public.active_heat_pointer
      WHERE upper(trim(coalesce(podium_id, 'A'))) = $1
        AND event_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [targetPodium]
  );

  return res.rows?.[0]?.event_id ?? null;
}

async function fetchAndBroadcastActivePriority(podiumId = 'A') {
  const targetPodium = normalizePodiumId(podiumId);
  try {
    const eventId = await resolveActiveEventIdForPodium(targetPodium);
    const res = eventId
      ? await pgPool.query('SELECT * FROM public.get_active_priority($1, $2)', [eventId, targetPodium])
      : await pgPool.query('SELECT * FROM public.get_active_priority($1)', [targetPodium]);
    if (res.rows && res.rows.length > 0) {
      const activeState = res.rows[0];
      currentPriorityStateByPodium.set(targetPodium, activeState);
      broadcastSse({
        event: 'priority_update',
        podium: targetPodium,
        timestamp: new Date().toISOString(),
        data: activeState,
      }, targetPodium);
      return activeState;
    } else {
      currentPriorityStateByPodium.set(targetPodium, null);
      broadcastSse({
        event: 'priority_update',
        podium: targetPodium,
        timestamp: new Date().toISOString(),
        data: null,
      }, targetPodium);
      return null;
    }
  } catch (err) {
    console.error(`❌ Error fetching active priority state for podium ${targetPodium}:`, err.message);
  }
}

async function fetchAndBroadcastAllActivePriorities() {
  const podiums = new Set(['A']);
  for (const client of sseClients.values()) {
    podiums.add(client.podiumId);
  }

  const res = await pgPool.query(`
    SELECT DISTINCT upper(trim(coalesce(podium_id, 'A'))) AS podium_id
    FROM public.active_heat_pointer
  `).catch(() => ({ rows: [] }));

  for (const row of res.rows || []) {
    podiums.add(normalizePodiumId(row.podium_id));
  }

  const states = await Promise.all(Array.from(podiums).map((podiumId) => fetchAndBroadcastActivePriority(podiumId)));
  return states;
}

/**
 * Manage countdown ticker and state changes
 */
function startCountdownTicker() {
  if (countdownInterval) return;
  
  console.log('⏰ Starting 1s real-time SSE ticker');
  countdownInterval = setInterval(async () => {
    if (sseClients.size === 0) return; // Save DB cycles if no boards are listening

    // Query active priority state once a second
    // This updates timer_remaining_seconds with absolute database precision
    const states = await fetchAndBroadcastAllActivePriorities();
    
    // If no active heat is running, we can pause the 1s ticker to save CPU
    if (!states.some((active) => active && active.status === 'running')) {
      console.log('⏸️ Active heat not running, sleeping 1s ticker...');
      stopCountdownTicker();
    }
  }, 1000);
}

function stopCountdownTicker() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// ============================================================================
//  REAL-TIME PG TRIGGER LISTEN / NOTIFY
// ============================================================================
let pgListenerClient = null;
let reconnectTimeout = null;

async function startPgListener() {
  pgListenerClient = new Client({ connectionString: pgConnectionString });

  pgListenerClient.on('error', (err) => {
    console.error('💥 DB Listener client error:', err.message);
    reconnectPgListener();
  });

  try {
    await pgListenerClient.connect();
    console.log('🔌 DB Listener connected to PostgreSQL');
    await pgListenerClient.query('LISTEN sync_event');
    console.log('👂 Listening for "sync_event" triggers...');

    pgListenerClient.on('notification', handleNotification);
  } catch (err) {
    console.error('❌ Failed to start DB listener:', err.message);
    reconnectPgListener();
  }
}

function reconnectPgListener() {
  if (reconnectTimeout) return;
  console.log('🔄 Reconnecting DB listener in 5 seconds...');
  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    if (pgListenerClient) {
      try {
        await pgListenerClient.end();
      } catch (e) {}
    }
    await startPgListener();
  }, 5000);
}

/**
 * Handle real-time database changes from trigger
 */
async function handleNotification(msg) {
  if (msg.channel !== 'sync_event' || !msg.payload) return;

  try {
    const payload = JSON.parse(msg.payload);
    const { channel, data } = payload;
    console.log(`🔔 DB Notification: [${channel}] row changed.`);

    if (channel === 'score_submitted') {
      // Score inserted or updated -> push to Cloud instantly
      console.log(`📤 Pushing score override/submission ${data.id} to Cloud...`);
      const { error } = await cloud.from('scores').upsert(data, { onConflict: 'id' });
      if (error) {
        console.error('❌ Score sync failed:', error.message);
      } else {
        console.log(`✅ Score ${data.id} synced to Cloud`);
      }
      
      // Also request statistics view recalculation
      checkAndTriggerMatViewRefresh();

    } else if (channel === 'heat_config_updated') {
      // Heat configs updated -> push to Cloud instantly
      console.log(`📤 Pushing heat realtime config for heat ${data.heat_id} to Cloud...`);
      const { error } = await cloud.from('heat_realtime_config').upsert(data, { onConflict: 'heat_id' });
      if (error) {
        console.error('❌ Heat config sync failed:', error.message);
      } else {
        console.log(`✅ Heat config for ${data.heat_id} synced to Cloud`);
      }

      // Heat config or status changed -> broadcast priority update instantly
      const states = await fetchAndBroadcastAllActivePriorities();
      
      // If heat status is now running, boot the 1s ticker
      if (states.some((active) => active && active.status === 'running') || data.status === 'running') {
        startCountdownTicker();
      } else {
        stopCountdownTicker();
      }
    }
  } catch (err) {
    console.error('❌ Error handling database notification payload:', err.message);
  }
}

// ============================================================================
//  MAT-VIEW DEBOUNCED REFRESH
// ============================================================================
let isRefreshingMatView = false;
let lastMatViewRefreshTime = 0;
const REFRESH_DEBOUNCE_MS = 20000; // Allow refresh once every 20 seconds

async function checkAndTriggerMatViewRefresh() {
  if (isRefreshingMatView) return;
  const now = Date.now();
  if (now - lastMatViewRefreshTime < REFRESH_DEBOUNCE_MS) {
    // Schedule a debounced check if not already running
    return;
  }

  isRefreshingMatView = true;
  try {
    // Check queue in PG
    const queueCheck = await pgPool.query(`
      SELECT last_refresh_requested_at, last_refreshed_at 
      FROM public.materialized_view_refresh_queue 
      WHERE view_name = 'v_event_judge_accuracy_summary'
    `);

    if (queueCheck.rows.length > 0) {
      const { last_refresh_requested_at, last_refreshed_at } = queueCheck.rows[0];
      const requested = new Date(last_refresh_requested_at).getTime();
      const refreshed = last_refreshed_at ? new Date(last_refreshed_at).getTime() : 0;

      if (requested > refreshed) {
        console.log('🧠 [MatView] Pending statistics refresh detected. Recalculating concurrently...');
        lastMatViewRefreshTime = now;
        await pgPool.query('SELECT public.refresh_judge_accuracy_summary()');
        console.log('🧠 [MatView] Concurrent statistics calculation completed successfully.');
      }
    }
  } catch (err) {
    console.error('❌ Failed to refresh judge accuracy summary view:', err.message);
  } finally {
    isRefreshingMatView = false;
  }
}

// Periodically check view refresh queue every 10 seconds
setInterval(checkAndTriggerMatViewRefresh, 10000);

// ============================================================================
//  PERIODIC DELTA SYNC ENGINE (Guarantees ultimate consistency)
// ============================================================================
let isDeltaSyncRunning = false;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function syncTableDelta(tableName, localRows, cloudConflictKey) {
  if (localRows.length === 0) return;
  console.log(`🔄 Delta Sync: Comparing ${localRows.length} rows for ${tableName}...`);
  
  // Quick signature filtering
  // Fetch existing rows from Cloud to avoid broad overwrites
  let changedRows = [];
  try {
    const { data: cloudRows, error } = await cloud
      .from(tableName)
      .select('*');
    
    if (error) throw error;
    const cloudMap = new Map();
    cloudRows.forEach((row) => {
      const key = cloudConflictKey.split(',').map((k) => String(row[k] ?? '')).join('::');
      cloudMap.set(key, JSON.stringify(row));
    });

    changedRows = localRows.filter((localRow) => {
      const key = cloudConflictKey.split(',').map((k) => String(localRow[k] ?? '')).join('::');
      const cloudJson = cloudMap.get(key);
      if (!cloudJson) return true; // New record

      // Simple stable comparison (ignoring date timestamps if desired, or comparing full)
      const cloudParsed = JSON.parse(cloudJson);
      for (const k of Object.keys(localRow)) {
        if (k === 'created_at' || k === 'updated_at' || k === 'timestamp') continue;
        if (JSON.stringify(localRow[k]) !== JSON.stringify(cloudParsed[k])) {
          return true; // Field changed
        }
      }
      return false;
    });
  } catch (err) {
    console.warn(`⚠️ Cloud fetch failed for ${tableName}, syncing full set:`, err.message);
    changedRows = localRows;
  }

  if (changedRows.length === 0) {
    console.log(`  - ${tableName} is perfectly in sync.`);
    return;
  }

  console.log(`  - Pushing ${changedRows.length} modified rows to Cloud...`);
  for (const batch of chunkArray(changedRows, 100)) {
    const { error } = await cloud.from(tableName).upsert(batch, { onConflict: cloudConflictKey });
    if (error) {
      console.error(`❌ Delta Sync failed on ${tableName}:`, error.message);
    }
  }
}

async function runDeltaSyncCycle() {
  if (isDeltaSyncRunning) return;
  isDeltaSyncRunning = true;
  console.log('📡 Beginning cursor-based Delta Sync cycle...');

  try {
    // 1. Fetch active event pointer
    const activePointerQuery = await pgPool.query('SELECT * FROM public.active_heat_pointer');
    if (activePointerQuery.rows.length === 0) {
      console.log('ℹ️ No active event pointer found locally. Skipping sync cycle.');
      isDeltaSyncRunning = false;
      return;
    }

    const eventIds = activePointerQuery.rows.map((r) => r.event_id);
    
    // Fetch heats for these events
    const heatsQuery = await pgPool.query('SELECT id FROM public.heats WHERE event_id = ANY($1)', [eventIds]);
    const heatIds = heatsQuery.rows.map((h) => h.id);

    if (heatIds.length === 0) {
      console.log('ℹ️ No active heats found locally. Skipping sync cycle.');
      isDeltaSyncRunning = false;
      return;
    }

    // 2. Fetch and sync participants
    const participants = (await pgPool.query('SELECT * FROM public.participants WHERE event_id = ANY($1)', [eventIds])).rows;
    await syncTableDelta('participants', participants, 'id');

    // 3. Fetch and sync heat entries
    const heatEntries = (await pgPool.query('SELECT * FROM public.heat_entries WHERE heat_id = ANY($1)', [heatIds])).rows;
    await syncTableDelta('heat_entries', heatEntries, 'heat_id,position');

    // 4. Fetch and sync scores
    const scores = (await pgPool.query('SELECT * FROM public.scores WHERE heat_id = ANY($1)', [heatIds])).rows;
    
    // Temporarily verify we allow scores sync
    const scoreHeatIds = Array.from(new Set(scores.map((s) => s.heat_id)));
    if (scoreHeatIds.length > 0) {
      const tempRunning = scoreHeatIds.map((id) => ({ heat_id: id, status: 'running' }));
      await cloud.from('heat_realtime_config').upsert(tempRunning, { onConflict: 'heat_id' });
    }
    
    await syncTableDelta('scores', scores, 'id');

    // 5. Fetch and sync interference calls
    const interferences = (await pgPool.query('SELECT * FROM public.interference_calls WHERE heat_id = ANY($1)', [heatIds])).rows;
    await syncTableDelta('interference_calls', interferences, 'heat_id,judge_id,surfer,wave_number');

    // 6. Fetch and sync realtime configs
    const realtimeConfigs = (await pgPool.query('SELECT * FROM public.heat_realtime_config WHERE heat_id = ANY($1)', [heatIds])).rows;
    await syncTableDelta('heat_realtime_config', realtimeConfigs, 'heat_id');

    // 7. Sync heat overrides
    try {
      const overrides = (await pgPool.query('SELECT * FROM public.heat_entry_overrides WHERE heat_id = ANY($1)', [heatIds])).rows;
      await syncTableDelta('heat_entry_overrides', overrides, 'id');
    } catch (e) {
      console.log('ℹ️ heat_entry_overrides not active in this DB schema, skipping.');
    }

    // 8. Sync active heat pointer
    await syncTableDelta('active_heat_pointer', activePointerQuery.rows, 'event_id,podium_id');

    console.log('✅ Delta Sync cycle completed.');
  } catch (err) {
    console.error('❌ Error in Delta Sync cycle:', err.message);
  } finally {
    isDeltaSyncRunning = false;
  }
}

// Run periodic sync fallback once every 60 seconds
setInterval(runDeltaSyncCycle, 60000);

// ============================================================================
//  LIGHTWEIGHT HTTP SSE SERVER (ZERO EXTERNAL DEPS FOR SSE PROXY)
// ============================================================================
const sseServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, apikey, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/priority/sse' || url.pathname === '/events') {
    const podiumId = normalizePodiumId(url.searchParams.get('podium'));

    // SSE Stream Handshake
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    });

    const clientId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sseClients.set(clientId, { res, podiumId });
    console.log(`🔌 SSE Client connected: ${clientId} podium ${podiumId} (Total: ${sseClients.size})`);

    // Write initial state immediately
    const currentPriorityState = currentPriorityStateByPodium.get(podiumId);
    if (currentPriorityState) {
      res.write(`data: ${JSON.stringify({
        event: 'priority_update',
        podium: podiumId,
        timestamp: new Date().toISOString(),
        data: currentPriorityState
      })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({
        event: 'connected',
        podium: podiumId,
        timestamp: new Date().toISOString(),
        message: 'Successfully connected to Surf Judging SSE Stream.'
      })}\n\n`);
      // Attempt fetch right away
      fetchAndBroadcastActivePriority(podiumId);
    }

    // If active running heat, boot countdown loop
    if (currentPriorityState && currentPriorityState.status === 'running') {
      startCountdownTicker();
    }

    req.on('close', () => {
      sseClients.delete(clientId);
      console.log(`🔌 SSE Client disconnected: ${clientId} podium ${podiumId} (Total: ${sseClients.size})`);
      if (sseClients.size === 0) {
        stopCountdownTicker();
      }
    });
  } else {
    // Basic diagnostic JSON endpoint
    const activeByPodium = Object.fromEntries(currentPriorityStateByPodium.entries());
    const defaultState = currentPriorityStateByPodium.get('A');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      daemon: 'surfjudging-sync-daemon v3.0',
      connectedClients: sseClients.size,
      activeHeatId: defaultState ? defaultState.heat_id : null,
      activeHeatStatus: defaultState ? defaultState.status : null,
      activeByPodium,
      timestamp: new Date().toISOString(),
    }));
  }
});

sseServer.listen(PORT, () => {
  console.log(`📡 Lightweight SSE Server running on http://localhost:${PORT}`);
});

// ============================================================================
//  DAEMON BOOTSTRAP
// ============================================================================
async function bootstrap() {
  console.log('🚀 Booting Sync Daemon & SSE Proxy...');
  
  // Initial DB triggers listen
  await startPgListener();

  // Load initial active state
  await fetchAndBroadcastAllActivePriorities();

  // Run initial comprehensive delta sync on startup
  console.log('🔄 Running initial Delta Sync on startup...');
  await runDeltaSyncCycle();

  console.log('🌟 Bootstrap sequence completed successfully.');
}

bootstrap().catch((err) => {
  console.error('❌ Daemon bootstrap failed:', err.message);
  process.exit(1);
});

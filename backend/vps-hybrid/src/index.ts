import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Client } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const port = process.env.PORT || 4000;
const apiKey = process.env.HYBRID_API_KEY;

// Configuration CORS pour autoriser ton frontend
app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "*", // À restreindre en production après les tests
    methods: ["GET", "POST"]
  }
});

// Middleware d'authentification simple pour Socket.io
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token === apiKey) {
    return next();
  }
  return next(new Error("Authentication error: invalid API Key"));
});

// =================================================================
// IoT Display State — Cache mémoire pour répondre < 50ms à l'ESP32
// =================================================================

interface IoTDisplayState {
  /** Heat status: waiting | running | paused | finished | closed */
  status: string;
  /** ISO timestamp when the timer was started (null if paused/stopped) */
  timer_start_time: string | null;
  /** Total duration of the heat in minutes */
  timer_duration_minutes: number;
  /** Ordered list of surfer colors (P1 first) */
  priority_order: string[];
  /** Surfers currently in-flight (on a wave) */
  priority_in_flight: string[];
  /** Priority mode: equal | opening | ordered */
  priority_mode: string;
  /** Heat identifier */
  heat_id: string;
  /** Last update timestamp */
  updated_at: string;
}

const DEFAULT_DISPLAY_STATE: IoTDisplayState = {
  status: 'waiting',
  timer_start_time: null,
  timer_duration_minutes: 20,
  priority_order: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
  priority_in_flight: [],
  priority_mode: 'equal',
  heat_id: '',
  updated_at: new Date().toISOString(),
};

let currentDisplayState: IoTDisplayState = { ...DEFAULT_DISPLAY_STATE };

/**
 * Calculates the remaining time as "MM:SS" from the display state.
 * The ESP32 uses this as the reference and continues counting locally.
 */
function computeTimerDisplay(state: IoTDisplayState): {
  timer_text: string;
  remaining_seconds: number;
  is_last_5_min: boolean;
  is_running: boolean;
} {
  const durationSec = (state.timer_duration_minutes || 20) * 60;

  if (!state.timer_start_time || state.status !== 'running') {
    const remainingSec = Math.max(0, durationSec);
    const minutes = Math.floor(remainingSec / 60);
    const seconds = remainingSec % 60;
    return {
      timer_text: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      remaining_seconds: remainingSec,
      is_last_5_min: false,
      is_running: false,
    };
  }

  const startMs = new Date(state.timer_start_time).getTime();
  const nowMs = Date.now();
  const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const remainingSec = Math.max(0, durationSec - elapsedSec);
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;

  return {
    timer_text: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    remaining_seconds: remainingSec,
    is_last_5_min: remainingSec <= 300 && remainingSec > 0,
    is_running: true,
  };
}

/**
 * Extracts priority state from the config_data JSONB column.
 */
function extractPriorityFromConfigData(configData: any): {
  mode: string;
  order: string[];
  inFlight: string[];
} {
  if (!configData) return { mode: 'equal', order: [], inFlight: [] };

  // config_data may contain priorityState directly or nested
  const ps = configData.priorityState || configData.priority_state || configData;

  return {
    mode: ps.mode || 'equal',
    order: Array.isArray(ps.order) ? ps.order : [],
    inFlight: Array.isArray(ps.inFlight) ? ps.inFlight : [],
  };
}

/**
 * Updates the in-memory display state from a heat_realtime_config row.
 */
function updateDisplayState(row: any) {
  if (!row || !row.heat_id) return;

  const priority = extractPriorityFromConfigData(row.config_data);

  currentDisplayState = {
    status: row.status || 'waiting',
    timer_start_time: row.timer_start_time || null,
    timer_duration_minutes: row.timer_duration_minutes || 20,
    priority_order: priority.order,
    priority_in_flight: priority.inFlight,
    priority_mode: priority.mode,
    heat_id: row.heat_id,
    updated_at: row.updated_at || new Date().toISOString(),
  };

  console.log(`[IOT] Display state updated for heat ${row.heat_id} (status: ${row.status})`);
}

// --- POSTGRES LISTENER ---
const pgClient = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function setupPostgresListener() {
  try {
    await pgClient.connect();
    console.log('✅ Connecté à PostgreSQL pour le Realtime Relay');

    // Écoute des channels spécifiques
    await pgClient.query('LISTEN sync_timer_event');
    await pgClient.query('LISTEN sync_score_event');
    await pgClient.query('LISTEN sync_config_event');
    await pgClient.query('LISTEN sync_event');

    pgClient.on('notification', (msg) => {
      if (!msg.payload) return;
      
      const payload = JSON.parse(msg.payload);
      const { channel, data } = payload;

      console.log(`[REALTIME] Relay event: ${channel}`);
      
      // Relay vers les bons clients via Socket.io
      io.emit(channel, data);

      // Mettre à jour l'état IoT si c'est un changement de config heat
      if (channel === 'heat_config_updated' && data) {
        updateDisplayState(data);
      }
    });

    // Bootstrap: charger l'état actuel du heat actif
    await bootstrapDisplayState();

  } catch (error) {
    console.error('❌ Erreur de connexion PostgreSQL:', error);
    setTimeout(setupPostgresListener, 5000); // Retry rapide
  }
}

/**
 * Loads the currently active/running heat to initialize the display state.
 */
async function bootstrapDisplayState() {
  try {
    const result = await pgClient.query(`
      SELECT heat_id, status, timer_start_time, timer_duration_minutes, config_data, updated_at
      FROM heat_realtime_config
      WHERE status IN ('running', 'paused')
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      updateDisplayState(result.rows[0]);
      console.log(`[IOT] Bootstrap: loaded heat ${result.rows[0].heat_id}`);
    } else {
      console.log('[IOT] Bootstrap: no active heat found, waiting for updates');
    }
  } catch (error) {
    console.error('[IOT] Bootstrap error:', error);
  }
}

// =================================================================
// Routes
// =================================================================

// Route de monitoring
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    clients: io.engine.clientsCount,
    pgConnected: (pgClient as any)._connected 
  });
});

// =================================================================
// 🏄 IoT Display Endpoint — Optimisé pour l'ESP32
// =================================================================
// L'ESP32 poll cette route toutes les 500ms.
// Réponse ultra-légère, pas de requête DB à chaque appel.

app.get('/api/iot/display', (_req, res) => {
  const timer = computeTimerDisplay(currentDisplayState);

  res.json({
    // Timer (7-segment display)
    timer: timer.timer_text,
    remaining_seconds: timer.remaining_seconds,
    is_running: timer.is_running,

    // Bande supérieure
    band: timer.is_running
      ? (timer.is_last_5_min ? 'YELLOW' : 'GREEN')
      : 'OFF',

    // Priorités dynamiques (P1 = index 0 = gauche/haut)
    priority: currentDisplayState.priority_order,
    in_flight: currentDisplayState.priority_in_flight,
    priority_mode: currentDisplayState.priority_mode,

    // Metadata
    heat_id: currentDisplayState.heat_id,
    status: currentDisplayState.status,
    server_time: Date.now(),
  });
});

// Endpoint pour forcer un refresh depuis la DB (admin / debug)
app.post('/api/iot/display/refresh', async (_req, res) => {
  try {
    await bootstrapDisplayState();
    res.json({ ok: true, state: currentDisplayState });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

// =================================================================
// Socket.io
// =================================================================

io.on('connection', (socket) => {
  console.log(`🔌 Client connecté: ${socket.id} (Total: ${io.engine.clientsCount})`);
  
  socket.on('disconnect', () => {
    console.log(`❌ Client déconnecté: ${socket.id}`);
  });
});

httpServer.listen(port, () => {
  console.log(`🚀 Serveur Hybride prêt sur le port ${port}`);
  if (!apiKey) {
    console.warn('⚠️ WARNING: HYBRID_API_KEY non configurée !');
  }
  setupPostgresListener();
});

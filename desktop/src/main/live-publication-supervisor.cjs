const fs = require('node:fs');
const { spawn } = require('node:child_process');

const REQUIRED = Object.freeze(['LIVE_FIELD_LOCAL_URL', 'LIVE_FIELD_SERVICE_ROLE_KEY', 'LIVE_RELAY_URL', 'LIVE_FIELD_INSTANCE_ID', 'LIVE_FIELD_HMAC_SECRET']);

function redact(value) { return String(value).replace(/(PASSWORD|JWT|KEY|SECRET|AUTHORIZATION)=\S+/gi, '$1=[REDACTED]'); }
function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return [];
    return [[match[1], match[2].replace(/^['"]|['"]$/g, '')]];
  }));
}
function readProvisioning(configPath, readFile = fs.readFileSync, exists = fs.existsSync) {
  if (!exists(configPath)) return { ok:false, reason:'NOT_PROVISIONED' };
  const values = parseEnv(readFile(configPath, 'utf8'));
  if (values.LIVE_PUBLICATION_ENABLED !== 'true') return { ok:false, reason:'DISABLED' };
  if (REQUIRED.some((key) => !values[key])) return { ok:false, reason:'INCOMPLETE_PROVISIONING' };
  if (values.LIVE_FIELD_INSTANCE_ID === 'unprovisioned') return { ok:false, reason:'UNPROVISIONED_IDENTITY' };
  return { ok:true, values };
}
function makeLivePublicationSupervisor({ configPath, workerPath, nodePath = process.execPath, spawnProcess = spawn, readFile, exists, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, logger = () => {} }) {
  let child = null; let restartTimer = null; let stopping = false; let state = 'STOPPED'; let lastError = null; let restartCount = 0; let startedAt = null;
  const log = (message) => logger(redact(message));
  const getStatus = () => ({ state, configured:readProvisioning(configPath, readFile, exists).ok, lastError, restartCount, startedAt });
  const stop = () => { stopping = true; if (restartTimer) clearTimeoutFn(restartTimer); restartTimer = null; if (child && !child.killed) child.kill(); child = null; state = 'STOPPED'; };
  const scheduleRestart = () => { if (stopping) return; const delay = Math.min(60000, 2000 * (2 ** Math.min(restartCount, 5))); restartCount += 1; state = 'BACKOFF'; log(`Live publication worker restart in ${delay}ms`); restartTimer = setTimeoutFn(() => { restartTimer = null; void start(); }, delay); restartTimer.unref?.(); };
  const start = async () => {
    if (child || restartTimer) return getStatus();
    stopping = false;
    const provisioning = readProvisioning(configPath, readFile, exists);
    if (!provisioning.ok) { state = provisioning.reason; lastError = null; return getStatus(); }
    state = 'STARTING';
    try {
      child = spawnProcess(nodePath, [workerPath], { stdio:['ignore','pipe','pipe'], env:{ ...process.env, ...provisioning.values, ELECTRON_RUN_AS_NODE:'1' } });
      startedAt = new Date().toISOString();
      child.stdout?.on('data', (data) => log(`live worker: ${data}`)); child.stderr?.on('data', (data) => log(`live worker: ${data}`));
      child.once?.('error', (error) => { lastError = error.message; child = null; scheduleRestart(); });
      child.once?.('exit', (code, signal) => { child = null; if (stopping) return; lastError = `worker exited (${signal || code || 'unknown'})`; scheduleRestart(); });
      state = 'RUNNING'; restartCount = 0;
    } catch (error) { child = null; lastError = error instanceof Error ? error.message : String(error); scheduleRestart(); }
    return getStatus();
  };
  return Object.freeze({ start, stop, getStatus, readProvisioning:() => readProvisioning(configPath, readFile, exists) });
}
module.exports = { REQUIRED, parseEnv, readProvisioning, makeLivePublicationSupervisor };

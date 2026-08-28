const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const STATES = Object.freeze(['STOPPED','CHECKING_RUNTIME','RUNTIME_UNAVAILABLE','STARTING','WAITING_DB','WAITING_API','WAITING_FRONTEND','VERIFYING_IDENTITY','DISCOVERING_LAN','READY','DEGRADED','STOP_CHECK','STOPPING','ERROR']);
const SERVICES = Object.freeze(['surfjudging_field_frontend','surfjudging_field_postgres','surfjudging_field_auth','surfjudging_field_realtime','surfjudging_field_storage','surfjudging_field_rest','surfjudging_field_kong']);

function launcherFor(platform, rootDir) {
  if (platform === 'win32') return { command:'powershell.exe', args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(rootDir, 'scripts', 'start-surfjudging-field-windows.ps1')] };
  if (platform === 'darwin') return { command:path.join(rootDir, 'scripts', 'start-surfjudging-field-mac.sh'), args:['--no-caffeinate'] };
  throw new Error(`Unsupported Field host platform: ${platform}`);
}

function runtimeIdentityMatches(candidate, expectedIdentity) {
  if (!expectedIdentity) return true;
  const manifest = candidate?.manifest || {};
  return manifest.releaseId === expectedIdentity.releaseId
    && manifest.expectedSchemaVersion === expectedIdentity.expectedSchemaVersion;
}

function makeManager({ rootDir, stateDir = null, expectedIdentity = null, platform = process.platform, discover, health, prerequisites, fetchRunningHeats, run = execFileAsync, spawnProcess = spawn, now = () => new Date().toISOString(), timeouts = {} }) {
  let state = 'STOPPED'; let activeStart = null; let child = null; let pollTimer = null; let healthSnapshot = null; let dockerCommand = 'docker'; let launcherFailure = null; const logs = [];
  const timeout = (key, fallback) => timeouts[key] ?? fallback;
  const append = (output) => { for (const line of String(output).split(/\r?\n/).filter(Boolean)) logs.push(line.replace(/(PASSWORD|JWT|KEY|SECRET)=\S+/gi, '$1=[REDACTED]')); if (logs.length > 200) logs.splice(0, logs.length - 200); };
  const setState = (next) => { if (!STATES.includes(next)) throw new Error(`invalid state ${next}`); state = next; };
  const checkRuntime = async () => { setState('CHECKING_RUNTIME'); const p = await prerequisites(); if (p.dockerCliPath) dockerCommand = p.dockerCliPath; if (!p.dockerCli || !p.dockerDaemon) { setState('RUNTIME_UNAVAILABLE'); return { ok:false, state, prerequisites:p }; } return { ok:true, state, prerequisites:p }; };
  const startPolling = (host) => { if (pollTimer) return; pollTimer = setInterval(async () => { try { healthSnapshot = await health(host); } catch (error) { append(error.message); } }, timeout('pollInterval', 15000)); pollTimer.unref?.(); };
  const stopPolling = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = null; };
  const waitReady = async () => { setState('WAITING_DB'); const deadline = Date.now() + timeout('startup', 12 * 60 * 1000); while (Date.now() < deadline) { if (launcherFailure) { setState('ERROR'); throw new Error(`Field launcher failed (${launcherFailure.code ?? launcherFailure.signal ?? 'unknown'}): ${logs.at(-1) || 'no diagnostic'}`); } const candidates = await discover(); if (candidates.length === 1) { setState('VERIFYING_IDENTITY'); const h = await health(candidates[0].host); if (h.frontend === 'HEALTHY' && h.api === 'HEALTHY' && runtimeIdentityMatches(candidates[0], expectedIdentity)) { healthSnapshot = h; startPolling(candidates[0].host); setState('READY'); return { ok:true, candidate:candidates[0], health:h }; } } await new Promise(r => setTimeout(r, timeout('startupPoll', 1000))); } setState('ERROR'); throw new Error(`Field startup timeout after ${Math.round(timeout('startup', 12 * 60 * 1000) / 1000)}s: ${logs.at(-1) || 'no launcher diagnostic'}`); };
  const startField = () => { if (activeStart) return activeStart; activeStart = (async () => { const existing = await discover(); if (existing.length === 1 && (await health(existing[0].host)).frontend === 'HEALTHY') { if (runtimeIdentityMatches(existing[0], expectedIdentity)) { setState('READY'); return { result:'ALREADY_RUNNING', candidate:existing[0] }; } const running = await fetchRunningHeats(); if (running.length) { throw new Error(`Field upgrade blocked: ${running.length} heat(s) currently running.`); } append(`FIELD_STAGE runtime-upgrade-required ${existing[0].manifest?.releaseId || 'unknown'} -> ${expectedIdentity?.releaseId || 'unknown'}`); } const runtime = await checkRuntime(); if (!runtime.ok) throw new Error('Runtime unavailable'); const launcher = launcherFor(platform, rootDir); const childEnv={...process.env,SURFJUDGING_DOCKER_BIN:dockerCommand}; if(stateDir)childEnv.SURFJUDGING_STATE_DIR=stateDir; launcherFailure = null; setState('STARTING'); child = spawnProcess(launcher.command, launcher.args, { cwd:rootDir, stdio:['ignore','pipe','pipe'], env:childEnv }); child.stdout?.on('data', d => append(d)); child.stderr?.on('data', d => append(d)); child.on?.('exit', (code, signal) => { append(`FIELD_STAGE launcher-exit code=${code ?? 'none'} signal=${signal ?? 'none'}`); if (code !== 0) launcherFailure = { code, signal }; }); child.on?.('error', (error) => { append(`FIELD_STAGE launcher-error ${error.message}`); launcherFailure = { code:'spawn', signal:null }; }); return { result:existing.length === 1 ? 'UPGRADING' : 'STARTING', ...(await waitReady()) }; })().catch(error => { setState('ERROR'); append(error.message); throw error; }).finally(() => { activeStart = null; }); return activeStart; };
  const canStopField = async () => { setState('STOP_CHECK'); const running = await fetchRunningHeats(); return { allowed: running.length === 0, runningHeats:running, reason:running.length ? 'A heat is currently running.' : null }; };
  const stopField = async ({ confirmed = false } = {}) => { const gate = await canStopField(); if (!gate.allowed) return { result:'DENIED_RUNNING_HEAT', ...gate }; if (!confirmed) return { result:'CONFIRMATION_REQUIRED', ...gate }; setState('STOPPING'); stopPolling(); const p=await prerequisites(); if(p.dockerCliPath)dockerCommand=p.dockerCliPath; await run(dockerCommand, ['stop', ...SERVICES], { cwd:rootDir, timeout:timeout('stop',30000) }); child = null; setState('STOPPED'); return { result:'STOPPED' }; };
  return Object.freeze({ states:STATES, getState:() => state, getLogs:() => logs.slice(), getProgress:() => ({state,lastLog:logs.at(-1) || null}), getHealthSnapshot:() => healthSnapshot, checkRuntime, startField, getHealth:health, discoverField:discover, canStopField, stopField, getChild:() => child, now });
}
module.exports = { STATES, SERVICES, launcherFor, runtimeIdentityMatches, makeManager };

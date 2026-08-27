const api = window.surfJudgingDesktop;
const state = { candidates: [], selected: null, health: null, prerequisites: null };
const $ = (id) => document.getElementById(id);
const actions = document.querySelector('.actions');
if (actions) { actions.insertAdjacentHTML('afterbegin', '<button id="start">Start Field</button><button id="stop">Stop Field</button>'); }
const dashboard = document.querySelector('.grid');
if (dashboard) dashboard.insertAdjacentHTML('beforeend', '<section class="card"><h2>Competition safety</h2><p id="competition">Checking authoritative DB…</p></section><section class="card"><h2>Disk</h2><p id="disk">Checking…</p></section><section class="card"><h2>Internet Live</h2><p id="live-publication">Checking local worker…</p><p class="hint">Publication sortante uniquement. Le jugement reste local.</p></section><section class="card wide"><h2>LAN QR</h2><div id="qr"></div><p class="hint">QR contains only the verified LAN Admin URL.</p></section>');
const setDl = (id, rows) => { $(id).innerHTML = rows.map(([k,v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join(''); };
function render() {
  const c = state.selected;
  $('status').textContent = c ? `FIELD FOUND — ${c.host}` : 'FIELD NOT FOUND / sélection manuelle requise';
  $('status').className = `banner ${c ? 'ok' : 'bad'}`;
  setDl('identity', [['Host', c?.host], ['Release', c?.manifest?.releaseId], ['Revision', c?.manifest?.codeRevision], ['Schema', c?.manifest?.expectedSchemaVersion]]);
  setDl('health', Object.entries(state.health ?? {}).map(([k,v]) => [k[0].toUpperCase()+k.slice(1), v]));
  setDl('prereq', [['Docker CLI', state.prerequisites?.dockerCli ? 'FOUND':'MISSING'], ['Colima', state.prerequisites?.colima ? 'FOUND':'MISSING'], ['Docker daemon', state.prerequisites?.dockerDaemon ? 'REACHABLE':'UNREACHABLE']]);
  const urls = c ? c.urls : {}; $('urls').innerHTML = Object.entries(urls).map(([k,v]) => `<a href="${v}" data-url="${v}">${k.toUpperCase()}<br><small>${v}</small></a>`).join('');
  document.querySelectorAll('[data-url]').forEach((a) => a.onclick = (e) => { e.preventDefault(); api.openUrl(a.dataset.url); });
}
async function refresh() { $('status').textContent = 'Recherche du Field local…'; state.candidates = await api.discoverFieldCandidates(); state.selected = state.candidates.length === 1 ? state.candidates[0] : null; state.health = await api.getFieldHealth(state.selected?.host); state.prerequisites = await api.getRuntimePrerequisiteStatus(); render(); const safety=await api.getCompetitionSafety(); $('competition').textContent=safety.runningCount?`RUNNING HEATS = ${safety.runningCount} — STOP FIELD bloqué`:'RUNNING HEATS = 0 — STOP FIELD autorisable après confirmation'; const disk=await api.getDiskStatus(); $('disk').textContent=disk.status==='UNKNOWN'?'UNKNOWN':`${disk.status} — ${Math.round(disk.available/1024/1024/1024)} GB available`; const live=await api.getLivePublicationStatus(); $('live-publication').textContent=live.configured?`${live.state}${live.restartCount?` · relances ${live.restartCount}`:''}${live.lastError?` · ${live.lastError}`:''}`:live.state==='NOT_PROVISIONED'?'Non provisionné — aucune publication externe.':'Désactivé — aucune publication externe.'; if(state.selected){const qr=await api.generateQr(state.selected.urls.admin); $('qr').innerHTML=`<img alt="Admin LAN QR" width="220" src="${qr}">`;}}
async function diagnostics() { const snapshot = { desktopVersion: await api.getDesktopVersion(), selected: state.selected, candidates: state.candidates, health: state.health, prerequisites: state.prerequisites, generatedAt: new Date().toISOString() }; await api.copyDiagnostics(snapshot); $('status').textContent = 'Diagnostic copié (données non secrètes).'; }
async function start(){ $('status').textContent='Démarrage contrôlé…'; try{const r=await api.startField(); $('status').textContent=`${r.result||'READY'} — Field`; await refresh()}catch(e){$('status').textContent=`ERROR — ${e.message||e}`;}}
async function stop(){const gate=await api.canStopField(); if(!gate.allowed){$('status').textContent='STOP DENIED — une heat est en cours.';return} if(!confirm('Arrêter les services Field ? Les données persistantes sont conservées.'))return; const r=await api.stopField(true); $('status').textContent=r.result;}
$('refresh').onclick = refresh; $('start').onclick=start; $('stop').onclick=stop; $('copy').onclick = diagnostics; refresh();

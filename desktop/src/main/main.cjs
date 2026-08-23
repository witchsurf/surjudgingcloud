const { app, BrowserWindow, clipboard, ipcMain, shell } = require('electron');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { statfs } = require('node:fs/promises');
const QRCode = require('qrcode');
const FIELD_TIMEOUT_MS = 2500;
const execFileAsync = promisify(execFile);
const { isPrivateLanAddress, candidateFromManifest, mapHealth, tabletUrls } = require('../shared/field.js');
const { makeManager } = require('./field-service-manager.cjs');
const { dataRoot, createBackupService } = require('./backup-service.cjs');

function interfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,values])=>(values||[]).filter(v=>v.family==='IPv4'&&!v.internal&&isPrivateLanAddress(v.address)&&!/(docker|colima|bridge)/i.test(name)).map(v=>({name,address:v.address,netmask:v.netmask})))}
async function fetchJson(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),FIELD_TIMEOUT_MS);try{const r=await fetch(url,{signal:c.signal});return {status:r.status,body:await r.json()}}finally{clearTimeout(t)}}
async function discover(){const out=[];for(const iface of interfaces()){try{const r=await fetchJson(`http://${iface.address}:8080/deployment-manifest.json`);const c=candidateFromManifest(iface.address,r.body);if(c)out.push({...c,interface:iface.name})}catch{}}return out}
async function prereq(){const command=async(n,a)=>{try{await execFileAsync(n,a,{timeout:1500});return true}catch{return false}};return {dockerCli:await command('docker',['--version']),colima:await command('colima',['version']),dockerDaemon:await command('docker',['info'])}}
async function health(host){if(!host)return {frontend:'UNAVAILABLE',api:'UNAVAILABLE',realtime:'UNKNOWN',internet:'UNKNOWN',cloud:'UNKNOWN'};const f=await fetchJson(`http://${host}:8080/deployment-manifest.json`).then(x=>x.status===200).catch(()=>false);const a=await fetch(`http://${host}:8000/rest/v1/`,{signal:AbortSignal.timeout(FIELD_TIMEOUT_MS)}).then(x=>x.ok).catch(()=>false);return {frontend:mapHealth(f),manifest:mapHealth(f),api:mapHealth(a),realtime:a?'UNKNOWN':'UNAVAILABLE',internet:'UNKNOWN',cloud:'UNKNOWN'}}
async function runningHeats(){const candidates=await discover();if(candidates.length!==1)return [];const r=await fetch(`http://${candidates[0].host}:8000/rest/v1/heats?status=eq.running&select=id,status`);return r.ok?await r.json():[]}
async function competitionSafety(){const running=await runningHeats();return {runningCount:running.length,runningHeats:running,stopAllowed:running.length===0}}
async function diskStatus(){try{const s=await statfs(app.getPath('appData'));const available=s.bavail*s.bsize,total=s.blocks*s.bsize;return {available,total,used:total-available,status:available<5*1024**3?'DEGRADED':'HEALTHY'}}catch{return {status:'UNKNOWN'}}}
const manager=makeManager({rootDir:path.resolve(__dirname,'../../..'),discover,health,prerequisites:prereq,fetchRunningHeats:runningHeats});
ipcMain.handle('field:interfaces',()=>interfaces());ipcMain.handle('field:candidates',()=>discover());ipcMain.handle('field:manifest',(_,h)=>fetchJson(`http://${h}:8080/deployment-manifest.json`));ipcMain.handle('field:health',(_,h)=>health(h));ipcMain.handle('field:prerequisites',()=>prereq());ipcMain.handle('field:urls',(_,h)=>tabletUrls(h));ipcMain.handle('field:qr',(_,url)=>QRCode.toDataURL(url,{margin:1,width:220}));ipcMain.handle('field:competition-safety',()=>competitionSafety());ipcMain.handle('field:disk',()=>diskStatus());ipcMain.handle('field:backup',()=>({ok:false,status:'UNAVAILABLE',reason:'P3.3 local Backup Now locked: existing backup script targets an explicit HP over SSH; no local backup path is proven yet.'}));ipcMain.handle('field:state',()=>manager.getState());ipcMain.handle('field:logs',()=>manager.getLogs());ipcMain.handle('field:check-runtime',()=>manager.checkRuntime());ipcMain.handle('field:start',()=>manager.startField());ipcMain.handle('field:stop-check',()=>manager.canStopField());ipcMain.handle('field:stop',(_,confirmed)=>manager.stopField({confirmed:Boolean(confirmed)}));ipcMain.handle('desktop:version',()=>app.getVersion());ipcMain.handle('diagnostics:copy',(_,s)=>{clipboard.writeText(JSON.stringify(s,null,2));return true});ipcMain.handle('open:url',(_,u)=>/^https?:\/\//.test(u)&&shell.openExternal(u));
ipcMain.handle('runtime:compatibility',async()=>{const m=await import('../shared/compatibility.js');const p=m.classifyPlatform({platform:process.platform,arch:process.arch});const r=await prereq();return {...p,runtime:m.classifyRuntime({dockerCli:r.dockerCli,daemon:r.dockerDaemon,context:'unknown',colima:r.colima,dockerDesktop:false}),images:m.REQUIRED_IMAGES}});
function createWindow(){const w=new BrowserWindow({width:1120,height:780,minWidth:860,minHeight:620,webPreferences:{contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'../preload/preload.cjs')}});w.loadFile(path.join(__dirname,'../renderer/index.html'))}
const backupService = createBackupService({root:dataRoot(),fetchRunningHeats:runningHeats,execFile:execFileAsync,manifest:{desktopVersion:'0.3.0-p3.5',frontend:{releaseId:'runtime-discovered',sourceRevision:'runtime-discovered'},schema:'runtime-discovered',databaseVersion:'runtime-discovered'}});
ipcMain.handle('field:backup-v2',()=>backupService.backup());
app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});

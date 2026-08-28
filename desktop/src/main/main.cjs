const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } = require('electron');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fsSync = require('node:fs');
const { statfs } = require('node:fs/promises');
const QRCode = require('qrcode');
const FIELD_TIMEOUT_MS = 2500;
const execFileAsync = promisify(execFile);
const { isPrivateLanAddress, candidateFromManifest, mapHealth, tabletUrls } = require('../shared/field.js');
const { makeManager } = require('./field-service-manager.cjs');
const { makeLivePublicationSupervisor } = require('./live-publication-supervisor.cjs');
const { dataRoot, createBackupService } = require('./backup-service.cjs');
const { makeRuntimePreparationService } = require('./runtime-preparation-service.cjs');
const { readOrganizationProfile, saveOrganizationProfile } = require('./organization-profile.cjs');
const { makeOrganizationPublisher } = require('./organization-publisher.cjs');

const runtimePreparation = makeRuntimePreparationService({
  execFile: execFileAsync,
  downloadsDir: app.getPath('downloads')
});
const appTranslocated = process.platform === 'darwin' && app.isPackaged && process.execPath.includes('/AppTranslocation/');
const inspectMachinePreparation = async () => {
  const result = await runtimePreparation.inspect();
  return appTranslocated ? {...result,state:'APP_TRANSLOCATED',appLocation:'TRANSLOCATED'} : {...result,appLocation:'STABLE'};
};
const organizationRoot = path.join(dataRoot(), 'branding');

async function chooseOrganizationLogo(owner) {
  const selection = await dialog.showOpenDialog(owner, {
    title: 'Choisir le logo de l’organisation',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (selection.canceled || selection.filePaths.length !== 1) return null;
  const source = nativeImage.createFromPath(selection.filePaths[0]);
  if (source.isEmpty()) throw new Error('Cette image ne peut pas être utilisée comme logo.');
  const size = source.getSize();
  const scale = Math.min(1, 512 / Math.max(size.width, size.height));
  const normalized = scale < 1
    ? source.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'best' })
    : source;
  return `data:image/png;base64,${normalized.toPNG().toString('base64')}`;
}

function normalizeOrganizationLogoForRuntime(logoDataUrl) {
  const encoded = String(logoDataUrl || '').replace(/^data:image\/png;base64,/, '');
  const source = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64'));
  if (source.isEmpty()) throw new Error('Le logo local de l’organisation est illisible.');
  const size = source.getSize();
  const scale = Math.min(1, 512 / Math.max(size.width, size.height));
  const normalized = scale < 1
    ? source.resize({ width:Math.max(1, Math.round(size.width * scale)), height:Math.max(1, Math.round(size.height * scale)), quality:'best' })
    : source;
  return `data:image/png;base64,${normalized.toPNG().toString('base64')}`;
}

function interfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,values])=>(values||[]).filter(v=>v.family==='IPv4'&&!v.internal&&isPrivateLanAddress(v.address)&&!/(docker|colima|bridge)/i.test(name)).map(v=>({name,address:v.address,netmask:v.netmask})))}
async function fetchJson(url){const c=new AbortController();const t=setTimeout(()=>c.abort(),FIELD_TIMEOUT_MS);try{const r=await fetch(url,{signal:c.signal});return {status:r.status,body:await r.json()}}finally{clearTimeout(t)}}
async function discover(){const out=[];for(const iface of interfaces()){try{const r=await fetchJson(`http://${iface.address}:8080/deployment-manifest.json`);const c=candidateFromManifest(iface.address,r.body);if(c)out.push({...c,interface:iface.name})}catch{}}return out}
async function prereq(){const command=async(n,a)=>{try{await execFileAsync(n,a,{timeout:1500});return true}catch{return false}};const host=await inspectMachinePreparation();return {dockerCli:host.dockerCli,dockerCliPath:host.dockerCliPath,dockerDesktop:host.dockerAppInstalled,colima:await command('colima',['version']),dockerDaemon:host.dockerDaemon,hostVersion:host.hostVersion,hostArch:host.arch,preparationState:host.state,appLocation:host.appLocation}}
async function health(host){if(!host)return {frontend:'UNAVAILABLE',api:'UNAVAILABLE',realtime:'UNKNOWN',internet:'UNKNOWN',cloud:'UNKNOWN'};const f=await fetchJson(`http://${host}:8080/deployment-manifest.json`).then(x=>x.status===200).catch(()=>false);const a=await fetch(`http://${host}:8000/rest/v1/`,{signal:AbortSignal.timeout(FIELD_TIMEOUT_MS)}).then(x=>x.ok).catch(()=>false);return {frontend:mapHealth(f),manifest:mapHealth(f),api:mapHealth(a),realtime:a?'UNKNOWN':'UNAVAILABLE',internet:'UNKNOWN',cloud:'UNKNOWN'}}
async function runningHeats(){const candidates=await discover();if(candidates.length!==1)return [];const r=await fetch(`http://${candidates[0].host}:8000/rest/v1/heats?status=eq.running&select=id,status`);return r.ok?await r.json():[]}
async function competitionSafety(){const running=await runningHeats();return {runningCount:running.length,runningHeats:running,stopAllowed:running.length===0}}
async function diskStatus(){try{const s=await statfs(app.getPath('appData'));const available=s.bavail*s.bsize,total=s.blocks*s.bsize;return {available,total,used:total-available,status:available<5*1024**3?'DEGRADED':'HEALTHY'}}catch{return {status:'UNKNOWN'}}}
// Development uses the repository; packaged applications use only the immutable
// Field payload shipped next to the executable. Never fall back to a user repo.
const fieldRuntimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'field-runtime')
  : path.resolve(__dirname, '../../..');
const runtimeManifestPath = app.isPackaged
  ? path.join(fieldRuntimeRoot, 'runtime-manifest.json')
  : path.resolve(__dirname, '../../field-runtime/runtime-manifest.json');
const runtimeManifest = JSON.parse(fsSync.readFileSync(runtimeManifestPath, 'utf8'));
const expectedRuntimeIdentity = {
  releaseId: runtimeManifest.frontend.releaseId,
  expectedSchemaVersion: runtimeManifest.schema.expectedVersion,
};
const manager=makeManager({rootDir:fieldRuntimeRoot,stateDir:path.join(dataRoot(),'runtime'),expectedIdentity:expectedRuntimeIdentity,platform:process.platform,discover,health,prerequisites:prereq,fetchRunningHeats:runningHeats});
const organizationPublisher=makeOrganizationPublisher({stateDir:path.join(dataRoot(),'runtime'),discover});
async function syncOrganizationProfile(){const profile=await readOrganizationProfile(organizationRoot);if(!profile.configured)return {status:'NOT_CONFIGURED'};return organizationPublisher.publish({...profile,logoDataUrl:normalizeOrganizationLogoForRuntime(profile.logoDataUrl)});}
const livePublicationSupervisor=makeLivePublicationSupervisor({configPath:path.join(dataRoot(),'live-publication.env'),workerPath:path.join(fieldRuntimeRoot,'scripts','live-outbox-worker.mjs'),logger:(line)=>console.info(line)});
ipcMain.handle('field:interfaces',()=>interfaces());ipcMain.handle('field:candidates',()=>discover());ipcMain.handle('field:manifest',(_,h)=>fetchJson(`http://${h}:8080/deployment-manifest.json`));ipcMain.handle('field:health',(_,h)=>health(h));ipcMain.handle('field:prerequisites',()=>prereq());ipcMain.handle('field:urls',(_,h)=>tabletUrls(h));ipcMain.handle('field:qr',(_,url)=>QRCode.toDataURL(url,{margin:1,width:220}));ipcMain.handle('field:competition-safety',()=>competitionSafety());ipcMain.handle('field:disk',()=>diskStatus());ipcMain.handle('field:backup',()=>({ok:false,status:'UNAVAILABLE',reason:'P3.3 local Backup Now locked: existing backup script targets an explicit HP over SSH; no local backup path is proven yet.'}));ipcMain.handle('field:state',()=>manager.getState());ipcMain.handle('field:progress',()=>manager.getProgress());ipcMain.handle('field:logs',()=>manager.getLogs());ipcMain.handle('field:check-runtime',()=>manager.checkRuntime());ipcMain.handle('field:start',async()=>{if(appTranslocated)throw new Error('Installation requise : déplacez SurfJudging Field dans le dossier Applications, puis rouvrez-le.');const result=await manager.startField();await livePublicationSupervisor.start();return result;});ipcMain.handle('field:stop-check',()=>manager.canStopField());ipcMain.handle('field:stop',async(_,confirmed)=>{const result=await manager.stopField({confirmed:Boolean(confirmed)});if(result.result==='STOPPED')livePublicationSupervisor.stop();return result;});ipcMain.handle('live-publication:status',()=>livePublicationSupervisor.getStatus());ipcMain.handle('desktop:version',()=>app.getVersion());ipcMain.handle('diagnostics:copy',(_,s)=>{clipboard.writeText(JSON.stringify(s,null,2));return true});ipcMain.handle('open:url',(_,u)=>/^https?:\/\//.test(u)&&shell.openExternal(u));
ipcMain.handle('runtime:compatibility',async()=>{const m=await import('../shared/compatibility.js');const p=m.classifyPlatform({platform:process.platform,arch:process.arch});const r=await prereq();return {...p,runtime:m.classifyRuntime({dockerCli:r.dockerCli,daemon:r.dockerDaemon,context:'unknown',colima:r.colima,dockerDesktop:r.dockerDesktop}),images:m.REQUIRED_IMAGES}});
ipcMain.handle('runtime-preparation:inspect',()=>inspectMachinePreparation());
ipcMain.handle('runtime-preparation:install',(event,confirmed)=>runtimePreparation.install({confirmed:Boolean(confirmed),onProgress:(progress)=>event.sender.send('runtime-preparation:progress',progress)}));
ipcMain.handle('runtime-preparation:launch',(event)=>runtimePreparation.launchDocker({onProgress:(progress)=>event.sender.send('runtime-preparation:progress',progress)}));
ipcMain.handle('organization:get',()=>readOrganizationProfile(organizationRoot));
ipcMain.handle('organization:choose-logo',(event)=>chooseOrganizationLogo(BrowserWindow.fromWebContents(event.sender)));
ipcMain.handle('organization:save',async(_event,input)=>{const profile=await saveOrganizationProfile(organizationRoot,input);return {...profile,runtimeSync:await syncOrganizationProfile()};});
ipcMain.handle('organization:sync',()=>syncOrganizationProfile());
function createWindow(){const w=new BrowserWindow({width:1120,height:780,minWidth:860,minHeight:620,webPreferences:{contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'../preload/preload.cjs')}});w.loadFile(path.join(__dirname,'../renderer/index.html'))}
const backupService = createBackupService({root:dataRoot(),fetchRunningHeats:runningHeats,execFile:execFileAsync,manifest:{desktopVersion:'0.3.0-p3.5',frontend:{releaseId:'runtime-discovered',sourceRevision:'runtime-discovered'},schema:'runtime-discovered',databaseVersion:'runtime-discovered'}});
ipcMain.handle('field:backup-v2',()=>backupService.backup());
app.whenReady().then(()=>{app.setAboutPanelOptions({applicationName:'SurfJudging Field',applicationVersion:app.getVersion(),copyright:'Copyright © 2026 René Pierre LARAISE',credits:'Conçu et développé par René Pierre LARAISE\nrplaraise@gmail.com'});createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});app.on('before-quit',()=>livePublicationSupervisor.stop());app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});

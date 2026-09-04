import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DOCKER_APP,
  dockerCliCandidates,
  dockerDesktopCandidates,
  downloadVerifiedInstaller,
  makeRuntimePreparationService,
  resolveDockerCli,
  selectInstaller
} = require('../src/main/runtime-preparation-service.cjs');

test('Ventura and Windows 11 x64 choose pinned Docker installers', () => {
  const intel = selectInstaller({ platform:'darwin', arch:'x64', hostVersion:'13.7.8' });
  const arm = selectInstaller({ platform:'darwin', arch:'arm64', hostVersion:'13.6.1' });
  assert.equal(intel.build, '207573');
  assert.equal(intel.sha256, 'fac73a1edc91e6bce5a449e83e3d0b537f19df74c5f51af4705e479cf0d32515');
  assert.equal(arm.sha256, '79b10d41c8ed5edde7e0db3e01f604349a1e1bcd35dd487ed13afaca98b2beb6');
  assert.equal(selectInstaller({ platform:'darwin', arch:'x64', hostVersion:'13.2.9' }), null);
  assert.equal(selectInstaller({ platform:'darwin', arch:'x64', hostVersion:'14.0' }), null);
  const windows = selectInstaller({ platform:'win32', arch:'x64', hostVersion:'10.0.22631' });
  assert.equal(windows.build, '237512');
  assert.equal(windows.sha256, '89fe3d80a326a2ad521de09b5a89ef04d10c60593604b344f11f433ca7f1f6f0');
  assert.equal(selectInstaller({ platform:'win32', arch:'x64', hostVersion:'10.0.22621' }), null);
  assert.equal(selectInstaller({ platform:'win32', arch:'arm64', hostVersion:'10.0.26100' }), null);
});

test('unsupported Windows hosts fail closed before WSL preparation', async () => {
  const calls = [];
  const service = makeRuntimePreparationService({
    execFile:async(file,args)=>{calls.push([file,args]);if(file==='wsl.exe')throw new Error('missing');return {stdout:'',stderr:''};},
    downloadsDir:'C:\\Users\\sandy\\Downloads',
    platform:'win32',
    arch:'arm64',
    release:()=> '10.0.26100',
    totalMemory:16*1024**3,
    access:async()=>{throw new Error('missing');},
    statfs:async()=>({bavail:30,bsize:1024**3})
  });
  assert.equal((await service.inspect()).state, 'UNSUPPORTED');
  await assert.rejects(service.install({confirmed:true}), /Aucun installateur Docker approuvé/);
  assert.equal(calls.some(([file,args])=>file==='powershell.exe' && args.some((arg)=>String(arg).includes('-Verb RunAs'))), false);
});

test('low-memory Windows hosts do not mutate WSL', async () => {
  const calls = [];
  const service = makeRuntimePreparationService({
    execFile:async(file,args)=>{calls.push([file,args]);if(file==='wsl.exe')throw new Error('missing');return {stdout:'',stderr:''};},
    downloadsDir:'C:\\Users\\sandy\\Downloads',
    platform:'win32',
    arch:'x64',
    release:()=> '10.0.22631',
    totalMemory:4*1024**3,
    access:async()=>{throw new Error('missing');},
    statfs:async()=>({bavail:30,bsize:1024**3})
  });
  assert.equal((await service.inspect()).state, 'MEMORY_INSUFFICIENT');
  await assert.rejects(service.install({confirmed:true}), /8 Go minimum/);
  assert.equal(calls.some(([file,args])=>file==='powershell.exe' && args.some((arg)=>String(arg).includes('-Verb RunAs'))), false);
});

test('Docker inside Docker.app is resolved before Finder PATH entries', async () => {
  const candidates = dockerCliCandidates({ platform:'darwin', home:'/Users/sandy', envPath:'/usr/bin:/bin' });
  assert.equal(candidates[0], '/Applications/Docker.app/Contents/Resources/bin/docker');
  const resolved = await resolveDockerCli({ candidates, access:async(file)=>{if(file!==candidates[0])throw new Error('missing');} });
  assert.equal(resolved, candidates[0]);
  const windows = dockerCliCandidates({ platform:'win32', home:'C:\\Users\\sandy', envPath:'C:\\Windows\\System32;C:\\Tools', localAppData:'C:\\Users\\sandy\\AppData\\Local', programFiles:'C:\\Program Files' });
  assert.match(windows[0], /Programs[\\/]DockerDesktop[\\/]resources[\\/]bin[\\/]docker\.exe$/);
  assert.match(windows[1], /Docker[\\/]Docker[\\/]resources[\\/]bin[\\/]docker\.exe$/);
  const desktop = dockerDesktopCandidates({ platform:'win32', localAppData:'C:\\Users\\sandy\\AppData\\Local', programFiles:'C:\\Program Files' });
  assert.match(desktop[0], /Programs[\\/]DockerDesktop[\\/]Docker Desktop\.exe$/);
});

test('host inspection distinguishes missing, stopped and ready Docker', async () => {
  let dockerInstalled = false;
  let daemon = false;
  const execFile = async (file, args) => {
    if (file === '/usr/bin/sw_vers') return { stdout:'13.7.8\n', stderr:'' };
    if (args?.[0] === 'info' && daemon) return { stdout:'"28.5.1"', stderr:'' };
    if (args?.[0] === 'info') throw new Error('daemon stopped');
    return { stdout:'', stderr:'' };
  };
  const access = async (file) => {
    if (file === DOCKER_APP && dockerInstalled) return;
    if (file.endsWith('/docker') && dockerInstalled) return;
    throw new Error('missing');
  };
  const service = makeRuntimePreparationService({ execFile, downloadsDir:'/tmp', platform:'darwin', arch:'x64', home:'/Users/sandy', totalMemory:8*1024**3, access });
  assert.equal((await service.inspect()).state, 'DOWNLOAD_REQUIRED');
  dockerInstalled = true;
  assert.equal((await service.inspect()).state, 'DOCKER_STOPPED');
  daemon = true;
  assert.equal((await service.inspect()).state, 'READY');
});

test('download is atomic and rejects bytes that do not match the pinned digest', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surfjudging-download-test-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const bytes = Buffer.from('official docker fixture');
  const installer = {
    url:'https://desktop.docker.com/mac/main/amd64/test/Docker.dmg',
    sizeBytes:bytes.length,
    sha256:crypto.createHash('sha256').update(bytes).digest('hex')
  };
  const response = (body) => ({
    ok:true,
    url:installer.url,
    headers:new Headers({ 'content-length':String(body.length) }),
    body:new ReadableStream({ start(controller){controller.enqueue(body);controller.close();} })
  });
  const destination = path.join(root, 'Docker.dmg');
  const result = await downloadVerifiedInstaller(installer, destination, { fetchImpl:async()=>response(bytes) });
  assert.equal(result.cached, false);
  assert.deepEqual(await fsp.readFile(destination), bytes);
  const cached = await downloadVerifiedInstaller(installer, destination, { fetchImpl:async()=>{throw new Error('must not download');} });
  assert.equal(cached.cached, true);
  const wrong = { ...installer, sha256:'0'.repeat(64) };
  await assert.rejects(downloadVerifiedInstaller(wrong, path.join(root, 'wrong.dmg'), { fetchImpl:async()=>response(bytes) }), /SHA-256/);
  assert.equal(fs.existsSync(path.join(root, 'wrong.dmg.part')), false);
  const wrongHeader = response(bytes);
  wrongHeader.headers = new Headers({ 'content-length':String(bytes.length + 1) });
  await assert.rejects(downloadVerifiedInstaller(installer, path.join(root, 'wrong-size.dmg'), { fetchImpl:async()=>wrongHeader }), /annoncée invalide/);
  assert.equal(fs.existsSync(path.join(root, 'wrong-size.dmg.part')), false);
});

test('approved installation uses the macOS admin dialog without auto-accepting Docker terms', async () => {
  let installed = false;
  const calls = [];
  const execFile = async (file, args) => {
    calls.push([file, args]);
    if (file === '/usr/bin/sw_vers') return { stdout:'13.7.8\n', stderr:'' };
    if (file === '/usr/bin/codesign' && args[0] === '-dv') return { stdout:'', stderr:'Identifier=com.docker.docker\nTeamIdentifier=9BNSXJN65R\n' };
    if (file === '/usr/bin/osascript') { installed = true; return { stdout:'', stderr:'' }; }
    if (args?.[0] === 'info' && installed) return { stdout:'"28.5.1"', stderr:'' };
    if (args?.[0] === 'info') throw new Error('daemon stopped');
    return { stdout:'', stderr:'' };
  };
  const access = async (file) => {
    if (!installed) throw new Error('missing');
    if (file === DOCKER_APP || file.endsWith('/docker')) return;
    throw new Error('missing');
  };
  const service = makeRuntimePreparationService({
    execFile,
    downloadsDir:'/tmp',
    platform:'darwin',
    arch:'x64',
    home:'/Users/sandy',
    username:'sandy',
    totalMemory:8*1024**3,
    access,
    statfs:async()=>({ bavail:30, bsize:1024**3 }),
    download:async()=>({ destination:'/tmp/Docker.dmg' }),
    mkdtemp:async()=>'/tmp/surfjudging-mounted-docker',
    rm:async()=>{},
    sleep:async()=>{}
  });
  assert.equal((await service.install()).state, 'CONFIRMATION_REQUIRED');
  const result = await service.install({ confirmed:true });
  assert.equal(result.state, 'READY');
  const admin = calls.find(([file]) => file === '/usr/bin/osascript');
  assert.ok(admin);
  assert.match(admin[1][1], /with administrator privileges/);
  assert.match(admin[1][1], /--user=/);
  assert.doesNotMatch(admin[1][1], /accept-license/);
});

test('Windows 11 inspection requires WSL before the pinned Docker download', async () => {
  let wslReady = false;
  const execFile = async (file, args) => {
    if (file === 'wsl.exe' && args[0] === '--version' && wslReady) return { stdout:'WSL version: 2.6.1.0', stderr:'' };
    if (file === 'wsl.exe') throw new Error('WSL missing');
    if (args?.[0] === 'info') throw new Error('daemon stopped');
    return { stdout:'', stderr:'' };
  };
  const service = makeRuntimePreparationService({
    execFile,
    downloadsDir:'C:\\Users\\sandy\\Downloads',
    platform:'win32',
    arch:'x64',
    home:'C:\\Users\\sandy',
    localAppData:'C:\\Users\\sandy\\AppData\\Local',
    programFiles:'C:\\Program Files',
    release:()=> '10.0.22631',
    totalMemory:16*1024**3,
    access:async()=>{throw new Error('missing');},
    statfs:async()=>({ bavail:30, bsize:1024**3 }),
    sleep:async()=>{}
  });
  assert.equal((await service.inspect()).state, 'WSL_REQUIRED');
  wslReady = true;
  const readyForDownload = await service.inspect();
  assert.equal(readyForDownload.state, 'DOWNLOAD_REQUIRED');
  assert.equal(readyForDownload.installer.build, '237512');
  assert.equal(readyForDownload.minimumMemory, 8*1024**3);
});

test('Windows WSL preparation uses UAC and reports restart instead of claiming ready', async () => {
  const calls = [];
  const execFile = async (file, args) => {
    calls.push([file,args]);
    if (file === 'wsl.exe') throw new Error('WSL missing');
    if (args?.[0] === 'info') throw new Error('daemon stopped');
    return { stdout:'', stderr:'' };
  };
  const service = makeRuntimePreparationService({
    execFile,
    downloadsDir:'C:\\Users\\sandy\\Downloads',
    platform:'win32',
    arch:'x64',
    release:()=> '10.0.22631',
    totalMemory:16*1024**3,
    access:async()=>{throw new Error('missing');},
    statfs:async()=>({ bavail:30, bsize:1024**3 })
  });
  const result = await service.install({ confirmed:true });
  assert.equal(result.state, 'RESTART_REQUIRED');
  const elevation = calls.find(([file,args])=>file==='powershell.exe' && args.some((arg)=>String(arg).includes('-Verb RunAs')));
  assert.ok(elevation);
  assert.ok(elevation[1].some((arg)=>String(arg).includes('--no-distribution')));
});

test('Windows Docker installation verifies Authenticode and never auto-accepts the license', async () => {
  let installed = false;
  let daemon = false;
  const calls = [];
  const localAppData = 'C:\\Users\\sandy\\AppData\\Local';
  const dockerDesktop = dockerDesktopCandidates({ platform:'win32', localAppData, programFiles:'C:\\Program Files' })[0];
  const dockerCli = dockerCliCandidates({ platform:'win32', home:'C:\\Users\\sandy', envPath:'', localAppData, programFiles:'C:\\Program Files' })[0];
  const execFile = async (file, args, options) => {
    calls.push([file,args,options]);
    if (file === 'wsl.exe') return { stdout:'WSL version: 2.6.1.0', stderr:'' };
    if (file === 'powershell.exe' && String(args[3]).includes('Get-AuthenticodeSignature')) return { stdout:JSON.stringify({Status:'Valid',Subject:'CN=Docker Inc, O=Docker Inc'}), stderr:'' };
    if (String(file).endsWith('Docker-4.88.1-237512-amd64.exe')) { installed = true; return { stdout:'', stderr:'' }; }
    if (file === 'powershell.exe' && String(args[3]).includes('Start-Process')) { daemon = true; return { stdout:'0', stderr:'' }; }
    if (file === dockerCli && args[0] === 'info' && daemon) return { stdout:'"29.7.2"', stderr:'' };
    if (args?.[0] === 'info') throw new Error('daemon stopped');
    return { stdout:'', stderr:'' };
  };
  const access = async (file) => {
    if (installed && (file === dockerCli || String(file).endsWith('Docker Desktop.exe'))) return;
    throw new Error('missing');
  };
  const service = makeRuntimePreparationService({
    execFile,
    downloadsDir:'C:\\Users\\sandy\\Downloads',
    platform:'win32',
    arch:'x64',
    home:'C:\\Users\\sandy',
    localAppData,
    programFiles:'C:\\Program Files',
    release:()=> '10.0.22631',
    totalMemory:16*1024**3,
    access,
    statfs:async()=>({ bavail:30, bsize:1024**3 }),
    download:async(_installer,destination)=>({ destination }),
    sleep:async()=>{}
  });
  const result = await service.install({ confirmed:true });
  assert.equal(result.state, 'READY');
  const installerCall = calls.find(([file,_args])=>String(file).endsWith('Docker-4.88.1-237512-amd64.exe'));
  assert.deepEqual(installerCall[1], ['install','--user','--backend=wsl-2','--no-windows-containers']);
  assert.ok(!installerCall[1].includes('--accept-license'));
});

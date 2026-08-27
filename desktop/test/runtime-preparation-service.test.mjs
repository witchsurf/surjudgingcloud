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
  downloadVerifiedInstaller,
  makeRuntimePreparationService,
  resolveDockerCli,
  selectInstaller
} = require('../src/main/runtime-preparation-service.cjs');

test('Ventura chooses a pinned installer for each Mac architecture', () => {
  const intel = selectInstaller({ platform:'darwin', arch:'x64', hostVersion:'13.7.8' });
  const arm = selectInstaller({ platform:'darwin', arch:'arm64', hostVersion:'13.6.1' });
  assert.equal(intel.build, '207573');
  assert.equal(intel.sha256, 'fac73a1edc91e6bce5a449e83e3d0b537f19df74c5f51af4705e479cf0d32515');
  assert.equal(arm.sha256, '79b10d41c8ed5edde7e0db3e01f604349a1e1bcd35dd487ed13afaca98b2beb6');
  assert.equal(selectInstaller({ platform:'darwin', arch:'x64', hostVersion:'13.2.9' }), null);
  assert.equal(selectInstaller({ platform:'darwin', arch:'x64', hostVersion:'14.0' }), null);
  assert.equal(selectInstaller({ platform:'win32', arch:'x64', hostVersion:'13.7.8' }), null);
});

test('Docker inside Docker.app is resolved before Finder PATH entries', async () => {
  const candidates = dockerCliCandidates({ platform:'darwin', home:'/Users/sandy', envPath:'/usr/bin:/bin' });
  assert.equal(candidates[0], '/Applications/Docker.app/Contents/Resources/bin/docker');
  const resolved = await resolveDockerCli({ candidates, access:async(file)=>{if(file!==candidates[0])throw new Error('missing');} });
  assert.equal(resolved, candidates[0]);
  const windows = dockerCliCandidates({ platform:'win32', envPath:'C:\\Windows\\System32;C:\\Tools', programFiles:'C:\\Program Files' });
  assert.match(windows[0], /Docker[\\/]Docker[\\/]resources[\\/]bin[\\/]docker\.exe$/);
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

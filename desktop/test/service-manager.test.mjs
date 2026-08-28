import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { launcherFor, runtimeIdentityMatches, makeManager } = require('../src/main/field-service-manager.cjs');
const candidate = { host:'10.0.0.10', manifest:{deploymentMode:'field',releaseId:'r',codeRevision:'c',expectedSchemaVersion:'s'} };
const healthy = { frontend:'HEALTHY', api:'HEALTHY' };
const base = (overrides={}) => makeManager({ rootDir:'/repo', discover:async()=>[], health:async()=>healthy, prerequisites:async()=>({dockerCli:true,colima:true,dockerDaemon:true}), fetchRunningHeats:async()=>[], spawnProcess:()=>({stdout:{on(){}},stderr:{on(){}}}), run:async()=>({}), ...overrides });

test('already-running does not spawn launcher', async()=>{let spawned=0; const m=base({discover:async()=>[candidate],spawnProcess:()=>{spawned++;}}); const r=await m.startField(); assert.equal(r.result,'ALREADY_RUNNING'); assert.equal(spawned,0); assert.equal(m.getState(),'READY');});
test('runtime identity compares both frontend release and schema', () => {
  assert.equal(runtimeIdentityMatches(candidate, { releaseId:'r', expectedSchemaVersion:'s' }), true);
  assert.equal(runtimeIdentityMatches(candidate, { releaseId:'r2', expectedSchemaVersion:'s' }), false);
  assert.equal(runtimeIdentityMatches(candidate, { releaseId:'r', expectedSchemaVersion:'s2' }), false);
});
test('stale runtime is upgraded only when no heat is running', async()=>{let spawned=0;let discovers=0;const upgraded={...candidate,manifest:{...candidate.manifest,releaseId:'new',expectedSchemaVersion:'new-schema'}};const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();const m=base({expectedIdentity:{releaseId:'new',expectedSchemaVersion:'new-schema'},discover:async()=>{discovers++;return discovers<2?[candidate]:[upgraded];},spawnProcess:()=>{spawned++;return child;}});const r=await m.startField();assert.equal(r.result,'UPGRADING');assert.equal(spawned,1);});
test('running heat blocks a stale runtime upgrade', async()=>{const m=base({expectedIdentity:{releaseId:'new',expectedSchemaVersion:'new-schema'},discover:async()=>[candidate],fetchRunningHeats:async()=>[{id:'live'}]});await assert.rejects(m.startField(),/upgrade blocked/);});
test('start requests share one active operation', async()=>{let spawned=0; const m=base({discover:async()=>[],spawnProcess:()=>{spawned++;return {stdout:{on(){}},stderr:{on(){}}}},timeouts:{startup:5,startupPoll:1}}); const a=m.startField(); const b=m.startField(); assert.equal(a,b); await Promise.allSettled([a,b]); assert.equal(spawned,1);});
test('running heat blocks stop from fresh backend truth', async()=>{const m=base({fetchRunningHeats:async()=>[{id:'heat-running'}]}); const r=await m.stopField({confirmed:true}); assert.equal(r.result,'DENIED_RUNNING_HEAT'); assert.equal(m.getState(),'STOP_CHECK');});
test('stop requires explicit confirmation when safe', async()=>{const m=base({run:async(cmd,args)=>{assert.equal(cmd,'docker'); assert.deepEqual(args.slice(0,2),['stop','surfjudging_field_frontend']);}}); const r=await m.stopField(); assert.equal(r.result,'CONFIRMATION_REQUIRED'); assert.equal(m.getState(),'STOP_CHECK');});
test('Docker Desktop is sufficient; Colima is not an installer requirement', async()=>{const m=base({prerequisites:async()=>({dockerCli:true,dockerDaemon:true,colima:false})}); const r=await m.checkRuntime(); assert.equal(r.ok,true);});
test('absolute Docker.app CLI and stable state path are passed to launcher', async()=>{let spawnOptions;let stopCommand;const prerequisites=async()=>({dockerCli:true,dockerDaemon:true,dockerCliPath:'/Applications/Docker.app/Contents/Resources/bin/docker'});const m=base({stateDir:'/Users/sandy/Library/Application Support/SurfJudging/runtime',prerequisites,discover:async()=>[],spawnProcess:(_command,_args,options)=>{spawnOptions=options;return {stdout:{on(){}},stderr:{on(){}}}},run:async(command)=>{stopCommand=command;},timeouts:{startup:5,startupPoll:1}});await Promise.allSettled([m.startField()]);assert.equal(spawnOptions.env.SURFJUDGING_DOCKER_BIN,'/Applications/Docker.app/Contents/Resources/bin/docker');assert.equal(spawnOptions.env.SURFJUDGING_STATE_DIR,'/Users/sandy/Library/Application Support/SurfJudging/runtime');await m.stopField({confirmed:true});assert.equal(stopCommand,'/Applications/Docker.app/Contents/Resources/bin/docker');});
test('launcher failure aborts immediately with the captured diagnostic', async()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();const m=base({discover:async()=>[],spawnProcess:()=>{queueMicrotask(()=>{child.stderr.emit('data','mount configuration failed\n');child.emit('exit',23,null);});return child;},timeouts:{startup:1000,startupPoll:1}});await assert.rejects(m.startField(),/launcher failed \(23\).*launcher-exit/);assert.match(m.getLogs().join('\n'),/mount configuration failed/);});
test('log buffer redacts and bounds output', async()=>{const m=base({discover:async()=>[]}); const logs=m.getLogs(); assert.deepEqual(logs,[]);});
test('uses a hidden PowerShell launcher on Windows', () => {
  const launcher = launcherFor('win32', 'C:/Program Files/SurfJudging Field/resources/field-runtime');
  assert.equal(launcher.command, 'powershell.exe');
  assert.match(launcher.args.at(-1), /start-surfjudging-field-windows\.ps1$/);
});

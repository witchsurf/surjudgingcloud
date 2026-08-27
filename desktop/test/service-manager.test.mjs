import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { launcherFor, makeManager } = require('../src/main/field-service-manager.cjs');
const candidate = { host:'10.0.0.10', manifest:{deploymentMode:'field',releaseId:'r',codeRevision:'c',expectedSchemaVersion:'s'} };
const healthy = { frontend:'HEALTHY', api:'HEALTHY' };
const base = (overrides={}) => makeManager({ rootDir:'/repo', discover:async()=>[], health:async()=>healthy, prerequisites:async()=>({dockerCli:true,colima:true,dockerDaemon:true}), fetchRunningHeats:async()=>[], spawnProcess:()=>({stdout:{on(){}},stderr:{on(){}}}), run:async()=>({}), ...overrides });

test('already-running does not spawn launcher', async()=>{let spawned=0; const m=base({discover:async()=>[candidate],spawnProcess:()=>{spawned++;}}); const r=await m.startField(); assert.equal(r.result,'ALREADY_RUNNING'); assert.equal(spawned,0); assert.equal(m.getState(),'READY');});
test('start requests share one active operation', async()=>{let spawned=0; const m=base({discover:async()=>[],spawnProcess:()=>{spawned++;return {stdout:{on(){}},stderr:{on(){}}}},timeouts:{startup:5}}); const a=m.startField(); const b=m.startField(); assert.equal(a,b); await Promise.allSettled([a,b]); assert.equal(spawned,1);});
test('running heat blocks stop from fresh backend truth', async()=>{const m=base({fetchRunningHeats:async()=>[{id:'heat-running'}]}); const r=await m.stopField({confirmed:true}); assert.equal(r.result,'DENIED_RUNNING_HEAT'); assert.equal(m.getState(),'STOP_CHECK');});
test('stop requires explicit confirmation when safe', async()=>{const m=base({run:async(cmd,args)=>{assert.equal(cmd,'docker'); assert.deepEqual(args.slice(0,2),['stop','surfjudging_field_frontend']);}}); const r=await m.stopField(); assert.equal(r.result,'CONFIRMATION_REQUIRED'); assert.equal(m.getState(),'STOP_CHECK');});
test('Docker Desktop is sufficient; Colima is not an installer requirement', async()=>{const m=base({prerequisites:async()=>({dockerCli:true,dockerDaemon:true,colima:false})}); const r=await m.checkRuntime(); assert.equal(r.ok,true);});
test('log buffer redacts and bounds output', async()=>{const m=base({discover:async()=>[]}); const logs=m.getLogs(); assert.deepEqual(logs,[]);});
test('uses a hidden PowerShell launcher on Windows', () => {
  const launcher = launcherFor('win32', 'C:/Program Files/SurfJudging Field/resources/field-runtime');
  assert.equal(launcher.command, 'powershell.exe');
  assert.match(launcher.args.at(-1), /start-surfjudging-field-windows\.ps1$/);
});

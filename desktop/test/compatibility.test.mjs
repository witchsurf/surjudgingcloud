import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPlatform, classifyRuntime, classifyOwnership, validateReleaseManifest } from '../src/shared/compatibility.js';
test('classifies supported Mac and Windows architectures',()=>{assert.equal(classifyPlatform({platform:'darwin',arch:'x64'}).status,'CANDIDATE');assert.equal(classifyPlatform({platform:'win32',arch:'arm64'}).status,'CANDIDATE');assert.equal(classifyPlatform({platform:'linux',arch:'x64'}).status,'UNSUPPORTED')});
test('classifies runtime without installing it',()=>{assert.equal(classifyRuntime({dockerCli:true,daemon:true,context:'colima',colima:true}),'COLIMA_DOCKER_READY');assert.equal(classifyRuntime({dockerCli:true,daemon:false}),'DAEMON_UNREACHABLE');assert.equal(classifyRuntime({dockerCli:false}),'RUNTIME_MISSING')});
test('never owns unlabeled containers',()=>{assert.equal(classifyOwnership({labels:{'com.docker.compose.project':'surfjudging'}}),'SURFJUDGING_OWNED');assert.equal(classifyOwnership({labels:{}}),'UNRELATED')});
test('requires complete release identity',()=>{assert.equal(validateReleaseManifest({desktopVersion:'1',frontendRelease:'r',sourceRevision:'s',expectedSchema:'x',runtimeVersion:'v'}),true);assert.equal(validateReleaseManifest({desktopVersion:'1'}),false)});

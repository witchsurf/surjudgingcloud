import test from 'node:test'; import assert from 'node:assert/strict'; import {dataRoot,layout,backupFilename,createBackupService} from '../src/main/backup-service.cjs';
test('canonical roots are platform specific',()=>{assert.match(dataRoot('darwin','/Users/x'),/Library\/Application Support\/SurfJudging$/); assert.match(dataRoot('win32','C:\\Users\\x'),/SurfJudging$/);});
test('backup filename is deterministic and schema-bound',()=>assert.match(backupFilename({schema:'s',date:new Date('2026-01-02T03:04:05.000Z')}),/surfjudging-field-20260102T030405Z-s\.dump/));
test('running heat blocks backup',async()=>{const s=createBackupService({root:'/tmp/x',fetchRunningHeats:async()=>[{id:'h'}],execFile:async()=>{},manifest:{}}); assert.equal((await s.backup()).status,'BLOCKED_RUNNING_HEAT');});

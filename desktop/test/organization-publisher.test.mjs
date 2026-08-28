import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { readEnvValue, makeOrganizationPublisher } = require('../src/main/organization-publisher.cjs');

test('reads only the requested runtime environment value', () => {
  assert.equal(readEnvValue('ANON_KEY=abc\nSECRET=hidden\n', 'ANON_KEY'), 'abc');
  assert.equal(readEnvValue('ANON_KEY=abc\n', 'SECRET'), '');
});

test('publishes the local organization to exactly one Field runtime', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surfjudging-org-publish-'));
  await fs.mkdir(path.join(root, 'compose'), { recursive:true });
  await fs.writeFile(path.join(root, 'compose', '.env'), 'ANON_KEY=local-anon\n');
  let request;
  const publisher = makeOrganizationPublisher({
    stateDir:root,
    discover:async()=>[{host:'192.168.1.99'}],
    fetchImpl:async(url, options)=>{request={url,options};return {ok:true,status:200,text:async()=>''};},
  });
  const result = await publisher.publish({configured:true,organizationName:'LARAISE',logoDataUrl:'data:image/png;base64,AAAA'});
  assert.equal(result.status, 'SYNCED');
  assert.match(request.url, /192\.168\.1\.99:8000.*upsert_field_organization_profile/);
  assert.equal(request.options.headers.apikey, 'local-anon');
  assert.deepEqual(JSON.parse(request.options.body), {p_organization_name:'LARAISE',p_logo_data_url:'data:image/png;base64,AAAA'});
  await fs.rm(root, { recursive:true, force:true });
});

test('keeps a durable pending state when no unique runtime is available', async () => {
  const publisher = makeOrganizationPublisher({stateDir:'/unused',discover:async()=>[]});
  const result = await publisher.publish({configured:true,organizationName:'LARAISE',logoDataUrl:'data:image/png;base64,AAAA'});
  assert.deepEqual(result, {status:'PENDING',reason:'FIELD_RUNTIME_NOT_UNIQUE'});
});

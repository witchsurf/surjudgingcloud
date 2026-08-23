#!/usr/bin/env node
import assert from 'node:assert';
import { assertNotProductionRuntime } from './anti-prod-guard.mjs';

console.log('======================================================');
console.log('🛡️  TEST DE LA PROTECTION ANTI-CONTAMINATION PROD');
console.log('======================================================');

let passCount = 0;

function testExpectsRejection(description, input) {
  try {
    assertNotProductionRuntime(input);
    assert.fail(`ÉCHEC DU TEST: ${description} aurait dû être refusé !`);
  } catch (err) {
    assert(
      err.message.includes('REFUS: production runtime protected'),
      `Message attendu non trouvé: ${err.message}`
    );
    console.log(`  ✓ Refus validé: ${description}`);
    passCount++;
  }
}

function testExpectsAcceptance(description, input) {
  try {
    assertNotProductionRuntime(input);
    console.log(`  ✓ Acceptation validée: ${description}`);
    passCount++;
  } catch (err) {
    assert.fail(`ÉCHEC DU TEST: ${description} n'aurait pas dû être refusé: ${err.message}`);
  }
}

// 1. Refusal on exact project name
testExpectsRejection('PROJECT == surfjudging_field_prod', {
  project: 'surfjudging_field_prod',
  webPort: 18880,
  apiPort: 18800,
  pgPort: 18832,
});

// 2. Refusal on volume name containing surfjudging_field_prod
testExpectsRejection('volumeName contains surfjudging_field_prod', {
  project: 'disposable_test',
  volumeName: 'surfjudging_field_prod_pgdata',
  webPort: 18880,
  apiPort: 18800,
  pgPort: 18832,
});

// 3. Refusal on production web port 8080
testExpectsRejection('webPort == 8080', {
  project: 'disposable_test',
  webPort: 8080,
  apiPort: 18800,
  pgPort: 18832,
});

// 4. Refusal on production api port 8000
testExpectsRejection('apiPort == 8000', {
  project: 'disposable_test',
  webPort: 18880,
  apiPort: 8000,
  pgPort: 18832,
});

// 5. Refusal on production pg port 5432
testExpectsRejection('pgPort == 5432', {
  project: 'disposable_test',
  webPort: 18880,
  apiPort: 18800,
  pgPort: 5432,
});

// 6. Refusal on composeFile path pointing to prod
testExpectsRejection('composeFile in artifacts/runtimes/surfjudging_field_prod', {
  project: 'disposable_test',
  composeFile: '/path/to/artifacts/runtimes/surfjudging_field_prod/docker-compose.yml',
  webPort: 18880,
  apiPort: 18800,
  pgPort: 18832,
});

// 7. Refusal on envFile path pointing to prod
testExpectsRejection('envFile in artifacts/runtimes/surfjudging_field_prod', {
  project: 'disposable_test',
  envFile: '/path/to/artifacts/runtimes/surfjudging_field_prod/.env',
  webPort: 18880,
  apiPort: 18800,
  pgPort: 18832,
});

// 8. Acceptance for isolated disposable runtime
testExpectsAcceptance('Disposable test runtime with isolated ports', {
  project: 'surfjudging_field_test_e2e',
  volumeName: 'surfjudging_field_test_e2e_pgdata',
  webPort: 18880,
  apiPort: 18800,
  pgPort: 18832,
  composeFile: '/path/to/artifacts/runtimes/surfjudging_field_test_e2e/docker-compose.yml',
  envFile: '/path/to/artifacts/runtimes/surfjudging_field_test_e2e/.env',
});

console.log('======================================================');
console.log(`🎉 TOUS LES TESTS DE PROTECTION SONT VERTS (${passCount}/${passCount})`);
console.log('======================================================');

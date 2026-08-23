#!/usr/bin/env node

/**
 * Barrière de sécurité stricte interdisant l'exécution de tests destructifs,
 * de scripts d'injection de fixtures ou de seeds sur le runtime de production surfjudging_field_prod.
 */
export function assertNotProductionRuntime({ project, webPort, apiPort, pgPort, composeFile, envFile, volumeName } = {}) {
  const PROD_PROJECT = 'surfjudging_field_prod';
  const PROD_WEB_PORT = 8080;
  const PROD_API_PORT = 8000;
  const PROD_PG_PORT = 5432;
  const PROD_PATH_SUBSTRING = 'artifacts/runtimes/surfjudging_field_prod';
  const PROD_VOLUME_SUBSTRING = 'surfjudging_field_prod';

  const errors = [];

  if (project === PROD_PROJECT) {
    errors.push(`PROJECT is set to production project "${PROD_PROJECT}"`);
  }

  if (volumeName && String(volumeName).includes(PROD_VOLUME_SUBSTRING)) {
    errors.push(`Volume target "${volumeName}" contains "${PROD_VOLUME_SUBSTRING}"`);
  }

  if (Number(webPort) === PROD_WEB_PORT) {
    errors.push(`WEB_PORT ${webPort} matches production port ${PROD_WEB_PORT}`);
  }
  if (Number(apiPort) === PROD_API_PORT) {
    errors.push(`API_PORT ${apiPort} matches production port ${PROD_API_PORT}`);
  }
  if (Number(pgPort) === PROD_PG_PORT) {
    errors.push(`PG_PORT ${pgPort} matches production port ${PROD_PG_PORT}`);
  }

  if (composeFile && String(composeFile).includes(PROD_PATH_SUBSTRING)) {
    errors.push(`composeFile path matches production runtime path "${PROD_PATH_SUBSTRING}"`);
  }
  if (envFile && String(envFile).includes(PROD_PATH_SUBSTRING)) {
    errors.push(`envFile path matches production runtime path "${PROD_PATH_SUBSTRING}"`);
  }

  if (errors.length > 0) {
    const refusalMsg = `REFUS: production runtime protected -> ${errors.join('; ')}`;
    console.error(`\n⛔ ${refusalMsg}\n`);
    const err = new Error(refusalMsg);
    err.name = 'ProductionRuntimeProtectionError';
    throw err;
  }
}

// CLI test usage
if (process.argv[1] && process.argv[1].endsWith('anti-prod-guard.mjs')) {
  try {
    const project = process.env.SURF_FIELD_PROJECT || process.argv[2];
    const webPort = process.env.SURF_FIELD_WEB_PORT || process.argv[3];
    const apiPort = process.env.SURF_FIELD_API_PORT || process.argv[4];
    const pgPort = process.env.SURF_FIELD_PG_PORT || process.argv[5];
    assertNotProductionRuntime({ project, webPort, apiPort, pgPort });
    console.log('✓ Anti-prod guard validation PASS: target is not production.');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

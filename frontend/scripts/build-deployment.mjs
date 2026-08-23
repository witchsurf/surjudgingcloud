import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const requestedMode = process.argv[2] ?? process.env.VITE_DEPLOYMENT_MODE;
if (requestedMode !== 'cloud' && requestedMode !== 'field') {
  console.error('Usage: node scripts/build-deployment.mjs <cloud|field>');
  process.exit(2);
}

if (requestedMode === 'field') {
  const runtimeName = process.argv[3] || process.env.SURF_RUNTIME_NAME;
  if (!runtimeName) {
    console.error('❌ Error: Field builds require an explicit runtime target.');
    console.error('Usage: npm run field:build -- <runtime-name>');
    console.error('   or: npm run field:test2');
    process.exit(1);
  }
  const fieldScript = resolve('scripts/build-field-runtime.mjs');
  const result = spawnSync(process.execPath, [fieldScript, runtimeName], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

const viteEntry = resolve('node_modules/vite/bin/vite.js');
const result = spawnSync(
  process.execPath,
  [viteEntry, 'build', '--outDir', `dist-${requestedMode}`],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEPLOYMENT_MODE: requestedMode,
      ...(requestedMode === 'cloud' ? { VITE_DEV_MODE: 'false' } : {}),
    },
  },
);

process.exit(result.status ?? 1);

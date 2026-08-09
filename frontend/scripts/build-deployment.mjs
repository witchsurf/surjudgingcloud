import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const requestedMode = process.argv[2] ?? process.env.VITE_DEPLOYMENT_MODE;
if (requestedMode !== 'cloud' && requestedMode !== 'field') {
  console.error('Usage: node scripts/build-deployment.mjs <cloud|field>');
  process.exit(2);
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

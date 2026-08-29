export const REQUIRED_IMAGES = Object.freeze([
  ['supabase/postgres', '15.1.0.147'],
  ['supabase/gotrue', 'v2.132.3'],
  ['supabase/realtime', 'v2.25.50'],
  ['postgrest/postgrest', 'v11.2.0'],
  ['kong', '2.8.1'],
  ['supabase/storage-api', 'v0.40.4']
]);

export function classifyPlatform({ platform, arch }) {
  const supportedPlatform = platform === 'darwin' || platform === 'win32';
  const supportedArch = platform === 'win32' ? arch === 'x64' : ['arm64', 'x64'].includes(arch);
  return { supportedPlatform, supportedArch, status: supportedPlatform && supportedArch ? 'CANDIDATE' : 'UNSUPPORTED' };
}

export function classifyRuntime({ dockerCli, daemon, context, colima, dockerDesktop }) {
  if (!dockerCli) return 'RUNTIME_MISSING';
  if (!daemon) return 'DAEMON_UNREACHABLE';
  if (context === 'colima' && colima) return 'COLIMA_DOCKER_READY';
  if (dockerDesktop) return 'DOCKER_DESKTOP_READY';
  return 'DOCKER_CONTEXT_UNKNOWN';
}

export function classifyOwnership(container) {
  const labels = container?.labels ?? {};
  return labels['com.docker.compose.project'] === 'surfjudging' || labels['com.surfjudging.owner'] === 'field' ? 'SURFJUDGING_OWNED' : 'UNRELATED';
}

export function validateReleaseManifest(manifest) {
  const keys = ['desktopVersion', 'frontendRelease', 'sourceRevision', 'expectedSchema', 'runtimeVersion'];
  return Boolean(manifest && keys.every((key) => typeof manifest[key] === 'string' && manifest[key].length > 0));
}

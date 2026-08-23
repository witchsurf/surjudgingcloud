import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export const PROFILE_IDS = Object.freeze({
  existingDocker: 'macos-intel-existing-docker',
  vz: 'macos-intel-vz',
  legacy: 'macos-intel-legacy',
  linux: 'linux-amd64-native',
  arm: 'macos-arm64'
});

const run = (file, args = []) => { try { return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

export function detectHost({ platform = process.platform, arch = process.arch } = {}) {
  const dockerCli = Boolean(run('docker', ['--version']));
  const dockerInfo = dockerCli ? run('docker', ['info', '--format', '{{json .}}']) : '';
  let info = {}; try { info = dockerInfo ? JSON.parse(dockerInfo) : {}; } catch { info = {}; }
  const hostVersion = platform === 'darwin' ? run('sw_vers', ['-productVersion']) : os.release();
  const colima = Boolean(run('colima', ['version']));
  const lima = Boolean(run('limactl', ['--version']));
  const freeBytes = (() => { try { return fs.statfsSync(process.env.HOME || '.').bavail * fs.statfsSync(process.env.HOME || '.').bsize; } catch { return null; } })();
  return Object.freeze({
    hostOS: platform,
    hostArch: arch,
    hostVersion,
    dockerCli,
    dockerDaemonReachable: Boolean(info.ServerVersion),
    dockerServerOS: info.OSType || '',
    dockerServerArch: info.Architecture || '',
    dockerServerVersion: info.ServerVersion || '',
    colimaPresent: colima,
    limaPresent: lima,
    vzCapability: platform === 'darwin' && arch === 'x64' ? 'requires-certified-matrix' : 'not-applicable',
    availableDiskBytes: freeBytes,
    availableRamBytes: os.totalmem()
  });
}

export function selectRuntimeProfile(host, { certifiedProfiles = new Set(), minimumDocker = '' } = {}) {
  if (!host || (host.hostOS !== 'darwin' && host.hostOS !== 'linux')) return { profileId: null, reasons: ['unsupported OS'] };
  if (host.hostOS === 'darwin' && host.hostArch === 'arm64') return certifiedProfiles.has(PROFILE_IDS.arm) ? { profileId: PROFILE_IDS.arm, reasons: [] } : { profileId: null, reasons: ['arm64 profile not certified'] };
  if (host.hostOS === 'linux' && host.hostArch === 'x64' && certifiedProfiles.has(PROFILE_IDS.linux)) return { profileId: PROFILE_IDS.linux, reasons: [] };
  if (host.hostOS === 'darwin' && host.hostArch === 'x64' && host.dockerCli && host.dockerDaemonReachable && host.dockerServerOS === 'linux' && /^(amd64|x86_64)$/.test(host.dockerServerArch) && (!minimumDocker || host.dockerServerVersion >= minimumDocker) && certifiedProfiles.has(PROFILE_IDS.existingDocker)) return { profileId: PROFILE_IDS.existingDocker, reasons: [] };
  if (host.hostOS === 'darwin' && host.hostArch === 'x64' && certifiedProfiles.has(PROFILE_IDS.vz) && host.vzCapability === 'certified') return { profileId: PROFILE_IDS.vz, reasons: [] };
  if (host.hostOS === 'darwin' && host.hostArch === 'x64' && certifiedProfiles.has(PROFILE_IDS.legacy)) return { profileId: PROFILE_IDS.legacy, reasons: [] };
  return { profileId: null, reasons: ['no certified runtime profile'] };
}

export function validateRuntimeAdapter(adapter, expectedSha256) {
  return Boolean(adapter && typeof adapter.runtime_detect === 'function' && typeof adapter.runtime_preflight === 'function' && typeof adapter.runtime_start === 'function' && typeof adapter.runtime_stop === 'function' && typeof adapter.runtime_status === 'function' && typeof adapter.runtime_socket === 'function' && typeof adapter.runtime_import_image === 'function' && typeof adapter.runtime_compose === 'function' && typeof adapter.runtime_cleanup_failed_install === 'function' && (!expectedSha256 || adapter.sha256 === expectedSha256));
}

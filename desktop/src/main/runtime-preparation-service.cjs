const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DOCKER_APP = '/Applications/Docker.app';
const DOCKER_TEAM_ID = '9BNSXJN65R';
const DOCKER_BUNDLE_ID = 'com.docker.docker';
const ALLOWED_DOWNLOAD_HOST = 'desktop.docker.com';

const INSTALLERS = Object.freeze({
  darwin: Object.freeze({
    x64: Object.freeze({
      id: 'docker-desktop-4.48.0-ventura-intel',
      version: '4.48.0',
      build: '207573',
      architecture: 'amd64',
      extension: 'dmg',
      url: 'https://desktop.docker.com/mac/main/amd64/207573/Docker.dmg',
      sizeBytes: 611682395,
      sha256: 'fac73a1edc91e6bce5a449e83e3d0b537f19df74c5f51af4705e479cf0d32515'
    }),
    arm64: Object.freeze({
      id: 'docker-desktop-4.48.0-ventura-arm64',
      version: '4.48.0',
      build: '207573',
      architecture: 'arm64',
      extension: 'dmg',
      url: 'https://desktop.docker.com/mac/main/arm64/207573/Docker.dmg',
      sizeBytes: 546855438,
      sha256: '79b10d41c8ed5edde7e0db3e01f604349a1e1bcd35dd487ed13afaca98b2beb6'
    })
  }),
  win32: Object.freeze({
    x64: Object.freeze({
      id: 'docker-desktop-4.88.1-windows-x64',
      version: '4.88.1',
      build: '237512',
      architecture: 'amd64',
      extension: 'exe',
      url: 'https://desktop.docker.com/win/main/amd64/237512/Docker%20Desktop%20Installer.exe',
      sizeBytes: 631183792,
      sha256: '89fe3d80a326a2ad521de09b5a89ef04d10c60593604b344f11f433ca7f1f6f0'
    })
  })
});

function major(version) {
  const value = Number.parseInt(String(version || '').split('.')[0], 10);
  return Number.isFinite(value) ? value : null;
}

function versionAtLeast(version, minimum) {
  const current = String(version || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const floor = String(minimum || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(current.length, floor.length); index += 1) {
    if ((current[index] || 0) > (floor[index] || 0)) return true;
    if ((current[index] || 0) < (floor[index] || 0)) return false;
  }
  return true;
}

function selectInstaller({ platform, arch, hostVersion }) {
  if (platform === 'darwin') {
    const hostMajor = major(hostVersion);
    if (hostMajor !== 13 || !versionAtLeast(hostVersion, '13.3')) return null;
    return INSTALLERS.darwin[arch] || null;
  }
  if (platform === 'win32') {
    const parts = String(hostVersion || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const build = parts[2] || 0;
    if (arch !== 'x64' || build < 22631) return null;
    return INSTALLERS.win32.x64;
  }
  return null;
}

function dockerDesktopCandidates({
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  programFiles = process.env.ProgramFiles || 'C:\\Program Files'
} = {}) {
  if (platform === 'darwin') return [DOCKER_APP];
  if (platform === 'win32') {
    return [
      path.join(localAppData, 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
      path.join(programFiles, 'Docker', 'Docker', 'Docker Desktop.exe')
    ];
  }
  return [];
}

function dockerCliCandidates({ platform = process.platform, home = os.homedir(), envPath = process.env.PATH || '', localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), programFiles = process.env.ProgramFiles || 'C:\\Program Files' } = {}) {
  if (platform === 'darwin') {
    return [
      '/Applications/Docker.app/Contents/Resources/bin/docker',
      path.join(home, '.docker/bin/docker'),
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      ...envPath.split(path.delimiter).filter(Boolean).map((entry) => path.join(entry, 'docker'))
    ].filter((value, index, values) => values.indexOf(value) === index);
  }
  const executable = platform === 'win32' ? 'docker.exe' : 'docker';
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  const candidates = envPath.split(delimiter).filter(Boolean).map((entry) => path.join(entry, executable));
  if (platform === 'win32') candidates.unshift(
    path.join(localAppData, 'Programs', 'DockerDesktop', 'resources', 'bin', executable),
    path.join(programFiles, 'Docker', 'Docker', 'resources', 'bin', executable)
  );
  return candidates.filter((value, index, values) => values.indexOf(value) === index);
}

async function resolveDockerCli({ access = fsp.access, candidates = dockerCliCandidates() } = {}) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function resolveDockerDesktop({ access = fsp.access, candidates = dockerDesktopCandidates() } = {}) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function sha256File(file, { createReadStream = fs.createReadStream } = {}) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function downloadVerifiedInstaller(installer, destination, {
  fetchImpl = globalThis.fetch,
  mkdir = fsp.mkdir,
  rename = fsp.rename,
  rm = fsp.rm,
  stat = fsp.stat,
  createWriteStream = fs.createWriteStream,
  onProgress = () => {}
} = {}) {
  const source = new URL(installer.url);
  if (source.protocol !== 'https:' || source.hostname !== ALLOWED_DOWNLOAD_HOST) throw new Error('Source Docker non autorisée.');
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await stat(destination);
    if (existing.size === installer.sizeBytes && await sha256File(destination) === installer.sha256) {
      onProgress({ phase: 'verified-cache', receivedBytes: existing.size, totalBytes: existing.size, percent: 100 });
      return { destination, cached: true, sha256: installer.sha256 };
    }
  } catch {}
  const temporary = `${destination}.part`;
  await rm(temporary, { force: true });
  try {
    const response = await fetchImpl(installer.url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) });
    const finalUrl = new URL(response.url || installer.url);
    if (!response.ok || finalUrl.protocol !== 'https:' || finalUrl.hostname !== ALLOWED_DOWNLOAD_HOST || !response.body) throw new Error('Téléchargement Docker refusé ou indisponible.');
    const declaredSize = Number(response.headers.get('content-length')) || null;
    if (declaredSize !== null && declaredSize !== installer.sizeBytes) throw new Error(`Taille Docker annoncée invalide (${declaredSize}/${installer.sizeBytes}).`);
    const total = installer.sizeBytes;
    let received = 0;
    const sourceStream = Readable.fromWeb(response.body);
    sourceStream.on('data', (chunk) => {
      received += chunk.length;
      if (received > installer.sizeBytes) sourceStream.destroy(new Error('Le téléchargement Docker dépasse la taille approuvée.'));
      onProgress({ phase: 'download', receivedBytes: received, totalBytes: total, percent: Math.min(99, Math.floor(received * 100 / total)) });
    });
    await pipeline(sourceStream, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const downloaded = await stat(temporary);
    if (downloaded.size !== installer.sizeBytes) throw new Error(`Taille Docker invalide (${downloaded.size}/${installer.sizeBytes}).`);
    const digest = await sha256File(temporary);
    if (digest !== installer.sha256) throw new Error('Signature SHA-256 Docker invalide.');
    await rename(temporary, destination);
    onProgress({ phase: 'verified-download', receivedBytes: downloaded.size, totalBytes: downloaded.size, percent: 100 });
    return { destination, cached: false, sha256: digest };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function makeRuntimePreparationService({
  execFile,
  downloadsDir,
  platform = process.platform,
  arch = process.arch,
  home = os.homedir(),
  localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
  programFiles = process.env.ProgramFiles || 'C:\\Program Files',
  release = os.release,
  username = os.userInfo().username,
  totalMemory = os.totalmem(),
  access = fsp.access,
  mkdtemp = fsp.mkdtemp,
  rm = fsp.rm,
  statfs = fsp.statfs,
  download = downloadVerifiedInstaller,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (typeof execFile !== 'function') throw new Error('execFile is required');
  const run = async (file, args, options = {}) => execFile(file, args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, ...options });
  const hostVersion = async () => platform === 'darwin' ? String((await run('/usr/bin/sw_vers', ['-productVersion'])).stdout || '').trim() : release();
  const desktopPath = async () => resolveDockerDesktop({ access, candidates: dockerDesktopCandidates({ platform, localAppData, programFiles }) });
  const appInstalled = async () => Boolean(await desktopPath());
  const cliPath = async () => resolveDockerCli({ access, candidates: dockerCliCandidates({ platform, home, localAppData, programFiles }) });
  const daemonReady = async (docker) => docker ? run(docker, ['info', '--format', '{{json .ServerVersion}}'], { timeout: 5000 }).then(() => true).catch(() => false) : false;

  async function inspectWsl() {
    if (platform !== 'win32') return { required:false, installed:null, version:null, ready:null };
    try {
      const result = await run('wsl.exe', ['--version'], { timeout:5000 });
      const output = `${result.stdout || ''}\n${result.stderr || ''}`.replaceAll('\0', '');
      const match = output.match(/(?:WSL[^\d]*)?(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/i);
      const version = match?.[1] || null;
      return { required:true, installed:true, version, ready:Boolean(version && versionAtLeast(version, '2.1.5')) };
    } catch {
      return { required:true, installed:false, version:null, ready:false };
    }
  }

  async function inspect() {
    const version = await hostVersion();
    const docker = await cliPath();
    const dockerDesktopPath = await desktopPath();
    const installed = Boolean(dockerDesktopPath);
    const ready = await daemonReady(docker);
    const wsl = await inspectWsl();
    const installer = selectInstaller({ platform, arch, hostVersion: version });
    const disk = await statfs(downloadsDir).catch(() => null);
    const availableDiskBytes = disk ? disk.bavail * disk.bsize : null;
    // Installing Docker needs download/install headroom, while a machine with
    // Docker Desktop already ready only needs room for the bundled Field
    // runtime and operational writes.
    const minimumDiskBytes = (installed ? 6 : 20) * 1024 ** 3;
    const minimumMemory = platform === 'win32' ? 8 * 1024 ** 3 : 4 * 1024 ** 3;
    const diskOk = availableDiskBytes === null || availableDiskBytes >= minimumDiskBytes;
    let state = 'READY';
    if (!ready && !installer) state = 'UNSUPPORTED';
    else if (!ready && platform === 'win32' && !wsl.installed) state = 'WSL_REQUIRED';
    else if (!ready && platform === 'win32' && !wsl.ready) state = 'WSL_UPDATE_REQUIRED';
    else if (!ready && installed) state = 'DOCKER_STOPPED';
    else if (!ready && !installed && installer) state = 'DOWNLOAD_REQUIRED';
    if (!ready && totalMemory < minimumMemory) state = 'MEMORY_INSUFFICIENT';
    if (!ready && !diskOk) state = 'DISK_INSUFFICIENT';
    return {
      state,
      platform,
      arch,
      hostVersion: version,
      totalMemory,
      minimumMemory,
      memoryOk: totalMemory >= minimumMemory,
      availableDiskBytes,
      minimumDiskBytes,
      diskOk,
      dockerAppInstalled: installed,
      dockerDesktopPath,
      dockerCli: Boolean(docker),
      dockerCliPath: docker,
      dockerDaemon: ready,
      installer,
      wsl
    };
  }

  async function launchDocker({ timeoutMs = 180000, onProgress = () => {} } = {}) {
    const installedPath = await desktopPath();
    if (!installedPath) throw new Error('Docker Desktop n’est pas installé.');
    if (platform === 'darwin') await run('/usr/bin/open', ['-a', 'Docker']);
    else if (platform === 'win32') await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:SURFJUDGING_DOCKER_DESKTOP_EXE'],
      { windowsHide:true, env:{ ...process.env, SURFJUDGING_DOCKER_DESKTOP_EXE:installedPath } }
    );
    else throw new Error('Démarrage Docker non supporté sur cette plateforme.');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const docker = await cliPath();
      if (await daemonReady(docker)) return { state: 'READY', dockerCliPath: docker };
      onProgress({ phase: 'docker-starting' });
      await sleep(2000);
    }
    throw new Error('Docker Desktop ne répond pas. Terminez son écran de première configuration puis réessayez.');
  }

  async function prepareWindowsWsl({ update = false, onProgress = () => {} } = {}) {
    if (platform !== 'win32') throw new Error('Préparation WSL disponible uniquement sous Windows.');
    const script = update
      ? "$p=Start-Process -FilePath wsl.exe -Verb RunAs -Wait -PassThru -ArgumentList '--update'; if($p.ExitCode -notin 0,3010){exit $p.ExitCode}; Write-Output $p.ExitCode"
      : "$p=Start-Process -FilePath wsl.exe -Verb RunAs -Wait -PassThru -ArgumentList '--install','--no-distribution'; if($p.ExitCode -notin 0,3010){exit $p.ExitCode}; Write-Output $p.ExitCode";
    onProgress({ phase:update ? 'wsl-update' : 'wsl-install', percent:100 });
    const prepared = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout:600000, windowsHide:false });
    const restartRequested = /(?:^|\s)3010(?:\s|$)/.test(String(prepared.stdout || ''));
    const after = await inspect();
    if (after.wsl?.ready && !restartRequested) return after;
    return { ...after, state:'RESTART_REQUIRED' };
  }

  async function verifyMountedDocker(dmgPath, installer) {
    const mountpoint = await mkdtemp(path.join(os.tmpdir(), 'surfjudging-docker-'));
    try {
      await run('/usr/bin/hdiutil', ['verify', dmgPath], { timeout: 120000 });
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountpoint, dmgPath], { timeout: 120000 });
      const dockerApp = path.join(mountpoint, 'Docker.app');
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', dockerApp], { timeout: 120000 });
      const signature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', dockerApp]);
      const evidence = `${signature.stdout || ''}\n${signature.stderr || ''}`;
      if (!evidence.includes(`TeamIdentifier=${DOCKER_TEAM_ID}`) || !evidence.includes(`Identifier=${DOCKER_BUNDLE_ID}`)) throw new Error('La signature éditeur Docker Inc est invalide.');
      return { mountpoint, dockerApp, installer };
    } catch (error) {
      await run('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 30000 }).catch(() => {});
      await rm(mountpoint, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function install({ confirmed = false, onProgress = () => {} } = {}) {
    if (!confirmed) return { state: 'CONFIRMATION_REQUIRED' };
    const before = await inspect();
    if (before.dockerDaemon) return before;
    if (!before.memoryOk) throw new Error(`Mémoire insuffisante : ${Math.round(before.minimumMemory / 1024 ** 3)} Go minimum requis.`);
    if (!before.diskOk) throw new Error(`Espace disque insuffisant : ${Math.round(before.minimumDiskBytes / 1024 ** 3)} Go libres minimum requis.`);
    if (before.state === 'WSL_REQUIRED') return prepareWindowsWsl({ onProgress });
    if (before.state === 'WSL_UPDATE_REQUIRED') return prepareWindowsWsl({ update:true, onProgress });
    if (before.dockerAppInstalled) return launchDocker({ onProgress });
    if (!before.installer) throw new Error('Aucun installateur Docker approuvé pour cette machine.');
    const filename = `Docker-${before.installer.version}-${before.installer.build}-${before.installer.architecture}.${before.installer.extension}`;
    const destination = path.join(downloadsDir, 'SurfJudging Prerequisites', filename);
    onProgress({ phase: 'download-start', percent: 0 });
    await download(before.installer, destination, { onProgress });
    onProgress({ phase:'signature-verification', percent:100 });
    if (platform === 'darwin') {
      const mounted = await verifyMountedDocker(destination, before.installer);
      try {
        const installBinary = path.join(mounted.dockerApp, 'Contents', 'MacOS', 'install');
        const command = `${shellQuote(installBinary)} --user=${shellQuote(username)}`;
        const appleScript = `do shell script ${JSON.stringify(command)} with administrator privileges`;
        onProgress({ phase:'admin-installation', percent:100 });
        await run('/usr/bin/osascript', ['-e', appleScript], { timeout:600000 });
      } finally {
        await run('/usr/bin/hdiutil', ['detach', mounted.mountpoint], { timeout:30000 }).catch(() => {});
        await rm(mounted.mountpoint, { recursive:true, force:true }).catch(() => {});
      }
    } else if (platform === 'win32') {
      const signatureScript = '$s=Get-AuthenticodeSignature -LiteralPath $env:SURFJUDGING_DOCKER_INSTALLER; [pscustomobject]@{Status=$s.Status.ToString();Subject=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress';
      const signature = await run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', signatureScript],
        { timeout:120000, env:{ ...process.env, SURFJUDGING_DOCKER_INSTALLER:destination } }
      );
      let evidence;
      try { evidence = JSON.parse(String(signature.stdout || '').trim()); } catch { throw new Error('Signature Authenticode Docker illisible.'); }
      if (evidence.Status !== 'Valid' || !/(^|,\s*)CN=Docker Inc(,|$)/i.test(String(evidence.Subject || ''))) throw new Error('La signature éditeur Docker Inc est invalide.');
      onProgress({ phase:'user-installation', percent:100 });
      try {
        await run(destination, ['install', '--user', '--backend=wsl-2', '--no-windows-containers'], { timeout:900000, windowsHide:false });
      } catch (error) {
        if (![1641, 3010].includes(Number(error?.code))) throw error;
        return { ...await inspect(), state:'RESTART_REQUIRED' };
      }
    } else {
      throw new Error('Installation Docker non supportée sur cette plateforme.');
    }
    onProgress({ phase: 'docker-first-start', percent: 100 });
    return launchDocker({ timeoutMs: 300000, onProgress });
  }

  return Object.freeze({ inspect, install, launchDocker, cliPath });
}

module.exports = {
  ALLOWED_DOWNLOAD_HOST,
  DOCKER_APP,
  DOCKER_BUNDLE_ID,
  DOCKER_TEAM_ID,
  INSTALLERS,
  dockerCliCandidates,
  dockerDesktopCandidates,
  downloadVerifiedInstaller,
  major,
  makeRuntimePreparationService,
  resolveDockerCli,
  resolveDockerDesktop,
  selectInstaller,
  sha256File,
  shellQuote,
  versionAtLeast
};

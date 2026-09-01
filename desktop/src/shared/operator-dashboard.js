export const quickAccessRoutes = [
  { key: 'admin', label: 'Administration', description: 'Piloter la compétition', icon: 'A' },
  { key: 'judge', label: 'Tablette juge', description: 'Saisir les notes', icon: 'J' },
  { key: 'priority', label: 'Juge de priorité', description: 'Gérer l’ordre des surfeurs', icon: 'P' },
  { key: 'priorityDisplay', label: 'Écran priorités', description: 'Sortie HDMI vers L2', icon: 'P1' },
  { key: 'display', label: 'Écran public', description: 'Scores et heat en cours', icon: 'TV' },
  { key: 'overlay', label: 'Overlay OBS', description: 'Habillage de la diffusion', icon: 'OBS' },
];

export function fieldHeadline(candidate, health = {}, preparation = null) {
  if (!candidate) {
    return {
      title: 'Field local non détecté',
      detail: 'Démarrez le Field ou vérifiez que le moteur local est prêt.',
      tone: 'bad',
    };
  }
  const essential = [health.frontend, health.manifest, health.api].filter(Boolean);
  const healthy = essential.length >= 2 && essential.every((value) => value === 'HEALTHY');
  if (healthy) {
    if (preparation?.diskOk === false) {
      const required = Math.round((preparation.minimumDiskBytes || 6 * 1024 ** 3) / 1024 ** 3);
      return {
        title: 'Field actif · espace disque à libérer',
        detail: `Les interfaces répondent à l’adresse ${candidate.host}, mais ${required} Go libres sont requis avant une compétition.`,
        tone: 'warning',
      };
    }
    return {
      title: 'Field prêt sur le réseau local',
      detail: `Les interfaces opérateur sont disponibles à l’adresse ${candidate.host}.`,
      tone: 'ok',
    };
  }
  return {
    title: 'Field détecté, vérification en cours',
    detail: `Le runtime ${candidate.host} répond, mais tous les services essentiels ne sont pas encore confirmés.`,
    tone: 'warning',
  };
}

export function preparationText(preparation) {
  if (!preparation) return { summary: 'Analyse du système…', detail: '', action: 'Analyser', tone: 'attention', icon: '…' };
  const architecture = preparation.platform === 'win32' && preparation.arch === 'x64'
    ? 'Intel/AMD x64'
    : preparation.arch === 'x64' ? 'Intel' : preparation.arch === 'arm64' ? 'Apple Silicon' : preparation.arch;
  const system = preparation.platform === 'win32' ? 'Windows 11' : 'macOS';
  const machine = `${system} ${preparation.hostVersion} · ${architecture}`;
  const minimumMemoryGb = Math.round((preparation.minimumMemory || 4 * 1024 ** 3) / 1024 ** 3);
  if (!preparation.memoryOk) return { summary: 'Mémoire insuffisante', detail: `${machine} · ${minimumMemoryGb} Go minimum requis.`, action: 'Réessayer', tone: 'blocked', icon: '!' };
  if (!preparation.diskOk) {
    const available = Number.isFinite(preparation.availableDiskBytes) ? Math.floor(preparation.availableDiskBytes / 1024 ** 3) : null;
    const shortage = available === null ? '' : ` ${available} Go sont disponibles actuellement.`;
    const required = Math.round((preparation.minimumDiskBytes || 6 * 1024 ** 3) / 1024 ** 3);
    return { summary: 'Libérez de l’espace pour sécuriser le Field', detail: `${machine} · ${required} Go libres minimum requis.${shortage}`, action: 'Réessayer', tone: 'blocked', icon: '!' };
  }
  if (preparation.state === 'APP_TRANSLOCATED') return { summary: 'Installation de l’application requise', detail: `${machine} · déplacez SurfJudging Field dans le dossier Applications, puis rouvrez-le.`, action: 'À déplacer', tone: 'attention', icon: '!' };
  if (preparation.state === 'RESTART_REQUIRED') return { summary: 'Redémarrage Windows requis', detail: `${machine} · WSL 2 a été préparé. Redémarrez Windows, puis relancez SurfJudging Field.`, action: 'Redémarrer Windows', tone: 'attention', icon: '↻' };
  if (preparation.state === 'WSL_REQUIRED') return { summary: 'Activation de WSL 2 requise', detail: `${machine} · Windows demandera une autorisation administrateur et pourra nécessiter un redémarrage.`, action: 'Préparer WSL 2', tone: 'attention', icon: '!' };
  if (preparation.state === 'WSL_UPDATE_REQUIRED') return { summary: 'Mise à jour de WSL 2 requise', detail: `${machine} · version minimale 2.1.5. Windows demandera une autorisation administrateur.`, action: 'Mettre à jour WSL 2', tone: 'attention', icon: '↻' };
  if (preparation.state === 'READY') return { summary: 'Machine prête pour SurfJudging Field', detail: `${machine} · le moteur local est opérationnel.`, action: 'Vérifié', tone: 'ready', icon: '✓' };
  if (preparation.state === 'DOCKER_STOPPED') return { summary: 'Le moteur local est arrêté', detail: `${machine} · aucun téléchargement nécessaire.`, action: 'Démarrer Docker', tone: 'attention', icon: '!' };
  if (preparation.state === 'DOWNLOAD_REQUIRED') return { summary: 'Installation du moteur local requise', detail: `${machine} · composant approuvé ${preparation.installer.version} (${Math.round(preparation.installer.sizeBytes / 1024 / 1024)} Mo).`, action: 'Préparer cette machine', tone: 'attention', icon: '↓' };
  return { summary: 'Préparation automatique indisponible', detail: `${machine} · aucun profil d’installation approuvé pour cette machine.`, action: 'Actualiser', tone: 'blocked', icon: '!' };
}

export function competitionPresentation(safety = {}) {
  const runningCount = Number(safety.runningCount || 0);
  return runningCount > 0
    ? { text: `${runningCount} heat${runningCount > 1 ? 's' : ''} en cours · arrêt du Field protégé`, badge: 'COMPÉTITION EN COURS', tone: 'warning' }
    : { text: 'Aucun heat en cours · arrêt possible après confirmation', badge: 'PRÊT', tone: 'ok' };
}

export function diskPresentation(disk = {}) {
  if (disk.status === 'UNKNOWN' || !Number.isFinite(disk.available)) return 'État du disque indisponible';
  const gigabytes = Math.floor(disk.available / 1024 ** 3);
  return gigabytes < 20
    ? `${gigabytes} Go libres · libérez de l’espace avant une compétition`
    : `${gigabytes} Go libres · capacité opérationnelle`;
}

export function livePresentation(live = {}) {
  if (!live.configured) {
    return live.state === 'NOT_PROVISIONED'
      ? 'Non configurée · le jugement reste entièrement local'
      : 'Désactivée · le jugement reste entièrement local';
  }
  const labels = { LIVE: 'En ligne', DEGRADED: 'Dégradée', OFFLINE: 'Hors ligne', BACKLOG: 'Rattrapage en cours' };
  const state = labels[live.state] || live.state || 'État inconnu';
  const details = [live.restartCount ? `${live.restartCount} relance${live.restartCount > 1 ? 's' : ''}` : '', live.lastError || ''].filter(Boolean);
  return `${state}${details.length ? ` · ${details.join(' · ')}` : ''}`;
}

export function translateServiceState(value) {
  const labels = { HEALTHY: 'OPÉRATIONNEL', UNAVAILABLE: 'INDISPONIBLE', UNKNOWN: 'NON VÉRIFIÉ', READY: 'PRÊT', OFFLINE: 'HORS LIGNE', ONLINE: 'EN LIGNE' };
  return labels[value] || value || '—';
}

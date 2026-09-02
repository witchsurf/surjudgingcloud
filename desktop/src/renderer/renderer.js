import {
  competitionPresentation,
  diskPresentation,
  fieldHeadline,
  livePresentation,
  preparationText,
  quickAccessRoutes,
  translateServiceState,
} from '../shared/operator-dashboard.js';

const api = window.surfJudgingDesktop;
const state = {
  candidates: [], selected: null, health: null, prerequisites: null,
  preparation: null, preparing: false, organization: null,
  pendingLogoDataUrl: null, priorityDisplay: null,
};
const $ = (id) => document.getElementById(id);
const defaultLogo = './assets/surfjudging-field-logo-v2.png';

const errorMessage = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');

function setStatus(title, detail = '', tone = '') {
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('status').className = `hero-status ${tone}`.trim();
}

function setDl(id, rows) {
  const target = $(id);
  target.replaceChildren();
  rows.forEach(([key, value]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = value ?? '—';
    target.append(dt, dd);
  });
}

function bindLocalLink(element, url) {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    api.openUrl(url);
  });
}

function renderUrls(urls = {}) {
  const quickLinks = $('urls');
  const technicalUrls = $('technical-urls');
  quickLinks.replaceChildren();
  technicalUrls.replaceChildren();

  const availableRoutes = quickAccessRoutes.filter(({ key }) => urls[key]);
  const operatorRoutes = availableRoutes.filter(({ key }) => key === 'admin');
  if (!operatorRoutes.length) {
    const empty = document.createElement('div');
    empty.className = 'quick-link empty';
    empty.textContent = 'Les accès apparaîtront dès que le Field local sera disponible.';
    quickLinks.append(empty);
    technicalUrls.textContent = 'Aucune adresse disponible.';
    return;
  }

  operatorRoutes.forEach(({ key, label, description, icon }) => {
    const link = document.createElement('a');
    link.className = 'quick-link';
    link.href = urls[key];
    const iconBox = document.createElement('span');
    iconBox.className = 'quick-link-icon';
    iconBox.textContent = icon;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const subtitle = document.createElement('small');
    title.textContent = label;
    subtitle.textContent = description;
    copy.append(title, subtitle);
    link.append(iconBox, copy);
    bindLocalLink(link, urls[key]);
    quickLinks.append(link);

  });

  availableRoutes.forEach(({ key, label }) => {
    const technical = document.createElement('a');
    technical.href = urls[key];
    technical.textContent = `${label} · ${urls[key]}`;
    bindLocalLink(technical, urls[key]);
    technicalUrls.append(technical);
  });
}

function render() {
  const candidate = state.selected;
  const headline = fieldHeadline(candidate, state.health || {}, state.preparation);
  setStatus(headline.title, headline.detail, headline.tone);
  setDl('identity', [
    ['Adresse Field', candidate?.host],
    ['Version', candidate?.manifest?.releaseId],
    ['Révision', candidate?.manifest?.codeRevision],
    ['Schéma', candidate?.manifest?.expectedSchemaVersion],
  ]);
  const serviceLabels = { frontend: 'Interface', manifest: 'Manifeste', api: 'API', realtime: 'Temps réel', internet: 'Internet', cloud: 'Cloud' };
  const health = state.health || {};
  setDl('health', ['frontend', 'manifest', 'api', 'realtime', 'internet', 'cloud'].map((key) => [serviceLabels[key], translateServiceState(health[key])]));
  setDl('prereq', [
    ['Docker Desktop', state.prerequisites?.dockerDesktop ? 'INSTALLÉ' : state.prerequisites?.dockerDaemon ? 'NON REQUIS' : 'NON INSTALLÉ'],
    ['Commande Docker', state.prerequisites?.dockerCli ? 'DISPONIBLE' : 'INTROUVABLE'],
    ['Moteur local', state.prerequisites?.dockerDaemon ? 'PRÊT' : 'ARRÊTÉ'],
  ]);
  renderUrls(candidate?.urls || {});
  $('start').disabled = Boolean(candidate) || state.preparing || !state.preparation?.diskOk;
  $('stop').disabled = !candidate;
}

function renderPriorityDisplay() {
  const output = state.priorityDisplay;
  if (!output) {
    $('priority-display-status').textContent = 'État de la sortie inconnu.';
    $('priority-display-open').disabled = true;
    $('priority-display-test').disabled = true;
    $('priority-display-blackout').disabled = true;
    return;
  }
  const priorityOrder = output.outputSignal?.order?.length
    ? output.outputSignal.order.map((color, index) => `P${index + 1} ${color}`).join(' · ')
    : output.outputSignal?.color || '';
  const labels = {
    LIVE: 'LIVE · ordre métier Field',
    TEST: 'Test matériel · aucune donnée de compétition',
    BLACKOUT: 'Noir de sécurité actif',
    STARTING: 'Démarrage de la sortie…',
    NO_EXTERNAL_DISPLAY: 'Aucun écran HDMI L2 détecté',
    ERROR: 'Erreur de sortie HDMI',
    CLOSED: 'Sortie fermée',
  };
  const parts = [labels[output.state] || output.state];
  if (priorityOrder) parts.push(priorityOrder);
  if (output.target) parts.push('écran L2 détecté');
  if (output.lastError) parts.push(output.lastError);
  $('priority-display-status').textContent = parts.filter(Boolean).join(' · ');
  $('priority-display-open').disabled = !state.selected || output.externalDisplayCount < 1;
  $('priority-display-test').disabled = output.externalDisplayCount < 1;
  $('priority-display-blackout').disabled = output.externalDisplayCount < 1;
}

function renderPreparation() {
  const copy = preparationText(state.preparation);
  const card = document.querySelector('.preparation');
  card.classList.remove('attention', 'blocked');
  if (copy.tone === 'attention') card.classList.add('attention');
  if (copy.tone === 'blocked') card.classList.add('blocked');
  document.querySelector('.preparation-icon').textContent = copy.icon;
  $('preparation-summary').textContent = copy.summary;
  $('preparation-detail').textContent = copy.detail;
  $('prepare').textContent = state.preparing ? 'Préparation en cours…' : copy.action;
  $('prepare').disabled = state.preparing || ['READY', 'APP_TRANSLOCATED', 'RESTART_REQUIRED'].includes(state.preparation?.state);
  if (!state.preparing) $('preparation-progress').hidden = true;
}

function renderOperationalStatus(safety, disk, live) {
  const competition = competitionPresentation(safety || {});
  $('competition').textContent = competition.text;
  $('competition-badge').textContent = competition.badge;
  $('competition-badge').className = `state-badge ${competition.tone}`;
  $('disk').textContent = diskPresentation(disk || {});
  $('live-publication').textContent = livePresentation(live || {});
}

async function safely(task, fallback = null) {
  try { return await task; }
  catch (error) { console.error(error); return fallback; }
}

async function refresh() {
  setStatus('Recherche du Field local…', 'Vérification des services essentiels en cours.');
  state.candidates = await safely(api.discoverFieldCandidates(), []);
  state.selected = state.candidates.length === 1 ? state.candidates[0] : null;
  [state.health, state.prerequisites, state.preparation, state.priorityDisplay] = await Promise.all([
    safely(api.getFieldHealth(state.selected?.host), {}),
    safely(api.getRuntimePrerequisiteStatus(), {}),
    safely(api.inspectMachinePreparation(), null),
    safely(api.getPriorityDisplayStatus(), null),
  ]);
  render();
  renderPreparation();
  renderPriorityDisplay();

  const [safety, disk, live] = await Promise.all([
    safely(api.getCompetitionSafety(), {}),
    safely(api.getDiskStatus(), {}),
    safely(api.getLivePublicationStatus(), {}),
  ]);
  renderOperationalStatus(safety, disk, live);

  $('qr').replaceChildren();
  if (state.selected) {
    if (state.organization?.configured) await safely(api.syncOrganizationProfile());
    const qr = await safely(api.generateQr(state.selected.urls.admin));
    if (qr) {
      const image = document.createElement('img');
      image.alt = 'QR de connexion à l’Admin local';
      image.src = qr;
      $('qr').append(image);
    }
  }
  if (!$('qr').children.length) {
    const empty = document.createElement('span');
    empty.textContent = 'Le QR apparaîtra lorsque le Field sera prêt.';
    $('qr').append(empty);
  }
}

async function openPriorityDisplay() {
  if (!state.selected) return;
  try {
    state.priorityDisplay = await api.openPriorityDisplay(state.selected.host, $('priority-display-podium').value);
    renderPriorityDisplay();
  } catch (error) { $('priority-display-status').textContent = errorMessage(error); }
}

async function blackoutPriorityDisplay() {
  try {
    state.priorityDisplay = await api.blackoutPriorityDisplay();
    renderPriorityDisplay();
  } catch (error) { $('priority-display-status').textContent = errorMessage(error); }
}

async function testPriorityDisplayColor() {
  try {
    const pattern = $('priority-display-test-color').value;
    state.priorityDisplay = pattern.startsWith('ORDER_')
      ? await api.testPriorityDisplayOrder(Number(pattern.split('_')[1]))
      : await api.testPriorityDisplayColor(pattern);
    renderPriorityDisplay();
  } catch (error) { $('priority-display-status').textContent = errorMessage(error); }
}

async function diagnostics() {
  const snapshot = {
    desktopVersion: await api.getDesktopVersion(), selected: state.selected,
    candidates: state.candidates, health: state.health, prerequisites: state.prerequisites,
    preparation: state.preparation, fieldState: await api.getFieldState(),
    fieldLogs: await api.getFieldLogs(), generatedAt: new Date().toISOString(),
  };
  await api.copyDiagnostics(snapshot);
  setStatus('Diagnostic copié', 'Les informations de support, sans secret, sont dans le presse-papiers.', 'ok');
}

function applyOrganization(profile) {
  state.organization = profile;
  $('organization-label').textContent = profile.configured ? profile.organizationName.toUpperCase() : 'SURFJUDGING';
  $('app-logo').src = profile.logoDataUrl || defaultLogo;
}

function openOrganizationSetup() {
  const profile = state.organization || { configured: false, organizationName: '', logoDataUrl: null };
  state.pendingLogoDataUrl = profile.logoDataUrl;
  $('organization-name').value = profile.organizationName;
  $('organization-logo-preview').src = profile.logoDataUrl || defaultLogo;
  $('organization-error').textContent = '';
  $('organization-close').hidden = !profile.configured;
  $('organization-overlay').hidden = false;
  $('organization-name').focus();
}

async function initializeOrganization() {
  const profile = await api.getOrganizationProfile();
  applyOrganization(profile);
  if (!profile.configured) openOrganizationSetup();
}

async function chooseOrganizationLogo() {
  try {
    const logo = await api.chooseOrganizationLogo();
    if (!logo) return;
    state.pendingLogoDataUrl = logo;
    $('organization-logo-preview').src = logo;
    $('organization-error').textContent = '';
  } catch (error) { $('organization-error').textContent = errorMessage(error); }
}

async function saveOrganization(event) {
  event.preventDefault();
  if (!state.pendingLogoDataUrl) {
    $('organization-error').textContent = 'Choisissez le logo de l’organisation.';
    return;
  }
  $('organization-save').disabled = true;
  try {
    const profile = await api.saveOrganizationProfile({ organizationName: $('organization-name').value, logoDataUrl: state.pendingLogoDataUrl });
    applyOrganization(profile);
    $('organization-overlay').hidden = true;
  } catch (error) { $('organization-error').textContent = errorMessage(error); }
  finally { $('organization-save').disabled = false; }
}

const stageLabel = (line) => {
  if (!line) return 'Démarrage contrôlé…';
  if (line.includes('staging-config')) return 'Préparation de la configuration locale persistante…';
  if (line.includes('image-ready')) return `Vérification des images · ${line.split('image-ready ')[1] || ''}`;
  if (line.includes('image-load')) return `Premier chargement des images · ${line.split('image-load ')[1] || ''}`;
  if (line.includes('kong-config')) return 'Préparation sécurisée de la passerelle locale…';
  if (line.includes('compose-start')) return 'Démarrage des services Field…';
  if (line.includes('compose-finished')) return 'Vérification de l’identité Field…';
  return 'Démarrage du Field en cours…';
};

async function start() {
  setStatus('Démarrage contrôlé…', 'Les services locaux sont préparés sans modifier les données de compétition.');
  const progressTimer = setInterval(async () => {
    const progress = await safely(api.getFieldProgress());
    if (progress) setStatus(stageLabel(progress.lastLog), 'Veuillez patienter pendant la vérification du runtime local.');
  }, 1000);
  try {
    await api.startField();
    await refresh();
  } catch (error) {
    const logs = await safely(api.getFieldLogs(), []);
    setStatus('Démarrage interrompu', `${errorMessage(error)}${logs.length ? ` · ${logs.at(-1)}` : ''}`, 'bad');
  } finally { clearInterval(progressTimer); }
}

async function stop() {
  const gate = await api.canStopField();
  if (!gate.allowed) {
    setStatus('Arrêt refusé', 'Un heat est en cours. Le Field protège la compétition.', 'warning');
    return;
  }
  if (!confirm('Arrêter les services Field ? Les données persistantes sont conservées.')) return;
  await api.stopField(true);
  await refresh();
}

async function prepareMachine() {
  if (state.preparing) return;
  state.preparation = await api.inspectMachinePreparation();
  renderPreparation();
  if (state.preparation.state === 'READY') return;
  if (['UNSUPPORTED', 'MEMORY_INSUFFICIENT', 'DISK_INSUFFICIENT', 'APP_TRANSLOCATED', 'RESTART_REQUIRED'].includes(state.preparation.state)) {
    const messages = {
      MEMORY_INSUFFICIENT: 'Préparation bloquée · cette machine ne dispose pas de la mémoire minimale requise.',
      DISK_INSUFFICIENT: 'Préparation bloquée · libérez au moins 20 Go sur le disque.',
      APP_TRANSLOCATED: 'Déplacez SurfJudging Field dans Applications, puis rouvrez-le.',
      RESTART_REQUIRED: 'Redémarrez Windows, puis relancez SurfJudging Field.',
      UNSUPPORTED: 'Préparation bloquée · ce système ou cette architecture n’a pas de profil approuvé.',
    };
    setStatus('Action nécessaire', messages[state.preparation.state], 'warning');
    return;
  }
  if (['WSL_REQUIRED', 'WSL_UPDATE_REQUIRED'].includes(state.preparation.state)) {
    const accepted = confirm(`${state.preparation.state === 'WSL_REQUIRED' ? 'WSL 2 doit être activé' : 'WSL 2 doit être mis à jour'} pour exécuter le Field local. Windows affichera une demande d’autorisation administrateur et un redémarrage pourra être nécessaire.\n\nContinuer ?`);
    if (!accepted) return;
  }
  if (state.preparation.state === 'DOWNLOAD_REQUIRED') {
    const size = Math.round(state.preparation.installer.sizeBytes / 1024 / 1024);
    const installDetail = state.preparation.platform === 'win32' ? 'l’installer pour votre compte Windows avec le moteur WSL 2' : 'macOS demandera le mot de passe administrateur pour l’installation';
    const accepted = confirm(`SurfJudging va télécharger ${size} Mo depuis le site officiel Docker, vérifier le fichier et sa signature Docker Inc, puis ${installDetail}.\n\nLa licence Docker restera à accepter dans la fenêtre Docker lors du premier démarrage. Continuer ?`);
    if (!accepted) return;
  }
  state.preparing = true;
  renderPreparation();
  setStatus('Préparation sécurisée de la machine…', 'Téléchargements et signatures sont vérifiés avant installation.');
  try {
    const result = state.preparation.state === 'DOCKER_STOPPED' ? await api.launchDockerDesktop() : await api.installRuntimePrerequisites(true);
    setStatus(result?.state === 'RESTART_REQUIRED' ? 'Redémarrage requis' : 'Machine prête', result?.state === 'RESTART_REQUIRED' ? 'Redémarrez Windows puis relancez SurfJudging Field.' : 'Le moteur local est opérationnel.', result?.state === 'RESTART_REQUIRED' ? 'warning' : 'ok');
  } catch (error) {
    setStatus('Préparation interrompue', errorMessage(error), 'bad');
  } finally {
    state.preparing = false;
    await refresh();
  }
}

api.onMachinePreparationProgress((progress) => {
  const box = $('preparation-progress');
  box.hidden = false;
  box.querySelector('span').style.width = `${Number(progress.percent || 0)}%`;
  const labels = {
    'download-start': 'Téléchargement officiel…', download: 'Téléchargement officiel…',
    'verified-download': 'Téléchargement vérifié.', 'verified-cache': 'Installateur déjà vérifié.',
    'signature-verification': 'Vérification de la signature Docker Inc…',
    'admin-installation': 'Installation autorisée par macOS…',
    'user-installation': 'Installation du moteur pour ce compte Windows…',
    'wsl-install': 'Activation de WSL 2 par Windows…', 'wsl-update': 'Mise à jour de WSL 2 par Windows…',
    'docker-first-start': 'Premier démarrage du moteur…', 'docker-starting': 'Démarrage du moteur local…',
  };
  $('preparation-detail').textContent = labels[progress.phase] || progress.phase;
});

$('refresh').onclick = refresh;
$('start').onclick = start;
$('stop').onclick = stop;
$('prepare').onclick = prepareMachine;
$('copy').onclick = diagnostics;
$('organization-settings').onclick = openOrganizationSetup;
$('organization-logo-choose').onclick = chooseOrganizationLogo;
$('organization-form').onsubmit = saveOrganization;
$('organization-close').onclick = () => { $('organization-overlay').hidden = true; };
$('priority-display-open').onclick = openPriorityDisplay;
$('priority-display-test').onclick = testPriorityDisplayColor;
$('priority-display-blackout').onclick = blackoutPriorityDisplay;

initializeOrganization().catch((error) => {
  console.error(error);
  applyOrganization({ configured: false, organizationName: '', logoDataUrl: null });
}).finally(() => {
  refresh();
  window.setInterval(async () => {
    state.priorityDisplay = await safely(api.getPriorityDisplayStatus(), state.priorityDisplay);
    renderPriorityDisplay();
  }, 1000);
});

const PRIORITY_BLACKOUT_URL = 'data:text/html,<html><body style="margin:0;background:%23000;overflow:hidden"></body></html>';
const TEST_COLORS = Object.freeze({
  ROUGE: '#ff0000',
  BLANC: '#ffffff',
  JAUNE: '#ffff00',
  BLEU: '#0000ff',
  VERT: '#00ff00',
  NOIR: '#000000',
});

function normalizePodiumId(value) {
  const normalized = String(value || 'A').trim().toUpperCase();
  return normalized || 'A';
}

function buildPriorityDisplayUrl(host, { podiumId = 'A', eventId = null } = {}) {
  if (typeof host !== 'string' || !host.trim()) throw new Error('Hôte Field requis pour la sortie priorité.');
  const url = new URL('/priority-display', `http://${host.trim()}:8080`);
  url.searchParams.set('podium', normalizePodiumId(podiumId));
  if (Number.isInteger(Number(eventId)) && Number(eventId) > 0) url.searchParams.set('eventId', String(Number(eventId)));
  return url.toString();
}

function buildPriorityTestUrl(color) {
  const normalized = String(color || '').trim().toUpperCase();
  const rgb = TEST_COLORS[normalized];
  if (!rgb) throw new Error('Couleur de test priorité invalide.');
  const html = `<html><body data-priority-color="${normalized}" data-signal-reason="hardware_test" data-signal-fresh="true" style="margin:0;background:${rgb};overflow:hidden"></body></html>`;
  return `data:text/html,${encodeURIComponent(html)}`;
}

function buildPriorityOrderTestUrl(count = 4) {
  const size = Number(count) === 6 ? 6 : 4;
  const colors = Object.keys(TEST_COLORS).slice(0, size);
  const bands = colors.map((color) => `<div style="flex:1 1 0;height:100%;background:${TEST_COLORS[color]}"></div>`).join('');
  const html = `<html><body data-priority-color="${colors[0]}" data-priority-order="${colors.join(',')}" data-signal-reason="hardware_order_test" data-signal-fresh="true" style="display:flex;margin:0;background:#000;overflow:hidden">${bands}</body></html>`;
  return `data:text/html,${encodeURIComponent(html)}`;
}

function displayArea(display) {
  return Math.max(0, Number(display?.bounds?.width) || 0) * Math.max(0, Number(display?.bounds?.height) || 0);
}

function selectPriorityOutputDisplay(displays, primaryDisplayId) {
  const candidates = Array.isArray(displays) ? displays.filter(Boolean) : [];
  const explicitlyExternal = candidates.filter((display) => display.internal === false);
  const nonPrimary = candidates.filter((display) => display.id !== primaryDisplayId);
  const pool = explicitlyExternal.length > 0 ? explicitlyExternal : nonPrimary;
  return [...pool].sort((a, b) => displayArea(b) - displayArea(a))[0] ?? null;
}

function makePriorityDisplayController({ BrowserWindow, screen, powerSaveBlocker }) {
  let outputWindow = null;
  let targetDisplay = null;
  let blockerId = null;
  let state = 'CLOSED';
  let lastError = null;
  let activeUrl = null;
  let outputSignal = null;
  let listeningForDisplays = false;

  const stopDisplaySleepBlocker = () => {
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    blockerId = null;
  };

  const closeWindow = () => {
    if (outputWindow && !outputWindow.isDestroyed()) outputWindow.destroy();
    outputWindow = null;
    targetDisplay = null;
    activeUrl = null;
    outputSignal = null;
    state = 'CLOSED';
    stopDisplaySleepBlocker();
  };

  const getStatus = () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const externalDisplayCount = displays.filter((display) => display.internal === false).length
      || displays.filter((display) => display.id !== primary?.id).length;
    return {
      state,
      lastError,
      activeUrl,
      outputSignal,
      externalDisplayCount,
      target: targetDisplay ? {
        id: targetDisplay.id,
        label: targetDisplay.label || 'Écran HDMI externe',
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
      } : null,
    };
  };

  const createOutputWindow = async (url, nextState) => {
    if (!listeningForDisplays) {
      screen.on('display-removed', handleDisplayRemoved);
      listeningForDisplays = true;
    }
    closeWindow();
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const target = selectPriorityOutputDisplay(displays, primary?.id);
    if (!target) {
      state = 'NO_EXTERNAL_DISPLAY';
      lastError = 'Aucun écran HDMI externe détecté.';
      return getStatus();
    }

    targetDisplay = target;
    activeUrl = url;
    outputSignal = null;
    lastError = null;
    state = 'STARTING';
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
    outputWindow = new BrowserWindow({
      x: target.bounds.x,
      y: target.bounds.y,
      width: target.bounds.width,
      height: target.bounds.height,
      frame: false,
      fullscreen: true,
      kiosk: true,
      alwaysOnTop: true,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    outputWindow.setBounds(target.bounds, false);
    outputWindow.setFullScreen(true);
    outputWindow.setKiosk(true);
    outputWindow.on('closed', () => {
      outputWindow = null;
      targetDisplay = null;
      activeUrl = null;
      state = 'CLOSED';
      stopDisplaySleepBlocker();
    });
    outputWindow.webContents.on('did-fail-load', (_event, code, description) => {
      state = 'ERROR';
      lastError = `${code} ${description}`;
      outputSignal = { color: 'NOIR_SECURITE', reason: 'page_load_failed', fresh: false };
    });

    try {
      await outputWindow.loadURL(url);
      if (outputWindow && !outputWindow.isDestroyed()) state = nextState;
    } catch (error) {
      state = 'ERROR';
      lastError = error instanceof Error ? error.message : String(error);
    }
    return getStatus();
  };

  const handleDisplayRemoved = (_event, display) => {
    if (targetDisplay?.id !== display?.id) return;
    closeWindow();
    state = 'NO_EXTERNAL_DISPLAY';
    lastError = 'La sortie HDMI L2 a été déconnectée.';
  };

  const inspectStatus = async () => {
    if (state === 'LIVE' && outputWindow && !outputWindow.isDestroyed()) {
      try {
        outputSignal = await outputWindow.webContents.executeJavaScript(`(() => {
          const node = document.querySelector('[data-priority-color]');
          if (!node) return { color: 'NOIR_SECURITE', reason: 'framebuffer_not_ready', fresh: false };
          return {
            color: node.dataset.priorityColor || 'NOIR_SECURITE',
            order: (node.dataset.priorityOrder || '').split(',').filter(Boolean),
            reason: node.dataset.signalReason || 'unknown',
            fresh: node.dataset.signalFresh === 'true'
          };
        })()`);
        lastError = null;
      } catch (error) {
        outputSignal = { color: 'NOIR_SECURITE', reason: 'telemetry_unavailable', fresh: false };
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return getStatus();
  };

  return {
    getStatus,
    inspectStatus,
    openLive: (host, options) => createOutputWindow(buildPriorityDisplayUrl(host, options), 'LIVE'),
    blackout: () => createOutputWindow(PRIORITY_BLACKOUT_URL, 'BLACKOUT'),
    testColor: async (color) => {
      const normalized = String(color || '').trim().toUpperCase();
      const status = await createOutputWindow(buildPriorityTestUrl(normalized), 'TEST');
      if (status.state === 'TEST') outputSignal = { color: normalized, reason: 'hardware_test', fresh: true };
      return getStatus();
    },
    testOrder: async (count) => {
      const size = Number(count) === 6 ? 6 : 4;
      const order = Object.keys(TEST_COLORS).slice(0, size);
      const status = await createOutputWindow(buildPriorityOrderTestUrl(size), 'TEST');
      if (status.state === 'TEST') outputSignal = { color: order[0], order, reason: 'hardware_order_test', fresh: true };
      return getStatus();
    },
    close: closeWindow,
    dispose: () => {
      if (listeningForDisplays) screen.removeListener('display-removed', handleDisplayRemoved);
      listeningForDisplays = false;
      closeWindow();
    },
  };
}

module.exports = { PRIORITY_BLACKOUT_URL, TEST_COLORS, buildPriorityDisplayUrl, buildPriorityTestUrl, buildPriorityOrderTestUrl, selectPriorityOutputDisplay, makePriorityDisplayController };

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('surfJudgingDesktop', Object.freeze({
  getDesktopVersion: () => ipcRenderer.invoke('desktop:version'),
  discoverNetworkInterfaces: () => ipcRenderer.invoke('field:interfaces'),
  discoverFieldCandidates: () => ipcRenderer.invoke('field:candidates'),
  probeFieldManifest: (host) => ipcRenderer.invoke('field:manifest', host),
  getFieldHealth: (host) => ipcRenderer.invoke('field:health', host),
  getRuntimePrerequisiteStatus: () => ipcRenderer.invoke('field:prerequisites'),
  getTabletUrls: (host) => ipcRenderer.invoke('field:urls', host),
  getFieldState: () => ipcRenderer.invoke('field:state'),
  getFieldProgress: () => ipcRenderer.invoke('field:progress'),
  checkRuntime: () => ipcRenderer.invoke('field:check-runtime'),
  startField: () => ipcRenderer.invoke('field:start'),
  canStopField: () => ipcRenderer.invoke('field:stop-check'),
  stopField: (confirmed) => ipcRenderer.invoke('field:stop', confirmed),
  getFieldLogs: () => ipcRenderer.invoke('field:logs'),
  getLivePublicationStatus: () => ipcRenderer.invoke('live-publication:status'),
  getCompetitionSafety: () => ipcRenderer.invoke('field:competition-safety'),
  getDiskStatus: () => ipcRenderer.invoke('field:disk'),
  generateQr: (url) => ipcRenderer.invoke('field:qr', url),
  requestBackup: () => ipcRenderer.invoke('field:backup-v2'),
  getRuntimeCompatibility: () => ipcRenderer.invoke('runtime:compatibility'),
  inspectMachinePreparation: () => ipcRenderer.invoke('runtime-preparation:inspect'),
  installRuntimePrerequisites: (confirmed) => ipcRenderer.invoke('runtime-preparation:install', confirmed),
  launchDockerDesktop: () => ipcRenderer.invoke('runtime-preparation:launch'),
  onMachinePreparationProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on('runtime-preparation:progress', handler);
    return () => ipcRenderer.removeListener('runtime-preparation:progress', handler);
  },
  copyDiagnostics: (snapshot) => ipcRenderer.invoke('diagnostics:copy', snapshot),
  openUrl: (url) => ipcRenderer.invoke('open:url', url)
}));

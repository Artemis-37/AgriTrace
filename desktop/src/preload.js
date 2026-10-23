const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agritrace', {
  desktop: true,
  stationName: ipcRenderer.sendSync('app:station'),
  choose: (cfg) => ipcRenderer.invoke('setup:choose', cfg),
  discover: () => ipcRenderer.invoke('setup:discover'),
  check: (url) => ipcRenderer.invoke('setup:check', url),
  retry: (url) => ipcRenderer.invoke('app:retry', url),
  change: () => ipcRenderer.invoke('app:change'),
  // Fermeture de la fenêtre : le logiciel demande à l'interface de se déconnecter (la caissière quitte alors la caisse).
  onSignOut: (cb) => ipcRenderer.on('app:sign-out', () => { Promise.resolve(cb()).finally(() => ipcRenderer.send('app:signed-out')); }),
});

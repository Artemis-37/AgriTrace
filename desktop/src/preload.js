const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agritrace', {
  desktop: true,
  stationName: ipcRenderer.sendSync('app:station'),
  choose: (cfg) => ipcRenderer.invoke('setup:choose', cfg),
  discover: () => ipcRenderer.invoke('setup:discover'),
  check: (url) => ipcRenderer.invoke('setup:check', url),
  retry: (url) => ipcRenderer.invoke('app:retry', url),
  change: () => ipcRenderer.invoke('app:change'),
});

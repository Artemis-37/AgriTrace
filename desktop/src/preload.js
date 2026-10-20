const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agritrace', {
  desktop: true,
  choose: (cfg) => ipcRenderer.invoke('setup:choose', cfg),
  check: (url) => ipcRenderer.invoke('setup:check', url),
  retry: (url) => ipcRenderer.invoke('app:retry', url),
  change: () => ipcRenderer.invoke('app:change'),
});

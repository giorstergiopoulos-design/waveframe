const { contextBridge, ipcRenderer } = require('electron');

// Narrow bridge for the welcome / family windows: no file system, no arbitrary URLs, only these named actions.
contextBridge.exposeInMainWorld('splashApi', {
  init: () => ipcRenderer.invoke('splash:init'),
  requestClose: (dontShow) => ipcRenderer.invoke('splash:close', { dontShow: !!dontShow }),
  done: () => ipcRenderer.send('splash:done'),
  catalogue: () => ipcRenderer.invoke('suite:catalogue'),
  releases: () => ipcRenderer.invoke('suite:releases'),
  action: (id, action) => ipcRenderer.invoke('suite:action', { id: String(id), action: String(action) }),
  onProgress: (cb) => ipcRenderer.on('suite:progress', (_e, d) => cb({ id: String(d.id), pct: Number(d.pct) })),
});

const { contextBridge, ipcRenderer } = require('electron');

const version = ipcRenderer.sendSync('app:version-sync');
const musicPath = ipcRenderer.sendSync('paths:music-sync');

contextBridge.exposeInMainWorld('waveframe', {
  version,
  musicPath,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximizeToggle: () => ipcRenderer.send('window:maximize-toggle'),
  setMiniMode: (enable) => ipcRenderer.send('window:mini-mode', enable),
  setTrackNotifications: (enabled) => ipcRenderer.send('settings:track-notifications', enabled),
  logCrash: (details) => ipcRenderer.send('crash:log', details),
  getCrashLogPath: () => ipcRenderer.invoke('crash:get-log-path'),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enabled) => ipcRenderer.send('autostart:set', enabled),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (event, filePath) => cb(filePath)),
  onMaximizedState: (cb) => ipcRenderer.on('window:maximized-state', (event, isMaximized) => cb(isMaximized)),
  close: () => ipcRenderer.send('window:close'),
  openHelp: () => ipcRenderer.send('help:open'),
  getFormats: () => ipcRenderer.invoke('export:formats'),
  exportAudio: (wavBuffer, opts) => ipcRenderer.invoke('export:save', { wavBuffer, ...opts }),
  checkDeps: () => ipcRenderer.invoke('deps:check'),
  installDeps: () => ipcRenderer.invoke('deps:install'),
  onDepsProgress: (cb) => ipcRenderer.on('deps:progress', (event, data) => cb(data)),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  exportSettings: (data) => ipcRenderer.invoke('settings:export', data),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  onExportProgress: (cb) => ipcRenderer.on('export:progress', (event, pct) => cb(pct)),
  onMediaKey: (cb) => ipcRenderer.on('media-key', (event, action) => cb(action)),
  readMetadata: (filePath) => ipcRenderer.invoke('metadata:read', filePath),
  setThumbbarIcons: (icons) => ipcRenderer.send('thumbbar:icons', icons),
  updateNowPlaying: (data) => ipcRenderer.send('now-playing:update', data),
  sendThemeChange: (theme) => ipcRenderer.send('theme:changed', theme),
  onThemeSync: (cb) => ipcRenderer.on('theme:sync', (event, theme) => cb(theme)),
});

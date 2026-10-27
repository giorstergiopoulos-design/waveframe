const { app, BrowserWindow, ipcMain, dialog, globalShortcut, nativeImage, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const suite = require('./suite-main.js');
const suiteLib = require('./suite.js');
const converter = require('./conv-main.js');

// Isolated profile for tests/self-test (never touches the real settings).
if (process.env.WAVEFRAME_USER_DATA) app.setPath('userData', process.env.WAVEFRAME_USER_DATA);

const FALLBACK_DIR = () => path.join(app.getPath('userData'), 'bin');
const FALLBACK_FFMPEG = () => path.join(FALLBACK_DIR(), 'ffmpeg.exe');
// LGPL build (not GPL): Waveframe only needs audio codecs (mp3/vorbis/opus/aac/wma/flac),
// none of which require GPL-only components — this avoids GPL source-distribution
// obligations entirely. See CLAUDE.md rule 11.
const FFMPEG_RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest';
const FFMPEG_ASSET_NAME = 'ffmpeg-master-latest-win64-lgpl.zip';

const WINDOW_WIDTH = 1180;
const WINDOW_HEIGHT = 760;

const FORMATS = {
  wav: { ext: 'wav', name: 'WAV', filters: [{ name: 'WAV Audio', extensions: ['wav'] }] },
  mp3: { ext: 'mp3', codec: 'libmp3lame', name: 'MP3', filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }] },
  flac: { ext: 'flac', codec: 'flac', lossless: true, name: 'FLAC', filters: [{ name: 'FLAC Audio', extensions: ['flac'] }] },
  ogg: { ext: 'ogg', codec: 'libvorbis', name: 'OGG Vorbis', filters: [{ name: 'OGG Audio', extensions: ['ogg'] }] },
  m4a: { ext: 'm4a', codec: 'aac', name: 'AAC (M4A)', filters: [{ name: 'AAC Audio', extensions: ['m4a'] }] },
  opus: { ext: 'opus', codec: 'libopus', name: 'Opus', filters: [{ name: 'Opus Audio', extensions: ['opus'] }] },
  wma: { ext: 'wma', codec: 'wmav2', name: 'WMA', filters: [{ name: 'WMA Audio', extensions: ['wma'] }] },
};

function testFfmpeg(ffmpegPath) {
  return new Promise((resolve) => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) return resolve(false);
    execFile(ffmpegPath, ['-version'], { timeout: 5000 }, (error) => resolve(!error));
  });
}

function testSystemFfmpeg() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (error) => resolve(!error));
  });
}

// Prefer an ffmpeg the user already has on their system PATH (e.g. from a
// codec pack or a standalone install) over anything Waveframe itself bundles
// or downloads — that way Waveframe never has to *distribute* the binary for
// that user at all. See CLAUDE.md rule 11. Waveframe does not bundle any
// ffmpeg binary itself; if none is found, the Settings > dependencies panel
// offers to download the LGPL build on demand.
async function resolveFfmpegPath() {
  if (await testSystemFfmpeg()) return 'ffmpeg';
  if (await testFfmpeg(FALLBACK_FFMPEG())) return FALLBACK_FFMPEG();
  return null;
}

// Source, size and SHA-256 of the LGPL ffmpeg build, straight from the GitHub release (asset digest, or the release's checksums.sha256).
async function getFfmpegAsset() {
  const r = await suiteLib.httpGet(FFMPEG_RELEASE_API, { timeout: 8000, maxBytes: 4 * 1024 * 1024, hostOpts: { hosts: suiteLib.API_HOSTS } });
  const rel = JSON.parse(r.body.toString('utf8'));
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const asset = assets.find((a) => a && a.name === FFMPEG_ASSET_NAME);
  if (!asset || !suiteLib.isAllowedUrl(asset.browser_download_url, suiteLib.DOWNLOAD_OPTS) || !new URL(asset.browser_download_url).pathname.startsWith('/BtbN/FFmpeg-Builds/')) throw new Error('ffmpeg asset not found');
  let sha = suiteLib.digestSha256(asset);
  if (!sha) {
    const sums = assets.find((a) => a && a.name === 'checksums.sha256');
    if (sums && suiteLib.isAllowedUrl(sums.browser_download_url, suiteLib.DOWNLOAD_OPTS)) {
      const t = (await suiteLib.httpGet(sums.browser_download_url, { timeout: 8000, maxBytes: 256 * 1024 })).body.toString('utf8');
      sha = suiteLib.parseChecksumText(t, FFMPEG_ASSET_NAME);
    }
  }
  if (!sha) throw new Error('no checksum published');
  return { url: asset.browser_download_url, size: Number(asset.size) || 0, sha256: sha, name: asset.name };
}

// confirm(info) -> Promise<boolean> shows the source/size/SHA-256 to the user first; nothing is downloaded without a yes.
async function installFfmpeg(onProgress, confirm) {
  const info = await getFfmpegAsset();
  if (confirm && !(await confirm(info))) { const e = new Error('cancelled'); e.code = 'cancelled'; throw e; }
  const dir = FALLBACK_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(os.tmpdir(), `waveframe-ffmpeg-${Date.now()}.zip`);

  onProgress({ phase: 'download', pct: 0 });
  try {
    await suiteLib.downloadVerified(info.url, zipPath, { expectedSha256: info.sha256, expectedSize: info.size, maxBytes: 400 * 1024 * 1024, onProgress: (pct) => onProgress({ phase: 'download', pct }) });
  } catch (e) {
    if (e.code === 'sha-mismatch' || e.code === 'size-mismatch') throw new Error('Το αρχείο που κατέβηκε δεν ταιριάζει με το δημοσιευμένο SHA-256 και διαγράφηκε.');
    throw e;
  }

  onProgress({ phase: 'extract', pct: 0 });
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntries().find((e) => /(^|\/)bin\/ffmpeg\.exe$/i.test(e.entryName));
  if (!entry) throw new Error('Το ffmpeg.exe δεν βρέθηκε μέσα στο πακέτο λήψης.');
  fs.writeFileSync(FALLBACK_FFMPEG(), entry.getData());
  fs.unlink(zipPath, () => {});
  onProgress({ phase: 'done', pct: 1 });

  const ok = await testFfmpeg(FALLBACK_FFMPEG());
  if (!ok) throw new Error('Η εγκατάσταση ολοκληρώθηκε αλλά το ffmpeg δεν εκτελείται σωστά.');
  return FALLBACK_FFMPEG();
}

const FFMPEG_MSG = {
  el: (i) => ({ title: 'Λήψη FFmpeg', detail: `Το Waveframe χρειάζεται το FFmpeg (έκδοση LGPL) για MP3, FLAC, AAC, OGG, Opus, WMA και AIFF/ALAC.

Πηγή: github.com/BtbN/FFmpeg-Builds
Αρχείο: ${i.name}
Μέγεθος: ${(i.size / 1048576).toFixed(0)} MB
SHA-256: ${i.sha256.slice(0, 16)}…

Το αρχείο ελέγχεται με το SHA-256 πριν χρησιμοποιηθεί.`, go: 'Λήψη', no: 'Άκυρο' }),
  en: (i) => ({ title: 'Download FFmpeg', detail: `Waveframe needs FFmpeg (LGPL build) for MP3, FLAC, AAC, OGG, Opus, WMA and AIFF/ALAC.

Source: github.com/BtbN/FFmpeg-Builds
File: ${i.name}
Size: ${(i.size / 1048576).toFixed(0)} MB
SHA-256: ${i.sha256.slice(0, 16)}…

The file is verified against its SHA-256 before it is used.`, go: 'Download', no: 'Cancel' }),
};
let uiLang = 'el';
async function confirmFfmpegDownload(win, info) {
  const t = (FFMPEG_MSG[uiLang] || FFMPEG_MSG.en)(info);
  const r = await dialog.showMessageBox(win, { type: 'question', title: 'Waveframe', message: t.title, detail: t.detail, buttons: [t.go, t.no], defaultId: 0, cancelId: 1, noLink: true });
  return r.response === 0;
}

let helpWindow = null;
let currentTheme = 'midnight';

function createHelpWindow(parent) {
  if (helpWindow && !helpWindow.isDestroyed()) { helpWindow.focus(); return; }
  helpWindow = new BrowserWindow({
    width: 720, height: 620, minWidth: 560, minHeight: 420,
    parent,
    title: 'Waveframe — Βοήθεια',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0b0b14',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  helpWindow.setMenuBarVisibility(false);
  helpWindow.loadFile(path.join(__dirname, 'renderer', 'help.html'), { search: `theme=${encodeURIComponent(currentTheme)}` });
  helpWindow.on('closed', () => { helpWindow = null; });
}

const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE(), 'utf-8'));
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.bounds;
      return state.x >= b.x - 50 && state.y >= b.y - 50 && state.x < b.x + b.width && state.y < b.y + b.height;
    });
    return onScreen ? state : null;
  } catch { return null; }
}
function saveWindowState(win) {
  if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  try { fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify(win.getBounds())); } catch { /* best-effort */ }
}

const AUDIO_FILE_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.wma'];
function extractAudioFileArg(argv) {
  return argv.find((a) => AUDIO_FILE_EXTENSIONS.includes(path.extname(a).toLowerCase()) && fs.existsSync(a)) || null;
}
function forwardOpenFile(argv) {
  const filePath = extractAudioFileArg(argv);
  if (filePath && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('open-file', filePath);
  }
}

function updateJumpList() {
  if (process.platform !== 'win32') return;
  app.setJumpList([
    {
      type: 'tasks',
      items: [
        { type: 'task', title: 'Play / Pause', program: process.execPath, args: '--jumplist-action=playpause', iconPath: process.execPath, iconIndex: 0 },
        { type: 'task', title: 'Επόμενο', program: process.execPath, args: '--jumplist-action=next', iconPath: process.execPath, iconIndex: 0 },
        { type: 'task', title: 'Προηγούμενο', program: process.execPath, args: '--jumplist-action=prev', iconPath: process.execPath, iconIndex: 0 },
      ],
    },
  ]);
}

let mainWin = null;
let suiteApi = null;
let converterApi = null;

function createWindow() {
  const savedState = loadWindowState();
  const win = new BrowserWindow({
    width: savedState?.width || WINDOW_WIDTH,
    height: savedState?.height || WINDOW_HEIGHT,
    x: savedState?.x,
    y: savedState?.y,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    minWidth: WINDOW_WIDTH,
    minHeight: WINDOW_HEIGHT,
    frame: false,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0b0b14',
    title: 'Waveframe',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWin = win;
  // Hardening + stability: the app only ever shows its own local pages.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  // Only the microphone input (getUserMedia) is a legitimate permission here; everything else is denied.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  // A crashed/killed renderer (GPU driver reset, out of memory on low-RAM PCs) used to leave a blank window until restart.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    try { win.reload(); } catch (_) { /* window is closing */ }
  });
  win.on('unresponsive', () => { /* keep the window: the audio engine may just be busy decoding a large file */ });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.WAVEFRAME_SELFTEST === '1') {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let code = 1;
        try {
          const results = await win.webContents.executeJavaScript('window.__selfTest()');
          results.push(...await suiteApi.selfTest());
          results.push(...await converterApi.selfTest());
          for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.extra ? ' — ' + r.extra : ''}`);
          code = results.every((r) => r.ok) ? 0 : 1;
        } catch (e) { console.log('FAIL self-test could not run: ' + e); }
        app.exit(code);
      }, 1500);
    });
  }
  win.on('closed', () => { if (mainWin === win) mainWin = null; });
  updateJumpList();

  let isMiniMode = false;
  let saveStateTimeout = null;
  const scheduleSaveState = () => {
    if (isMiniMode) return;
    clearTimeout(saveStateTimeout);
    saveStateTimeout = setTimeout(() => saveWindowState(win), 500);
  };
  win.on('resize', scheduleSaveState);
  win.on('move', scheduleSaveState);
  win.on('close', () => { if (!isMiniMode) saveWindowState(win); });

  const bindMediaKey = (accelerator, action) => {
    globalShortcut.register(accelerator, () => {
      if (!win.isDestroyed()) win.webContents.send('media-key', action);
    });
  };
  bindMediaKey('MediaPlayPause', 'playpause');
  bindMediaKey('MediaNextTrack', 'next');
  bindMediaKey('MediaPreviousTrack', 'prev');
  bindMediaKey('MediaStop', 'stop');
  win.on('closed', () => globalShortcut.unregisterAll());

  let thumbbarIcons = null;
  let isPlaying = false;
  function updateThumbbar() {
    if (!thumbbarIcons || win.isDestroyed()) return;
    win.setThumbarButtons([
      { icon: thumbbarIcons.prev, tooltip: 'Προηγούμενο', click: () => win.webContents.send('media-key', 'prev') },
      {
        icon: isPlaying ? thumbbarIcons.pause : thumbbarIcons.play,
        tooltip: isPlaying ? 'Παύση' : 'Αναπαραγωγή',
        click: () => win.webContents.send('media-key', 'playpause'),
      },
      { icon: thumbbarIcons.next, tooltip: 'Επόμενο', click: () => win.webContents.send('media-key', 'next') },
    ]);
  }

  ipcMain.on('thumbbar:icons', (event, icons) => {
    thumbbarIcons = {
      prev: nativeImage.createFromDataURL(icons.prev),
      play: nativeImage.createFromDataURL(icons.play),
      pause: nativeImage.createFromDataURL(icons.pause),
      next: nativeImage.createFromDataURL(icons.next),
    };
    updateThumbbar();
  });

  let lastNotifiedTitle = null;
  let trackNotificationsEnabled = true;
  ipcMain.on('settings:track-notifications', (event, enabled) => { trackNotificationsEnabled = !!enabled; });

  ipcMain.on('crash:log', (event, details) => {
    try {
      const logPath = path.join(app.getPath('userData'), 'crash.log');
      const line = `[${new Date().toISOString()}] ${details}\n`;
      fs.appendFileSync(logPath, line);
    } catch { /* best-effort — never let logging itself crash the app */ }
  });
  ipcMain.handle('crash:get-log-path', () => path.join(app.getPath('userData'), 'crash.log'));

  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.on('autostart:set', (event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
  });
  ipcMain.on('now-playing:update', (event, { title, playing }) => {
    isPlaying = !!playing;
    win.setTitle(title ? `${title} — Waveframe` : 'Waveframe');
    updateThumbbar();
    if (playing && title && title !== lastNotifiedTitle && trackNotificationsEnabled && Notification.isSupported()) {
      lastNotifiedTitle = title;
      new Notification({ title: 'Waveframe', body: title, silent: true }).show();
    }
    if (!title) lastNotifiedTitle = null;
  });

  ipcMain.on('theme:changed', (event, theme) => {
    currentTheme = theme;
    if (helpWindow && !helpWindow.isDestroyed()) {
      helpWindow.webContents.send('theme:sync', theme);
    }
  });

  ipcMain.on('window:minimize', () => win.minimize());
  ipcMain.on('window:maximize-toggle', () => {
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });

  let normalBounds = null;
  ipcMain.on('window:mini-mode', (event, enable) => {
    isMiniMode = enable;
    if (enable) {
      normalBounds = win.getBounds();
      win.setAlwaysOnTop(true);
      win.setResizable(false);
      win.setMinimumSize(340, 130); // the normal 1180x760 floor would otherwise keep the window from shrinking
      win.setSize(340, 130);
    } else {
      win.setAlwaysOnTop(false);
      win.setResizable(true);
      win.setMinimumSize(WINDOW_WIDTH, WINDOW_HEIGHT);
      if (normalBounds) win.setBounds(normalBounds);
      else win.setSize(WINDOW_WIDTH, WINDOW_HEIGHT);
      normalBounds = null;
    }
  });
  win.on('maximize', () => win.webContents.send('window:maximized-state', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized-state', false));
  ipcMain.on('window:close', () => win.close());
  ipcMain.on('app:version-sync', (event) => { event.returnValue = app.getVersion(); });
  ipcMain.on('paths:music-sync', (event) => { event.returnValue = app.getPath('music'); });
  ipcMain.on('help:open', () => createHelpWindow(win));

  ipcMain.handle('deps:check', async () => {
    const ffmpegPath = await resolveFfmpegPath();
    return { ffmpeg: { ok: !!ffmpegPath, path: ffmpegPath } };
  });

  ipcMain.handle('deps:install', async () => {
    try {
      const installedPath = await installFfmpeg((progress) => {
        win.webContents.send('deps:progress', progress);
      }, (info) => confirmFfmpegDownload(win, info));
      return { ok: true, path: installedPath };
    } catch (err) {
      return { ok: false, error: err.message, cancelled: err.code === 'cancelled' };
    }
  });

  ipcMain.handle('metadata:read', async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) return null;
      const mm = await import('music-metadata');
      const meta = await mm.parseFile(filePath, { duration: false, skipCovers: false });
      const { common } = meta;
      let picture = null;
      if (common.picture && common.picture[0]) {
        const pic = common.picture[0];
        picture = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
      }
      return {
        title: common.title || null,
        artist: common.artist || null,
        album: common.album || null,
        picture,
      };
    } catch {
      return null;
    }
  });

  ipcMain.handle('settings:export', async (event, data) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'waveframe-backup.json',
      filters: [{ name: 'Waveframe Backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
      return { canceled: false, ok: true, path: result.filePath };
    } catch (err) {
      return { canceled: false, ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Waveframe Backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw);
      return { canceled: false, ok: true, data };
    } catch (err) {
      return { canceled: false, ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:choose-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    return { canceled: false, folderPath: filePaths[0] };
  });
}

function forwardJumpListAction(argv) {
  const arg = argv.find((a) => a.startsWith('--jumplist-action='));
  if (arg && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('media-key', arg.split('=')[1]);
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
      forwardJumpListAction(argv);
      forwardOpenFile(argv);
    }
  });

  app.whenReady().then(() => {
    suiteApi = suite.init({
      onLang: (l) => { uiLang = l; },
      getMainWin: () => mainWin,
      getTheme: () => currentTheme,
      isMini: () => !!mainWin && !mainWin.isDestroyed() && mainWin.getBounds().width < 700,
      isTrusted: (wc) => (!!mainWin && !mainWin.isDestroyed() && wc === mainWin.webContents) || (!!helpWindow && !helpWindow.isDestroyed() && wc === helpWindow.webContents),
    });
    converterApi = converter.init({
      getMainWin: () => mainWin, resolveFfmpegPath, installFfmpeg, confirmFfmpegDownload,
      // default place for every encode: Windows Music folder > WaveFrame (created automatically)
      defaultOutDir: () => { const d = path.join(app.getPath('music'), 'WaveFrame'); fs.mkdirSync(d, { recursive: true }); return d; },
    });
    createWindow();
    forwardJumpListAction(process.argv);
    mainWin.webContents.once('did-finish-load', () => forwardOpenFile(process.argv));
    if (process.env.WAVEFRAME_SELFTEST !== '1' && process.env.WAVEFRAME_NO_SPLASH !== '1') mainWin.webContents.once('did-finish-load', () => suiteApi.onMainLoaded());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

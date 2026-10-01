const { app, BrowserWindow, ipcMain, dialog, globalShortcut, nativeImage, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');

const FALLBACK_DIR = () => path.join(app.getPath('userData'), 'bin');
const FALLBACK_FFMPEG = () => path.join(FALLBACK_DIR(), 'ffmpeg.exe');
// LGPL build (not GPL): Waveframe only needs audio codecs (mp3/vorbis/opus/aac/wma/flac),
// none of which require GPL-only components — this avoids GPL source-distribution
// obligations entirely. See CLAUDE.md rule 11.
const FFMPEG_DOWNLOAD_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-lgpl.zip';

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

function downloadFile(url, destPath, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'Waveframe' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadFile(res.headers.location, destPath, onProgress, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(received / total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => { res.destroy(); fs.unlink(destPath, () => {}); reject(err); });
      res.on('error', (err) => { file.destroy(); fs.unlink(destPath, () => {}); reject(err); });
    });
    // Χωρίς timeout, μια "κολλημένη" σύνδεση άφηνε τη λήψη του ffmpeg να περιμένει για πάντα.
    req.setTimeout(30000, () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}

async function installFfmpeg(onProgress) {
  const dir = FALLBACK_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(os.tmpdir(), `waveframe-ffmpeg-${Date.now()}.zip`);

  onProgress({ phase: 'download', pct: 0 });
  await downloadFile(FFMPEG_DOWNLOAD_URL, zipPath, (pct) => onProgress({ phase: 'download', pct }));

  onProgress({ phase: 'extract', pct: 0 });
  let entryData;
  try {
    const zip = new AdmZip(zipPath);
    const entry = zip.getEntries().find((e) => /(^|\/)bin\/ffmpeg\.exe$/i.test(e.entryName));
    if (!entry) throw new Error('Το ffmpeg.exe δεν βρέθηκε μέσα στο πακέτο λήψης.');
    entryData = entry.getData();
  } finally {
    fs.unlink(zipPath, () => {}); // πριν: το προσωρινό zip έμενε στο temp όταν η εξαγωγή αποτύγχανε
  }
  // Ατομική εγγραφή (tmp + rename): μια διακοπή στη μέση δεν αφήνει μισο-γραμμένο ffmpeg.exe.
  const tmpExe = FALLBACK_FFMPEG() + '.tmp';
  fs.writeFileSync(tmpExe, entryData);
  fs.renameSync(tmpExe, FALLBACK_FFMPEG());
  onProgress({ phase: 'done', pct: 1 });

  const ok = await testFfmpeg(FALLBACK_FFMPEG());
  if (!ok) throw new Error('Η εγκατάσταση ολοκληρώθηκε αλλά το ffmpeg δεν εκτελείται σωστά.');
  return FALLBACK_FFMPEG();
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
  helpWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  helpWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
  // Το παράθυρο φορτώνει ΜΟΝΟ τοπικές σελίδες. Ένας σύνδεσμος/redirect δεν πρέπει να μπορεί να φορτώσει
  // εξωτερικό περιεχόμενο στο ίδιο παράθυρο με το preload (IPC) ούτε να ανοίξει νέο παράθυρο Electron.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
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
  ipcMain.on('now-playing:update', (event, payload) => {
    const { title, playing } = payload || {};
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
      win.setSize(340, 130);
    } else {
      win.setAlwaysOnTop(false);
      win.setResizable(true);
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

  ipcMain.handle('export:formats', () => FORMATS);

  ipcMain.handle('deps:check', async () => {
    const ffmpegPath = await resolveFfmpegPath();
    return { ffmpeg: { ok: !!ffmpegPath, path: ffmpegPath } };
  });

  ipcMain.handle('deps:install', async () => {
    try {
      const installedPath = await installFfmpeg((progress) => {
        win.webContents.send('deps:progress', progress);
      });
      return { ok: true, path: installedPath };
    } catch (err) {
      return { ok: false, error: err.message };
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

  ipcMain.handle('export:save', async (event, { wavBuffer, format, bitrate, sampleRate, suggestedName, destFolder, duration }) => {
    const spec = FORMATS[format] || FORMATS.wav;
    const safeName = (suggestedName || 'waveframe-export').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'waveframe-export';
    let filePath;
    if (destFolder) {
      filePath = path.join(destFolder, `${safeName}.${spec.ext}`);
      let n = 1;
      while (fs.existsSync(filePath)) {
        filePath = path.join(destFolder, `${safeName} (${n}).${spec.ext}`);
        n++;
      }
    } else {
      const result = await dialog.showSaveDialog(win, {
        defaultPath: `${safeName}.${spec.ext}`,
        filters: spec.filters,
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = result.filePath;
    }

    const tmpWav = path.join(os.tmpdir(), `waveframe-${Date.now()}.wav`);
    fs.writeFileSync(tmpWav, Buffer.from(wavBuffer));
    const sendProgress = (pct) => win.webContents.send('export:progress', pct);

    try {
      if (format === 'wav') {
        sendProgress(0.4);
        fs.copyFileSync(tmpWav, filePath);
        sendProgress(1);
      } else {
        const ffmpegPath = await resolveFfmpegPath();
        if (!ffmpegPath) {
          return { canceled: false, error: 'missing-ffmpeg' };
        }
        // Opus only supports 8/12/16/24/48kHz — force 48kHz regardless of the
        // chosen quality tier's sample rate, or libopus rejects the encode outright.
        const effectiveRate = format === 'opus' ? 48000 : sampleRate;
        const args = ['-y', '-i', tmpWav, '-ar', String(effectiveRate), '-c:a', spec.codec];
        if (!spec.lossless && bitrate) args.push('-b:a', `${bitrate}k`);
        args.push(filePath);

        await new Promise((resolve, reject) => {
          const child = spawn(ffmpegPath, args);
          let stderrBuf = '';
          child.stderr.on('data', (chunk) => {
            stderrBuf = (stderrBuf + chunk.toString()).slice(-4000); // bounded
            const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk.toString());
            if (match && duration) {
              const secs = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseFloat(match[3]);
              sendProgress(Math.min(0.98, secs / duration));
            }
          });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) { sendProgress(1); resolve(); }
            else reject(new Error(stderrBuf.slice(-800) || `ffmpeg exited with code ${code}`));
          });
        });
      }
      return { canceled: false, filePath };
    } finally {
      fs.unlink(tmpWav, () => {});
    }
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
    createWindow();
    forwardJumpListAction(process.argv);
    mainWin.webContents.once('did-finish-load', () => forwardOpenFile(process.argv));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

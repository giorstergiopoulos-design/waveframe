'use strict';
// IPC glue for the 2.3.0 features taken over from Opsis Media Player Pro: the video player (file picker, subtitle discovery, a read-only
// "wfmedia" protocol with range support), the photo editor (open / save) and the Media Player Pro importer (scan, backup, M3U playlists).
// Only the main window may call these channels; payloads are validated here. Media Player Pro's own folder is only ever READ.

const { ipcMain, dialog, protocol, net, app } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const M = require('./mpp-import.js');

const VIDEO_EXTS = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'ogv', '3gp'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wma', 'aiff', 'aif'];
const SUB_EXTS = ['srt', 'vtt', 'ass', 'ssa', 'sub'];
const IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'];
const SERVE_EXTS = new Set([...VIDEO_EXTS, ...AUDIO_EXTS, ...SUB_EXTS]);
const MAX_SUB_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 200 * 1024 * 1024;
const MAX_SAVE_BYTES = 256 * 1024 * 1024;
const SAVE_FORMATS = { jpeg: ['jpg', 'jpeg'], png: ['png'], webp: ['webp'] };

const extOf = (p) => path.extname(String(p || '')).slice(1).toLowerCase();
const isFile = (p) => { try { return typeof p === 'string' && path.isAbsolute(p) && fs.statSync(p).isFile(); } catch (_) { return false; } };

// Must run before the app is ready.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'wfmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } }]);
}

// Subtitle bytes -> text: UTF-8 (with or without BOM), otherwise Windows-1253 (Greek) which is what old .srt files from Greek sites use.
function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.slice(3).toString('utf8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1253').decode(buf); } catch (_) { return buf.toString('latin1'); }
}

function siblingSubtitles(video) {
  const dir = path.dirname(video), base = path.basename(video, path.extname(video)).toLowerCase();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const out = [];
  for (const n of names) {
    const e = extOf(n);
    if (!SUB_EXTS.includes(e) || e === 'sub' || e === 'ssa') continue;
    const stem = path.basename(n, path.extname(n)).toLowerCase();
    if (stem !== base && !stem.startsWith(base + '.')) continue; // "movie.srt", "movie.el.srt"
    const f = path.join(dir, n);
    try { const st = fs.statSync(f); if (st.isFile() && st.size <= MAX_SUB_BYTES) out.push({ name: n, ext: e, text: decodeText(fs.readFileSync(f)) }); } catch (_) { /* skip */ }
    if (out.length >= 8) break;
  }
  return out;
}

function init({ getMainWin, resolveFfmpegPath }) {
  const trusted = (e) => { const w = getMainWin(); return !!w && !w.isDestroyed() && e.sender === w.webContents; };
  const bk = { dir: '' };
  const backupRoot = () => path.join(app.getPath('userData'), 'backups');

  protocol.handle('wfmedia', (req) => {
    try {
      const u = new URL(req.url);
      const p = decodeURIComponent(u.pathname.replace(/^\//, ''));
      if (!isFile(p) || !SERVE_EXTS.has(extOf(p))) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(p).toString(), { headers: req.headers, bypassCustomProtocolHandlers: true }).then((r) => {
        // the page is file:// (another origin): CORS headers are needed so the equaliser can read the video's sound
        const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
      });
    } catch (_) { return new Response('bad request', { status: 400 }); }
  });

  /* ---------------- video player ---------------- */
  ipcMain.handle('vp:pick', async (e, kind) => {
    if (!trusted(e)) return [];
    const r = await dialog.showOpenDialog(getMainWin(), kind === 'folder'
      ? { properties: ['openDirectory'] }
      : { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: [...VIDEO_EXTS, ...AUDIO_EXTS] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled) return [];
    if (kind === 'folder') {
      const out = [];
      (function walk(d, depth) {
        let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const it of list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
          const f = path.join(d, it.name);
          if (it.isFile() && [...VIDEO_EXTS, ...AUDIO_EXTS].includes(extOf(it.name))) out.push(f);
          else if (it.isDirectory() && depth < 3) walk(f, depth + 1);
          if (out.length >= 2000) return;
        }
      })(r.filePaths[0], 0);
      return out;
    }
    return r.filePaths.filter(isFile).slice(0, 2000);
  });
  ipcMain.handle('vp:subs-for', (e, p) => (trusted(e) && isFile(p) ? siblingSubtitles(p) : []));
  ipcMain.handle('vp:pick-sub', async (e) => {
    if (!trusted(e)) return null;
    const r = await dialog.showOpenDialog(getMainWin(), { properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: SUB_EXTS }] });
    if (r.canceled || !isFile(r.filePaths[0])) return null;
    const f = r.filePaths[0];
    try { const st = fs.statSync(f); if (st.size > MAX_SUB_BYTES) return null; return { name: path.basename(f), ext: extOf(f), text: decodeText(fs.readFileSync(f)) }; } catch (_) { return null; }
  });
  ipcMain.handle('vp:exists', (e, list) => (trusted(e) && Array.isArray(list) ? list.slice(0, 500).map((p) => isFile(p)) : []));

  /* ---------------- photo editor ---------------- */
  ipcMain.handle('photo:pick', async (e) => {
    if (!trusted(e)) return null;
    const r = await dialog.showOpenDialog(getMainWin(), { properties: ['openFile'], filters: [{ name: 'Images', extensions: IMG_EXTS }] });
    return r.canceled || !isFile(r.filePaths[0]) || !IMG_EXTS.includes(extOf(r.filePaths[0])) ? null : r.filePaths[0];
  });
  ipcMain.handle('photo:read', (e, p) => {
    if (!trusted(e) || !isFile(p) || !IMG_EXTS.includes(extOf(p))) return null;
    try { const st = fs.statSync(p); if (st.size > MAX_IMAGE_BYTES) return { error: 'too-large' }; const b = fs.readFileSync(p); return { name: path.basename(p), bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch (_) { return null; }
  });
  ipcMain.handle('photo:save', async (e, req) => {
    if (!trusted(e) || !req || !SAVE_FORMATS[req.format] || !(req.bytes instanceof ArrayBuffer || ArrayBuffer.isView(req.bytes)) || req.bytes.byteLength > MAX_SAVE_BYTES) return { ok: false };
    const base = String(req.name || 'photo').replace(/[\\/:*?"<>|\0]/g, '_').replace(/\.[A-Za-z0-9]{1,5}$/, '').slice(0, 120) || 'photo';
    const ext = SAVE_FORMATS[req.format][0];
    const r = await dialog.showSaveDialog(getMainWin(), { defaultPath: path.join(app.getPath('pictures'), `${base}-edited.${ext}`), filters: [{ name: ext.toUpperCase(), extensions: SAVE_FORMATS[req.format] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    if (!SAVE_FORMATS[req.format].includes(extOf(r.filePath))) return { ok: false };
    try { fs.writeFileSync(r.filePath, Buffer.from(req.bytes instanceof ArrayBuffer ? req.bytes : req.bytes.buffer)); return { ok: true, file: r.filePath }; } catch (_) { return { ok: false }; }
  });

  /* ---------------- Media Player Pro importer ---------------- */
  ipcMain.handle('mpp:scan', (e) => {
    if (!trusted(e)) return { found: false };
    const r = M.scan(M.defaultDir());
    return r;
  });
  ipcMain.handle('mpp:backup', (e, snapshot) => {
    if (!trusted(e)) return { ok: false };
    try {
      const snap = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? Object.fromEntries(Object.entries(snapshot).filter(([k, v]) => k.startsWith('waveframe.') && typeof v === 'string' && v.length < 5 * 1024 * 1024)) : {};
      const b = M.backup(M.defaultDir(), backupRoot(), snap);
      bk.dir = b.dir;
      return { ok: true, dir: b.dir, copied: b.copied };
    } catch (_) { return { ok: false }; }
  });
  ipcMain.handle('mpp:report', (e, report) => (trusted(e) && bk.dir && report && typeof report === 'object' ? M.writeReport(bk.dir, report) : false));
  // WAVEFRAME_SELFTEST: the real renderer plays a generated clip through wfmedia: with its subtitle, edits a generated photo, and scans a
  // synthetic Media Player Pro folder (APPDATA is pointed at a temp folder for the duration) - the source must stay byte-identical.
  async function selfTest() {
    const out = []; const check = (name, ok, extra) => out.push({ name, ok: !!ok, extra: ok ? extra : (extra || 'failed') });
    const win = getMainWin(); const os = require('os'); const crypto = require('crypto');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-media-self-'));
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(code)) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
    try {
      /* video player */
      const ff = await resolveFfmpegPath();
      if (ff) {
        const clip = path.join(dir, 'clip.mp4');
        await new Promise((res) => require('child_process').execFile(ff, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { timeout: 60000 }, () => res()));
        if (!fs.existsSync(clip)) {
          await new Promise((res) => require('child_process').execFile(ff, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libvpx', '-c:a', 'libvorbis', '-shortest', path.join(dir, 'clip.webm')], { timeout: 60000 }, () => res()));
        }
        const file = fs.existsSync(clip) ? clip : path.join(dir, 'clip.webm');
        if (fs.existsSync(file)) {
          fs.writeFileSync(path.join(dir, path.basename(file, path.extname(file)) + '.srt'), '1\r\n00:00:00,200 --> 00:00:01,500\r\nΚαλημέρα\r\n\r\n');
          await js("document.querySelector('.tab-btn[data-tab=\"video\"]').click(); loadVideoPlayer().then(() => 1)");
          await until("!!window.WaveframeVideoPlayer", 8000);
          await js(`window.WaveframeVideoPlayer.open(${JSON.stringify(file)}); 1`);
          const ok = await until("(() => { const v = document.getElementById('vpVideo'); return v && v.readyState >= 2 && v.videoWidth === 320; })()", 15000);
          const info = await js("(() => { const v = document.getElementById('vpVideo'); return JSON.stringify({ w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration * 10) / 10, err: v.error && v.error.code, media: document.getElementById('vpFrame').classList.contains('has-media'), tracks: v.querySelectorAll('track').length }); })()");
          check('video player plays a local clip through wfmedia: (320x180, ~2 s)', ok, info);
          const subOk = await until("document.getElementById('vpVideo').querySelectorAll('track').length === 1", 6000);
          check('video player finds and shows the subtitle next to the clip', subOk, await js("document.getElementById('vpSubTrack').options.length + ' options'"));
          await js("document.getElementById('vpFx').click(); 1");
          await new Promise((r) => setTimeout(r, 400));
          check('equalizer on the video sound turns on (CORS-enabled wfmedia: source)', await js("document.getElementById('vpFx').getAttribute('aria-pressed') === 'true' && !/./.test(document.getElementById('vpStatus').textContent.match(/equalizer|ισοσταθμιστ/i) || '')"), await js("document.getElementById('vpStatus').textContent"));
          const guard = await js("fetch('wfmedia://f/' + encodeURIComponent('C:\\Windows\\System32\\drivers\\etc\\hosts')).then((r) => r.status).catch(() => 'blocked')");
          check('wfmedia: refuses files that are not media / subtitles', guard === 404 || guard === 'blocked', String(guard));
        }
      }
      /* photo editor */
      const { nativeImage } = require('electron');
      const W = 64, H = 48, buf = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; buf[i] = 40 + x * 2; buf[i + 1] = 90; buf[i + 2] = 160 - y; buf[i + 3] = 255; } // BGRA
      const png = path.join(dir, 'photo.png'); fs.writeFileSync(png, nativeImage.createFromBitmap(buf, { width: W, height: H }).toPNG());
      await js("document.querySelector('.tab-btn[data-tab=\"photo\"]').click(); loadPhoto().then(() => 1)");
      await until("!!window.WaveframePhotoUi", 8000);
      await js(`WaveframePhotoUi.open(${JSON.stringify(png)}); 1`);
      const loaded = await until("document.getElementById('phCanvas').width === 64", 8000);
      const before = await js("(() => { const c = document.getElementById('phCanvas'); const d = c.getContext('2d').getImageData(10, 10, 1, 1).data; return [d[0], d[1], d[2]].join(','); })()");
      await js("(() => { const s = document.getElementById('ph_exposure'); s.value = '1'; s.dispatchEvent(new Event('input')); return 1; })()");
      await new Promise((r) => setTimeout(r, 300));
      const after = await js("(() => { const c = document.getElementById('phCanvas'); const d = c.getContext('2d').getImageData(10, 10, 1, 1).data; return [d[0], d[1], d[2]].join(','); })()");
      check('photo editor opens a PNG and the exposure slider changes the preview', loaded && before !== after && Number(after.split(',')[1]) > Number(before.split(',')[1]), before + ' -> ' + after);
      await js("(() => { document.getElementById('phRotR').click(); return 1; })()");
      await new Promise((r) => setTimeout(r, 200));
      check('photo editor rotates 90 degrees (64x48 -> 48x64)', await js("document.getElementById('phCanvas').width === 48 && document.getElementById('phCanvas').height === 64"));
      /* Media Player Pro importer */
      const mdir = path.join(dir, 'AppData', 'MediaPlayerPro'); fs.mkdirSync(mdir, { recursive: true });
      fs.writeFileSync(path.join(mdir, 'recent.txt'), 'C:\\Videos\\a.mp4\r\nC:\\Videos\\b.mkv\r\n');
      fs.writeFileSync(path.join(mdir, 'bookmarks.txt'), 'C:\\Videos\\a.mp4|4000\r\n');
      fs.writeFileSync(path.join(mdir, 'settings.json'), JSON.stringify({ Languages: 'el,en', OsApiKey: 'SECRET-KEY', SubFontSize: 20 }));
      const hash = () => fs.readdirSync(mdir).sort().map((n) => n + crypto.createHash('sha256').update(fs.readFileSync(path.join(mdir, n))).digest('hex')).join('|');
      const h0 = hash(); const oldAppData = process.env.APPDATA; process.env.APPDATA = path.join(dir, 'AppData');
      try {
        await js("document.querySelector('.tab-btn[data-tab=\"settings\"]').click(); loadMppImport().then(() => 1)");
        await until("!!window.WaveframeMpp", 8000);
        await js("document.getElementById('mppScan').click(); 1");
        const shown = await until("document.querySelectorAll('#mppResult input[data-cat]').length >= 3", 6000);
        const rows = await js("[...document.querySelectorAll('#mppResult input[data-cat]')].map((c) => c.dataset.cat).join(',')");
        const notes = await js("document.querySelector('#mppResult .mpp-notes') ? document.querySelector('#mppResult .mpp-notes').textContent : ''");
        check('Media Player Pro importer finds the data and lists the categories and what is not carried over', shown && /recent/.test(rows) && /bookmarks/.test(rows) && /subtitles/.test(rows) && /settings\.json/.test(notes), rows + ' | ' + notes.slice(0, 80));
        await js("document.getElementById('mppImport').click(); 1");
        const done = await until("/\\d/.test(document.getElementById('mppStatus').textContent) && document.getElementById('mppImport').disabled === false && !!localStorage.getItem('waveframe.mppImport')", 10000);
        const stored = await js("JSON.stringify({ recent: JSON.parse(localStorage.getItem('waveframe.video.recent') || '[]').length, bm: JSON.parse(localStorage.getItem('waveframe.video.bookmarks') || '[]').length, secret: Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes('SECRET-KEY')) })");
        const st = JSON.parse(stored);
        check('import merges only what was ticked, never the service credentials', done && st.recent === 3 && st.bm === 1 && st.secret === false, stored);
        const bdir = path.join(app.getPath('userData'), 'backups');
        const made = fs.existsSync(bdir) && fs.readdirSync(bdir).some((n) => n.startsWith('mpp-import-') && fs.existsSync(path.join(bdir, n, 'source', 'recent.txt')) && fs.existsSync(path.join(bdir, n, 'waveframe-before.json')) && fs.existsSync(path.join(bdir, n, 'report.json')));
        check('a backup of the source files and of the Suite settings plus a report were written first', made);
        check('Media Player Pro folder is byte-identical after scan + import', hash() === h0);
      } finally { process.env.APPDATA = oldAppData; }
    /* layout of the three new areas in all 20 languages, at 100 % and 150 % zoom: no overlapping controls, no clipped button text, no sideways scroll */
    try {
      const audit = `(async () => {
        const tabs = ['video', 'photo', 'settings'], bad = [];
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        for (const l of LANGUAGES.map((x) => x.code)) {
          setLanguage(l);
          for (const z of [1, 1.5]) {
            window.waveframe.setZoomForTest && window.waveframe.setZoomForTest(z);
            document.documentElement.style.setProperty('zoom', String(z));
            for (const tab of tabs) {
              document.querySelector('.tab-btn[data-tab="' + tab + '"]').click();
              await new Promise((r) => setTimeout(r, 30));
              const root = document.getElementById('tab-' + tab);
              const els = [...root.querySelectorAll('button, select, input[type=range], input[type=color], label.vp-inline, .ph-slider')].filter((e) => vis(e) && !e.closest('.dep-hidden') && !e.closest('#mppResult'));
              for (const e of els) { if ((e.tagName === 'BUTTON' || e.tagName === 'LABEL') && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') bad.push(l + '/' + z + '/' + tab + ': clipped ' + (e.id || e.textContent.slice(0, 20))); }
              const bars = [...root.querySelectorAll('.vp-bar')];
              for (const bar of bars) {
                const kids = [...bar.children].filter(vis);
                for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
                  const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
                  const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                  if (ox > 2 && oy > 2) bad.push(l + '/' + z + '/' + tab + ': overlap ' + (kids[i].id || kids[i].textContent.slice(0, 15)) + ' x ' + (kids[j].id || kids[j].textContent.slice(0, 15)));
                }
              }
              if (document.documentElement.scrollWidth > window.innerWidth + 4) bad.push(l + '/' + z + '/' + tab + ': page scrolls sideways');
            }
          }
        }
        document.documentElement.style.removeProperty('zoom'); setLanguage('el');
        document.querySelector('.tab-btn[data-tab="player"]').click();
        return JSON.stringify(bad.slice(0, 12));
      })()`;
      const bad = JSON.parse(await js(audit));
      check('video / photo / import areas: no overlapping or clipped controls (20 languages x 100 % / 150 %)', bad.length === 0, bad.join(' ; '));
    } catch (e) { check('media layout audit threw', false, e && e.stack || e); }
    } catch (e) { check('media self-test threw', false, e && e.stack || e); }
    finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } }
    return out;
  }

  ipcMain.handle('mpp:pick-m3u', async (e) => {
    if (!trusted(e)) return [];
    const r = await dialog.showOpenDialog(getMainWin(), { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8'] }] });
    if (r.canceled) return [];
    return r.filePaths.slice(0, 20).map(M.readM3uFile).filter(Boolean);
  });

  return { selfTest };
}

module.exports = { init, registerScheme, decodeText, siblingSubtitles, VIDEO_EXTS, AUDIO_EXTS, SUB_EXTS, IMG_EXTS };

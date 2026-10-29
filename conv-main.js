'use strict';
// IPC glue for the audio converter. Only the main window may call these channels; every payload is validated here
// (options through convlib.validateOptions, files must exist and be regular files). The original files are only read.

const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const L = require('./renderer/convlib.js');
const E = require('./conv-engine.js');

const MAX_READ = 600 * 1024 * 1024; // the renderer decodes the whole file in memory

function init({ getMainWin, resolveFfmpegPath, installFfmpeg, confirmFfmpegDownload, defaultOutDir }) {
  const trusted = (e) => { const w = getMainWin(); return !!w && !w.isDestroyed() && e.sender === w.webContents; };
  const jobs = new Map(); // id -> { cancel }
  const cancelledEarly = new Set(); // cancel requests that arrived while the job was still being prepared
  const sendProgress = (payload) => { const w = getMainWin(); if (w && !w.isDestroyed()) w.webContents.send('conv:progress', payload); };
  const okFile = (p) => { try { return typeof p === 'string' && path.isAbsolute(p) && fs.statSync(p).isFile(); } catch (_) { return false; } };
  const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id);
  const errorOf = (e) => ({ ok: false, code: e && e.code || 'failed', error: (e && e.message || String(e)).slice(0, 400) });

  ipcMain.handle('conv:pick', async (e) => {
    if (!trusted(e)) return [];
    const r = await dialog.showOpenDialog(getMainWin(), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio / Video', extensions: [...E.AUDIO_EXTS, ...E.VIDEO_EXTS] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? [] : r.filePaths.filter(okFile);
  });

  ipcMain.handle('conv:status', async (e) => (trusted(e) ? { ffmpeg: !!(await resolveFfmpegPath()) } : null));

  // Offers the on-demand LGPL ffmpeg download (confirmation dialog with source/size/SHA-256 inside installFfmpeg's confirm callback).
  ipcMain.handle('conv:ensure-ffmpeg', async (e) => {
    if (!trusted(e)) return { ok: false };
    if (await resolveFfmpegPath()) return { ok: true };
    try {
      await installFfmpeg((p) => sendProgress({ phase: 'ffmpeg', pct: p.pct, step: p.phase }), (info) => confirmFfmpegDownload(getMainWin(), info));
      return { ok: !!(await resolveFfmpegPath()) };
    } catch (err) { return { ...errorOf(err), declined: err && err.code === 'cancelled' }; }
  });

  ipcMain.handle('conv:probe', async (e, p) => {
    if (!trusted(e) || !okFile(p)) return null;
    const ff = await resolveFfmpegPath();
    return ff ? E.probe(ff, p) : null;
  });

  ipcMain.handle('conv:read', async (e, p) => {
    if (!trusted(e) || !okFile(p)) return null;
    if (fs.statSync(p).size > MAX_READ) return { tooLarge: true };
    return { bytes: fs.readFileSync(p) };
  });

  ipcMain.handle('conv:predecode', async (e, p, sampleRate) => {
    if (!trusted(e) || !okFile(p)) return null;
    const ff = await resolveFfmpegPath();
    if (!ff) return null;
    try { return { bytes: await E.predecodeToWav({ ffmpegPath: ff, input: p, sampleRate: Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000 ? sampleRate : 0 }) }; } catch (_) { return null; }
  });

  // 'default' = MusicWaveFrame (created on demand), 'custom' = a folder the user picked, 'source' = next to the original (undefined).
  function resolveOutDir(req, hasSource) {
    if (req.outMode === 'custom' && typeof req.outDir === 'string' && path.isAbsolute(req.outDir)) return req.outDir;
    if (req.outMode === 'source' && hasSource) return undefined;
    return defaultOutDir();
  }

  ipcMain.handle('conv:default-dir', (e) => (trusted(e) ? defaultOutDir() : null));

  async function track(id, make) {
    try {
      const job = await make();
      jobs.set(id, job);
      if (cancelledEarly.delete(id)) job.cancel();
      const r = await job.promise;
      return { ok: true, output: r.output };
    } catch (err) { return errorOf(err); } finally { jobs.delete(id); cancelledEarly.delete(id); }
  }

  ipcMain.handle('conv:direct', async (e, req) => {
    if (!trusted(e) || !req || !okId(req.id) || !okFile(req.path)) return { ok: false, code: 'bad-request' };
    const v = L.validateOptions(req.options);
    if (!v.ok) return { ok: false, code: 'bad-options', error: v.errors.join(',') };
    const ff = await resolveFfmpegPath();
    if (!ff) return { ok: false, code: 'no-ffmpeg' };
    return track(req.id, () => E.convertDirect({ ffmpegPath: ff, input: req.path, options: v.options, onProgress: (p) => sendProgress({ id: req.id, pct: p }), outDir: resolveOutDir(req, true) }));
  });

  ipcMain.handle('conv:encode', async (e, req) => {
    const hasSource = !!req && okFile(req.path);
    const hasName = !!req && typeof req.name === 'string' && req.name.length > 0 && req.name.length < 200;
    if (!trusted(e) || !req || !okId(req.id) || !(hasSource || hasName) || !(req.wav instanceof Uint8Array || req.wav instanceof ArrayBuffer)) return { ok: false, code: 'bad-request' };
    const v = L.validateOptions(req.options);
    if (!v.ok) return { ok: false, code: 'bad-options', error: v.errors.join(',') };
    const ff = v.options.format === 'wav' ? null : await resolveFfmpegPath();
    if (v.options.format !== 'wav' && !ff) return { ok: false, code: 'no-ffmpeg' };
    const wavBytes = req.wav instanceof ArrayBuffer ? new Uint8Array(req.wav) : req.wav;
    const outDir = resolveOutDir(req, hasSource);
    // tracks that come from the playlist have no file on disk: name them after the track inside the output folder
    const input = hasSource ? req.path : path.join(outDir, `${req.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'track'}.src`);
    return track(req.id, () => E.convertFromWav({ ffmpegPath: ff, input, wavBytes, options: v.options, duration: Number(req.duration) || 0, onProgress: (p) => sendProgress({ id: req.id, pct: p }), outDir }));
  });

  ipcMain.on('conv:cancel', (e, id) => {
    if (!trusted(e) || !okId(id)) return;
    if (jobs.has(id)) jobs.get(id).cancel(); else cancelledEarly.add(id);
  });
  ipcMain.on('conv:reveal', (e, p) => { if (trusted(e) && okFile(p)) shell.showItemInFolder(p); });

  // WAVEFRAME_SELFTEST: runs the real renderer converter (lazy load, decode, Enhancer chain, BS.1770 gain, ffmpeg encode) on a generated tone.
  async function selfTest() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    const check = (name, ok, extra) => out.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
    const os = require('os');
    const audio = require('./renderer/audiolib.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-convself-'));
    try {
      const win = getMainWin();
      const ff = await resolveFfmpegPath();
      check('ffmpeg available for converter tests', !!ff, ff || 'none');
      const n = 44100 * 4, l = new Float32Array(n), r = new Float32Array(n);
      for (let i = 0; i < n; i++) { l[i] = 0.05 * Math.sin(2 * Math.PI * 440 * i / 44100); r[i] = 0.05 * Math.sin(2 * Math.PI * 660 * i / 44100); }
      const src = path.join(dir, 'tone.wav');
      fs.writeFileSync(src, Buffer.from(L.writeWav([l, r], 44100, 16)));
      const run = (opts) => win.webContents.executeJavaScript(`(async () => {
        await loadConverter();
        const v = WaveframeConv.validateOptions(${JSON.stringify(opts)});
        if (!v.ok) return { error: v.errors.join() };
        try { const r = await WaveframeConverter.convertFile({ id: 'self1', path: ${JSON.stringify(src)} }, v.options, { ffmpeg: ${!!ff}, outMode: 'source', cancelled: () => false, report() {}, setBase() {} }); return r; }
        catch (e) { return { error: String(e && e.message || e) }; }
      })()`);
      check('converter tab skeleton exists but is empty before first open', (await win.webContents.executeJavaScript("document.getElementById('tab-converter').children.length")) === 0);
      // 1. processed route: normalise -23.. -> -16 LUFS, FLAC
      const a = await run({ format: 'flac', depth: 16, normalize: true, targetLufs: -16, suffix: '-selftest' });
      check('processed route (normalise to -16 LUFS -> FLAC) runs', a && a.output && !a.error, a && (a.error || path.basename(a.output)));
      if (a && a.output && ff) {
        const pre = L.readWav(new Uint8Array(await E.predecodeToWav({ ffmpegPath: ff, input: a.output })).buffer);
        const lufs = audio.integratedLufs(pre.samples, pre.sampleRate);
        check('normalised output measures the LUFS target', Math.abs(lufs + 16) < 0.5, lufs.toFixed(2) + ' LUFS');
        const v = await E.verifyDecodes(ff, a.output);
        check('FLAC output decodes (44.1 kHz stereo, ~4 s)', v.ok && v.codec === 'flac' && v.sampleRate === 44100 && v.channels === 2 && Math.abs(v.decodedSeconds - 4) < 0.1, JSON.stringify(v));
      }
      // 2. processed route with the Enhancer chain, resample + mono + trim, pure-JS WAV writer (no ffmpeg involved for WAV output)
      const b = await run({ format: 'wav', depth: 24, effects: true, sampleRate: 22050, channels: 1, trimStart: 1, trimEnd: 3, suffix: '-selftest-fx' });
      check('processed route (effects, 22.05 kHz mono, trim 1-3 s -> WAV 24-bit) runs', b && b.output && !b.error, b && (b.error || path.basename(b.output)));
      if (b && b.output) {
        const w = L.readWav(fs.readFileSync(b.output).buffer.slice(0));
        check('WAV output has the requested format', w.sampleRate === 22050 && w.channels === 1 && w.bits === 24 && Math.abs(w.frames / w.sampleRate - 2) < 0.05, JSON.stringify({ r: w.sampleRate, c: w.channels, b: w.bits, s: w.frames / w.sampleRate }));
      }
      // 3. direct route
      if (ff) {
        const d = await run({ format: 'mp3', bitrate: 128, suffix: '-selftest-direct' });
        check('direct route (ffmpeg -> MP3) runs', d && d.output && !d.error, d && (d.error || path.basename(d.output)));
      }
      check('original is untouched', fs.statSync(src).size === 44 + n * 4);
      // layout: no two controls of the Export / Convert tab overlap, in every language, at 100 % and 150 %, with files listed and while converting
      const AUDIT = `(() => {
        const pane = document.getElementById('tab-converter');
        const els = [...pane.querySelectorAll('button, select, input, .dest-path, .conv-drop, .conv-name, .conv-state')].filter((e) => e.offsetParent && !e.closest('.dep-hidden'));
        const R = els.map((e) => ({ e, r: e.getBoundingClientRect() })).filter((o) => o.r.width > 0 && o.r.height > 0);
        const out = [];
        for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
          if (R[i].e.contains(R[j].e) || R[j].e.contains(R[i].e)) continue;
          const a = R[i].r, b = R[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 2) out.push((R[i].e.id || R[i].e.className || R[i].e.tagName) + ' x ' + (R[j].e.id || R[j].e.className || R[j].e.tagName));
        }
        return out.slice(0, 5);
      })()`;
      await win.webContents.executeJavaScript("document.querySelector('.tab-btn[data-tab=\"converter\"]').click()");
      const langs = await win.webContents.executeJavaScript('Object.keys(I18N)');
      const bad = [];
      for (const zoom of [1, 1.5]) {
        win.webContents.setZoomFactor(zoom);
        for (const l of langs) {
          await win.webContents.executeJavaScript(`(async () => { setLanguage(${JSON.stringify(l)}); await loadConverter(); WaveframeConverter.clearFiles(); WaveframeConverter.addPaths(['C:\\\\Music\\\\a-very-long-file-name-for-the-layout-test-number-one.mp3', 'C:\\\\Music\\\\b.flac']); WaveframeConverter.showRunning(${l.charCodeAt(0) % 2 === 0}); })()`);
          await wait(120);
          const o = await win.webContents.executeJavaScript(AUDIT);
          if (o.length) bad.push(`${l} x${zoom}: ${o.join(', ')}`);
        }
      }
      win.webContents.setZoomFactor(1);
      await win.webContents.executeJavaScript("setLanguage('el'); WaveframeConverter.clearFiles(); WaveframeConverter.showRunning(false)");
      check('Export / Convert layout: no overlapping controls (20 languages x 100 % / 150 %)', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) { check('converter self-test threw', false, e && e.stack || e); }
    finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ } }
    return out;
  }

  return { selfTest };
}

module.exports = { init };

'use strict';
// Export / convert tab (1.8.0 converter, merged with the old Export tab in 1.9.0: playlist tracks and files share one list and one set of options). Loaded lazily the first time the tab is opened (see app.js), so it costs nothing until then.
// Two routes per file:
//  - direct:    ffmpeg (main process) reads the original and does decode / trim / rate / channels / codec;
//  - processed: used when loudness normalisation or the Enhancer's effects are requested, or when no ffmpeg exists and the output is WAV:
//               decode here (Web Audio), trim, render through OfflineAudioContext, BS.1770 gain, then write WAV (pure JS) or hand it to ffmpeg.
// Pure logic (validation, naming, WAV writer, gain maths, queue) lives in convlib.js.

(function () {
  const C = window.WaveframeConv;
  const api = window.waveframe;
  const OPT_KEY = 'waveframe.conv.opts';
  const root = document.getElementById('tab-converter');
  const $ = (id) => document.getElementById(id);
  let files = [];
  let running = null;
  let seq = 0;

  const h = (tag, props = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('data-')) e.setAttribute(k, v); else e[k] = v; }
    for (const c of [].concat(kids)) if (c) e.append(c);
    return e;
  };
  const fmt = (s, vars) => Object.entries(vars || {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

  /* ---------------- pure helpers ---------------- */

  // "90", "1:30", "0:01:30.5", "" -> seconds (NaN when malformed)
  function parseTime(text) {
    const s = String(text == null ? '' : text).trim().replace(',', '.');
    if (!s) return 0;
    if (!/^\d+(\.\d+)?(:\d{1,2}(\.\d+)?){0,2}$/.test(s)) return NaN;
    return s.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
  }

  async function decode(bytes, rate) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(rate >= 8000 && rate <= 96000 ? { sampleRate: rate } : undefined);
    try {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return await ctx.decodeAudioData(copy);
    } finally { ctx.close().catch(() => {}); }
  }

  // decoded AudioBuffer + validated options -> { channels, sampleRate, lufs, gainDb, limited }
  async function processBuffer(decoded, o, hooks = {}) {
    const sr = decoded.sampleRate, rateOut = o.sampleRate || sr;
    const start = Math.round(o.trimStart * sr);
    const end = o.trimEnd > 0 ? Math.min(decoded.length, Math.round(o.trimEnd * sr)) : decoded.length;
    if (start >= end) throw Object.assign(new Error('trim'), { code: 'trim' });
    const len = end - start;
    let chs = [];
    if (o.effects) {
      const tb = new AudioBuffer({ length: len, numberOfChannels: decoded.numberOfChannels, sampleRate: sr });
      for (let c = 0; c < decoded.numberOfChannels; c++) tb.copyToChannel(decoded.getChannelData(c).subarray(start, end), c);
      const rendered = await engine.renderOffline(tb, { tempo: 1, rate: rateOut }); // the Enhancer's live chain, at normal speed
      const frames = Math.round(len / sr * rateOut);
      chs = [rendered.getChannelData(0).slice(0, frames), rendered.getChannelData(1).slice(0, frames)];
    } else if (rateOut !== sr) {
      const ctx = new OfflineAudioContext(decoded.numberOfChannels, Math.ceil(len / sr * rateOut), rateOut);
      const tb = ctx.createBuffer(decoded.numberOfChannels, len, sr);
      for (let c = 0; c < decoded.numberOfChannels; c++) tb.copyToChannel(decoded.getChannelData(c).subarray(start, end), c);
      const src = ctx.createBufferSource(); src.buffer = tb; src.connect(ctx.destination); src.start();
      const rendered = await ctx.startRendering();
      for (let c = 0; c < rendered.numberOfChannels; c++) chs.push(rendered.getChannelData(c));
    } else {
      for (let c = 0; c < decoded.numberOfChannels; c++) chs.push(decoded.getChannelData(c).slice(start, end));
    }
    chs = C.mapChannels(chs, o.channels);
    let lufs = NaN, gainDb = 0, limited = false;
    if (o.normalize) {
      lufs = WaveframeAudio.integratedLufs(chs, rateOut);
      let peak = 0;
      for (const ch of chs) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
      const safe = C.peakSafeGainDb(C.targetGainDb(lufs, o.targetLufs), peak);
      gainDb = safe.gainDb; limited = safe.limited;
      if (gainDb !== 0) { const g = Math.pow(10, gainDb / 20); for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g; }
    }
    return { channels: chs, sampleRate: rateOut, lufs, gainDb, limited };
  }

  /* ---------------- one file ---------------- */

  async function convertFile(item, o, ctx) {
    const id = item.id;
    const out = { outMode: ctx.outMode || 'default', outDir: ctx.outDir };
    const isTrack = item.kind === 'track';
    const processed = isTrack || o.normalize || o.effects || !ctx.ffmpeg;
    if (!processed) {
      const r = await api.convDirect({ id, path: item.path, options: o, ...out });
      if (!r.ok) throw Object.assign(new Error(r.error || r.code), { code: r.code });
      return { output: r.output };
    }
    const info = ctx.ffmpeg && !isTrack ? await api.convProbe(item.path) : null;
    if (info && !info.hasAudio) throw Object.assign(new Error('no-audio'), { code: 'no-audio' });
    ctx.report(0.05);
    let read;
    if (isTrack) {
      const t0 = item.track; // playlist entry: a File from the picker or a URL
      read = { bytes: new Uint8Array(t0.file ? await t0.file.arrayBuffer() : await (await fetch(t0.url)).arrayBuffer()) };
    } else read = await api.convRead(item.path);
    if (!read || read.tooLarge) throw Object.assign(new Error('file too large to process in memory'), { code: 'too-large' });
    let decoded;
    try { decoded = await decode(read.bytes, info && info.sampleRate); }
    catch (_) {
      const pre = ctx.ffmpeg && !isTrack ? await api.convPredecode(item.path, info && info.sampleRate) : null; // WMA, AIFF, video containers ...
      if (!pre) throw Object.assign(new Error('decode-failed'), { code: 'decode-failed' });
      decoded = await decode(pre.bytes, info && info.sampleRate);
    }
    read = null;
    if (ctx.cancelled()) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    ctx.report(0.25);
    const p = await processBuffer(decoded, o);
    if (ctx.cancelled()) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    ctx.report(0.5);
    const depth = o.format === 'wav' ? o.depth : 24;
    const wav = C.writeWav(p.channels, p.sampleRate, depth);
    ctx.setBase(0.5);
    const r = await api.convEncode({ id, ...(isTrack ? { name: item.name } : { path: item.path }), wav: new Uint8Array(wav), options: o, duration: p.channels[0].length / p.sampleRate, ...out });
    if (!r.ok) throw Object.assign(new Error(r.error || r.code), { code: r.code });
    return { output: r.output, lufs: p.lufs, gainDb: p.gainDb, limited: p.limited };
  }

  /* ---------------- UI ---------------- */

  // the quality presets of the old Export tab
  const PRESETS = [
    { key: 'low', format: 'mp3', bitrate: 96, sampleRate: 22050 },
    { key: 'medium', format: 'mp3', bitrate: 128, sampleRate: 44100 },
    { key: 'high', format: 'mp3', bitrate: 320, sampleRate: 48000 },
    { key: 'lossless', format: 'flac', depth: 16, sampleRate: 48000 },
  ];
  function applyPreset(p) {
    $('convFormat').value = p.format; $('convMode').value = 'cbr';
    if (p.bitrate) $('convBitrate').value = String(p.bitrate);
    if (p.depth) $('convDepth').value = String(p.depth);
    $('convRate').value = String(p.sampleRate);
    $('convFormat').dispatchEvent(new Event('change'));
  }

  const FORMAT_KEYS = ['mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'aiff', 'alac', 'wma'];
  const FORMAT_LABEL = { mp3: 'MP3', flac: 'FLAC', wav: 'WAV', aac: 'AAC (M4A)', ogg: 'OGG Vorbis', opus: 'Opus', aiff: 'AIFF', alac: 'ALAC (M4A)', wma: 'WMA' };

  function loadSaved() { try { return JSON.parse(localStorage.getItem(OPT_KEY) || '{}'); } catch (_) { return {}; } }
  function save(o) { try { localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch (_) { /* storage unavailable */ } }

  function select(id, options, value) {
    const s = h('select', { id });
    for (const [v, label] of options) s.append(h('option', { value: String(v), text: label }));
    s.value = String(value);
    return s;
  }
  function field(labelKey, control, id) { return h('div', { class: 'conv-field', id }, [h('label', { class: 'field-label', 'data-i18n': labelKey, text: t(labelKey) }), control]); }

  function build() {
    const saved = { ...C.DEFAULTS, effects: true, ...loadSaved() };
    const customDir = localStorage.getItem('waveframe.destFolder') || '';
    // a folder picked in the old Export tab becomes the custom destination; otherwise Music\WaveFrame
    const outMode = localStorage.getItem('waveframe.destMode') || (customDir ? 'custom' : 'default');
    root.textContent = '';
    const panel = h('div', { class: 'panel conv-panel' });
    panel.append(h('h2', { 'data-i18n': 'conv.title', text: t('conv.title') }), h('p', { class: 'hint', 'data-i18n': 'conv.hint', text: t('conv.hint') }));

    const drop = h('div', { class: 'conv-drop', id: 'convDrop', tabIndex: 0 }, [h('span', { 'data-i18n': 'conv.drop', text: t('conv.drop') })]);
    const list = h('div', { class: 'conv-list', id: 'convList' });
    const btnAdd = h('button', { class: 'small-btn', id: 'convAdd', 'data-i18n': 'conv.add', text: t('conv.add') });
    const btnPlaylist = h('button', { class: 'small-btn', id: 'convFromPlaylist', 'data-i18n': 'conv.fromPlaylist', text: t('conv.fromPlaylist') });
    const btnClear = h('button', { class: 'small-btn', id: 'convClear', 'data-i18n': 'conv.clear', text: t('conv.clear') });
    panel.append(drop, list, h('div', { class: 'settings-btn-row' }, [btnAdd, btnPlaylist, btnClear]));

    const formatSel = select('convFormat', FORMAT_KEYS.map((k) => [k, FORMAT_LABEL[k]]), saved.format);
    const depthSel = select('convDepth', [[16, '16-bit'], [24, '24-bit'], [32, t('conv.depthFloat')]], saved.depth);
    const bitrateSel = select('convBitrate', [64, 96, 128, 160, 192, 224, 256, 320].map((b) => [b, `${b}`]), saved.bitrate);
    const modeSel = select('convMode', [['cbr', t('conv.cbr')], ['vbr', t('conv.vbr')]], saved.mode);
    const vbrSel = select('convVbr', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((q) => [q, `${q}`]), saved.vbrQuality);
    const rateSel = select('convRate', C.RATES.map((r) => [r, r ? `${r} Hz` : t('conv.auto')]), saved.sampleRate);
    const chSel = select('convChannels', [[0, t('conv.auto')], [1, t('conv.mono')], [2, t('conv.stereo')]], saved.channels);
    const tStart = h('input', { id: 'convTrimStart', type: 'text', placeholder: '0:00', value: saved.trimStartText || '' });
    const tEnd = h('input', { id: 'convTrimEnd', type: 'text', placeholder: '', value: saved.trimEndText || '' });
    const norm = h('input', { id: 'convNorm', type: 'checkbox', checked: !!saved.normalize });
    const target = h('input', { id: 'convTarget', type: 'number', min: -40, max: -5, step: 1, value: saved.targetLufs });
    const fx = h('input', { id: 'convFx', type: 'checkbox', checked: !!saved.effects });
    const suffix = h('input', { id: 'convSuffix', type: 'text', maxLength: 40, value: saved.suffix });

    const presets = h('div', { class: 'conv-presets' }, PRESETS.map((p) => h('button', { class: 'small-btn', 'data-i18n': `conv.preset.${p.key}`, text: t(`conv.preset.${p.key}`), onclick: () => applyPreset(p) })));
    const outSel = select('convOut', [['default', t('conv.out.default')], ['source', t('conv.out.source')], ['custom', t('conv.out.custom')]], outMode);
    const outPath = h('span', { class: 'dest-path', id: 'convOutPath', text: customDir });
    const outPick = h('button', { class: 'small-btn', id: 'convOutPick', 'data-i18n': 'conv.out.choose', text: t('conv.out.choose') });
    const outRow = h('div', { class: 'dest-row', id: 'convOutRow' }, [outPath, outPick]);
    panel.append(
      presets,
      h('div', { class: 'conv-grid' }, [
        field('conv.format', formatSel), field('conv.depth', depthSel, 'convDepthField'), field('conv.bitrate', bitrateSel, 'convBitrateField'),
        field('conv.mp3mode', modeSel, 'convModeField'), field('conv.vbrq', vbrSel, 'convVbrField'),
        field('conv.rate', rateSel), field('conv.channels', chSel), field('conv.trimStart', tStart), field('conv.trimEnd', tEnd), field('conv.suffix', suffix), field('conv.out', outSel),
      ]),
      outRow,
      h('label', { class: 'conv-check' }, [norm, h('span', { 'data-i18n': 'conv.normalize', text: t('conv.normalize') }), h('span', { class: 'conv-inline' }, [h('span', { 'data-i18n': 'conv.target', text: t('conv.target') }), target])]),
      h('label', { class: 'conv-check' }, [fx, h('span', { 'data-i18n': 'conv.effects', text: t('conv.effects') })]),
      h('p', { class: 'hint', id: 'convNote', 'data-i18n': 'conv.processedNote', text: t('conv.processedNote') }),
    );
    const bStart = h('button', { class: 'export-btn', id: 'convStart', 'data-i18n': 'conv.start', text: t('conv.start') });
    const bCancel = h('button', { class: 'small-btn dep-hidden', id: 'convCancel', 'data-i18n': 'conv.cancel', text: t('conv.cancel') });
    const track = h('div', { class: 'progress-track dep-hidden', id: 'convTrack' }, [h('div', { class: 'progress-fill', id: 'convFill' })]);
    panel.append(bStart, bCancel, track, h('p', { class: 'export-status', id: 'convStatus', role: 'status' }));
    root.append(panel);

    const syncVisibility = () => {
      const spec = C.FORMATS[formatSel.value];
      $('convDepthField').classList.toggle('dep-hidden', !spec.depths);
      depthSel.querySelector('option[value="32"]').hidden = formatSel.value !== 'wav';
      if (formatSel.value !== 'wav' && depthSel.value === '32') depthSel.value = '24';
      $('convBitrateField').classList.toggle('dep-hidden', !spec.bitrates || (formatSel.value === 'mp3' && modeSel.value === 'vbr'));
      $('convModeField').classList.toggle('dep-hidden', formatSel.value !== 'mp3');
      $('convVbrField').classList.toggle('dep-hidden', !(formatSel.value === 'mp3' && modeSel.value === 'vbr'));
      if (spec.bitrates && ![...bitrateSel.options].some((o) => +o.value === +bitrateSel.value)) bitrateSel.value = '192';
      const opusRates = new Set(spec.fixedRates || []);
      for (const o of rateSel.options) o.hidden = (spec.fixedRates && +o.value !== 0 && !opusRates.has(+o.value)) || (spec.maxRate && +o.value > spec.maxRate);
      if (rateSel.selectedOptions[0] && rateSel.selectedOptions[0].hidden) rateSel.value = spec.fixedRates ? '48000' : '0';
      const bitrates = spec.bitrates || [];
      for (const o of bitrateSel.options) o.hidden = bitrates.length > 0 && !bitrates.includes(+o.value);
      if (bitrates.length && !bitrates.includes(+bitrateSel.value)) bitrateSel.value = String(bitrates.includes(192) ? 192 : bitrates[Math.floor(bitrates.length / 2)]);
      $('convNote').classList.toggle('dep-hidden', !(norm.checked || fx.checked));
    };
    const syncOut = () => { outRow.classList.toggle('dep-hidden', outSel.value !== 'custom'); localStorage.setItem('waveframe.destMode', outSel.value); };
    outSel.addEventListener('change', syncOut); syncOut();
    outPick.addEventListener('click', async () => {
      const r = await api.chooseFolder();
      if (r && !r.canceled) { outPath.textContent = r.folderPath; localStorage.setItem('waveframe.destFolder', r.folderPath); }
    });
    btnPlaylist.addEventListener('click', () => addTracks());
    for (const el of [formatSel, modeSel, norm, fx]) el.addEventListener('change', syncVisibility);
    syncVisibility();

    btnAdd.addEventListener('click', async () => addPaths(await api.convPick()));
    btnClear.addEventListener('click', () => { if (!running) { files = []; renderList(); } });
    drop.addEventListener('click', async () => addPaths(await api.convPick()));
    drop.addEventListener('keydown', async (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addPaths(await api.convPick()); } });
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('over');
      addPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
    });
    bStart.addEventListener('click', start);
    bCancel.addEventListener('click', cancel);
    renderList();
  }

  function addTracks() {
    const list = typeof playlist !== 'undefined' ? playlist : [];
    for (const t0 of list) {
      if (!files.some((f) => f.track === t0)) files.push({ id: `c${Date.now().toString(36)}${++seq}`, kind: 'track', track: t0, name: t0.name || 'track', path: '', state: 'wait', pct: 0 });
    }
    renderList();
  }

  function addPaths(paths) {
    for (const p of paths || []) {
      if (typeof p === 'string' && !files.some((f) => f.path === p)) files.push({ id: `c${Date.now().toString(36)}${++seq}`, kind: 'file', path: p, name: p.split(/[\\/]/).pop(), state: 'wait', pct: 0 });
    }
    renderList();
  }

  function renderList() {
    const list = $('convList');
    if (!list) return;
    list.textContent = '';
    $('convDrop').classList.toggle('dep-hidden', files.length > 0);
    for (const f of files) {
      const status = f.state === 'failed' ? fmt(t('conv.st.failed'), { why: f.err || '' }) : t(`conv.st.${f.state === 'work' ? 'work' : f.state}`);
      const row = h('div', { class: `conv-row ${f.state}` }, [
        h('div', { class: 'conv-name', title: f.path || f.name, text: (f.kind === 'track' ? '\u266a ' : '') + f.name }),
        h('div', { class: 'conv-state', text: status + (f.note ? ` · ${f.note}` : '') }),
        h('div', { class: 'conv-bar' }, [h('div', { class: 'conv-bar-fill', id: `bar-${f.id}` })]),
      ]);
      if (f.state === 'done' && f.out) row.append(h('button', { class: 'small-btn', text: t('conv.reveal'), onclick: () => api.convReveal(f.out) }));
      else if (!running) row.append(h('button', { class: 'small-btn', text: t('conv.remove'), onclick: () => { files = files.filter((x) => x !== f); renderList(); } }));
      list.append(row);
      const bar = $(`bar-${f.id}`);
      if (bar) bar.style.width = `${Math.round((f.state === 'done' ? 1 : f.pct) * 100)}%`;
    }
  }

  let current = null, base = 0;
  function onProgress(p) {
    if (p.phase === 'ffmpeg') { $('convStatus').textContent = fmt(t('conv.ffmpegDownloading'), { n: Math.round((p.pct || 0) * 100) }); return; }
    if (!current || p.id !== current.id) return;
    current.pct = base + (1 - base) * p.pct;
    const bar = $(`bar-${current.id}`);
    if (bar) bar.style.width = `${Math.round(current.pct * 100)}%`;
  }

  function collect() {
    const ts = parseTime($('convTrimStart').value), te = parseTime($('convTrimEnd').value);
    const raw = {
      format: $('convFormat').value, depth: +$('convDepth').value, bitrate: +$('convBitrate').value, mode: $('convMode').value, vbrQuality: +$('convVbr').value,
      sampleRate: +$('convRate').value, channels: +$('convChannels').value, trimStart: ts, trimEnd: te,
      normalize: $('convNorm').checked, targetLufs: +$('convTarget').value, effects: $('convFx').checked, suffix: $('convSuffix').value,
    };
    save({ ...raw, trimStartText: $('convTrimStart').value, trimEndText: $('convTrimEnd').value });
    return raw;
  }

  async function start() {
    if (running) return;
    const status = $('convStatus');
    if (!files.length) { status.textContent = t('conv.needFiles'); return; }
    const v = C.validateOptions(collect());
    if (!v.ok) { status.textContent = fmt(t('conv.invalid'), { what: v.errors.join(', ') }); return; }
    const o = v.options;
    const warn = v.warnings.map((w) => t(w === 'rate-forced' ? 'conv.warn.rateForced' : 'conv.warn.rateClamped')).join(' ');
    let st = await api.convStatus();
    if (o.format !== 'wav' && !st.ffmpeg) {
      status.textContent = '';
      const r = await api.convEnsureFfmpeg();
      if (!r.ok) { status.textContent = r.declined ? t('conv.ffmpegDeclined') : fmt(t('conv.ffmpegFailed'), { why: r.error || '' }); return; }
      st = await api.convStatus();
    }
    if ($('convOut').value === 'custom' && !localStorage.getItem('waveframe.destFolder')) { status.textContent = t('conv.out.needFolder'); return; }
    for (const f of files) { f.state = 'wait'; f.pct = 0; f.err = ''; f.note = ''; f.out = ''; }
    $('convStart').classList.add('dep-hidden'); $('convCancel').classList.remove('dep-hidden'); $('convTrack').classList.remove('dep-hidden');
    status.textContent = warn;
    const queue = C.createQueue(files, async (item, qctx) => {
      current = item; base = 0; item.state = 'work'; renderList();
      const ctx = { outMode: $('convOut').value, outDir: localStorage.getItem('waveframe.destFolder') || '', ffmpeg: st.ffmpeg, cancelled: qctx.cancelled, report: (p) => { item.pct = p; qctx.report(p); const b = $(`bar-${item.id}`); if (b) b.style.width = `${Math.round(p * 100)}%`; }, setBase: (b) => { base = b; } };
      try {
        const r = await convertFile(item, o, ctx);
        item.state = 'done'; item.out = r.output;
        if (r.limited) item.note = fmt(t('conv.limited'), { lufs: Number.isFinite(r.lufs) ? r.lufs.toFixed(1) : '?' });
        return r;
      } catch (e) {
        item.state = e.code === 'cancelled' ? 'cancelled' : 'failed';
        item.err = ({ 'decode-failed': t('conv.err.decode'), 'no-audio': t('conv.err.noaudio'), trim: t('conv.err.trim') })[e.code] || e.message;
        throw e;
      } finally { renderList(); }
    }, (p) => { $('convFill').style.width = `${Math.round(p.overall * 100)}%`; });
    running = queue;
    const results = await queue.start();
    running = null; current = null;
    $('convStart').classList.remove('dep-hidden'); $('convCancel').classList.add('dep-hidden');
    const ok = results.filter((r) => r.status === 'done').length;
    status.textContent = fmt(t('conv.summary'), { ok, n: results.length }) + (warn ? ` ${warn}` : '');
    renderList();
  }

  function cancel() {
    if (!running) return;
    running.cancel();
    if (current) api.convCancel(current.id);
  }

  build();
  api.onConvProgress(onProgress);
  document.addEventListener('waveframe:language-changed', () => { if (!running) { if ($('convFormat')) collect(); build(); } });
  // addPaths / showRunning are exposed for the layout self-test (every language x zoom, with files in the list and while converting)
  function showRunning(on) { $('convStart').classList.toggle('dep-hidden', on); $('convCancel').classList.toggle('dep-hidden', !on); $('convTrack').classList.toggle('dep-hidden', !on); }
  window.WaveframeConverter = { processBuffer, convertFile, parseTime, decode, addPaths, showRunning, clearFiles: () => { files = []; renderList(); } };
})();

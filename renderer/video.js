'use strict';
// Video converter card (2.1.0, Opsis Media Suite step 1). Loaded together with the audio converter the first time the Export / Convert tab is
// opened and shown as its own card beside the audio card. The engine is ffmpeg in the main process (hardware encoders first, software as
// fallback); the browser's WebCodecs / MediaRecorder support is only DETECTED and reported. All paths come from main-process dialogs or
// dropped files and are re-validated there; this file never builds a command line.

(function () {
  const V = window.WaveframeVideo;
  const C = window.WaveframeConv;
  const api = window.waveframe;
  const KEY = 'waveframe.vid.opts';
  const $ = (id) => document.getElementById(id);
  let items = [];
  let running = null;
  let current = null;
  let encInfo = null;      // result of vid:encoders (null until asked, { ffmpeg:false } when no ffmpeg)
  let mode = 'video';      // video | gif | audio (set by presets)
  let subFile = '';
  let seq = 0;
  let listening = false;

  const h = (tag, props = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('aria-') || k === 'role') e.setAttribute(k, v); else e[k] = v; }
    for (const c of [].concat(kids)) if (c) e.append(c);
    return e;
  };
  const fmt = (s, vars) => Object.entries(vars || {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);
  const loadSaved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (_) { /* storage unavailable */ } };
  const sizeText = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1048576))} MB`);
  const clock = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const parseTime = (text) => { const s = String(text == null ? '' : text).trim().replace(',', '.'); if (!s) return 0; if (!/^\d+(\.\d+)?(:\d{1,2}(\.\d+)?){0,2}$/.test(s)) return NaN; return s.split(':').reduce((a, p) => a * 60 + parseFloat(p), 0); };

  function select(id, labelKey, options, value) {
    const sel = h('select', { id });
    for (const [v, label] of options) sel.append(h('option', { value: String(v), text: label }));
    sel.value = String(value);
    return h('div', { class: 'conv-field', id: `${id}Field` }, [h('label', { class: 'field-label', htmlFor: id, text: t(labelKey) }), sel]);
  }
  function input(id, labelKey, props) {
    return h('div', { class: 'conv-field', id: `${id}Field` }, [h('label', { class: 'field-label', htmlFor: id, text: t(labelKey) }), h('input', { id, ...props })]);
  }

  /* ---------------- build ---------------- */

  function build() {
    const cols = $('convCols');
    if (!cols) return;
    const old = $('vidPanel');
    const keepOpts = old ? collect() : null;
    if (old) old.remove();
    const s = { ...V.DEFAULTS, ...(keepOpts || loadSaved()) };
    mode = s.gif ? 'gif' : s.audioOnly ? 'audio' : 'video';
    subFile = s.subtitleFile || '';
    const outMode = localStorage.getItem('waveframe.vidDestMode') || 'default';
    const customDir = localStorage.getItem('waveframe.vidDestFolder') || '';

    const panel = h('section', { class: 'panel conv-panel vid-panel', id: 'vidPanel', 'aria-labelledby': 'vidTitle' });
    panel.append(h('h2', { id: 'vidTitle', text: t('vid.title') }), h('p', { class: 'hint', text: t('vid.hint') }));
    panel.append(h('div', { class: 'vid-enc', id: 'vidEnc', role: 'status', 'aria-live': 'polite' }));

    const drop = h('div', { class: 'conv-drop', id: 'vidDrop', tabIndex: 0, role: 'button', 'aria-label': t('vid.drop') }, [h('span', { text: t('vid.drop') })]);
    panel.append(drop, h('div', { class: 'conv-list', id: 'vidList' }),
      h('div', { class: 'settings-btn-row' }, [h('button', { class: 'small-btn', id: 'vidAdd', text: t('vid.add') }), h('button', { class: 'small-btn', id: 'vidClear', text: t('conv.clear') })]));

    panel.append(h('div', { class: 'conv-presets', id: 'vidPresets', role: 'group', 'aria-label': t('vid.preset') },
      Object.keys(V.PRESETS).map((k) => h('button', { class: 'small-btn', 'data-preset': k, 'aria-pressed': 'false', text: t(`vid.preset.${k}`) }))));

    const codecOpts = Object.keys(V.CODECS).map((k) => [k, V.CODECS[k].label]);
    const heights = [[0, t('vid.keep')], [2160, '2160p (4K)'], [1440, '1440p'], [1080, '1080p'], [720, '720p'], [480, '480p'], [360, '360p']];
    const fpsOpts = [[0, t('vid.keep')], [24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']];
    const audioCodecs = V.PRESETS && ['copy', 'aac', 'opus', 'mp3', 'flac'].map((k) => [k, t(`vid.audio.${k}`)]);
    panel.append(h('div', { class: 'conv-grid', id: 'vidGrid' }, [
      select('vidCodec', 'vid.codec', codecOpts, s.codec),
      select('vidContainer', 'vid.container', [['mp4', 'MP4'], ['mkv', 'MKV'], ['webm', 'WebM']], s.container),
      select('vidHeight', 'vid.height', heights, s.height),
      select('vidFps', 'vid.fps', fpsOpts, s.fps),
      select('vidRateMode', 'vid.rateMode', [['crf', t('vid.crfMode')], ['bitrate', t('vid.bitrateMode')]], s.rateMode),
      input('vidCrf', 'vid.crfValue', { type: 'number', min: 0, max: 63, step: 1, value: s.crf }),
      input('vidBitrate', 'vid.bitrate', { type: 'number', min: V.LIMITS.minBitrate, max: V.LIMITS.maxBitrate, step: 100, value: s.bitrate }),
      select('vidPasses', 'vid.passes', [[1, t('vid.pass1')], [2, t('vid.pass2')]], s.passes),
      select('vidSpeed', 'vid.speed', V.SPEEDS.map((k) => [k, t(`vid.speed.${k}`)]), s.speed),
      select('vidAudioCodec', 'vid.audio', audioCodecs, s.audioCodec),
      input('vidAudioBitrate', 'vid.audioBitrate', { type: 'number', min: 32, max: 512, step: 16, value: s.audioBitrate }),
      select('vidAudioTrack', 'vid.audioTrack', [[0, fmt(t('vid.track'), { n: 1 })]], s.audioTrack),
      select('vidAudioOnlyFormat', 'vid.audioOnlyFmt', [['m4a', 'AAC (M4A)'], ['mp3', 'MP3'], ['opus', 'Opus'], ['flac', 'FLAC']], s.audioOnlyFormat),
      select('vidSubtitle', 'vid.subtitle', [['none', t('vid.sub.none')], ['embed', t('vid.sub.embed')], ['burn', t('vid.sub.burn')]], s.subtitle),
      select('vidSubtitleTrack', 'vid.subtitleTrack', [[0, fmt(t('vid.track'), { n: 1 })]], s.subtitleTrack),
      input('vidTrimStart', 'conv.trimStart', { type: 'text', placeholder: '0:00', value: s.trimStartText || '' }),
      input('vidTrimEnd', 'conv.trimEnd', { type: 'text', value: s.trimEndText || '' }),
      input('vidSuffix', 'conv.suffix', { type: 'text', maxLength: 40, value: s.suffix }),
      select('vidOut', 'conv.out', [['default', t('vid.out.default')], ['source', t('conv.out.source')], ['custom', t('conv.out.custom')]], outMode),
    ]));
    panel.append(
      h('label', { class: 'conv-check' }, [h('input', { id: 'vidRemoveAudio', type: 'checkbox', checked: !!s.removeAudio }), h('span', { text: t('vid.removeAudio') })]),
      h('div', { class: 'conv-check vid-sub-row', id: 'vidSubFileRow' }, [h('button', { class: 'small-btn', id: 'vidSubFile', text: t('vid.subFile') }), h('span', { class: 'dest-path', id: 'vidSubFileName', text: subFile ? subFile.split(/[\\/]/).pop() : t('vid.subFileNone') })]),
      h('div', { class: 'dest-row', id: 'vidOutRow' }, [h('span', { class: 'dest-path', id: 'vidOutPath', text: customDir }), h('button', { class: 'small-btn', id: 'vidOutPick', text: t('conv.out.choose') })]),
      h('p', { class: 'hint vid-estimate', id: 'vidEstimate', role: 'status' }),
      h('button', { class: 'export-btn', id: 'vidStart', text: t('vid.start') }),
      h('button', { class: 'small-btn dep-hidden', id: 'vidCancel', text: t('conv.cancel') }),
      h('div', { class: 'progress-track dep-hidden', id: 'vidTrack', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': t('vid.title') }, [h('div', { class: 'progress-fill', id: 'vidFill' })]),
      h('p', { class: 'export-status', id: 'vidStatus', role: 'status' }),
    );
    cols.append(panel);
    wire();
    sync();
    renderList();
    renderEncoders();
    detectWeb();
    if (!encInfo) refreshEncoders();
  }

  /* ---------------- options <-> controls ---------------- */

  function collect() {
    const ts = parseTime($('vidTrimStart').value), te = parseTime($('vidTrimEnd').value);
    const raw = {
      codec: $('vidCodec').value, container: $('vidContainer').value, height: +$('vidHeight').value, fps: +$('vidFps').value,
      rateMode: $('vidRateMode').value, crf: +$('vidCrf').value, bitrate: +$('vidBitrate').value, passes: +$('vidPasses').value, speed: $('vidSpeed').value,
      audioCodec: $('vidAudioCodec').value, audioBitrate: +$('vidAudioBitrate').value, audioTrack: +$('vidAudioTrack').value,
      removeAudio: $('vidRemoveAudio').checked, subtitle: $('vidSubtitle').value, subtitleTrack: +$('vidSubtitleTrack').value, subtitleFile: subFile,
      trimStart: ts, trimEnd: te, audioOnly: mode === 'audio', audioOnlyFormat: $('vidAudioOnlyFormat').value, gif: mode === 'gif', suffix: $('vidSuffix').value,
    };
    save({ ...raw, trimStartText: $('vidTrimStart').value, trimEndText: $('vidTrimEnd').value });
    return raw;
  }

  function applyPreset(key) {
    const p = V.PRESETS[key];
    const o = { ...V.DEFAULTS, ...p };
    mode = p.gif ? 'gif' : p.audioOnly ? 'audio' : 'video';
    $('vidCodec').value = o.codec; $('vidContainer').value = o.container; $('vidHeight').value = String(o.height); $('vidFps').value = String(o.fps);
    $('vidRateMode').value = o.rateMode; $('vidCrf').value = o.crf; $('vidSpeed').value = o.speed; $('vidAudioCodec').value = o.audioCodec;
    $('vidAudioBitrate').value = o.audioBitrate; $('vidRemoveAudio').checked = !!o.removeAudio; $('vidAudioOnlyFormat').value = o.audioOnlyFormat;
    for (const b of document.querySelectorAll('#vidPresets button')) b.setAttribute('aria-pressed', String(b.dataset.preset === key));
    sync();
  }

  // shows only what applies, keeps values inside the ranges of the chosen codec, and refreshes the size estimate
  function sync() {
    const vid = mode === 'video', gif = mode === 'gif', aud = mode === 'audio';
    const codec = V.CODECS[$('vidCodec').value] || V.CODECS.h264;
    const cont = $('vidContainer');
    for (const o of cont.options) o.hidden = !codec.containers.includes(o.value);
    if (!codec.containers.includes(cont.value)) cont.value = codec.containers[0];
    const crf = $('vidCrf');
    crf.min = codec.crf[0]; crf.max = codec.crf[1];
    if (+crf.value > codec.crf[1] || +crf.value < codec.crf[0]) crf.value = Math.min(codec.crf[1], Math.max(codec.crf[0], codec.crfDefault));
    const rateBitrate = $('vidRateMode').value === 'bitrate';
    const best = encInfo && encInfo.summary && encInfo.summary[$('vidCodec').value] && encInfo.summary[$('vidCodec').value].best;
    const show = (id, on) => $(`${id}Field`).classList.toggle('dep-hidden', !on);
    for (const id of ['vidCodec', 'vidContainer', 'vidRateMode', 'vidSpeed', 'vidSubtitle']) show(id, vid);
    show('vidHeight', vid || gif); show('vidFps', vid || gif);
    show('vidCrf', vid && !rateBitrate); show('vidBitrate', vid && rateBitrate);
    show('vidPasses', vid && rateBitrate && (!best || V.canTwoPass(best) || (encInfo && encInfo.summary && V.CODECS[$('vidCodec').value].sw.some((e) => V.canTwoPass(e) && encInfo.encoders.includes(e)))));
    show('vidAudioCodec', vid && !$('vidRemoveAudio').checked);
    show('vidAudioBitrate', (vid && !$('vidRemoveAudio').checked && $('vidAudioCodec').value !== 'copy' && $('vidAudioCodec').value !== 'flac') || aud);
    show('vidAudioTrack', vid || aud); show('vidAudioOnlyFormat', aud);
    show('vidSubtitleTrack', vid && $('vidSubtitle').value !== 'none' && !subFile);
    $('vidRemoveAudio').closest('label').classList.toggle('dep-hidden', !vid);
    $('vidSubFileRow').classList.toggle('dep-hidden', !(vid && $('vidSubtitle').value === 'burn'));
    $('vidOutRow').classList.toggle('dep-hidden', $('vidOut').value !== 'custom');
    for (const b of document.querySelectorAll('#vidPresets button')) { /* aria-pressed is set by applyPreset */ }
    estimate();
  }

  function estimate() {
    const el = $('vidEstimate');
    const o = V.validateOptions(collect());
    if (!o.ok) { el.textContent = ''; return; }
    let total = 0;
    for (const it of items) if (it.info && it.info.duration) total += V.predictBytes({ duration: it.info.duration, width: it.info.video && it.info.video.width, height: it.info.video && it.info.video.height, fps: it.info.video && it.info.video.fps }, o.options);
    el.textContent = total > 0 ? fmt(t('vid.estimate'), { size: sizeText(total) }) : '';
  }

  function fillTracks() {
    const first = items.find((i) => i.info);
    const fillSel = (id, list, key) => {
      const sel = $(id), keep = sel.value;
      sel.textContent = '';
      const rows = list && list.length ? list : [{ index: 0, lang: '' }];
      for (const x of rows) sel.append(h('option', { value: String(x.index), text: x.lang ? fmt(t('vid.trackLang'), { n: x.index + 1, lang: x.lang }) : fmt(t('vid.track'), { n: x.index + 1 }) }));
      sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '0';
    };
    fillSel('vidAudioTrack', first && first.info.audio);
    fillSel('vidSubtitleTrack', first && first.info.subtitles);
  }

  /* ---------------- encoders ---------------- */

  async function refreshEncoders() {
    try { encInfo = await api.vidEncoders(); } catch (_) { encInfo = { ffmpeg: false }; }
    renderEncoders();
    if ($('vidCodec')) sync();
  }
  function renderEncoders() {
    const el = $('vidEnc');
    if (!el) return;
    el.textContent = '';
    if (!encInfo) { el.append(h('span', { text: t('conv.st.work') })); return; }
    if (!encInfo.ffmpeg) { el.append(h('span', { class: 'vid-warn', text: t('vid.enc.none') })); return; }
    const rows = [];
    for (const k of Object.keys(V.CODECS)) {
      const s = encInfo.summary[k];
      const text = s.best ? fmt(t('vid.enc.best'), { codec: V.CODECS[k].label, enc: s.best, hw: V.isHardware(s.best) ? ` (${t('vid.enc.gpu')})` : '' }) : fmt(t('vid.enc.nobest'), { codec: V.CODECS[k].label });
      rows.push(h('span', { class: 'vid-chip' + (s.best ? '' : ' none') + (s.best && V.isHardware(s.best) ? ' gpu' : ''), text }));
    }
    el.append(h('span', { class: 'vid-enc-title', text: t('vid.encoders') }), ...rows);
  }
  async function detectWeb() {
    const el = $('vidEnc');
    const parts = [];
    try {
      if (typeof VideoEncoder !== 'undefined') {
        for (const k of Object.keys(V.CODECS)) {
          try { const r = await VideoEncoder.isConfigSupported({ codec: V.CODECS[k].webCodec, width: 1280, height: 720, bitrate: 2000000, framerate: 30 }); parts.push(`${V.CODECS[k].label} ${r.supported ? '✓' : '✗'}`); } catch (_) { parts.push(`${V.CODECS[k].label} ✗`); }
        }
      }
      const mr = typeof MediaRecorder !== 'undefined' ? ['video/webm;codecs=vp9', 'video/webm;codecs=av1', 'video/mp4'].filter((m) => MediaRecorder.isTypeSupported(m)).map((m) => m.replace('video/', '').replace(';codecs=', ' ')) : [];
      if (!document.body.contains(el)) return;
      const line = h('div', { class: 'vid-web', text: `${t('vid.web')} ${parts.join(' · ') || '—'}${mr.length ? ` · MediaRecorder: ${mr.join(', ')}` : ''}` });
      const prev = el.querySelector('.vid-web'); if (prev) prev.remove();
      el.append(line);
    } catch (_) { /* detection is informational only */ }
  }

  /* ---------------- file list ---------------- */

  function addPaths(paths) {
    const added = [];
    for (const p of paths || []) {
      if (typeof p === 'string' && items.length < V.LIMITS.maxFiles && !items.some((f) => f.path === p)) {
        const it = { id: `v${Date.now().toString(36)}${++seq}`, path: p, name: p.split(/[\\/]/).pop(), state: 'wait', pct: 0, info: null, thumb: '' };
        items.push(it); added.push(it);
      }
    }
    renderList();
    for (const it of added) {
      api.vidProbe(it.path).then((info) => { if (info) { it.info = info; renderList(); fillTracks(); estimate(); } }).catch(() => {});
      api.vidThumb(it.path, 1).then((th) => { if (th) { it.thumb = th; renderList(); } }).catch(() => {});
    }
  }

  function renderList() {
    const list = $('vidList');
    if (!list) return;
    list.textContent = '';
    $('vidDrop').classList.toggle('dep-hidden', items.length > 0);
    for (const f of items) {
      const status = f.state === 'failed' ? fmt(t('conv.st.failed'), { why: f.err || '' }) : t(`conv.st.${f.state}`);
      const meta = f.info ? [f.info.video ? `${f.info.video.width}×${f.info.video.height}` : '', f.info.video ? f.info.video.codec : '', clock(f.info.duration)].filter(Boolean).join(' · ') : '';
      const thumb = f.thumb ? h('img', { class: 'vid-thumb', src: f.thumb, alt: '' }) : h('div', { class: 'vid-thumb vid-thumb-empty', 'aria-hidden': 'true', text: '🎞' });
      const row = h('div', { class: `conv-row vid-row ${f.state}` }, [
        thumb,
        h('div', { class: 'vid-info' }, [h('div', { class: 'conv-name', title: f.path, text: f.name }), h('div', { class: 'vid-meta', text: meta })]),
        h('div', { class: 'conv-state', text: status + (f.note ? ` · ${f.note}` : '') }),
        h('div', { class: 'conv-bar' }, [h('div', { class: 'conv-bar-fill', id: `vbar-${f.id}` })]),
      ]);
      if (f.state === 'done' && f.out) row.append(h('button', { class: 'small-btn', text: t('conv.reveal'), onclick: () => api.convReveal(f.out) }));
      else if (!running) row.append(h('button', { class: 'small-btn', text: t('conv.remove'), onclick: () => { items = items.filter((x) => x !== f); renderList(); fillTracks(); estimate(); } }));
      list.append(row);
      const bar = $(`vbar-${f.id}`);
      if (bar) bar.style.width = `${Math.round((f.state === 'done' ? 1 : f.pct) * 100)}%`;
    }
  }

  /* ---------------- run ---------------- */

  function onProgress(p) {
    if (!current || p.id !== current.id) return;
    current.pct = Math.max(0, Math.min(1, p.pct));
    const bar = $(`vbar-${current.id}`);
    if (bar) bar.style.width = `${Math.round(current.pct * 100)}%`;
  }

  async function start() {
    if (running) return;
    const status = $('vidStatus');
    if (!items.length) { status.textContent = t('conv.needFiles'); return; }
    const v = V.validateOptions(collect());
    if (!v.ok) { status.textContent = fmt(t('conv.invalid'), { what: v.errors.join(', ') }); return; }
    if ($('vidOut').value === 'custom' && !localStorage.getItem('waveframe.vidDestFolder')) { status.textContent = t('conv.out.needFolder'); return; }
    const st = await api.convStatus();
    if (!st.ffmpeg) {
      const r = await api.convEnsureFfmpeg();
      if (!r.ok) { status.textContent = r.declined ? t('vid.ffmpegNeeded') : fmt(t('conv.ffmpegFailed'), { why: r.error || '' }); return; }
      await refreshEncoders();
    } else if (!encInfo || !encInfo.ffmpeg) await refreshEncoders();
    const needsEncoder = mode === 'video';
    if (needsEncoder && encInfo && encInfo.summary && !encInfo.summary[v.options.codec].best) { status.textContent = fmt(t('vid.err.noEncoder'), { codec: V.CODECS[v.options.codec].label }); return; }
    for (const f of items) { f.state = 'wait'; f.pct = 0; f.err = ''; f.note = ''; f.out = ''; }
    $('vidStart').classList.add('dep-hidden'); $('vidCancel').classList.remove('dep-hidden'); $('vidTrack').classList.remove('dep-hidden');
    status.textContent = '';
    const outMode = $('vidOut').value, outDir = localStorage.getItem('waveframe.vidDestFolder') || '';
    const queue = C.createQueue(items, async (item) => {
      current = item; item.state = 'work'; renderList();
      try {
        const r = await api.vidEncode({ id: item.id, path: item.path, options: v.options, outMode, outDir });
        if (!r.ok) throw Object.assign(new Error(r.error || r.code), { code: r.code });
        item.state = 'done'; item.out = r.output;
        if (r.fellBackFrom && r.encoder) item.note = fmt(t('vid.hwFallback'), { from: r.fellBackFrom, to: r.encoder });
        else if (r.encoder && V.isHardware(r.encoder)) item.note = fmt(t('vid.hwUsed'), { enc: r.encoder });
        return r;
      } catch (e) {
        item.state = e.code === 'cancelled' ? 'cancelled' : 'failed';
        item.err = ({ 'no-video': t('vid.err.noVideo'), 'no-audio': t('conv.err.noaudio'), 'no-encoder': fmt(t('vid.err.noEncoder'), { codec: V.CODECS[v.options.codec].label }) })[e.code] || e.message;
        throw e;
      } finally { renderList(); }
    }, (p) => { const pct = Math.round(p.overall * 100); $('vidFill').style.width = `${pct}%`; $('vidTrack').setAttribute('aria-valuenow', String(pct)); });
    running = queue;
    const results = await queue.start();
    running = null; current = null;
    $('vidStart').classList.remove('dep-hidden'); $('vidCancel').classList.add('dep-hidden');
    status.textContent = fmt(t('conv.summary'), { ok: results.filter((r) => r.status === 'done').length, n: results.length });
    renderList();
  }

  function cancel() {
    if (!running) return;
    running.cancel();
    if (current) api.convCancel(current.id); // same cancel channel as the audio converter: kills ffmpeg and removes the partial file
  }

  /* ---------------- wiring ---------------- */

  function wire() {
    $('vidAdd').addEventListener('click', async () => addPaths(await api.vidPick('video')));
    $('vidDrop').addEventListener('click', async () => addPaths(await api.vidPick('video')));
    $('vidDrop').addEventListener('keydown', async (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addPaths(await api.vidPick('video')); } });
    for (const ev of ['dragenter', 'dragover']) $('vidDrop').addEventListener(ev, (e) => { e.preventDefault(); $('vidDrop').classList.add('over'); });
    $('vidDrop').addEventListener('dragleave', () => $('vidDrop').classList.remove('over'));
    $('vidDrop').addEventListener('drop', (e) => { e.preventDefault(); $('vidDrop').classList.remove('over'); addPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)); });
    $('vidClear').addEventListener('click', () => { if (!running) { items = []; renderList(); fillTracks(); estimate(); } });
    $('vidPresets').addEventListener('click', (e) => { const b = e.target.closest('button[data-preset]'); if (b) applyPreset(b.dataset.preset); });
    for (const id of ['vidCodec', 'vidContainer', 'vidHeight', 'vidFps', 'vidRateMode', 'vidCrf', 'vidBitrate', 'vidPasses', 'vidSpeed', 'vidAudioCodec', 'vidAudioBitrate', 'vidAudioTrack', 'vidAudioOnlyFormat', 'vidSubtitle', 'vidSubtitleTrack', 'vidTrimStart', 'vidTrimEnd', 'vidRemoveAudio']) {
      $(id).addEventListener('change', sync);
      if ($(id).tagName === 'INPUT') $(id).addEventListener('input', estimate);
    }
    $('vidOut').addEventListener('change', () => { localStorage.setItem('waveframe.vidDestMode', $('vidOut').value); sync(); });
    $('vidOutPick').addEventListener('click', async () => {
      const r = await api.chooseFolder();
      if (r && !r.canceled) { $('vidOutPath').textContent = r.folderPath; localStorage.setItem('waveframe.vidDestFolder', r.folderPath); }
    });
    $('vidSubFile').addEventListener('click', async () => {
      const r = await api.vidPick('subtitle');
      if (r && r[0]) { subFile = r[0]; $('vidSubFileName').textContent = subFile.split(/[\\/]/).pop(); sync(); }
    });
    $('vidStart').addEventListener('click', start);
    $('vidCancel').addEventListener('click', cancel);
    if (!listening) { listening = true; api.onConvProgress(onProgress); }
  }

  document.addEventListener('waveframe:converter-built', () => { if (!running) build(); });
  build();
  // exposed for the layout self-test (every language x zoom) and the unit-level checks
  window.WaveframeVideoUi = { addPaths, clearItems: () => { items = []; renderList(); }, showRunning: (on) => { $('vidStart').classList.toggle('dep-hidden', on); $('vidCancel').classList.toggle('dep-hidden', !on); $('vidTrack').classList.toggle('dep-hidden', !on); }, applyPreset, collect, getEncInfo: () => encInfo };
})();

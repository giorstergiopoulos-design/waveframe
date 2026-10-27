'use strict';
// Pure logic of the audio converter (1.8.0): option validation, output naming, WAV writer, LUFS-target gain,
// ffmpeg argument building and the batch queue with progress/cancel. UMD: loaded lazily by the renderer when the
// converter tab is first opened (window.WaveframeConv) and required by the main process and the unit tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveframeConv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RATES = [0, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
  const LOSSY_RATES = [64, 96, 128, 160, 192, 224, 256, 320];

  // muxer = ffmpeg -f name; maxRate = hard limit of the encoder; fixedRates = the only rates the encoder accepts.
  const FORMATS = {
    wav: { ext: 'wav', muxer: 'wav', lossless: true, depths: [16, 24, 32] },
    flac: { ext: 'flac', muxer: 'flac', lossless: true, depths: [16, 24] },
    mp3: { ext: 'mp3', muxer: 'mp3', bitrates: LOSSY_RATES, maxRate: 48000, modes: ['cbr', 'vbr'] },
    aac: { ext: 'm4a', muxer: 'ipod', bitrates: [64, 96, 128, 160, 192, 256, 320] },
    ogg: { ext: 'ogg', muxer: 'ogg', bitrates: [64, 96, 128, 160, 192, 256, 320] },
    opus: { ext: 'opus', muxer: 'opus', bitrates: [24, 32, 48, 64, 96, 128, 160, 192, 256], fixedRates: [8000, 12000, 16000, 24000, 48000] },
    aiff: { ext: 'aiff', muxer: 'aiff', lossless: true, depths: [16, 24] },
    alac: { ext: 'm4a', muxer: 'ipod', lossless: true, depths: [16, 24] },
    wma: { ext: 'wma', muxer: 'asf', bitrates: [64, 96, 128, 160, 192, 256, 320], maxRate: 48000 },
  };

  const DEFAULTS = { format: 'mp3', bitrate: 192, mode: 'cbr', vbrQuality: 2, depth: 16, sampleRate: 0, channels: 0, trimStart: 0, trimEnd: 0, normalize: false, targetLufs: -16, effects: false, suffix: '-converted' };

  function sanitizeSuffix(s) {
    return String(s == null ? '' : s).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/[. ]+$/, '').slice(0, 40);
  }

  // Returns { ok, options, errors: [code], warnings: [code] }. Never throws; options is only meaningful when ok.
  function validateOptions(raw) {
    const o = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    const errors = [], warnings = [];
    const spec = FORMATS[o.format];
    if (!spec) return { ok: false, options: o, errors: ['format'], warnings };
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    o.sampleRate = num(o.sampleRate); o.channels = num(o.channels); o.bitrate = num(o.bitrate); o.depth = num(o.depth);
    o.vbrQuality = num(o.vbrQuality); o.trimStart = num(o.trimStart); o.trimEnd = num(o.trimEnd); o.targetLufs = num(o.targetLufs);
    o.normalize = o.normalize === true; o.effects = o.effects === true;

    if (!RATES.includes(o.sampleRate)) errors.push('sampleRate');
    else if (spec.fixedRates && !spec.fixedRates.includes(o.sampleRate)) { o.sampleRate = 48000; warnings.push('rate-forced'); }
    else if (spec.maxRate && o.sampleRate > spec.maxRate) { o.sampleRate = spec.maxRate; warnings.push('rate-clamped'); }
    if (![0, 1, 2].includes(o.channels)) errors.push('channels');
    if (spec.bitrates) {
      if (o.format === 'mp3' && !spec.modes.includes(o.mode)) errors.push('mode');
      if (o.format === 'mp3' && o.mode === 'vbr') { if (!(Number.isInteger(o.vbrQuality) && o.vbrQuality >= 0 && o.vbrQuality <= 9)) errors.push('vbrQuality'); }
      else if (!spec.bitrates.includes(o.bitrate)) errors.push('bitrate');
    }
    if (spec.depths && !spec.depths.includes(o.depth)) errors.push('depth');
    if (!(o.trimStart >= 0) || !(o.trimEnd >= 0) || (o.trimEnd > 0 && o.trimEnd <= o.trimStart) || o.trimStart > 360000 || o.trimEnd > 360000) errors.push('trim');
    if (!(o.targetLufs >= -40 && o.targetLufs <= -5)) errors.push('lufs');
    o.suffix = sanitizeSuffix(o.suffix) || DEFAULTS.suffix;
    return { ok: errors.length === 0, options: o, errors, warnings };
  }

  /* ---------- output naming: next to the original, never the original itself, never an existing file ---------- */

  // pathApi: node's path.win32 / path.posix (injected so the same code runs in tests); exists(p) -> boolean.
  function buildOutputPath({ inputPath, ext, suffix, pathApi, exists, dir }) {
    const p = pathApi;
    const parsed = p.parse(inputPath);
    const outDir = dir || parsed.dir;
    const norm = (x) => p.resolve(x).toLowerCase();
    const base = parsed.name + sanitizeSuffix(suffix);
    for (let n = 0; n < 10000; n++) {
      const name = n === 0 ? base : `${base} (${n})`;
      const candidate = p.join(outDir, `${name}.${ext}`);
      if (norm(candidate) !== norm(inputPath) && !exists(candidate)) return candidate;
    }
    throw new Error('no free output name');
  }

  /* ---------- loudness-target gain ---------- */

  // Gain (dB) that moves a track measured at `lufs` to `target`; silence / too-short material (non-finite) gets 0.
  function targetGainDb(lufs, target, { maxBoost = 24, maxCut = -60 } = {}) {
    if (!Number.isFinite(lufs)) return 0;
    return Math.max(maxCut, Math.min(maxBoost, target - lufs));
  }
  // Never let the gain push the sample peak above ceilingDb (default -1 dBFS): returns the gain actually applied.
  function peakSafeGainDb(gainDb, peakLinear, ceilingDb = -1) {
    if (!(peakLinear > 0)) return { gainDb, limited: false };
    const allowed = ceilingDb - 20 * Math.log10(peakLinear);
    return gainDb > allowed ? { gainDb: allowed, limited: true } : { gainDb, limited: false };
  }

  /* ---------- WAV writer / reader (pure JS, 16/24-bit PCM and 32-bit float) ---------- */

  function writeWav(channels, sampleRate, depth) {
    const nch = channels.length, frames = nch ? channels[0].length : 0;
    const bytes = depth === 32 ? 4 : depth === 24 ? 3 : 2;
    const block = nch * bytes, dataSize = frames * block;
    const out = new ArrayBuffer(44 + dataSize), v = new DataView(out);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, depth === 32 ? 3 : 1, true); v.setUint16(22, nch, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * block, true); v.setUint16(32, block, true); v.setUint16(34, bytes * 8, true);
    str(36, 'data'); v.setUint32(40, dataSize, true);
    let o = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < nch; c++) {
        const x = channels[c][i];
        if (depth === 32) { v.setFloat32(o, x, true); }
        else {
          const s = x > 1 ? 1 : x < -1 ? -1 : x;
          if (depth === 24) { const n = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, n & 255); v.setUint8(o + 1, (n >> 8) & 255); v.setUint8(o + 2, (n >> 16) & 255); }
          else v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
        }
        o += bytes;
      }
    }
    return out;
  }

  function readWav(buf) {
    const v = new DataView(buf);
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    let o = 12, fmt = null, data = null;
    while (o + 8 <= buf.byteLength) {
      const id = tag(o), size = v.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
      else if (id === 'data') { data = { at: o + 8, size: Math.min(size, buf.byteLength - o - 8) }; break; }
      o += 8 + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('bad WAV');
    const bytes = fmt.bits / 8, frames = Math.floor(data.size / (bytes * fmt.channels));
    const samples = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
    let p = data.at;
    for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) {
      let x;
      if (fmt.format === 3) x = v.getFloat32(p, true);
      else if (fmt.bits === 24) { let n = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16); if (n & 0x800000) n -= 0x1000000; x = n / 0x800000; }
      else x = v.getInt16(p, true) / 0x8000;
      samples[c][i] = x; p += bytes;
    }
    return { ...fmt, frames, samples };
  }

  // Maps decoded channel arrays to 1 or 2 channels (0 = keep). Mono <- average of all; stereo <- duplicated mono, or the first two (front L/R) of a multichannel source.
  function mapChannels(chs, target) {
    if (!target || chs.length === target) return chs;
    if (target === 1) { const n = chs[0].length, out = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < chs.length; c++) s += chs[c][i]; out[i] = s / chs.length; } return [out]; }
    return chs.length === 1 ? [chs[0], chs[0]] : [chs[0], chs[1]];
  }

  /* ---------- ffmpeg arguments ---------- */

  function codecArgs(o) {
    switch (o.format) {
      case 'wav': return ['-c:a', o.depth === 32 ? 'pcm_f32le' : o.depth === 24 ? 'pcm_s24le' : 'pcm_s16le'];
      case 'flac': return ['-c:a', 'flac', '-compression_level', '8', ...(o.depth === 24 ? ['-sample_fmt', 's32', '-bits_per_raw_sample', '24'] : ['-sample_fmt', 's16'])];
      case 'mp3': return ['-c:a', 'libmp3lame', ...(o.mode === 'vbr' ? ['-q:a', String(o.vbrQuality)] : ['-b:a', `${o.bitrate}k`])];
      case 'aac': return ['-c:a', 'aac', '-b:a', `${o.bitrate}k`];
      case 'ogg': return ['-c:a', 'libvorbis', '-b:a', `${o.bitrate}k`];
      case 'opus': return ['-c:a', 'libopus', '-b:a', `${o.bitrate}k`, '-vbr', 'on'];
      case 'aiff': return ['-c:a', o.depth === 24 ? 'pcm_s24be' : 'pcm_s16be'];
      case 'alac': return ['-c:a', 'alac', ...(o.depth === 24 ? ['-sample_fmt', 's32p', '-bits_per_raw_sample', '24'] : ['-sample_fmt', 's16p'])];
      case 'wma': return ['-c:a', 'wmav2', '-b:a', `${o.bitrate}k`];
      default: throw new Error('format');
    }
  }

  // mode 'direct': ffmpeg decodes the original (any audio, or the first audio track of a video) and applies trim / rate / channels.
  // mode 'encode': the input is the already processed WAV from the renderer (trim, rate, channels, effects, gain are done), only the codec runs.
  function buildFfmpegArgs({ input, output, options, mode }) {
    const o = options, spec = FORMATS[o.format];
    const a = ['-hide_banner', '-nostdin', '-y', '-i', input];
    if (mode === 'direct') {
      if (o.trimStart > 0) a.push('-ss', String(o.trimStart));
      if (o.trimEnd > 0) a.push('-t', String(o.trimEnd - o.trimStart));
      a.push('-vn', '-map', '0:a:0');
      const rate = o.format === 'opus' && !o.sampleRate ? 48000 : o.sampleRate;
      if (rate > 0) a.push('-ar', String(rate));
      if (o.channels > 0) a.push('-ac', String(o.channels));
    } else if (o.format === 'opus') a.push('-ar', '48000');
    a.push(...codecArgs(o), '-f', spec.muxer, output);
    return a;
  }

  // "time=00:01:02.50" -> seconds of the LAST progress stamp in a stderr chunk (null when none).
  function parseFfmpegTime(text) {
    const all = [...String(text).matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    if (!all.length) return null;
    const m = all[all.length - 1];
    return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
  }
  // Parses the banner `ffmpeg -i file` prints: { duration, sampleRate, channels, codec, hasAudio }.
  function parseProbe(text) {
    const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    const a = /Stream #[^\n]*Audio:\s*([A-Za-z0-9_]+)[^\n]*?,\s*(\d+) Hz,\s*([^,\n]+)/.exec(text);
    const layout = a ? a[3].trim() : '';
    const channels = /^mono/.test(layout) ? 1 : /^stereo/.test(layout) ? 2 : /^(\d+) channels/.test(layout) ? +/^(\d+)/.exec(layout)[1] : /^5\.1/.test(layout) ? 6 : /^7\.1/.test(layout) ? 8 : a ? 2 : 0;
    return { duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0, sampleRate: a ? +a[2] : 0, channels, codec: a ? a[1] : '', hasAudio: !!a };
  }

  /* ---------- batch queue: sequential, overall progress, cancel ---------- */

  // run(item, { report(pct 0..1), cancelled() }) -> Promise<any>. Resolves to [{ item, status: done|error|cancelled, result?, error? }].
  function createQueue(items, run, onProgress) {
    let cancelled = false;
    const results = [];
    const notify = (i, pct) => { if (onProgress) onProgress({ index: i, itemPct: pct, overall: items.length ? (i + pct) / items.length : 1 }); };
    return {
      cancel() { cancelled = true; },
      get isCancelled() { return cancelled; },
      async start() {
        for (let i = 0; i < items.length; i++) {
          if (cancelled) { results.push({ item: items[i], status: 'cancelled' }); continue; }
          notify(i, 0);
          try {
            const result = await run(items[i], { report: (p) => notify(i, Math.max(0, Math.min(1, p))), cancelled: () => cancelled });
            results.push(cancelled ? { item: items[i], status: 'cancelled' } : { item: items[i], status: 'done', result });
          } catch (e) { results.push({ item: items[i], status: cancelled ? 'cancelled' : 'error', error: e && e.message || String(e) }); }
          notify(i, 1);
        }
        return results;
      },
    };
  }

  return { RATES, FORMATS, DEFAULTS, sanitizeSuffix, validateOptions, buildOutputPath, targetGainDb, peakSafeGainDb, mapChannels, writeWav, readWav, buildFfmpegArgs, parseFfmpegTime, parseProbe, createQueue };
});

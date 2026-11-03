'use strict';
// Pure logic of the video encoder (2.1.0, Opsis Media Suite step 1): presets, option validation, ffmpeg argument building (always an
// ARRAY, never a shell string), encoder detection/selection, size prediction and probe parsing. UMD like convlib.js: loaded lazily by the
// renderer (window.WaveframeVideo), required by the main process and the unit tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveframeVideo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // software encoders first are NOT preferred: hardware (if listed) comes first, then software; the engine retries the next one on failure.
  const CODECS = {
    h264: { label: 'H.264', hw: ['h264_nvenc', 'h264_qsv', 'h264_amf'], sw: ['libx264', 'libopenh264'], containers: ['mp4', 'mkv'], crf: [0, 51], crfDefault: 21, webCodec: 'avc1.42001f' },
    h265: { label: 'H.265 / HEVC', hw: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf'], sw: ['libx265'], containers: ['mp4', 'mkv'], crf: [0, 51], crfDefault: 24, webCodec: 'hvc1.1.6.L93.B0' },
    vp9: { label: 'VP9', hw: [], sw: ['libvpx-vp9'], containers: ['webm', 'mkv'], crf: [0, 63], crfDefault: 32, webCodec: 'vp09.00.10.08' },
    av1: { label: 'AV1', hw: ['av1_nvenc', 'av1_qsv', 'av1_amf'], sw: ['libsvtav1', 'libaom-av1'], containers: ['mp4', 'mkv', 'webm'], crf: [0, 63], crfDefault: 30, webCodec: 'av01.0.04M.08' },
  };
  const SPEEDS = ['veryfast', 'fast', 'medium', 'slow', 'veryslow'];
  const AUDIO_CODECS = ['copy', 'aac', 'opus', 'mp3', 'flac'];
  const AUDIO_ONLY = { m4a: { codec: 'aac', ext: 'm4a', muxer: 'ipod' }, mp3: { codec: 'libmp3lame', ext: 'mp3', muxer: 'mp3' }, opus: { codec: 'libopus', ext: 'opus', muxer: 'opus' }, flac: { codec: 'flac', ext: 'flac', muxer: 'flac' } };
  const MUXERS = { mp4: 'mp4', mkv: 'matroska', webm: 'webm' };
  const LIMITS = { maxHeight: 4320, maxFps: 240, minBitrate: 100, maxBitrate: 200000, maxFiles: 200, maxTrack: 31 };

  const DEFAULTS = {
    preset: 'youtube1080', codec: 'h264', container: 'mp4', height: 1080, fps: 0, rateMode: 'crf', crf: 21, bitrate: 8000, passes: 1, speed: 'medium',
    audioCodec: 'aac', audioBitrate: 192, audioTrack: 0, removeAudio: false, subtitle: 'none', subtitleFile: '', subtitleTrack: 0,
    trimStart: 0, trimEnd: 0, audioOnly: false, audioOnlyFormat: 'm4a', gif: false, suffix: '-video',
  };

  // The preset table of the UI (YouTube, web, archive, device, GIF/WebM, audio-only extraction). A preset only fills option fields.
  const PRESETS = {
    youtube1080: { codec: 'h264', container: 'mp4', height: 1080, rateMode: 'crf', crf: 18, speed: 'slow', audioCodec: 'aac', audioBitrate: 192 },
    youtube4k: { codec: 'h264', container: 'mp4', height: 2160, rateMode: 'crf', crf: 18, speed: 'slow', audioCodec: 'aac', audioBitrate: 256 },
    webSmall: { codec: 'h264', container: 'mp4', height: 720, rateMode: 'crf', crf: 26, speed: 'medium', audioCodec: 'aac', audioBitrate: 128 },
    archiveH265: { codec: 'h265', container: 'mkv', height: 0, rateMode: 'crf', crf: 22, speed: 'slow', audioCodec: 'copy', audioBitrate: 192 },
    device: { codec: 'h264', container: 'mp4', height: 720, fps: 30, rateMode: 'crf', crf: 23, speed: 'medium', audioCodec: 'aac', audioBitrate: 128 },
    webm: { codec: 'vp9', container: 'webm', height: 720, rateMode: 'crf', crf: 32, speed: 'medium', audioCodec: 'opus', audioBitrate: 96 },
    gif: { gif: true, codec: 'h264', container: 'mp4', height: 480, fps: 12, removeAudio: true },
    audioOnly: { audioOnly: true, audioOnlyFormat: 'm4a', audioBitrate: 192 },
  };

  const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

  function sanitizeSuffix(s) { return String(s == null ? '' : s).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/[. ]+$/, '').slice(0, 40); }

  // Burn-in subtitles use a filter option that contains a path: only plain, existing-looking absolute Windows paths without filter metacharacters.
  function validSubtitlePath(p) { return typeof p === 'string' && /^[A-Za-z]:[\\/]/.test(p) && p.length < 260 && !/['"\n\r\x00%`$]/.test(p) && /\.(srt|ass|ssa|vtt|sub)$/i.test(p); }
  // The path goes into a filter option inside single quotes (validSubtitlePath already rejects quotes): inside quotes only the drive-letter colon
  // needs a backslash, and backslashes of Windows paths become forward slashes. Wrapped in quotes by quoteFilterPath.
  function escapeFilterPath(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:'); }
  const quoteFilterPath = (p) => `'${escapeFilterPath(p)}'`;

  // Returns { ok, options, errors:[code], warnings:[code] }. Never throws.
  function validateOptions(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const base = { ...DEFAULTS, ...(PRESETS[r.preset] || {}) };
    const o = { ...base, ...r };
    const errors = [], warnings = [];
    if (!CODECS[o.codec]) errors.push('codec');
    else if (!CODECS[o.codec].containers.includes(o.container)) { o.container = CODECS[o.codec].containers[0]; warnings.push('container-changed'); }
    for (const k of ['height', 'fps', 'crf', 'bitrate', 'passes', 'audioBitrate', 'audioTrack', 'subtitleTrack']) o[k] = int(o[k]);
    o.trimStart = num(o.trimStart); o.trimEnd = num(o.trimEnd);
    if (!(o.height === 0 || (o.height >= 144 && o.height <= LIMITS.maxHeight))) errors.push('height');
    if (!(o.fps === 0 || (o.fps >= 1 && o.fps <= LIMITS.maxFps))) errors.push('fps');
    if (!['crf', 'bitrate'].includes(o.rateMode)) errors.push('rateMode');
    if (CODECS[o.codec] && !(o.crf >= CODECS[o.codec].crf[0] && o.crf <= CODECS[o.codec].crf[1])) errors.push('crf');
    if (!(o.bitrate >= LIMITS.minBitrate && o.bitrate <= LIMITS.maxBitrate)) errors.push('bitrate');
    if (![1, 2].includes(o.passes)) errors.push('passes');
    if (!SPEEDS.includes(o.speed)) errors.push('speed');
    if (!AUDIO_CODECS.includes(o.audioCodec)) errors.push('audioCodec');
    if (!(o.audioBitrate >= 32 && o.audioBitrate <= 512)) errors.push('audioBitrate');
    if (!(o.audioTrack >= 0 && o.audioTrack <= LIMITS.maxTrack)) errors.push('audioTrack');
    if (!['none', 'embed', 'burn'].includes(o.subtitle)) errors.push('subtitle');
    if (!(o.subtitleTrack >= 0 && o.subtitleTrack <= LIMITS.maxTrack)) errors.push('subtitleTrack');
    if (o.subtitleFile && !validSubtitlePath(o.subtitleFile)) errors.push('subtitleFile');
    if (!(o.trimStart >= 0) || !(o.trimEnd >= 0) || (o.trimEnd > 0 && o.trimEnd <= o.trimStart) || o.trimStart > 360000 || o.trimEnd > 360000) errors.push('trim');
    o.removeAudio = o.removeAudio === true; o.audioOnly = o.audioOnly === true; o.gif = o.gif === true;
    if (!AUDIO_ONLY[o.audioOnlyFormat]) errors.push('audioOnlyFormat');
    o.suffix = sanitizeSuffix(o.suffix) || DEFAULTS.suffix;
    // two passes only make sense for a target bitrate and for encoders that support -pass (libx264, VP9, libaom)
    if (o.passes === 2 && o.rateMode !== 'bitrate') { o.passes = 1; warnings.push('passes-needs-bitrate'); }
    if (o.subtitle === 'embed' && o.container === 'mp4' && o.subtitleFile) { warnings.push('embed-uses-track'); }
    if (o.gif || o.audioOnly) o.passes = 1;
    return { ok: errors.length === 0, options: o, errors, warnings };
  }

  /* ---------- encoder detection and choice ---------- */

  // `ffmpeg -encoders` lists encoders as " V....D libx264   libx264 H.264 ..." -> Set of video encoder names
  function parseEncoders(text) {
    const set = new Set();
    for (const line of String(text).split(/\r?\n/)) {
      const m = /^\s*V[.A-Z]{5}\s+(\S+)/.exec(line);
      if (m) set.add(m[1]);
    }
    return set;
  }
  // `ffmpeg -hwaccels` prints a header and one accelerator per line ("cuda", "qsv", "d3d11va", ...)
  function parseHwaccels(text) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => /^Hardware acceleration methods/i.test(l));
    return (i >= 0 ? lines.slice(i + 1) : []).filter((l) => /^[a-z0-9_]+$/i.test(l));
  }

  // Candidate encoders for a codec, best first: hardware (when listed) then software. `available` is a Set of encoder names.
  function encoderOrder(codec, available, { preferHardware = true } = {}) {
    const c = CODECS[codec];
    if (!c) return [];
    const hw = c.hw.filter((e) => available.has(e)), sw = c.sw.filter((e) => available.has(e));
    return preferHardware ? [...hw, ...sw] : [...sw, ...hw];
  }
  const isHardware = (enc) => /_(nvenc|qsv|amf)$/.test(enc);
  // For the UI: what exists per codec and which one is chosen automatically.
  function summarize(available) {
    const out = {};
    for (const k of Object.keys(CODECS)) {
      const order = encoderOrder(k, available);
      out[k] = { best: order[0] || null, hardware: order.filter(isHardware), software: order.filter((e) => !isHardware(e)), missing: [...CODECS[k].hw, ...CODECS[k].sw].filter((e) => !available.has(e)) };
    }
    return out;
  }

  /* ---------- ffmpeg arguments ---------- */

  // The LGPL ffmpeg that Waveframe downloads has NO libx264/libx265 (GPL): its software H.264 is libopenh264 (bitrate only), H.265 is hardware only.
  const NO_CRF = (enc) => enc === 'libopenh264';

  function speedFor(enc, speed) {
    if (enc === 'libopenh264') return [];
    const i = SPEEDS.indexOf(speed);
    if (/_nvenc$/.test(enc)) return ['-preset', ['p2', 'p3', 'p4', 'p5', 'p7'][i]];
    if (/_qsv$/.test(enc)) return ['-preset', speed];
    if (/_amf$/.test(enc)) return ['-quality', ['speed', 'speed', 'balanced', 'quality', 'quality'][i]];
    if (enc === 'libvpx-vp9') return ['-cpu-used', String([5, 4, 3, 2, 1][i]), '-row-mt', '1'];
    if (enc === 'libaom-av1') return ['-cpu-used', String([8, 6, 4, 3, 2][i]), '-row-mt', '1'];
    if (enc === 'libsvtav1') return ['-preset', String([10, 8, 6, 4, 2][i])];
    return ['-preset', speed]; // libx264 / libx265
  }

  function videoCodecArgs(enc, o, pass, info) {
    const crfMode = o.rateMode === 'crf' && !NO_CRF(enc);
    const a = ['-c:v', enc];
    if (NO_CRF(enc) && o.rateMode === 'crf') o = { ...o, bitrate: Math.max(LIMITS.minBitrate, Math.round(estimateVideoKbps(info || {}, o))) };
    a.push(...speedFor(enc, o.speed));
    if (/_nvenc$/.test(enc)) a.push(...(crfMode ? ['-rc', 'vbr', '-cq', String(o.crf), '-b:v', '0'] : ['-rc', 'vbr', '-b:v', `${o.bitrate}k`]));
    else if (/_qsv$/.test(enc)) a.push(...(crfMode ? ['-global_quality', String(o.crf)] : ['-b:v', `${o.bitrate}k`]));
    else if (/_amf$/.test(enc)) a.push(...(crfMode ? ['-rc', 'cqp', '-qp_i', String(o.crf), '-qp_p', String(o.crf)] : ['-rc', 'vbr_peak', '-b:v', `${o.bitrate}k`]));
    else if (enc === 'libvpx-vp9' || enc === 'libaom-av1') a.push(...(crfMode ? ['-crf', String(o.crf), '-b:v', '0'] : ['-b:v', `${o.bitrate}k`]));
    else if (enc === 'libopenh264') a.push('-b:v', `${o.bitrate}k`, '-allow_skip_frames', '1');
    else a.push(...(crfMode ? ['-crf', String(o.crf)] : ['-b:v', `${o.bitrate}k`])); // libx264 / libx265 / libsvtav1
    if (enc === 'libx264') a.push('-profile:v', 'high');
    if (/^(libx265|hevc_)/.test(enc) && o.container === 'mp4') a.push('-tag:v', 'hvc1');
    a.push('-pix_fmt', 'yuv420p');
    if (pass) a.push('-pass', String(pass));
    return a;
  }

  function audioArgs(o) {
    if (o.removeAudio) return ['-an'];
    const a = ['-map', `0:a:${o.audioTrack}?`];
    if (o.audioCodec === 'copy') return [...a, '-c:a', 'copy'];
    const codec = { aac: 'aac', opus: 'libopus', mp3: 'libmp3lame', flac: 'flac' }[o.audioCodec];
    return [...a, '-c:a', codec, ...(o.audioCodec === 'flac' ? [] : ['-b:a', `${o.audioBitrate}k`])];
  }

  function filterChain(o, input) {
    const f = [];
    if (o.height > 0) f.push(`scale=-2:min(${o.height}\\,ih):flags=lanczos`); // never upscales; '\,' keeps the comma inside the expression
    if (o.fps > 0 && !o.gif) f.push(`fps=${o.fps}`);
    if (o.subtitle === 'burn') {
      f.push(o.subtitleFile ? `subtitles=${quoteFilterPath(o.subtitleFile)}` : `subtitles=${quoteFilterPath(input)}:si=${o.subtitleTrack}`);
    }
    return f;
  }

  // Builds the argument ARRAY for one ffmpeg run. info = { duration } is optional.
  // pass: 0 = single pass, 1 = first pass of two (null output), 2 = second pass. passLog: base path for -passlogfile (a temp file, never user input).
  function buildArgs({ input, output, options, encoder, pass = 0, passLog = '', info = null }) {
    const o = options;
    const a = ['-hide_banner', '-nostdin', '-y', '-i', input];
    if (o.trimStart > 0) a.push('-ss', String(o.trimStart));
    if (o.trimEnd > 0) a.push('-t', String(o.trimEnd - o.trimStart));
    if (o.audioOnly) {
      const f = AUDIO_ONLY[o.audioOnlyFormat];
      a.push('-vn', '-map', `0:a:${o.audioTrack}?`, '-c:a', f.codec, ...(o.audioOnlyFormat === 'flac' ? [] : ['-b:a', `${o.audioBitrate}k`]), '-f', f.muxer, output);
      return a;
    }
    if (o.gif) {
      // two-step palette: far better colours than the default GIF palette
      const chain = `fps=${o.fps || 12},scale=-2:${o.height > 0 ? o.height : 480}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      a.push('-map', '0:v:0', '-vf', chain, '-an', '-loop', '0', '-f', 'gif', output);
      return a;
    }
    a.push('-map', '0:v:0');
    const vf = filterChain(o, input);
    if (vf.length) a.push('-vf', vf.join(','));
    if (pass) a.push('-passlogfile', passLog);
    a.push(...videoCodecArgs(encoder, o, pass, info && info.video));
    if (pass === 1) { a.push('-an', '-f', 'null', process.platform === 'win32' ? 'NUL' : '/dev/null'); return a; }
    a.push(...audioArgs(o));
    if (o.subtitle === 'embed') {
      a.push('-map', `0:s:${o.subtitleTrack}?`, '-c:s', o.container === 'mp4' ? 'mov_text' : o.container === 'webm' ? 'webvtt' : 'copy');
    }
    if (o.container === 'mp4') a.push('-movflags', '+faststart');
    a.push('-f', MUXERS[o.container], output);
    return a;
  }

  function outputExt(o) { return o.audioOnly ? AUDIO_ONLY[o.audioOnlyFormat].ext : o.gif ? 'gif' : o.container; }

  // Two passes are only used when the chosen encoder supports -pass (software H.264 / VP9 / AV1-aom).
  function canTwoPass(enc) { return enc === 'libx264' || enc === 'libvpx-vp9' || enc === 'libaom-av1'; }

  /* ---------- size prediction (an estimate, shown with "~") ---------- */

  // bits per pixel at CRF 23 (H.264 reference); other codecs are relative; every 6 CRF steps halves/doubles the rate
  const BPP = { h264: 0.075, h265: 0.045, vp9: 0.05, av1: 0.035 };
  function outputSize(src, o) {
    const height = src.height || 1080, width = src.width || 1920;
    const outH = o.height > 0 ? Math.min(o.height, height) : height;
    return { w: Math.round(width * outH / height), h: outH, fps: o.fps > 0 ? o.fps : (src.fps || 30) };
  }
  // video bitrate (kbps) implied by the options: the target bitrate, or an estimate from CRF (6 CRF steps = factor 2)
  function estimateVideoKbps(src, o) {
    const s = outputSize(src, o);
    if (o.gif) return s.w * s.h * (o.fps || 12) * 0.25 / 1000;
    if (o.rateMode === 'bitrate') return o.bitrate;
    const bpp = (BPP[o.codec] || BPP.h264) * Math.pow(2, (23 - o.crf) / 6);
    return s.w * s.h * s.fps * bpp / 1000;
  }
  function predictBytes({ duration, width = 1920, height = 1080, fps = 30 }, o) {
    if (!(duration > 0)) return 0;
    const span = (o.trimEnd > 0 ? Math.min(o.trimEnd, duration) : duration) - o.trimStart;
    if (!(span > 0)) return 0;
    if (o.audioOnly) return Math.round(span * (o.audioOnlyFormat === 'flac' ? 700 : o.audioBitrate) * 125);
    const audio = o.removeAudio ? 0 : o.audioCodec === 'copy' ? 160 : o.audioBitrate;
    return Math.round((estimateVideoKbps({ width, height, fps }, o) + audio) * span * 125);
  }

  /* ---------- probe parsing (from the banner of `ffmpeg -i file`) ---------- */

  function parseProbe(text) {
    const t = String(text);
    const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t);
    const out = { duration: d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : 0, video: null, audio: [], subtitles: [] };
    for (const line of t.split(/\r?\n/)) {
      const m = /Stream #\d+:(\d+)(?:\((\w+)\))?[^:]*:\s*(Video|Audio|Subtitle):\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, , lang, kind, rest] = m;
      if (kind === 'Video' && !out.video && !/attached pic/i.test(rest)) {
        const size = /(\d{2,5})x(\d{2,5})/.exec(rest), fps = /([\d.]+)\s*fps/.exec(rest);
        out.video = { codec: rest.split(/[ ,(]/)[0], width: size ? +size[1] : 0, height: size ? +size[2] : 0, fps: fps ? parseFloat(fps[1]) : 0 };
      } else if (kind === 'Audio') {
        const ch = /(mono|stereo|5\.1|7\.1|\d+ channels)/.exec(rest);
        out.audio.push({ index: out.audio.length, codec: rest.split(/[ ,(]/)[0], lang: lang || '', channels: ch ? ch[1] : '' });
      } else if (kind === 'Subtitle') {
        out.subtitles.push({ index: out.subtitles.length, codec: rest.split(/[ ,(]/)[0], lang: lang || '' });
      }
    }
    return out;
  }

  return { CODECS, SPEEDS, PRESETS, DEFAULTS, LIMITS, AUDIO_ONLY, validateOptions, validSubtitlePath, escapeFilterPath, parseEncoders, parseHwaccels, encoderOrder, summarize, isHardware, buildArgs, outputExt, canTwoPass, predictBytes, estimateVideoKbps, parseProbe, sanitizeSuffix };
});

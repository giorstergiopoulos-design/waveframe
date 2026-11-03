'use strict';
// Unit tests for the video encoder logic (renderer/vidlib.js): presets, validation, argument building, encoder choice, size prediction.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../renderer/vidlib.js');
const C = require('../renderer/convlib.js');

const opts = (o) => { const v = V.validateOptions(o); assert.ok(v.ok, v.errors.join()); return v.options; };
const args = (o, enc, extra = {}) => V.buildArgs({ input: 'C:\\v\\in.mp4', output: 'C:\\v\\out', options: opts(o), encoder: enc, ...extra });

test('every preset is valid and builds an argument array (no shell string)', () => {
  for (const p of Object.keys(V.PRESETS)) {
    const v = V.validateOptions({ preset: p });
    assert.ok(v.ok, `${p}: ${v.errors}`);
    const enc = v.options.audioOnly || v.options.gif ? null : V.CODECS[v.options.codec].sw[0];
    const a = V.buildArgs({ input: 'C:\\v\\in.mp4', output: 'C:\\v\\out.' + V.outputExt(v.options), options: v.options, encoder: enc });
    assert.ok(Array.isArray(a) && a.every((x) => typeof x === 'string'), p);
    assert.equal(a[a.indexOf('-i') + 1], 'C:\\v\\in.mp4', 'the input path is ONE argument, untouched');
    // no argument is a glued "flag value" string: only filter graphs / the two paths may contain spaces
    assert.ok(a.filter((x) => /\s/.test(x)).every((x) => x.startsWith('C:\\')), `${p}: glued argument`);
  }
});

test('presets: YouTube 1080p/4K never upscale, archive H.265 copies audio, WebM is VP9+Opus, GIF has no audio, audio-only drops video', () => {
  assert.ok(args({ preset: 'youtube1080' }, 'libx264').includes('scale=-2:min(1080\\,ih):flags=lanczos'));
  assert.ok(args({ preset: 'youtube4k' }, 'libx264').includes('scale=-2:min(2160\\,ih):flags=lanczos'));
  const h265 = args({ preset: 'archiveH265' }, 'libx265');
  assert.deepEqual(h265.slice(h265.indexOf('-c:a'), h265.indexOf('-c:a') + 2), ['-c:a', 'copy']);
  assert.ok(h265.includes('matroska'));
  const webm = args({ preset: 'webm' }, 'libvpx-vp9');
  assert.ok(webm.includes('libopus') && webm.includes('webm') && webm.includes('-row-mt'));
  const gif = args({ preset: 'gif' }, null);
  assert.ok(gif.includes('-an') && gif.includes('gif') && gif.some((x) => /palettegen/.test(x)));
  const au = args({ preset: 'audioOnly' }, null);
  assert.ok(au.includes('-vn') && !au.includes('-c:v'));
  assert.equal(V.outputExt(opts({ preset: 'audioOnly' })), 'm4a');
});

test('validation rejects out-of-range and injected values', () => {
  const bad = (o, code) => assert.ok(V.validateOptions(o).errors.includes(code), `${JSON.stringify(o)} -> ${code}`);
  bad({ codec: 'wmv' }, 'codec');
  bad({ height: 100 }, 'height'); bad({ height: 9000 }, 'height'); bad({ height: 720.5 }, 'height');
  bad({ fps: 500 }, 'fps'); bad({ fps: -1 }, 'fps');
  bad({ codec: 'h264', crf: 60 }, 'crf'); bad({ codec: 'vp9', crf: 64 }, 'crf');
  assert.ok(V.validateOptions({ codec: 'vp9', container: 'webm', crf: 60 }).ok, 'VP9 allows up to 63');
  bad({ bitrate: 10 }, 'bitrate'); bad({ bitrate: 999999 }, 'bitrate');
  bad({ passes: 3 }, 'passes'); bad({ rateMode: 'abr' }, 'rateMode'); bad({ speed: 'ludicrous' }, 'speed');
  bad({ audioCodec: 'wma' }, 'audioCodec'); bad({ audioBitrate: 8 }, 'audioBitrate');
  bad({ audioTrack: 99 }, 'audioTrack'); bad({ subtitleTrack: -1 }, 'subtitleTrack'); bad({ subtitle: 'hard' }, 'subtitle');
  bad({ trimStart: 5, trimEnd: 2 }, 'trim'); bad({ trimStart: -1 }, 'trim');
  bad({ height: '1080' }, 'height');
  bad({ subtitle: 'burn', subtitleFile: "C:\\a\\x.srt'; rm" }, 'subtitleFile');
  bad({ subtitle: 'burn', subtitleFile: 'relative.srt' }, 'subtitleFile');
  bad({ subtitle: 'burn', subtitleFile: 'C:\\a\\x.exe' }, 'subtitleFile');
  bad({ audioOnlyFormat: 'wav' }, 'audioOnlyFormat');
  assert.equal(V.validateOptions(null).ok, true, 'null falls back to defaults');
});

test('container is corrected to one the codec supports; suffix cannot inject a path; two passes need a target bitrate', () => {
  const v = V.validateOptions({ codec: 'vp9', container: 'mp4' });
  assert.equal(v.options.container, 'webm'); assert.deepEqual(v.warnings, ['container-changed']);
  assert.equal(V.validateOptions({ suffix: '..\\..\\evil/x' }).options.suffix, '....evilx');
  assert.equal(V.validateOptions({ suffix: '' }).options.suffix, '-video');
  const p = V.validateOptions({ passes: 2, rateMode: 'crf' });
  assert.equal(p.options.passes, 1); assert.ok(p.warnings.includes('passes-needs-bitrate'));
});

test('two-pass: pass 1 writes to the null device without audio, pass 2 encodes; only libx264/VP9/libaom support it', () => {
  const o = { rateMode: 'bitrate', bitrate: 4000, passes: 2 };
  const p1 = args(o, 'libx264', { pass: 1, passLog: 'C:\\t\\log' });
  assert.deepEqual(p1.slice(p1.indexOf('-passlogfile'), p1.indexOf('-passlogfile') + 2), ['-passlogfile', 'C:\\t\\log']);
  assert.ok(p1.includes('-an') && p1.includes('null') && p1.includes('-b:v') && p1.includes('4000k'));
  assert.equal(p1[p1.indexOf('-pass') + 1], '1');
  const p2 = args(o, 'libx264', { pass: 2, passLog: 'C:\\t\\log' });
  assert.equal(p2[p2.indexOf('-pass') + 1], '2'); assert.ok(p2.includes('mp4') && p2.includes('-c:a'));
  assert.deepEqual(['libx264', 'libvpx-vp9', 'libaom-av1', 'libx265', 'h264_nvenc', 'libopenh264', 'libsvtav1'].map(V.canTwoPass), [true, true, true, false, false, false, false]);
});

test('encoder arguments per family (hardware, software, LGPL libopenh264)', () => {
  const crf = { rateMode: 'crf', crf: 20, speed: 'slow' };
  const nv = args(crf, 'h264_nvenc'); assert.ok(nv.includes('-cq') && nv.includes('p5') && nv.includes('-rc'));
  const qsv = args(crf, 'h264_qsv'); assert.ok(qsv.includes('-global_quality') && qsv.includes('slow'));
  const amf = args(crf, 'h264_amf'); assert.ok(amf.includes('-qp_i') && amf.includes('quality'));
  const x264 = args(crf, 'libx264'); assert.ok(x264.includes('-crf') && x264.includes('-profile:v'));
  const x265 = args({ preset: 'archiveH265', container: 'mp4' }, 'libx265'); assert.ok(x265.includes('hvc1'), 'HEVC in MP4 gets the hvc1 tag');
  const av1 = args({ codec: 'av1', container: 'mkv', crf: 30, speed: 'fast' }, 'libsvtav1'); assert.ok(av1.includes('-preset') && av1.includes('8'));
  const aom = args({ codec: 'av1', container: 'mkv', crf: 30 }, 'libaom-av1'); assert.ok(aom.includes('-cpu-used') && aom.includes('-crf'));
  const oh = args({ ...crf, height: 0 }, 'libopenh264', { info: { video: { width: 1280, height: 720, fps: 25 } } });
  assert.ok(!oh.includes('-crf') && !oh.includes('-preset'), 'libopenh264 has no CRF/preset');
  const kb = parseInt(oh[oh.indexOf('-b:v') + 1], 10);
  assert.ok(kb > 500 && kb < 20000, `derived bitrate ${kb}k`);
  const lower = parseInt(args({ rateMode: 'crf', crf: 30, height: 0 }, 'libopenh264', { info: { video: { width: 1280, height: 720, fps: 25 } } }).reduce((acc, x, i, a) => (a[i - 1] === '-b:v' ? x : acc), '0'), 10);
  assert.ok(lower < kb, 'a higher CRF gives a lower derived bitrate');
});

test('trim, fps, remove audio, audio track, copy/convert audio, embedded and burned subtitles', () => {
  const a = args({ trimStart: 2, trimEnd: 10, fps: 24, audioTrack: 2, audioCodec: 'opus', audioBitrate: 96 }, 'libx264');
  assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4), ['-ss', '2', '-t', '8']);
  assert.ok(a.some((x) => /fps=24/.test(x)) && a.includes('0:a:2?') && a.includes('libopus'));
  const na = args({ removeAudio: true }, 'libx264');
  assert.ok(na.includes('-an') && !na.includes('-c:a'));
  const emb = args({ subtitle: 'embed', subtitleTrack: 1 }, 'libx264');
  assert.ok(emb.includes('0:s:1?') && emb.includes('mov_text'));
  const embMkv = args({ subtitle: 'embed', codec: 'h264', container: 'mkv' }, 'libx264');
  assert.deepEqual(embMkv.slice(embMkv.indexOf('-c:s'), embMkv.indexOf('-c:s') + 2), ['-c:s', 'copy']);
  const burn = args({ subtitle: 'burn', subtitleFile: 'C:\\subs dir\\my,file[1].srt' }, 'libx264');
  const vf = burn[burn.indexOf('-vf') + 1];
  assert.ok(vf.includes("subtitles='C\\:/subs dir/my,file[1].srt'"), vf);
  const burnEmb = args({ subtitle: 'burn', subtitleTrack: 1 }, 'libx264');
  assert.ok(burnEmb[burnEmb.indexOf('-vf') + 1].includes("subtitles='C\\:/v/in.mp4':si=1"));
});

test('filter path escaping and subtitle path validation', () => {
  assert.equal(V.escapeFilterPath('C:\\a b\\c;d=e.srt'), 'C\\:/a b/c;d=e.srt');
  assert.equal(V.validSubtitlePath('C:\\Users\\me\\sub.SRT'), true);
  for (const bad of ["C:\\a'b.srt", 'C:\\a\nb.srt', 'D:\\a%b.srt', 'C:\\a$b.srt', 'x.srt', 'C:\\a\\b.mp4', 12, null]) assert.equal(V.validSubtitlePath(bad), false, String(bad));
});

const ENC_TEXT = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 V....D libsvtav1            SVT-AV1 (codec av1)
 A....D aac                  AAC (Advanced Audio Coding)
 V..... mjpeg_qsv            MJPEG (Intel Quick Sync Video acceleration)
`;
test('encoder list and hardware accelerators are parsed; hardware comes first, software is the fallback; missing ones are reported', () => {
  const set = V.parseEncoders(ENC_TEXT);
  assert.ok(set.has('libx264') && set.has('h264_nvenc') && set.has('libsvtav1') && !set.has('aac'), 'audio encoders are not video encoders');
  assert.deepEqual(V.encoderOrder('h264', set), ['h264_nvenc', 'libx264']);
  assert.deepEqual(V.encoderOrder('h264', set, { preferHardware: false }), ['libx264', 'h264_nvenc']);
  assert.deepEqual(V.encoderOrder('h265', set), ['libx265']);
  assert.deepEqual(V.encoderOrder('av1', set), ['libsvtav1']);
  assert.deepEqual(V.encoderOrder('vp9', new Set()), [], 'nothing available');
  const sum = V.summarize(set);
  assert.equal(sum.h264.best, 'h264_nvenc'); assert.deepEqual(sum.h264.software, ['libx264']);
  assert.ok(sum.h265.missing.includes('hevc_nvenc') && sum.h265.best === 'libx265');
  assert.deepEqual(V.parseHwaccels('Hardware acceleration methods:\ncuda\nd3d11va\nqsv\n'), ['cuda', 'd3d11va', 'qsv']);
  assert.deepEqual(V.parseHwaccels('garbage'), []);
  // the LGPL build Waveframe downloads has no libx264/libx265: software H.264 is libopenh264, H.265 only via hardware
  const lgpl = V.parseEncoders(' V....D libopenh264          OpenH264 H.264 / AVC (codec h264)\n V....D hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)\n');
  assert.deepEqual(V.encoderOrder('h264', lgpl), ['libopenh264']);
  assert.deepEqual(V.encoderOrder('h265', lgpl), ['hevc_nvenc']);
  assert.equal(V.isHardware('hevc_nvenc'), true); assert.equal(V.isHardware('libx265'), false);
});

test('size prediction: lower CRF = bigger, trim and downscale = smaller, audio-only is small, nothing without a duration', () => {
  const src = { duration: 120, width: 1920, height: 1080, fps: 30 };
  const big = V.predictBytes(src, opts({ crf: 18, height: 0 }));
  const small = V.predictBytes(src, opts({ crf: 28, height: 0 }));
  assert.ok(big > small * 2, `${big} vs ${small}`);
  assert.ok(V.predictBytes(src, opts({ crf: 23, height: 720 })) < V.predictBytes(src, opts({ crf: 23, height: 0 })));
  assert.ok(V.predictBytes(src, opts({ crf: 23, height: 0, trimStart: 0, trimEnd: 30 })) < V.predictBytes(src, opts({ crf: 23, height: 0 })) / 3);
  assert.equal(V.predictBytes({ ...src, duration: 0 }, opts({})), 0);
  const br = V.predictBytes(src, opts({ rateMode: 'bitrate', bitrate: 8000, audioBitrate: 192 }));
  assert.ok(Math.abs(br - (8000 + 192) * 120 * 125) < 2000);
  assert.ok(V.predictBytes(src, opts({ preset: 'audioOnly' })) < 5 * 1024 * 1024);
  assert.ok(V.predictBytes(src, opts({ preset: 'archiveH265', crf: 22 })) < V.predictBytes(src, opts({ crf: 22, height: 0 })), 'HEVC predicts smaller than H.264 at the same CRF');
});

test('ffmpeg banner is parsed into video, audio tracks and subtitle tracks', () => {
  const p = V.parseProbe(`  Duration: 00:01:30.50, start: 0.000000, bitrate: 2500 kb/s
  Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 24 fps, 24 tbr, 12288 tbn (default)
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s (default)
  Stream #0:2(ell): Audio: ac3, 48000 Hz, 5.1(side), fltp, 384 kb/s
  Stream #0:3(eng): Subtitle: subrip
  Stream #0:4(ell): Subtitle: mov_text (default)
  Stream #0:5: Video: mjpeg, yuvj420p, 600x600, 90k tbr (attached pic)`);
  assert.equal(p.duration, 90.5);
  assert.deepEqual(p.video, { codec: 'h264', width: 1920, height: 1080, fps: 24 });
  assert.deepEqual(p.audio.map((a) => [a.index, a.codec, a.lang, a.channels]), [[0, 'aac', 'eng', 'stereo'], [1, 'ac3', 'ell', '5.1']]);
  assert.deepEqual(p.subtitles.map((s) => [s.index, s.codec, s.lang]), [[0, 'subrip', 'eng'], [1, 'mov_text', 'ell']]);
  assert.equal(V.parseProbe('nothing').video, null);
});

test('the shared queue handles video jobs: sequential, progress, per-file errors, cancel', async () => {
  const seen = [];
  const q = C.createQueue(['a.mp4', 'b.mp4', 'c.mp4'], async (item, ctx) => { ctx.report(0.5); if (item === 'b.mp4') throw new Error('no-encoder'); return item; }, (p) => seen.push(p.overall));
  const r = await q.start();
  assert.deepEqual(r.map((x) => x.status), ['done', 'error', 'done']);
  assert.equal(r[1].error, 'no-encoder');
  assert.equal(seen[seen.length - 1], 1);
  let release;
  const q2 = C.createQueue([1, 2], (item) => (item === 1 ? new Promise((res) => { release = res; }) : Promise.resolve(item)));
  const done = q2.start(); q2.cancel(); release('late');
  assert.deepEqual((await done).map((x) => x.status), ['cancelled', 'cancelled']);
});

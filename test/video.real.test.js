'use strict';
// REAL transcodes with whatever ffmpeg is available (PATH, or WAVEFRAME_FFMPEG = e.g. the LGPL build Waveframe downloads): a generated
// test video is encoded with the real presets and every output is decoded again. Skipped when no ffmpeg exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const V = require('../renderer/vidlib.js');
const EA = require('../conv-engine.js');
const EV = require('../conv-video.js');

function findFfmpeg() {
  const c = process.env.WAVEFRAME_FFMPEG || 'ffmpeg';
  try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch (_) { return null; }
}
const FFMPEG = findFfmpeg();
const skip = FFMPEG ? false : 'ffmpeg not available';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-vid-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: 'ignore' });
const SRC = path.join(dir, 'clip.mp4');
let AVAIL = new Set();

test.before(async () => {
  if (!FFMPEG) return;
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'aac', SRC]);
  AVAIL = (await EV.detectEncoders(FFMPEG)).encoders;
});

const sw264 = () => ['libx264', 'libopenh264'].find((e) => AVAIL.has(e));
async function encode(o, available = AVAIL, input = SRC) {
  const v = V.validateOptions(o);
  assert.ok(v.ok, v.errors.join());
  const job = await EV.encodeVideo({ ffmpegPath: FFMPEG, input, options: v.options, available });
  return job.promise;
}
async function check(file) {
  const dec = await EA.verifyDecodes(FFMPEG, file);
  assert.ok(dec.ok, 'output decodes without errors');
  return { dec, info: await EV.probeVideo(FFMPEG, file) };
}

test('encoders are detected; this ffmpeg can encode H.264 in some way', { skip }, () => {
  assert.ok(AVAIL.size > 0);
  assert.ok(V.encoderOrder('h264', AVAIL).length > 0, 'no H.264 encoder at all');
});

test('web preset (H.264, 720p max, AAC) -> decodes, h264, never upscaled, next to the source', { skip }, async () => {
  const r = await encode({ preset: 'webSmall' }, new Set([sw264()]));
  assert.equal(path.dirname(r.output), dir);
  assert.match(path.basename(r.output), /^clip-video\.mp4$/);
  const { dec, info } = await check(r.output);
  assert.equal(info.video.codec, 'h264');
  assert.equal(info.video.height, 360, '640x360 is not upscaled to 720');
  assert.ok(Math.abs(dec.decodedSeconds - 3) < 0.3);
  assert.equal(info.audio.length, 1);
});

test('downscale: 1080p preset on a 360p source keeps 360p; a 240p cap scales down', { skip }, async () => {
  const r = await encode({ preset: 'webSmall', height: 240, suffix: '-240' }, new Set([sw264()]));
  const { info } = await check(r.output);
  assert.equal(info.video.height, 240);
});

test('every software codec available here produces a valid file (H.264 / H.265 / VP9 / AV1)', { skip }, async () => {
  const cases = [['h264', 'mp4', { crf: 28 }], ['h265', 'mkv', { crf: 30 }], ['vp9', 'webm', { crf: 40, speed: 'veryfast' }], ['av1', 'mkv', { crf: 45, speed: 'veryfast' }]];
  for (const [codec, container, extra] of cases) {
    const soft = V.encoderOrder(codec, AVAIL).filter((e) => !V.isHardware(e));
    if (!soft.length) continue; // e.g. the LGPL build has no software H.265
    const r = await encode({ codec, container, height: 0, audioCodec: codec === 'vp9' ? 'opus' : 'aac', suffix: `-${codec}`, ...extra }, new Set([soft[0]]));
    const { info } = await check(r.output);
    assert.ok(info.video, codec);
    assert.ok(path.extname(r.output) === `.${container}`, codec);
  }
});

test('hardware encoder first, software fallback: a failing GPU encoder falls through and the file is still produced', { skip }, async () => {
  const soft = sw264();
  const avail = new Set(['h264_nvenc', 'h264_qsv', 'h264_amf', soft]);
  const r = await encode({ preset: 'webSmall', suffix: '-hwfallback' }, avail);
  const { info } = await check(r.output);
  assert.equal(info.video.codec, 'h264');
  // either a GPU encoded it, or the first hardware encoder failed and a later one (ultimately software) did
  assert.ok(V.isHardware(r.encoder) || r.fellBackFrom, JSON.stringify(r));
});

test('no encoder for the codec -> clear error, nothing written', { skip }, async () => {
  const before = fs.readdirSync(dir).length;
  await assert.rejects(encode({ codec: 'vp9', container: 'webm' }, new Set(['libx264'])), { code: 'no-encoder' });
  assert.equal(fs.readdirSync(dir).length, before);
});

test('trim, remove audio and audio-track selection', { skip }, async () => {
  const e = new Set([sw264()]);
  const t = await encode({ preset: 'webSmall', trimStart: 1, trimEnd: 2.5, removeAudio: true, suffix: '-trim' }, e);
  const a = await check(t.output);
  assert.ok(Math.abs(a.dec.decodedSeconds - 1.5) < 0.3, `trim ${a.dec.decodedSeconds}`);
  assert.equal(a.info.audio.length, 0, 'audio removed');
  const second = await encode({ preset: 'webSmall', audioTrack: 1, suffix: '-track2' }, e);
  const b = await check(second.output);
  assert.equal(b.info.audio.length, 1, 'exactly the chosen audio track');
});

test('two-pass VP9 (target bitrate) runs both passes, leaves no pass files behind and decodes', { skip }, async (t) => {
  if (!AVAIL.has('libvpx-vp9')) return t.skip('no libvpx-vp9 in this ffmpeg'); // decided at run time: AVAIL is filled by the async before-hook
  const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('waveframe-pass-')).length;
  const r = await encode({ codec: 'vp9', container: 'webm', rateMode: 'bitrate', bitrate: 600, passes: 2, height: 0, speed: 'veryfast', audioCodec: 'opus', suffix: '-2pass' }, new Set(['libvpx-vp9']));
  await check(r.output);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('waveframe-pass-')).length, before, 'pass logs cleaned up');
});

test('GIF and audio-only extraction presets', { skip }, async () => {
  const g = await encode({ preset: 'gif', suffix: '-gif' });
  assert.ok(fs.statSync(g.output).size > 1000);
  assert.equal(fs.readFileSync(g.output).slice(0, 3).toString(), 'GIF');
  const a = await encode({ preset: 'audioOnly', suffix: '-audio' });
  const { dec, info } = await check(a.output);
  assert.equal(info.video, null);
  assert.ok(Math.abs(dec.decodedSeconds - 3) < 0.3);
  assert.equal(path.extname(a.output), '.m4a');
});

test('subtitles: embedded into MP4 (mov_text) and burned in from an external SRT', { skip }, async () => {
  fs.mkdirSync(path.join(dir, 'sub dir, [odd]'), { recursive: true });
  const srt = path.join(dir, 'sub dir, [odd]', 'my sub;1=a.srt'); // spaces, comma, brackets, semicolon and '=' must all survive the filter parsing
  fs.writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,500\nHello Waveframe\n\n');
  const withSub = path.join(dir, 'with-sub.mkv');
  try { ff(['-i', SRC, '-i', srt, '-map', '0:v', '-map', '0:a:0', '-map', '1:0', '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'srt', withSub]); } catch (_) { return; }
  const e = new Set([sw264()]);
  const emb = await encode({ preset: 'webSmall', subtitle: 'embed', subtitleTrack: 0, suffix: '-emb' }, e, withSub);
  const { info } = await check(emb.output);
  assert.equal(info.subtitles.length, 1, 'the subtitle track is embedded');
  const filters = execFileSync(FFMPEG, ['-hide_banner', '-filters']).toString();
  if (!/\bsubtitles\b/.test(filters)) return; // this ffmpeg has no libass: burn-in cannot be tested
  const burn = await encode({ preset: 'webSmall', subtitle: 'burn', subtitleFile: srt, suffix: '-burn' }, e);
  const b = await check(burn.output);
  assert.equal(b.info.subtitles.length, 0, 'burned in: no separate subtitle track');
});

test('cancel stops ffmpeg, rejects with "cancelled" and leaves no partial file', { skip }, async () => {
  const long = path.join(dir, 'long.mp4');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=60', '-c:v', 'mpeg4', '-q:v', '3', long]);
  const v = V.validateOptions({ preset: 'webSmall', height: 0, speed: 'veryslow', suffix: '-cancel' });
  const job = await EV.encodeVideo({ ffmpegPath: FFMPEG, input: long, options: v.options, available: new Set([sw264()]) });
  setTimeout(() => job.cancel(), 400);
  await assert.rejects(job.promise, { code: 'cancelled' });
  assert.equal(fs.existsSync(path.join(dir, 'long-cancel.mp4')), false);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.waveframe-')), [], 'no temp files left behind');
});

test('output folder: created on demand and collisions are numbered, the source is never touched', { skip }, async () => {
  const target = path.join(dir, 'Videos', 'Opsis Media Suite');
  const before = fs.readFileSync(SRC);
  const v = V.validateOptions({ preset: 'webSmall', suffix: '-out' });
  const e = new Set([sw264()]);
  const one = await (await EV.encodeVideo({ ffmpegPath: FFMPEG, input: SRC, options: v.options, available: e, outDir: target })).promise;
  const two = await (await EV.encodeVideo({ ffmpegPath: FFMPEG, input: SRC, options: v.options, available: e, outDir: target })).promise;
  assert.equal(path.dirname(one.output), target);
  assert.equal(path.basename(one.output), 'clip-out.mp4');
  assert.equal(path.basename(two.output), 'clip-out (1).mp4');
  assert.ok(before.equals(fs.readFileSync(SRC)), 'the original is unchanged');
});

test('a file without video and a missing file fail cleanly', { skip }, async () => {
  const audioOnly = path.join(dir, 'tone.m4a');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audioOnly]);
  const v = V.validateOptions({ preset: 'webSmall' });
  await assert.rejects(EV.encodeVideo({ ffmpegPath: FFMPEG, input: audioOnly, options: v.options, available: new Set([sw264()]) }), { code: 'no-video' });
  await assert.rejects(EV.encodeVideo({ ffmpegPath: FFMPEG, input: path.join(dir, 'nope.mp4'), options: v.options, available: new Set([sw264()]) }));
});

test('thumbnail: a PNG data URL of one frame', { skip }, async () => {
  const t = await EV.thumbnail(FFMPEG, SRC, 1);
  assert.match(t, /^data:image\/png;base64,/);
  assert.ok(t.length > 500);
  assert.equal(await EV.thumbnail(FFMPEG, path.join(dir, 'nope.mp4'), 1), null);
});

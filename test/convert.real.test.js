'use strict';
// REAL conversions: a generated tone is converted to every supported format with ffmpeg and each output is decoded again
// (duration / sample rate / channels / codec checked). Skipped when no ffmpeg is available (set WAVEFRAME_FFMPEG to test a specific build,
// e.g. the LGPL build Waveframe downloads on demand).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const C = require('../renderer/convlib.js');
const E = require('../conv-engine.js');

function findFfmpeg() {
  const cand = process.env.WAVEFRAME_FFMPEG || 'ffmpeg';
  try { execFileSync(cand, ['-version'], { stdio: 'ignore' }); return cand; } catch (_) { return null; }
}
const FFMPEG = findFfmpeg();
const opts = { skip: FFMPEG ? false : 'ffmpeg not available' };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-conv-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function tone(file, seconds, rate, channels) {
  const n = Math.round(seconds * rate), ch = [];
  for (let c = 0; c < channels; c++) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = 0.5 * Math.sin(2 * Math.PI * (440 + 110 * c) * i / rate); ch.push(a); }
  fs.writeFileSync(file, Buffer.from(C.writeWav(ch, rate, 16)));
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const SECONDS = 3;
const src = path.join(dir, 'tone.wav');
tone(src, SECONDS, 44100, 2);

// format, extra options, expected codec name in the output, expected sample rate (0 = same as input), expected channels
const MATRIX = [
  ['wav', { depth: 16 }, 'pcm_s16le', 44100, 2],
  ['wav', { depth: 24 }, 'pcm_s24le', 44100, 2],
  ['wav', { depth: 32 }, 'pcm_f32le', 44100, 2],
  ['wav', { depth: 16, sampleRate: 22050, channels: 1 }, 'pcm_s16le', 22050, 1],
  ['flac', { depth: 16 }, 'flac', 44100, 2],
  ['flac', { depth: 24, sampleRate: 48000 }, 'flac', 48000, 2],
  ['mp3', { mode: 'cbr', bitrate: 192 }, 'mp3', 44100, 2],
  ['mp3', { mode: 'vbr', vbrQuality: 2 }, 'mp3', 44100, 2],
  ['mp3', { mode: 'cbr', bitrate: 128, sampleRate: 96000 }, 'mp3', 48000, 2], // clamped to the MP3 maximum
  ['aac', { bitrate: 128 }, 'aac', 44100, 2],
  ['ogg', { bitrate: 128 }, 'vorbis', 44100, 2],
  ['opus', { bitrate: 96 }, 'opus', 48000, 2],
  ['opus', { bitrate: 64, sampleRate: 16000, channels: 1 }, 'opus', 48000, 1], // Opus decoders always output 48 kHz (the 16 kHz input rate is only stored in the header)
  ['aiff', { depth: 16 }, 'pcm_s16be', 44100, 2],
  ['aiff', { depth: 24 }, 'pcm_s24be', 44100, 2],
  ['alac', { depth: 16 }, 'alac', 44100, 2],
  ['alac', { depth: 24 }, 'alac', 44100, 2],
  ['wma', { bitrate: 128 }, 'wmav2', 44100, 2],
];

for (const [format, extra, codec, rate, channels] of MATRIX) {
  const label = `${format} ${JSON.stringify(extra)}`;
  test(`direct conversion -> ${label} decodes with the expected codec/rate/channels/duration, original untouched`, opts, async () => {
    const before = sha(src);
    const v = C.validateOptions({ format, ...extra });
    assert.ok(v.ok, v.errors.join());
    const job = await E.convertDirect({ ffmpegPath: FFMPEG, input: src, options: v.options });
    const { output } = await job.promise;
    assert.equal(path.dirname(output), path.dirname(src), 'written next to the original');
    assert.match(path.basename(output), /^tone-converted.*\./);
    const r = await E.verifyDecodes(FFMPEG, output);
    assert.ok(r.ok, 'output decodes without errors');
    assert.equal(r.codec, codec);
    assert.equal(r.sampleRate, rate);
    assert.equal(r.channels, channels);
    assert.ok(Math.abs(r.decodedSeconds - SECONDS) < 0.15, `duration ${r.decodedSeconds}`);
    assert.equal(sha(src), before, 'the original is never changed');
  });
}

test('trim: 1.0 s - 2.5 s of a 3 s tone gives 1.5 s', opts, async () => {
  const v = C.validateOptions({ format: 'flac', trimStart: 1, trimEnd: 2.5, suffix: '-trim' });
  const { output } = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: src, options: v.options })).promise;
  const r = await E.verifyDecodes(FFMPEG, output);
  assert.ok(Math.abs(r.decodedSeconds - 1.5) < 0.1, `got ${r.decodedSeconds}`);
});

test('collisions: converting again never overwrites, it numbers the new file', opts, async () => {
  const v = C.validateOptions({ format: 'wav', suffix: '-twice' });
  const a = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: src, options: v.options })).promise;
  const b = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: src, options: v.options })).promise;
  assert.equal(path.basename(a.output), 'tone-twice.wav');
  assert.equal(path.basename(b.output), 'tone-twice (1).wav');
});

test('same-format conversion (wav -> wav, empty suffix) does not touch the source', opts, async () => {
  const copy = path.join(dir, 'same.wav'); fs.copyFileSync(src, copy);
  const before = sha(copy);
  const v = C.validateOptions({ format: 'wav', suffix: '' });
  const { output } = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: copy, options: v.options })).promise;
  assert.notEqual(output.toLowerCase(), copy.toLowerCase());
  assert.equal(sha(copy), before);
});

test('the audio track of a video file is converted', opts, async () => {
  const mp4 = path.join(dir, 'clip.mp4');
  execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', mp4]);
  const v = C.validateOptions({ format: 'mp3', bitrate: 128 });
  const { output } = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: mp4, options: v.options })).promise;
  const r = await E.verifyDecodes(FFMPEG, output);
  assert.ok(r.ok && r.codec === 'mp3' && Math.abs(r.decodedSeconds - 2) < 0.2);
});

test('a file without audio and a missing file fail cleanly and leave no partial output', opts, async () => {
  const silent = path.join(dir, 'video-only.mp4');
  execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-c:v', 'mpeg4', silent]);
  const v = C.validateOptions({ format: 'wav' });
  await assert.rejects(E.convertDirect({ ffmpegPath: FFMPEG, input: silent, options: v.options }), { code: 'no-audio' });
  await assert.rejects(async () => (await E.convertDirect({ ffmpegPath: FFMPEG, input: path.join(dir, 'nope.mp3'), options: v.options })).promise);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.waveframe-')), [], 'no temp files left behind');
});

test('cancel kills ffmpeg, rejects with "cancelled" and removes the partial file', opts, async () => {
  const big = path.join(dir, 'long.wav'); tone(big, 600, 44100, 2); // 10 minutes
  const v = C.validateOptions({ format: 'flac', suffix: '-cancel' });
  const job = await E.convertDirect({ ffmpegPath: FFMPEG, input: big, options: v.options });
  setTimeout(() => job.cancel(), 150);
  await assert.rejects(job.promise, { code: 'cancelled' });
  assert.equal(fs.existsSync(path.join(dir, 'long-cancel.flac')), false);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.waveframe-')), []);
});

test('progress is reported while converting', opts, async () => {
  const big = path.join(dir, 'prog.wav'); tone(big, 120, 44100, 2);
  const seen = [];
  const v = C.validateOptions({ format: 'mp3', bitrate: 128 });
  await (await E.convertDirect({ ffmpegPath: FFMPEG, input: big, options: v.options, onProgress: (p) => seen.push(p) })).promise;
  assert.ok(seen.length >= 1 && seen.every((p) => p >= 0 && p <= 1), `progress events: ${seen.length}`);
});

for (const format of ['wav', 'flac', 'mp3', 'aac', 'ogg', 'opus', 'aiff', 'alac', 'wma']) {
  test(`processed path (renderer WAV -> ${format}) encodes and decodes`, opts, async () => {
    const wav = C.writeWav([new Float32Array(48000 * 2).map((_, i) => 0.4 * Math.sin(i / 20)), new Float32Array(48000 * 2).map((_, i) => 0.4 * Math.sin(i / 25))], 48000, format === 'wav' ? 24 : 24);
    const v = C.validateOptions({ format, depth: 24, bitrate: format === 'opus' ? 96 : 128, suffix: '-proc', sampleRate: 48000 });
    assert.ok(v.ok, v.errors.join());
    const job = await E.convertFromWav({ ffmpegPath: FFMPEG, input: path.join(dir, 'processed-src.mp3'), wavBytes: wav, options: v.options, duration: 2 });
    const { output } = await job.promise;
    const r = await E.verifyDecodes(FFMPEG, output);
    assert.ok(r.ok && r.channels === 2 && r.sampleRate === 48000 && Math.abs(r.decodedSeconds - 2) < 0.15, JSON.stringify(r));
  });
}

test('the encode step reports a missing ffmpeg for non-WAV output (WAV needs none)', opts, async () => {
  const wav = C.writeWav([new Float32Array(4800)], 48000, 16);
  const v = C.validateOptions({ format: 'mp3', suffix: '-noff' });
  await assert.rejects(E.convertFromWav({ ffmpegPath: null, input: path.join(dir, 'x.wav'), wavBytes: wav, options: v.options }), { code: 'no-ffmpeg' });
  const w = await (await E.convertFromWav({ ffmpegPath: null, input: path.join(dir, 'x.wav'), wavBytes: wav, options: C.validateOptions({ format: 'wav', suffix: '-pure' }).options })).promise;
  assert.ok(fs.existsSync(w.output));
});

test('outDir: results go to the chosen folder (created on demand), named after the source, collisions numbered', opts, async () => {
  const target = path.join(dir, 'Music', 'WaveFrame');
  const v = C.validateOptions({ format: 'flac', suffix: '-out' });
  const a = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: src, options: v.options, outDir: target })).promise;
  const b = await (await E.convertDirect({ ffmpegPath: FFMPEG, input: src, options: v.options, outDir: target })).promise;
  assert.equal(path.dirname(a.output), target);
  assert.equal(path.basename(a.output), 'tone-out.flac');
  assert.equal(path.basename(b.output), 'tone-out (1).flac');
  // a playlist track has no file on disk: a virtual source name inside the folder is used
  const wav = C.writeWav([new Float32Array(4800)], 48000, 16);
  const w = await (await E.convertFromWav({ ffmpegPath: null, input: path.join(target, 'Song title.src'), wavBytes: wav, options: C.validateOptions({ format: 'wav', suffix: '' }).options, outDir: target })).promise;
  assert.equal(path.basename(w.output), 'Song title-converted.wav');
});

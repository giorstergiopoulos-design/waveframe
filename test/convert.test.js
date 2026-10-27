'use strict';
// Unit tests for the audio converter logic (renderer/convlib.js) - run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const C = require('../renderer/convlib.js');
const audio = require('../renderer/audiolib.js');

test('validateOptions: defaults are valid; unknown format / bad values are rejected with codes', () => {
  assert.equal(C.validateOptions({}).ok, true);
  assert.deepEqual(C.validateOptions({ format: 'exe' }).errors, ['format']);
  assert.ok(C.validateOptions({ sampleRate: 12345 }).errors.includes('sampleRate'));
  assert.ok(C.validateOptions({ channels: 6 }).errors.includes('channels'));
  assert.ok(C.validateOptions({ format: 'mp3', bitrate: 1 }).errors.includes('bitrate'));
  assert.ok(C.validateOptions({ format: 'mp3', mode: 'vbr', vbrQuality: 10 }).errors.includes('vbrQuality'));
  assert.ok(C.validateOptions({ format: 'mp3', mode: 'abr' }).errors.includes('mode'));
  assert.ok(C.validateOptions({ format: 'flac', depth: 32 }).errors.includes('depth'));
  assert.ok(C.validateOptions({ format: 'wav', depth: 32 }).ok);
  assert.ok(C.validateOptions({ targetLufs: 0 }).errors.includes('lufs'));
  assert.ok(C.validateOptions({ targetLufs: '-16' }).errors.includes('lufs'), 'strings are not numbers');
  assert.ok(C.validateOptions(null).ok, 'null input falls back to defaults');
});

test('validateOptions: trim rules', () => {
  assert.ok(C.validateOptions({ trimStart: 5, trimEnd: 0 }).ok, 'end 0 = until the end');
  assert.ok(C.validateOptions({ trimStart: 1, trimEnd: 9 }).ok);
  assert.ok(C.validateOptions({ trimStart: 9, trimEnd: 3 }).errors.includes('trim'));
  assert.ok(C.validateOptions({ trimStart: 3, trimEnd: 3 }).errors.includes('trim'));
  assert.ok(C.validateOptions({ trimStart: -1 }).errors.includes('trim'));
  assert.ok(C.validateOptions({ trimEnd: NaN }).errors.includes('trim'));
});

test('validateOptions: encoder limits are enforced with warnings (opus forced to 48 kHz, mp3/wma capped at 48 kHz)', () => {
  const op = C.validateOptions({ format: 'opus', bitrate: 96, sampleRate: 44100 });
  assert.equal(op.options.sampleRate, 48000); assert.deepEqual(op.warnings, ['rate-forced']);
  assert.equal(C.validateOptions({ format: 'opus', bitrate: 96, sampleRate: 16000 }).options.sampleRate, 16000);
  const mp = C.validateOptions({ format: 'mp3', sampleRate: 96000 });
  assert.equal(mp.options.sampleRate, 48000); assert.deepEqual(mp.warnings, ['rate-clamped']);
  assert.equal(C.validateOptions({ format: 'wma', bitrate: 128, sampleRate: 88200 }).options.sampleRate, 48000);
  assert.equal(C.validateOptions({ format: 'wav', sampleRate: 192000 }).options.sampleRate, 192000);
});

test('suffix is sanitised so it can never inject a path', () => {
  assert.equal(C.validateOptions({ suffix: '..\\..\\evil' }).options.suffix, '....evil');
  assert.equal(C.sanitizeSuffix('a/b\\c:d*e?'), 'abcde');
  assert.equal(C.validateOptions({ suffix: '' }).options.suffix, '-converted');
  assert.equal(C.validateOptions({ suffix: '///' }).options.suffix, '-converted');
  assert.equal(C.validateOptions({ suffix: 'x'.repeat(100) }).options.suffix.length, 40);
});

test('output naming: next to the original, suffix added, collisions numbered, never the original itself', () => {
  const w = path.win32;
  const taken = new Set();
  const exists = (p) => taken.has(p.toLowerCase());
  const input = 'C:\\Music\\Song.mp3';
  const first = C.buildOutputPath({ inputPath: input, ext: 'flac', suffix: '-converted', pathApi: w, exists });
  assert.equal(first, 'C:\\Music\\Song-converted.flac');
  taken.add(first.toLowerCase());
  assert.equal(C.buildOutputPath({ inputPath: input, ext: 'flac', suffix: '-converted', pathApi: w, exists }), 'C:\\Music\\Song-converted (1).flac');
  taken.add('c:\\music\\song-converted (1).flac');
  assert.equal(C.buildOutputPath({ inputPath: input, ext: 'flac', suffix: '-converted', pathApi: w, exists }), 'C:\\Music\\Song-converted (2).flac');
  // empty-looking suffix on a same-extension conversion must not resolve to the original (case-insensitive on Windows)
  const same = C.buildOutputPath({ inputPath: 'C:\\Music\\Song.mp3', ext: 'mp3', suffix: '', pathApi: w, exists: () => false });
  assert.notEqual(same.toLowerCase(), input.toLowerCase());
  assert.equal(same, 'C:\\Music\\Song (1).mp3');
  assert.equal(C.buildOutputPath({ inputPath: 'D:\\a b\\x.y.wav', ext: 'ogg', suffix: '_c', pathApi: w, exists: () => false }), 'D:\\a b\\x.y_c.ogg');
});

test('LUFS target gain maths', () => {
  assert.equal(C.targetGainDb(-23, -16), 7);
  assert.equal(C.targetGainDb(-10, -16), -6);
  assert.equal(C.targetGainDb(-60, -16, { maxBoost: 24 }), 24, 'boost is capped');
  assert.equal(C.targetGainDb(-Infinity, -16), 0, 'silence is left alone');
  assert.equal(C.targetGainDb(NaN, -16), 0);
  // peak safety: a -3 dBFS peak may only be raised by 2 dB to stay under -1 dBFS
  const p = C.peakSafeGainDb(7, Math.pow(10, -3 / 20));
  assert.ok(Math.abs(p.gainDb - 2) < 1e-9 && p.limited);
  assert.deepEqual(C.peakSafeGainDb(-4, 0.9), { gainDb: -4, limited: false });
  assert.equal(C.peakSafeGainDb(5, 0).limited, false);
});

test('normalising a real -23 LUFS signal to -16 LUFS with the BS.1770 code lands on target', () => {
  const fs = 48000, n = fs * 6, ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.pow(10, -23 / 20) * Math.sin(2 * Math.PI * 997 * i / fs);
  const before = audio.integratedLufs([ch, ch], fs);
  const g = Math.pow(10, C.targetGainDb(before, -16) / 20);
  const out = ch.map((x) => x * g);
  assert.ok(Math.abs(audio.integratedLufs([out, out], fs) - -16) < 0.1);
});

test('WAV writer round trip: 16-bit, 24-bit and 32-bit float keep the samples', () => {
  const frames = 1000, L = new Float32Array(frames), R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { L[i] = Math.sin(i / 7) * 0.8; R[i] = i % 2 ? 0.5 : -0.5; }
  for (const [depth, tol] of [[16, 1 / 16000], [24, 1 / 4000000], [32, 0]]) {
    const wav = C.writeWav([L, R], 44100, depth);
    const back = C.readWav(wav);
    assert.equal(back.channels, 2); assert.equal(back.sampleRate, 44100); assert.equal(back.bits, depth); assert.equal(back.frames, frames);
    assert.equal(back.format, depth === 32 ? 3 : 1);
    let worst = 0;
    for (let i = 0; i < frames; i++) worst = Math.max(worst, Math.abs(back.samples[0][i] - L[i]), Math.abs(back.samples[1][i] - R[i]));
    assert.ok(worst <= tol + 1e-7, `depth ${depth}: error ${worst}`);
    assert.equal(wav.byteLength, 44 + frames * 2 * (depth / 8));
  }
});

test('WAV writer clips out-of-range samples instead of wrapping', () => {
  const back = C.readWav(C.writeWav([new Float32Array([2, -2, 0])], 8000, 16));
  assert.ok(back.samples[0][0] > 0.99 && back.samples[0][1] < -0.99 && back.samples[0][2] === 0);
  assert.throws(() => C.readWav(new ArrayBuffer(20)));
});

test('ffmpeg arguments per format (direct mode)', () => {
  const args = (o, extra = {}) => C.buildFfmpegArgs({ input: 'in.mp4', output: 'out', options: C.validateOptions({ ...o, ...extra }).options, mode: 'direct' }).join(' ');
  assert.match(args({ format: 'mp3', mode: 'cbr', bitrate: 256 }), /-c:a libmp3lame -b:a 256k -f mp3 out$/);
  assert.match(args({ format: 'mp3', mode: 'vbr', vbrQuality: 0 }), /-c:a libmp3lame -q:a 0 /);
  assert.match(args({ format: 'wav', depth: 24 }), /-c:a pcm_s24le -f wav/);
  assert.match(args({ format: 'wav', depth: 32 }), /-c:a pcm_f32le/);
  assert.match(args({ format: 'flac', depth: 24 }), /-c:a flac -compression_level 8 -sample_fmt s32 -bits_per_raw_sample 24 -f flac/);
  assert.match(args({ format: 'aac', bitrate: 160 }), /-c:a aac -b:a 160k -f ipod/);
  assert.match(args({ format: 'ogg', bitrate: 128 }), /-c:a libvorbis -b:a 128k -f ogg/);
  assert.match(args({ format: 'opus', bitrate: 96 }), /-ar 48000 -c:a libopus -b:a 96k -vbr on -f opus/);
  assert.match(args({ format: 'aiff', depth: 16 }), /-c:a pcm_s16be -f aiff/);
  assert.match(args({ format: 'alac', depth: 16 }), /-c:a alac -sample_fmt s16p -f ipod/);
  assert.match(args({ format: 'wma', bitrate: 128 }), /-c:a wmav2 -b:a 128k -f asf/);
  const t = args({ format: 'wav' }, { trimStart: 1.5, trimEnd: 4, sampleRate: 22050, channels: 1 });
  assert.match(t, /-i in\.mp4 -ss 1\.5 -t 2\.5 -vn -map 0:a:0 -ar 22050 -ac 1 /);
  assert.ok(!/-ss/.test(args({ format: 'wav' })), 'no trim flags without trim');
});

test('ffmpeg arguments (encode mode): trim/rate/channels are NOT repeated on the processed WAV', () => {
  const o = C.validateOptions({ format: 'mp3', bitrate: 128, trimStart: 2, trimEnd: 5, sampleRate: 22050, channels: 1 }).options;
  const a = C.buildFfmpegArgs({ input: 'p.wav', output: 'o.mp3', options: o, mode: 'encode' });
  assert.ok(!a.includes('-ss') && !a.includes('-ar') && !a.includes('-ac') && !a.includes('-t'));
});

test('ffmpeg progress and probe parsing', () => {
  assert.equal(C.parseFfmpegTime('size=  10kB time=00:01:02.50 bitrate=...'), 62.5);
  assert.equal(C.parseFfmpegTime('time=00:00:01.00 ... time=00:00:02.00'), 2, 'last stamp wins');
  assert.equal(C.parseFfmpegTime('no progress here'), null);
  const p = C.parseProbe('  Duration: 00:03:25.12, start: 0.000000, bitrate: 320 kb/s\n  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 320 kb/s');
  assert.deepEqual(p, { duration: 205.12, sampleRate: 44100, channels: 2, codec: 'mp3', hasAudio: true });
  assert.equal(C.parseProbe('Stream #0:1: Audio: aac (LC), 48000 Hz, mono, fltp').channels, 1);
  assert.equal(C.parseProbe('Stream #0:1: Audio: ac3, 48000 Hz, 5.1(side), fltp').channels, 6);
  assert.equal(C.parseProbe('Stream #0:0: Video: h264, 1920x1080').hasAudio, false);
});

test('batch queue: sequential, overall progress, per-file errors do not stop the batch', async () => {
  const seen = [], order = [];
  const q = C.createQueue(['a', 'b', 'c'], async (item, ctx) => {
    order.push(item); ctx.report(0.5);
    if (item === 'b') throw new Error('boom');
    return item.toUpperCase();
  }, (p) => seen.push(+p.overall.toFixed(3)));
  const r = await q.start();
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(r.map((x) => x.status), ['done', 'error', 'done']);
  assert.equal(r[1].error, 'boom'); assert.equal(r[0].result, 'A');
  assert.equal(seen[seen.length - 1], 1);
  assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress never goes backwards');
});

test('batch queue: cancel stops the current wait and skips the rest', async () => {
  let release;
  const q = C.createQueue([1, 2, 3], (item, ctx) => (item === 1 ? new Promise((res) => { release = res; }) : Promise.resolve(item)));
  const done = q.start();
  q.cancel();
  release('late');
  const r = await done;
  assert.deepEqual(r.map((x) => x.status), ['cancelled', 'cancelled', 'cancelled']);
  assert.equal(q.isCancelled, true);
});

test('mapChannels: mono average, stereo duplication, multichannel front pair, untouched when equal', () => {
  const a = Float32Array.of(1, 0), b = Float32Array.of(0, 1), c = Float32Array.of(0.5, 0.5);
  assert.deepEqual(Array.from(C.mapChannels([a, b], 1)[0]), [0.5, 0.5]);
  assert.deepEqual(C.mapChannels([a], 2), [a, a]);
  assert.deepEqual(C.mapChannels([a, b, c], 2), [a, b]);
  assert.equal(C.mapChannels([a, b], 0).length, 2);
  assert.equal(C.mapChannels([a, b], 2).length, 2);
});

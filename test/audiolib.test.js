'use strict';
// Unit tests for renderer/audiolib.js — run with `npm test` (node's built-in test runner, no extra dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../renderer/audiolib.js');

function sine(freq, seconds, fs, amplitude) {
  const a = new Float32Array(Math.round(seconds * fs));
  for (let i = 0; i < a.length; i++) a[i] = amplitude * Math.sin(2 * Math.PI * freq * i / fs);
  return a;
}
const dbfs = (db) => Math.pow(10, db / 20);

test('K-weighting coefficients at 48 kHz match the BS.1770-4 reference table', () => {
  const [shelf, high] = lib.kWeighting(48000);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
  near(shelf.b[0], 1.53512485958697); near(shelf.b[1], -2.69169618940638); near(shelf.b[2], 1.19839281085285);
  near(shelf.a[1], -1.69065929318241); near(shelf.a[2], 0.73248077421585);
  near(high.a[1], -1.99004745483398); near(high.a[2], 0.99007225036621);
});

test('stereo 997 Hz sine at -23 dBFS measures -23.0 LUFS (EBU Tech 3341 calibration)', () => {
  const fs = 48000, s = sine(997, 10, fs, dbfs(-23));
  const l = lib.integratedLufs([s, s], fs);
  assert.ok(Math.abs(l - -23.0) < 0.1, `got ${l}`);
});

test('measurement is sample-rate independent (44.1 kHz, same -23 LUFS)', () => {
  const fs = 44100, s = sine(997, 10, fs, dbfs(-23));
  const l = lib.integratedLufs([s, s], fs);
  assert.ok(Math.abs(l - -23.0) < 0.15, `got ${l}`);
});

test('a mono sine reads 3 LU lower than the same sine on both channels', () => {
  const fs = 48000, s = sine(997, 10, fs, dbfs(-20));
  const stereo = lib.integratedLufs([s, s], fs), mono = lib.integratedLufs([s], fs);
  assert.ok(Math.abs((stereo - mono) - 3.01) < 0.05, `diff ${stereo - mono}`);
});

test('loudness follows level: +6 dB of amplitude = +6 LU', () => {
  const fs = 48000;
  const quiet = sine(997, 8, fs, dbfs(-30)), loud = sine(997, 8, fs, dbfs(-24));
  const d = lib.integratedLufs([loud, loud], fs) - lib.integratedLufs([quiet, quiet], fs);
  assert.ok(Math.abs(d - 6) < 0.05, `diff ${d}`);
});

test('the relative gate ignores a very quiet passage (gated, not averaged in)', () => {
  const fs = 48000;
  const loud = sine(997, 6, fs, dbfs(-20)), quiet = sine(997, 6, fs, dbfs(-60));
  const both = new Float32Array(loud.length + quiet.length); both.set(loud, 0); both.set(quiet, loud.length);
  const gated = lib.integratedLufs([both, both], fs), loudOnly = lib.integratedLufs([loud, loud], fs);
  assert.ok(Math.abs(gated - loudOnly) < 0.2, `gated ${gated} vs ${loudOnly}`);
});

test('silence and too-short material return -Infinity (never NaN)', () => {
  const fs = 48000;
  assert.equal(lib.integratedLufs([new Float32Array(fs * 3)], fs), -Infinity);
  assert.equal(lib.integratedLufs([new Float32Array(1000)], fs), -Infinity);
  assert.equal(lib.integratedLufs([], fs), -Infinity);
});

test('lufsToGainDb moves a track to the target and clamps', () => {
  assert.equal(lib.lufsToGainDb(-24, -18), 6);
  assert.equal(lib.lufsToGainDb(-10, -18), -8);
  assert.equal(lib.lufsToGainDb(-50, -18), 12);     // clamp +12
  assert.equal(lib.lufsToGainDb(0, -18), -12);      // clamp -12
  assert.equal(lib.lufsToGainDb(-Infinity, -18), 0);
});

test('toEqualizerApo writes a preamp that cancels the largest boost and one filter per active band', () => {
  const txt = lib.toEqualizerApo({ bands: [8, 7, 5, 2, 0, 0, 0, 0, 0, -3], bassBoost: 0 }, 'Bass boost');
  assert.match(txt, /Preamp: -8\.0 dB/);
  assert.match(txt, /Filter 1: ON LSC Fc 32 Hz Gain 8\.0 dB Q 0\.70/);
  assert.match(txt, /Filter 4: ON PK Fc 250 Hz Gain 2\.0 dB Q 1\.41/);
  assert.match(txt, /ON HSC Fc 16000 Hz Gain -3\.0 dB/);
  assert.equal((txt.match(/^Filter /gm) || []).length, 5);        // 32, 64, 125, 250, 16000
  assert.ok(txt.endsWith('\r\n'));
});

test('a flat EQ exports a flat file (preamp 0, no filters)', () => {
  const txt = lib.toEqualizerApo({ bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.match(txt, /Preamp: 0\.0 dB/);
  assert.equal((txt.match(/^Filter /gm) || []).length, 0);
});

test('bass boost adds a shelf and is counted in the headroom', () => {
  const txt = lib.toEqualizerApo({ bands: [4, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassBoost: 6 });
  assert.match(txt, /Preamp: -10\.0 dB/);                          // 4 (band) + 6 (shelf) overlap at the lowest band
  assert.match(txt, /ON LSC Fc 100 Hz Gain 6\.0 dB/);
});

test('export then parse round-trips every filter', () => {
  const bands = [3, 2, 1, 0, 1, 2, 1, 1, 2, 2];
  const parsed = lib.parseEqualizerApo(lib.toEqualizerApo({ bands }));
  assert.equal(parsed.preamp, -3);
  const byFc = Object.fromEntries(parsed.filters.map((f) => [f.fc, f.gain]));
  lib.EQ_FREQS.forEach((fc, i) => { if (bands[i]) assert.equal(byFc[fc], bands[i], `band ${fc}`); });
});

test('parse ignores comments, junk and OFF filters', () => {
  const p = lib.parseEqualizerApo('# hi\nInclude: evil.txt\nPreamp: -2 dB\nFilter 1: OFF PK Fc 1000 Hz Gain 3 dB Q 1\nFilter 2: ON PK Fc 1000 Hz Gain 3 dB Q 1\nrandom');
  assert.equal(p.preamp, -2);
  assert.equal(p.filters.length, 1);
});

test('sleep fade: full volume until the last 10 s, then linear to silence', () => {
  assert.equal(lib.sleepFadeGain(60000), 1);
  assert.equal(lib.sleepFadeGain(10000), 1);
  assert.equal(lib.sleepFadeGain(5000), 0.5);
  assert.equal(lib.sleepFadeGain(0), 0);
  assert.equal(lib.sleepFadeGain(-5), 0);
});

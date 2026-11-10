'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../renderer/photolib.js');

const img = (w, h, fn) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = fn(x, y); const i = (y * w + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return { data: d, width: w, height: h }; };
const flat = (v, w = 8, h = 8) => img(w, h, () => [v, v, v]);
const mean = (im) => { let s = 0; for (let i = 0; i < im.data.length; i += 4) s += im.data[i]; return s / (im.data.length / 4); };

test('neutral parameters leave the pixels untouched and never modify the source', () => {
  const src = img(6, 4, (x, y) => [x * 40, y * 60, 128]);
  const copy = new Uint8ClampedArray(src.data);
  const out = P.process(src, P.defaults());
  assert.deepEqual([...out.data], [...copy]);
  assert.deepEqual([...src.data], [...copy]);
  assert.notEqual(out.data, src.data);
  assert.equal(P.isNeutral({}), true); assert.equal(P.isNeutral({ exposure: 0.5 }), false);
});

test('parameters are clamped and sanitised', () => {
  const p = P.clampParams({ exposure: 99, contrast: -500, gamma: 'x', black: 300, white: 10, rotate: 45, crop: { x: -1, y: 2, w: 5, h: 0 }, flipH: 1 });
  assert.equal(p.exposure, 2); assert.equal(p.contrast, -100); assert.equal(p.gamma, 1); assert.ok(p.white > p.black);
  assert.equal(p.rotate, 0); assert.equal(p.flipH, true);
  assert.ok(p.crop.x >= 0 && p.crop.y <= 0.99 && p.crop.x + p.crop.w <= 1.0001 && p.crop.h >= 0.01);
  assert.equal(P.clampParams({ crop: { x: 'a' } }).crop, null);
});

test('exposure, contrast, shadows and highlights move the tones in the right direction', () => {
  assert.ok(mean(P.process(flat(100), { exposure: 1 })) > 150);
  assert.ok(mean(P.process(flat(100), { exposure: -1 })) < 70);
  const lut = P.toneLut(P.clampParams({ contrast: 60 }));
  assert.ok(lut[40] < 40 && lut[220] > 220, 'contrast darkens darks and brightens brights');
  const low = P.toneLut(P.clampParams({ contrast: -60 }));
  assert.ok(low[40] > 40 && low[220] < 220, 'negative contrast flattens');
  assert.ok(P.toneLut(P.clampParams({ shadows: 80 }))[40] > 40, 'shadows lifted');
  assert.ok(P.toneLut(P.clampParams({ highlights: -80 }))[220] < 220, 'highlights recovered');
  assert.ok(P.toneLut(P.clampParams({ shadows: 80 }))[250] === 250 || Math.abs(P.toneLut(P.clampParams({ shadows: 80 }))[250] - 250) <= 3, 'bright end barely moved by shadows');
  const l = P.toneLut(P.clampParams({ black: 50, white: 200 }));
  assert.equal(l[50], 0); assert.equal(l[200], 255);
  for (let i = 1; i < 256; i++) assert.ok(P.toneLut(P.clampParams({ exposure: 0.7, contrast: 40, shadows: 30, highlights: -30 }))[i] >= P.toneLut(P.clampParams({ exposure: 0.7, contrast: 40, shadows: 30, highlights: -30 }))[i - 1] - 1, 'curve stays (almost) monotonic');
});

test('saturation and white balance', () => {
  const px = img(2, 2, () => [200, 100, 50]);
  const gray = P.process(px, { saturation: -100 });
  assert.ok(Math.abs(gray.data[0] - gray.data[1]) <= 1 && Math.abs(gray.data[1] - gray.data[2]) <= 1, 'fully desaturated is gray');
  const sat = P.process(px, { saturation: 60 });
  assert.ok(sat.data[0] - sat.data[2] > px.data[0] - px.data[2]);
  const warm = P.process(flat(120), { temperature: 60 });
  assert.ok(warm.data[0] > warm.data[2]);
  const cool = P.process(flat(120), { temperature: -60 });
  assert.ok(cool.data[2] > cool.data[0]);
  const mag = P.process(flat(120), { tint: 60 });
  assert.ok(mag.data[1] < mag.data[0]);
});

test('sharpen raises edge contrast, flat areas stay flat', () => {
  const edge = img(8, 8, (x) => (x < 4 ? [80, 80, 80] : [160, 160, 160]));
  const out = P.process(edge, { sharpen: 100 });
  assert.ok(out.data[(3) * 4] < 80 && out.data[(4) * 4] > 160, 'overshoot on both sides of the edge');
  assert.equal(out.data[0], 80); assert.equal(out.data[7 * 4], 160);
});

test('denoise lowers noise but keeps a strong edge', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const noisy = img(24, 24, (x) => { const base = x < 12 ? 60 : 190, n = Math.round((rnd() - 0.5) * 24); return [base + n, base + n, base + n]; });
  const variance = (im, x0, x1) => { let s = 0, s2 = 0, n = 0; for (let y = 2; y < 22; y++) for (let x = x0; x < x1; x++) { const v = im.data[(y * 24 + x) * 4]; s += v; s2 += v * v; n++; } return s2 / n - (s / n) ** 2; };
  const out = P.process(noisy, { denoise: 100 });
  assert.ok(variance(out, 2, 10) < variance(noisy, 2, 10) * 0.6, 'noise reduced');
  assert.ok(out.data[(10 * 24 + 15) * 4] - out.data[(10 * 24 + 8) * 4] > 100, 'edge kept');
});

test('geometry: crop, flips and rotations', () => {
  const src = img(4, 2, (x, y) => [x * 10 + y, 0, 0]);   // values 0 10 20 30 / 1 11 21 31
  const val = (im, x, y) => im.data[(y * im.width + x) * 4];
  const r90 = P.process(src, { rotate: 90 });
  assert.deepEqual([r90.width, r90.height], [2, 4]);
  assert.equal(val(r90, 1, 0), 0, 'top-left of the source ends up top-right after a clockwise turn');
  assert.equal(val(r90, 0, 0), 1);
  const r180 = P.process(src, { rotate: 180 });
  assert.equal(val(r180, 0, 0), 31); assert.equal(val(r180, 3, 1), 0);
  const r270 = P.process(src, { rotate: 270 });
  assert.equal(val(r270, 0, 0), 30);
  const fh = P.process(src, { flipH: true }); assert.equal(val(fh, 0, 0), 30);
  const fv = P.process(src, { flipV: true }); assert.equal(val(fv, 0, 0), 1);
  const cr = P.process(src, { crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  assert.deepEqual([cr.width, cr.height], [2, 2]); assert.equal(val(cr, 0, 0), 20);
  assert.deepEqual(P.outputSize(4000, 3000, { rotate: 90, crop: { x: 0, y: 0, w: 0.5, h: 1 } }), { width: 3000, height: 2000 });
});

test('auto enhance stretches a dull image and leaves a full-range one nearly alone', () => {
  const dull = img(32, 32, (x) => { const v = 90 + Math.floor((x / 31) * 70); return [v, v, v]; });
  const p = P.autoParams(dull);
  assert.ok(p.black > 60 && p.white < 200 + 60);
  const out = P.process(dull, p);
  const range = (im) => { let lo = 255, hi = 0; for (let i = 0; i < im.data.length; i += 4) { lo = Math.min(lo, im.data[i]); hi = Math.max(hi, im.data[i]); } return hi - lo; };
  assert.ok(range(out) > range(dull) * 1.4);
  const full = img(32, 32, (x) => { const v = Math.floor((x / 31) * 255); return [v, v, v]; });
  const pf = P.autoParams(full);
  assert.ok(pf.black <= 10 && pf.white >= 245 && pf.gamma > 0.85 && pf.gamma < 1.2);
});

test('preview size keeps the aspect ratio and never upscales; histogram counts every pixel', () => {
  assert.deepEqual(P.previewSize(6000, 3000, 1500), { width: 1500, height: 750, scale: 0.25 });
  assert.equal(P.previewSize(800, 600, 1500).scale, 1);
  const h = P.histogram(flat(10, 5, 5).data); assert.equal(h[10], 25); assert.equal(h.reduce((a, b) => a + b, 0), 25);
});

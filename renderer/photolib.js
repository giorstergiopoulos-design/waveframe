'use strict';
// Photo enhancement maths (2.3.0). Pure functions over RGBA byte arrays ({ data, width, height }), so the same code produces the live preview (on a
// downscaled copy) and the export at the original resolution, and is unit-tested in Node without a browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveframePhoto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = { maxPixels: 80e6, previewEdge: 1400, maxFileBytes: 200 * 1024 * 1024 };
  const RANGE = {
    exposure: [-2, 2], contrast: [-100, 100], saturation: [-100, 100], temperature: [-100, 100], tint: [-100, 100],
    highlights: [-100, 100], shadows: [-100, 100], sharpen: [0, 100], denoise: [0, 100],
    black: [0, 254], white: [1, 255], gamma: [0.2, 5],
  };
  function defaults() {
    return { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, sharpen: 0, denoise: 0, black: 0, white: 255, gamma: 1, rotate: 0, flipH: false, flipV: false, crop: null };
  }
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  function clampParams(p) {
    const d = defaults(), o = { ...d };
    for (const k of Object.keys(RANGE)) o[k] = Math.min(RANGE[k][1], Math.max(RANGE[k][0], num(p && p[k], d[k])));
    if (o.white <= o.black) o.white = Math.min(255, o.black + 1);
    o.rotate = [0, 90, 180, 270].includes(Number(p && p.rotate)) ? Number(p.rotate) : 0;
    o.flipH = !!(p && p.flipH); o.flipV = !!(p && p.flipV);
    const c = p && p.crop;
    if (c && [c.x, c.y, c.w, c.h].every(Number.isFinite)) {
      const x = Math.min(0.99, Math.max(0, c.x)), y = Math.min(0.99, Math.max(0, c.y));
      o.crop = { x, y, w: Math.min(1 - x, Math.max(0.01, c.w)), h: Math.min(1 - y, Math.max(0.01, c.h)) };
    }
    return o;
  }
  const isNeutral = (p) => JSON.stringify(clampParams(p)) === JSON.stringify(defaults());

  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // One 256-entry curve for the tonal controls: levels -> gamma -> exposure -> shadows/highlights -> contrast (S-curve around the middle).
  function toneLut(p) {
    const lut = new Uint8ClampedArray(256), gain = Math.pow(2, p.exposure), c = p.contrast / 100;
    for (let i = 0; i < 256; i++) {
      let v = Math.min(1, Math.max(0, (i - p.black) / (p.white - p.black)));
      v = Math.pow(v, 1 / p.gamma);
      v = Math.min(1, v * gain);
      v += (p.shadows / 100) * 0.35 * (1 - smooth(0, 0.55, v)) * (1 - v) * 1.4;      // lifts / deepens the dark half
      v += (p.highlights / 100) * 0.35 * smooth(0.45, 1, v) * v;              // recovers / pushes the bright half
      v = Math.min(1, Math.max(0, v));
      if (c > 0) v = v < 0.5 ? 0.5 * Math.pow(2 * v, 1 + c * 1.2) : 1 - 0.5 * Math.pow(2 * (1 - v), 1 + c * 1.2);
      else if (c < 0) v = 0.5 + (v - 0.5) * (1 + c * 0.6);
      lut[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    return lut;
  }

  // Colour: white balance (warm/cool, green/magenta), then saturation around the pixel's luma.
  function applyColor(data, params) {
    const p = clampParams(params), lut = toneLut(p);
    const t = p.temperature / 100, g = p.tint / 100, sat = 1 + p.saturation / 100;
    const mr = 1 + 0.25 * t + 0.06 * g, mg = 1 - 0.12 * g, mb = 1 - 0.25 * t + 0.06 * g;
    const neutral = t === 0 && g === 0 && p.saturation === 0;
    for (let i = 0; i < data.length; i += 4) {
      let r = lut[data[i]], gg = lut[data[i + 1]], b = lut[data[i + 2]];
      if (!neutral) {
        r *= mr; gg *= mg; b *= mb;
        const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        r = y + (r - y) * sat; gg = y + (gg - y) * sat; b = y + (b - y) * sat;
      }
      data[i] = r < 0 ? 0 : r > 255 ? 255 : r; data[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg; data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b; // Uint8ClampedArray rounds
    }
    return data;
  }

  // Edge-preserving 3x3 smoothing: neighbours count less the more their colour differs (so edges and texture survive, flat noise is averaged).
  function denoise(img, amount) {
    if (!(amount > 0)) return img;
    const { data, width: w, height: h } = img, out = new Uint8ClampedArray(data.length), k = amount / 100;
    const sigma = 12 + 60 * k, inv = 1 / (2 * sigma * sigma);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx)), j = (yy * w + xx) * 4;
          const dr = data[j] - data[i], dg = data[j + 1] - data[i + 1], db = data[j + 2] - data[i + 2];
          const wt = Math.exp(-(dr * dr + dg * dg + db * db) * inv);
          sr += data[j] * wt; sg += data[j + 1] * wt; sb += data[j + 2] * wt; sw += wt;
        }
      }
      out[i] = data[i] + (sr / sw - data[i]) * k; out[i + 1] = data[i + 1] + (sg / sw - data[i + 1]) * k; out[i + 2] = data[i + 2] + (sb / sw - data[i + 2]) * k; out[i + 3] = data[i + 3];
    }
    return { data: out, width: w, height: h };
  }

  // Unsharp mask (3x3 blur): original + amount * (original - blurred).
  function sharpen(img, amount) {
    if (!(amount > 0)) return img;
    const { data, width: w, height: h } = img, out = new Uint8ClampedArray(data.length), a = amount / 100 * 1.6;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -1; dx <= 1; dx++) s += data[(yy * w + Math.min(w - 1, Math.max(0, x + dx))) * 4 + c] * (dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1); }
        const blur = s / 16;
        out[i + c] = data[i + c] + a * (data[i + c] - blur);
      }
      out[i + 3] = data[i + 3];
    }
    return { data: out, width: w, height: h };
  }

  // Crop (normalised rectangle of the ORIGINAL orientation), then flip, then rotate by multiples of 90 degrees.
  function geometry(img, params) {
    const p = clampParams(params);
    if (!p.crop && !p.flipH && !p.flipV && !p.rotate) return img;
    let { data, width: w, height: h } = img;
    if (p.crop) {
      const cx = Math.round(p.crop.x * w), cy = Math.round(p.crop.y * h), cw = Math.max(1, Math.min(w - cx, Math.round(p.crop.w * w))), ch = Math.max(1, Math.min(h - cy, Math.round(p.crop.h * h)));
      const o = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) o.set(data.subarray(((cy + y) * w + cx) * 4, ((cy + y) * w + cx + cw) * 4), y * cw * 4);
      data = o; w = cw; h = ch;
    }
    const nw = p.rotate === 90 || p.rotate === 270 ? h : w, nh = p.rotate === 90 || p.rotate === 270 ? w : h;
    const out = new Uint8ClampedArray(nw * nh * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = p.flipH ? w - 1 - x : x, sy = p.flipV ? h - 1 - y : y;
      let dx, dy;
      if (p.rotate === 0) { dx = x; dy = y; } else if (p.rotate === 90) { dx = h - 1 - y; dy = x; } else if (p.rotate === 180) { dx = w - 1 - x; dy = h - 1 - y; } else { dx = y; dy = w - 1 - x; }
      const s = (sy * w + sx) * 4, d = (dy * nw + dx) * 4;
      out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
    return { data: out, width: nw, height: nh };
  }

  // Whole pipeline. The source is never modified (a copy is made).
  function process(img, params) {
    const p = clampParams(params);
    let cur = geometry({ data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }, p);
    if (cur.data === img.data) cur = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
    cur = denoise(cur, p.denoise);
    applyColor(cur.data, p);
    return sharpen(cur, p.sharpen);
  }

  function histogram(data) {
    const bins = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) bins[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++;
    return bins;
  }

  // "Auto": stretch the levels to the 0.5 % / 99.5 % percentiles and move the mean towards the middle with gamma.
  function autoParams(img) {
    const bins = histogram(img.data), total = img.width * img.height, lo = total * 0.005, hi = total * 0.995;
    let acc = 0, black = 0, white = 255;
    for (let i = 0; i < 256; i++) { acc += bins[i]; if (acc >= lo) { black = i; break; } }
    acc = 0; for (let i = 0; i < 256; i++) { acc += bins[i]; if (acc >= hi) { white = i; break; } }
    if (white - black < 16) { black = 0; white = 255; }
    let mean = 0; for (let i = 0; i < 256; i++) mean += bins[i] * Math.min(1, Math.max(0, (i - black) / (white - black)));
    mean /= total;
    const gamma = Math.min(1.6, Math.max(0.7, mean > 0.01 && mean < 0.99 ? Math.log(0.45) / Math.log(mean) : 1));
    return clampParams({ ...defaults(), black: Math.min(black, 120), white: Math.max(white, 135), gamma: Math.round(gamma * 100) / 100, saturation: 8 });
  }

  function previewSize(w, h, maxEdge) {
    const m = maxEdge || LIMITS.previewEdge, s = Math.min(1, m / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scale: s };
  }
  function outputSize(w, h, params) {
    const p = clampParams(params);
    const cw = p.crop ? Math.max(1, Math.min(w, Math.round(p.crop.w * w))) : w, ch = p.crop ? Math.max(1, Math.min(h, Math.round(p.crop.h * h))) : h;
    return p.rotate === 90 || p.rotate === 270 ? { width: ch, height: cw } : { width: cw, height: ch };
  }
  const EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'];
  const OUT_FORMATS = { jpeg: { mime: 'image/jpeg', ext: 'jpg' }, png: { mime: 'image/png', ext: 'png' }, webp: { mime: 'image/webp', ext: 'webp' } };

  return { LIMITS, RANGE, EXTS, OUT_FORMATS, defaults, clampParams, isNeutral, toneLut, applyColor, denoise, sharpen, geometry, process, histogram, autoParams, previewSize, outputSize };
});

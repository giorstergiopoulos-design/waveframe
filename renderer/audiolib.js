/* Waveframe audio library — pure functions, no DOM / Web Audio dependency, so they run both in the renderer
 * (<script src="audiolib.js"> exposes window.WaveframeAudio) and in node (require) for the unit tests.
 *
 *  - integratedLufs():   ITU-R BS.1770-4 integrated loudness (K-weighting + 400 ms blocks, 75 % overlap, absolute -70 LUFS
 *                        and relative -10 LU gates). Replaces the old RMS estimate for loudness normalisation.
 *  - lufsToGainDb():     gain that brings a track to the target loudness, clamped.
 *  - toEqualizerApo():   waveframe EQ -> Equalizer APO config text (also understood by Opsis "Audio Enhancement").
 *  - parseEqualizerApo() the reverse, for the lines we generate (Preamp / Filter n: ON PK|LSC|HSC ...).
 *  - sleepFadeGain():    master-gain factor for the sleep timer's fade-out.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WaveframeAudio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  /** K-weighting biquad coefficients for any sample rate (BS.1770-4 filter re-derived from its analogue prototype). */
  function kWeighting(fs) {
    // Stage 1: high shelf (+4 dB above ~1.7 kHz) — models the head's acoustic effect.
    const G = 3.999843853973347, Q1 = 0.7071752369554196, fc1 = 1681.9744509555319;
    let K = Math.tan(Math.PI * fc1 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q1 + K * K;
    const shelf = {
      b: [(Vh + Vb * K / Q1 + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q1 + K * K) / a0],
      a: [1, 2 * (K * K - 1) / a0, (1 - K / Q1 + K * K) / a0],
    };
    // Stage 2: revised low-frequency B-curve (high-pass at ~38 Hz).
    const Q2 = 0.5003270373238773, fc2 = 38.13547087613982;
    K = Math.tan(Math.PI * fc2 / fs);
    a0 = 1 + K / Q2 + K * K;
    const high = { b: [1, -2, 1], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q2 + K * K) / a0] };
    return [shelf, high];
  }

  function biquad(input, c) {
    const out = new Float64Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const [b0, b1, b2] = c.b, [, a1, a2] = c.a;
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i];
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y0; x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    }
    return out;
  }

  /**
   * Integrated loudness in LUFS. channels: array of Float32Array/Float64Array (one per channel).
   * Returns -Infinity for silence / material shorter than one block.
   */
  function integratedLufs(channels, sampleRate) {
    if (!channels.length || !channels[0].length) return -Infinity;
    const [shelf, high] = kWeighting(sampleRate);
    const n = channels[0].length;
    const block = Math.round(0.4 * sampleRate), step = Math.round(0.1 * sampleRate);
    if (n < block) return -Infinity;
    // Prefix sums of the squared, K-weighted samples: mean square of any block in O(1).
    const prefix = channels.map((ch) => {
      const f = biquad(biquad(ch, shelf), high);
      const p = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) p[i + 1] = p[i] + f[i] * f[i];
      return p;
    });
    // BS.1770 channel weights: 1.0 for L/R/C, 1.41 for the surround channels (indices 3 and 4 of a 5.x layout).
    const weight = (c) => (channels.length >= 5 && (c === 3 || c === 4) ? 1.41 : 1);
    const blocks = [];
    for (let start = 0; start + block <= n; start += step) {
      let sum = 0;
      for (let c = 0; c < prefix.length; c++) sum += weight(c) * (prefix[c][start + block] - prefix[c][start]) / block;
      blocks.push(sum);
    }
    const lufs = (z) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => z > 0 && lufs(z) > -70);
    if (!abs.length) return -Infinity;
    const relGate = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const kept = abs.filter((z) => lufs(z) > relGate);
    if (!kept.length) return -Infinity;
    return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
  }

  /** Linear gain that moves a track at `lufs` to `targetLufs`, limited to ±clampDb (default ±12 dB). */
  function lufsToGainDb(lufs, targetLufs = -18, clampDb = 12) {
    if (!Number.isFinite(lufs)) return 0;
    return Math.max(-clampDb, Math.min(clampDb, targetLufs - lufs));
  }

  const dbToLinear = (db) => Math.pow(10, db / 20);

  /** Waveframe EQ -> Equalizer APO text. state: { bands:[10 dB values], bassBoost: dB (optional) }. */
  function toEqualizerApo(state, name = 'Waveframe EQ') {
    const bands = (state.bands || []).slice(0, EQ_FREQS.length);
    while (bands.length < EQ_FREQS.length) bands.push(0);
    const bass = Number(state.bassBoost) || 0;
    // Headroom: the largest boost anywhere (band + bass shelf) is cancelled by the preamp so the output cannot clip.
    const maxBoost = Math.max(0, ...bands, bass, ...bands.map((g, i) => g + (i <= 2 ? bass : 0)));
    const preamp = -(Math.ceil(maxBoost * 10) / 10);
    const f = (v) => (Math.round(v * 10) / 10).toFixed(1);
    const lines = [`# ${String(name).replace(/[\r\n]+/g, ' ')} — exported by Waveframe (open with Equalizer APO or Opsis > Audio Enhancement)`, `Preamp: ${f(preamp)} dB`];
    let n = 1;
    EQ_FREQS.forEach((freq, i) => {
      if (Math.abs(bands[i]) < 0.05) return;
      const type = i === 0 ? 'LSC' : i === EQ_FREQS.length - 1 ? 'HSC' : 'PK';
      const q = type === 'PK' ? 1.41 : 0.70;
      lines.push(`Filter ${n++}: ON ${type} Fc ${freq} Hz Gain ${f(bands[i])} dB Q ${q.toFixed(2)}`);
    });
    if (Math.abs(bass) >= 0.05) lines.push(`Filter ${n++}: ON LSC Fc 100 Hz Gain ${f(bass)} dB Q 0.70`);
    return lines.join('\r\n') + '\r\n';
  }

  /** Parses the Equalizer APO lines we generate. Returns { preamp, filters:[{type,fc,gain,q}] } (unknown lines are ignored). */
  function parseEqualizerApo(text) {
    const out = { preamp: 0, filters: [] };
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      let m = /^Preamp:\s*(-?\d+(?:\.\d+)?)\s*dB$/i.exec(line);
      if (m) { out.preamp = parseFloat(m[1]); continue; }
      m = /^Filter\s*\d*:\s*ON\s+(PK|LSC|HSC|LS|HS)\s+Fc\s+(\d+(?:\.\d+)?)\s*Hz\s+Gain\s+(-?\d+(?:\.\d+)?)\s*dB(?:\s+Q\s+(\d+(?:\.\d+)?))?/i.exec(line);
      if (m) out.filters.push({ type: m[1].toUpperCase(), fc: parseFloat(m[2]), gain: parseFloat(m[3]), q: m[4] ? parseFloat(m[4]) : 0.7 });
    }
    return out;
  }

  /** Fade-out factor (1 → 0) for the last `fadeMs` of the sleep timer. */
  function sleepFadeGain(remainingMs, fadeMs = 10000) {
    if (remainingMs <= 0) return 0;
    if (remainingMs >= fadeMs) return 1;
    return remainingMs / fadeMs;
  }

  return { EQ_FREQS, kWeighting, integratedLufs, lufsToGainDb, dbToLinear, toEqualizerApo, parseEqualizerApo, sleepFadeGain };
});

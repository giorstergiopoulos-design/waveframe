'use strict';

/* ------------------------------------------------------------------ */
/* Global error handling — crash overlay + local log file             */
/* ------------------------------------------------------------------ */
function handleFatalError(message, details) {
  window.waveframe?.logCrash?.(`${message}\n${details || ''}`);
  const overlay = document.getElementById('crashOverlay');
  const detailsEl = document.getElementById('crashDetails');
  if (!overlay || !detailsEl) return; // can happen if DOM isn't ready yet
  detailsEl.textContent = `${message}\n${details || ''}`.trim();
  overlay.classList.remove('dep-hidden');
}
window.addEventListener('error', (e) => {
  handleFatalError(e.message, e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  handleFatalError('Unhandled promise rejection', e.reason?.stack || String(e.reason));
});

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const PRESETS = [
  { key: 'flat', icon: '⚖️', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { key: 'music', icon: '🎵', bands: [3, 2, 1, 0, 1, 2, 1, 1, 2, 2] },
  { key: 'gaming', icon: '🎮', bands: [4, 3, 1, -1, -1, 0, 2, 3, 4, 4] },
  { key: 'movies', icon: '🎬', bands: [6, 5, 3, 1, 0, 0, 1, 2, 3, 4] },
  { key: 'voice', icon: '🎙️', bands: [-4, -3, -2, 0, 2, 4, 5, 3, 1, 0] },
  { key: 'bassBoost', icon: '🔊', bands: [8, 7, 5, 2, 0, 0, 0, 0, 0, 0] },
  { key: 'classical', icon: '🎻', bands: [1, 1, 0, 0, 0, 0, 0, 1, 2, 2] },
  { key: 'rock', icon: '🎸', bands: [3, 2, 1, -1, -1, 1, 2, 3, 3, 2] },
  { key: 'pop', icon: '⭐', bands: [-1, 0, 2, 4, 4, 2, 0, -1, -1, -1] },
  { key: 'jazz', icon: '🎷', bands: [2, 1, 0, 1, 2, 2, 1, 1, 2, 3] },
  { key: 'electronic', icon: '🎛️', bands: [5, 4, 1, 0, -1, 1, 1, 2, 4, 5] },
  { key: 'hiphop', icon: '🎤', bands: [6, 5, 3, 1, 0, -1, 0, 1, 2, 2] },
  { key: 'acoustic', icon: '🪕', bands: [2, 2, 1, 0, 0, 1, 2, 2, 1, 1] },
  { key: 'latin', icon: '💃', bands: [3, 2, 1, 0, 1, 2, 3, 3, 2, 1] },
  { key: 'smallSpeakers', icon: '🔈', bands: [4, 3, 2, 1, 0, 1, 2, 3, 3, 2] },
  { key: 'trebleBoost', icon: '✨', bands: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6] },
];

const QUALITY = {
  low: { sampleRate: 22050, bitrate: 96 },
  medium: { sampleRate: 44100, bitrate: 128 },
  high: { sampleRate: 48000, bitrate: 320 },
  lossless: { sampleRate: 48000, bitrate: null },
};
// Opus is far more efficient than MP3/AAC at a given bitrate, so the shared
// QUALITY bitrates (up to 320k) would be wasteful for it — use its own,
// lower bitrate ladder instead (still forced to 48kHz, see main.js).
const OPUS_BITRATES = { low: 64, medium: 96, high: 160 };

const USER_PRESET_KEY = 'waveframe.userPresets';

/* ------------------------------------------------------------------ */
/* Audio engine                                                       */
/* ------------------------------------------------------------------ */

class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.slots = [
      { el: document.getElementById('audioSlotA'), source: null, gain: null, name: null },
      { el: document.getElementById('audioSlotB'), source: null, gain: null, name: null },
    ];
    this.activeSlot = 0;
    this.crossfadeSeconds = 0;

    this.micStream = null;
    this.micSource = null;
    this.testOsc = null;

    this.state = {
      eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bassBoost: 0,
      volumeBoost: 0,
      surround: 0,
      compressor: false,
      reverb: false,
      exciter: false,
      tempo: 1,
      preservePitch: true,
      volume: 0.8,
      muted: false,
      normalizationEnabled: true,
      masterEnabled: true,
    };

    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.mixSum = ctx.createGain();
    this.mixSum.gain.value = 1;

    this.slots.forEach((slot) => {
      slot.source = ctx.createMediaElementSource(slot.el);
      slot.gain = ctx.createGain();
      slot.gain.gain.value = 0;
      slot.source.connect(slot.gain);
      slot.gain.connect(this.mixSum);
    });

    this.micGain = ctx.createGain();
    this.micGain.gain.value = 0;
    this.micGain.connect(this.mixSum);

    this.toneGain = ctx.createGain();
    this.toneGain.gain.value = 0;
    this.toneGain.connect(this.mixSum);

    this.eqNodes = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      if (i === 0) f.type = 'lowshelf';
      else if (i === EQ_FREQS.length - 1) f.type = 'highshelf';
      else f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.4;
      f.gain.value = 0;
      return f;
    });
    for (let i = 0; i < this.eqNodes.length - 1; i++) {
      this.eqNodes[i].connect(this.eqNodes[i + 1]);
    }
    // Loudness-normalization trim, applied before any EQ/FX coloring so
    // boosts behave consistently regardless of the source track's own level.
    this.normGain = ctx.createGain();
    this.normGain.gain.value = 1;
    this.mixSum.connect(this.normGain);
    this.normGain.connect(this.eqNodes[0]);
    const eqOut = this.eqNodes[this.eqNodes.length - 1];

    this.bassBoostNode = ctx.createBiquadFilter();
    this.bassBoostNode.type = 'lowshelf';
    this.bassBoostNode.frequency.value = 90;
    this.bassBoostNode.gain.value = 0;
    eqOut.connect(this.bassBoostNode);

    this.volumeBoostNode = ctx.createGain();
    this.volumeBoostNode.gain.value = 1;
    this.bassBoostNode.connect(this.volumeBoostNode);

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    this.volumeBoostNode.connect(splitter);

    this.surroundInvert = ctx.createGain();
    this.surroundInvert.gain.value = -1;
    this.surroundMid = ctx.createGain();
    this.surroundMid.gain.value = 0.5;
    this.surroundSide = ctx.createGain();
    this.surroundSide.gain.value = 0;

    splitter.connect(this.surroundMid, 0);
    splitter.connect(this.surroundMid, 1);
    splitter.connect(this.surroundSide, 0);
    splitter.connect(this.surroundInvert, 1);
    this.surroundInvert.connect(this.surroundSide);

    this.surroundMid.connect(merger, 0, 0);
    this.surroundMid.connect(merger, 0, 1);
    this.surroundSide.connect(merger, 0, 0);
    const sideInvertR = ctx.createGain();
    sideInvertR.gain.value = -1;
    this.surroundSide.connect(sideInvertR);
    sideInvertR.connect(merger, 0, 1);

    this.compressorNode = ctx.createDynamicsCompressor();
    this.compressorNode.threshold.value = -24;
    this.compressorNode.knee.value = 30;
    this.compressorNode.ratio.value = 8;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.25;
    this.compDry = ctx.createGain();
    this.compWet = ctx.createGain();
    this.compWet.gain.value = 0;
    this.compDry.gain.value = 1;
    merger.connect(this.compDry);
    merger.connect(this.compressorNode);
    this.compressorNode.connect(this.compWet);
    this.compSum = ctx.createGain();
    this.compDry.connect(this.compSum);
    this.compWet.connect(this.compSum);

    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = this._makeImpulseResponse(2.2, 2.0);
    this.reverbDry = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0;
    this.reverbDry.gain.value = 1;
    this.compSum.connect(this.reverbDry);
    this.compSum.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbWet);
    this.reverbSum = ctx.createGain();
    this.reverbDry.connect(this.reverbSum);
    this.reverbWet.connect(this.reverbSum);

    this.exciterNode = ctx.createWaveShaper();
    this.exciterNode.curve = this._makeSaturationCurve();
    this.exciterNode.oversample = '4x';
    this.exciterDry = ctx.createGain();
    this.exciterWet = ctx.createGain();
    this.exciterWet.gain.value = 0;
    this.exciterDry.gain.value = 1;
    this.reverbSum.connect(this.exciterDry);
    this.reverbSum.connect(this.exciterNode);
    this.exciterNode.connect(this.exciterWet);
    this.exciterSum = ctx.createGain();
    this.exciterDry.connect(this.exciterSum);
    this.exciterWet.connect(this.exciterSum);

    this.masterBypassDry = ctx.createGain();
    this.masterBypassDry.gain.value = 0;
    this.masterBypassWet = ctx.createGain();
    this.masterBypassWet.gain.value = 1;
    this.mixSum.connect(this.masterBypassDry);
    this.exciterSum.connect(this.masterBypassWet);
    this.masterBypassSum = ctx.createGain();
    this.masterBypassDry.connect(this.masterBypassSum);
    this.masterBypassWet.connect(this.masterBypassSum);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.state.volume;
    this.masterBypassSum.connect(this.masterGain);

    // Brick-wall-ish limiter at the very end of the chain, catching clipping
    // from any combination of EQ/boost/FX settings, regardless of source.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;
    this.masterGain.connect(this.limiter);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  _makeImpulseResponse(duration, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  _makeSaturationCurve() {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) * 0.9 + x * 0.1;
    }
    return curve;
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  stopAlternateSources() {
    this.micGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.toneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    if (this.testOsc) {
      try { this.testOsc.stop(); } catch { /* already stopped */ }
      this.testOsc = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((tr) => tr.stop());
      this.micStream = null;
      this.micSource = null;
    }
  }

  async startMic() {
    this.stopAlternateSources();
    this.pauseActive();
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.micGain);
    this.micGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }

  playTestTone() {
    this.stopAlternateSources();
    this.pauseActive();
    this.testOsc = this.ctx.createOscillator();
    this.testOsc.type = 'sine';
    this.testOsc.frequency.value = 440;
    this.testOsc.connect(this.toneGain);
    this.testOsc.start();
    this.toneGain.gain.setTargetAtTime(0.4, this.ctx.currentTime, 0.05);
  }

  get activeEl() { return this.slots[this.activeSlot].el; }

  play() {
    this.resume();
    this.stopAlternateSources();
    const slot = this.slots[this.activeSlot];
    slot.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
    slot.el.playbackRate = this.state.tempo;
    slot.el.preservesPitch = this.state.preservePitch;
    return slot.el.play();
  }

  pauseActive() { this.slots.forEach((s) => s.el.pause()); }

  togglePlay() {
    if (this.activeEl.paused) return this.play();
    this.pauseActive();
    return Promise.resolve();
  }

  seekTo(fraction) {
    const el = this.activeEl;
    if (el.duration) el.currentTime = fraction * el.duration;
  }

  setVolume(v) {
    this.state.volume = v;
    if (!this.state.muted) this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setMasterEnable(on) {
    this.state.masterEnabled = on;
    const tt = this.ctx.currentTime;
    this.masterBypassWet.gain.setTargetAtTime(on ? 1 : 0, tt, 0.05);
    this.masterBypassDry.gain.setTargetAtTime(on ? 0 : 1, tt, 0.05);
  }

  setMuted(m) {
    this.state.muted = m;
    this.masterGain.gain.setTargetAtTime(m ? 0 : this.state.volume, this.ctx.currentTime, 0.02);
  }

  setTempo(rate) {
    this.state.tempo = rate;
    this.slots.forEach((s) => { s.el.playbackRate = rate; });
  }

  setPreservePitch(on) {
    this.state.preservePitch = on;
    this.slots.forEach((s) => { s.el.preservesPitch = on; });
  }

  switchTrack(loader, onReady) {
    const nextSlotIndex = this.crossfadeSeconds > 0 ? 1 - this.activeSlot : this.activeSlot;
    const prevSlotIndex = this.activeSlot;
    const nextSlot = this.slots[nextSlotIndex];

    if (nextSlotIndex === prevSlotIndex) {
      loader(nextSlotIndex);
      nextSlot.gain.gain.value = 1;
      this.resume();
      nextSlot.el.playbackRate = this.state.tempo;
      nextSlot.el.preservesPitch = this.state.preservePitch;
      nextSlot.el.play();
      if (onReady) onReady(nextSlot);
      return;
    }

    loader(nextSlotIndex);
    nextSlot.gain.gain.value = 0;
    this.resume();
    nextSlot.el.playbackRate = this.state.tempo;
    nextSlot.el.preservesPitch = this.state.preservePitch;

    const doCrossfade = () => {
      const now = this.ctx.currentTime;
      const dur = this.crossfadeSeconds;
      const prevSlot = this.slots[prevSlotIndex];
      nextSlot.gain.gain.cancelScheduledValues(now);
      nextSlot.gain.gain.setValueAtTime(0, now);
      nextSlot.gain.gain.linearRampToValueAtTime(1, now + dur);
      prevSlot.gain.gain.cancelScheduledValues(now);
      prevSlot.gain.gain.setValueAtTime(prevSlot.gain.gain.value, now);
      prevSlot.gain.gain.linearRampToValueAtTime(0, now + dur);
      setTimeout(() => prevSlot.el.pause(), dur * 1000 + 50);
      this.activeSlot = nextSlotIndex;
    };

    nextSlot.el.play().then(doCrossfade).catch(doCrossfade);
    if (onReady) onReady(nextSlot);
  }

  setEqBand(index, db) {
    this.state.eqBands[index] = db;
    this.eqNodes[index].gain.setTargetAtTime(db, this.ctx.currentTime, 0.02);
  }
  applyEqBands(bands) { bands.forEach((db, i) => this.setEqBand(i, db)); }

  setNormalizationEnabled(on) {
    this.state.normalizationEnabled = on;
  }
  setNormalizationGain(linearGain) {
    const target = this.state.normalizationEnabled ? linearGain : 1;
    this.normGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }
  setBassBoost(db) {
    this.state.bassBoost = db;
    this.bassBoostNode.gain.setTargetAtTime(db, this.ctx.currentTime, 0.02);
  }
  setVolumeBoostDb(db) {
    this.state.volumeBoost = db;
    this.volumeBoostNode.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.02);
  }
  setSurround(pct) {
    this.state.surround = pct;
    const w = (pct / 100) * 1.6;
    this.surroundSide.gain.setTargetAtTime(0.5 * w, this.ctx.currentTime, 0.02);
  }
  setCompressor(on) {
    this.state.compressor = on;
    const tt = this.ctx.currentTime;
    this.compWet.gain.setTargetAtTime(on ? 1 : 0, tt, 0.05);
    this.compDry.gain.setTargetAtTime(on ? 0 : 1, tt, 0.05);
  }
  setReverb(on) {
    this.state.reverb = on;
    const tt = this.ctx.currentTime;
    this.reverbWet.gain.setTargetAtTime(on ? 0.28 : 0, tt, 0.05);
    this.reverbDry.gain.setTargetAtTime(1, tt, 0.05);
  }
  setExciter(on) {
    this.state.exciter = on;
    const tt = this.ctx.currentTime;
    this.exciterWet.gain.setTargetAtTime(on ? 0.35 : 0, tt, 0.05);
    this.exciterDry.gain.setTargetAtTime(1, tt, 0.05);
  }
  resetEffects() {
    this.setBassBoost(0);
    this.setVolumeBoostDb(0);
    this.setSurround(0);
  }

  async renderOffline(buffer) {
    const rate = buffer.sampleRate;
    const offline = new OfflineAudioContext(2, Math.ceil(buffer.duration / this.state.tempo * rate) + rate, rate);

    const src = offline.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.state.tempo;

    if (!this.state.masterEnabled) {
      src.connect(offline.destination);
      src.start();
      return offline.startRendering();
    }

    const eqNodes = EQ_FREQS.map((freq, i) => {
      const f = offline.createBiquadFilter();
      if (i === 0) f.type = 'lowshelf'; else if (i === EQ_FREQS.length - 1) f.type = 'highshelf'; else f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1.4;
      f.gain.value = this.state.eqBands[i];
      return f;
    });
    for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i + 1]);

    const bassBoost = offline.createBiquadFilter();
    bassBoost.type = 'lowshelf';
    bassBoost.frequency.value = 90;
    bassBoost.gain.value = this.state.bassBoost;

    const volBoost = offline.createGain();
    volBoost.gain.value = Math.pow(10, this.state.volumeBoost / 20);

    let chainEnd = volBoost;
    src.connect(eqNodes[0]);
    eqNodes[eqNodes.length - 1].connect(bassBoost);
    bassBoost.connect(volBoost);

    if (this.state.compressor) {
      const comp = offline.createDynamicsCompressor();
      comp.threshold.value = -24; comp.knee.value = 30; comp.ratio.value = 8;
      comp.attack.value = 0.003; comp.release.value = 0.25;
      chainEnd.connect(comp);
      chainEnd = comp;
    }
    if (this.state.reverb) {
      const conv = offline.createConvolver();
      conv.buffer = this._makeImpulseResponse(2.2, 2.0);
      const dry = offline.createGain(); dry.gain.value = 1;
      const wet = offline.createGain(); wet.gain.value = 0.28;
      const sum = offline.createGain();
      chainEnd.connect(dry); dry.connect(sum);
      chainEnd.connect(conv); conv.connect(wet); wet.connect(sum);
      chainEnd = sum;
    }
    if (this.state.exciter) {
      const shaper = offline.createWaveShaper();
      shaper.curve = this._makeSaturationCurve();
      shaper.oversample = '4x';
      const dry = offline.createGain(); dry.gain.value = 1;
      const wet = offline.createGain(); wet.gain.value = 0.35;
      const sum = offline.createGain();
      chainEnd.connect(dry); dry.connect(sum);
      chainEnd.connect(shaper); shaper.connect(wet); wet.connect(sum);
      chainEnd = sum;
    }

    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.001; limiter.release.value = 0.05;
    chainEnd.connect(limiter);
    limiter.connect(offline.destination);
    src.start();
    return offline.startRendering();
  }
}

/* ------------------------------------------------------------------ */
/* WAV encoder (used as the lossless intermediate for every export)   */
/* ------------------------------------------------------------------ */

function encodeWavBuffer(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* UI wiring                                                           */
/* ------------------------------------------------------------------ */

const engine = new AudioEngine();

/* ---- generic modal (replaces window.prompt/alert, unsupported in Electron) ---- */
const inputModalOverlay = document.getElementById('inputModalOverlay');
const inputModalTitle = document.getElementById('inputModalTitle');
const inputModalMessage = document.getElementById('inputModalMessage');
const inputModalField = document.getElementById('inputModalField');
const inputModalCancel = document.getElementById('inputModalCancel');
const inputModalOk = document.getElementById('inputModalOk');
let modalResolver = null;

function closeModal(value) {
  inputModalOverlay.classList.remove('open');
  if (modalResolver) { modalResolver(value); modalResolver = null; }
}
inputModalOk.addEventListener('click', () => closeModal(inputModalField.style.display === 'none' ? true : inputModalField.value));
inputModalCancel.addEventListener('click', () => closeModal(null));
inputModalField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') closeModal(inputModalField.value);
  else if (e.key === 'Escape') closeModal(null);
});

function showInputDialog(title, initial = '') {
  inputModalTitle.textContent = title;
  inputModalMessage.style.display = 'none';
  inputModalField.style.display = 'block';
  inputModalField.value = initial;
  inputModalCancel.style.display = 'inline-block';
  inputModalOverlay.classList.add('open');
  setTimeout(() => inputModalField.focus(), 50);
  return new Promise((resolve) => { modalResolver = resolve; });
}

function showAlertDialog(title, message) {
  inputModalTitle.textContent = title;
  inputModalMessage.textContent = message;
  inputModalMessage.style.display = 'block';
  inputModalField.style.display = 'none';
  inputModalCancel.style.display = 'none';
  inputModalOverlay.classList.add('open');
  return new Promise((resolve) => { modalResolver = () => resolve(); });
}

const els = {
  trackName: document.getElementById('trackName'),
  trackSub: document.getElementById('trackSub'),
  albumArt: document.getElementById('albumArt'),
  albumArtImg: document.getElementById('albumArtImg'),
  seek: document.getElementById('seek'),
  timeLabel: document.getElementById('timeLabel'),
  btnPlay: document.getElementById('btnPlay'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnShuffle: document.getElementById('btnShuffle'),
  btnRepeat: document.getElementById('btnRepeat'),
  btnMute: document.getElementById('btnMute'),
  volume: document.getElementById('volume'),
  fileInput: document.getElementById('fileInput'),
  btnUrl: document.getElementById('btnUrl'),
  btnMic: document.getElementById('btnMic'),
  btnTestTone: document.getElementById('btnTestTone'),
  btnTogglePlaylist: document.getElementById('btnTogglePlaylist'),
  playlistDrawer: document.getElementById('playlistDrawer'),
  presetGrid: document.getElementById('presetGrid'),
  userPresetList: document.getElementById('userPresetList'),
  btnSavePreset: document.getElementById('btnSavePreset'),
  crossfade: document.getElementById('crossfade'),
  playlist: document.getElementById('playlist'),
  playlistEmptyHint: document.getElementById('playlistEmptyHint'),
  eqRack: document.getElementById('eqRack'),
  bassBoost: document.getElementById('bassBoost'),
  bassBoostVal: document.getElementById('bassBoostVal'),
  knobBassBoost: document.getElementById('knobBassBoost'),
  surround: document.getElementById('surround'),
  surroundVal: document.getElementById('surroundVal'),
  knobSurround: document.getElementById('knobSurround'),
  volBoost: document.getElementById('volBoost'),
  volBoostVal: document.getElementById('volBoostVal'),
  knobVolBoost: document.getElementById('knobVolBoost'),
  btnResetFx: document.getElementById('btnResetFx'),
  swMasterEnable: document.getElementById('swMasterEnable'),
  miniMeter: document.getElementById('miniMeter'),
  swCompressor: document.getElementById('swCompressor'),
  swReverb: document.getElementById('swReverb'),
  swExciter: document.getElementById('swExciter'),
  tempo: document.getElementById('tempo'),
  tempoVal: document.getElementById('tempoVal'),
  swPreservePitch: document.getElementById('swPreservePitch'),
  formatGrid: document.getElementById('formatGrid'),
  qualityGrid: document.getElementById('qualityGrid'),
  btnExport: document.getElementById('btnExport'),
  exportTrackList: document.getElementById('exportTrackList'),
  exportStatus: document.getElementById('exportStatus'),
  destPath: document.getElementById('destPath'),
  btnChooseFolder: document.getElementById('btnChooseFolder'),
  progressTrack: document.getElementById('progressTrack'),
  progressFill: document.getElementById('progressFill'),
  visualizer: document.getElementById('visualizer'),
  skinGrid: document.getElementById('skinGrid'),
  bgGrid: document.getElementById('bgGrid'),
  btnShowTutorial: document.getElementById('btnShowTutorial'),
  btnOpenHelp: document.getElementById('btnOpenHelp'),
  btnBackupExport: document.getElementById('btnBackupExport'),
  btnBackupImport: document.getElementById('btnBackupImport'),
  backupStatus: document.getElementById('backupStatus'),
};

let playlist = [];
let currentTrackIndex = -1;
let selectedForExport = new Set();
let exportSelectionInitialized = false;
let shuffleOn = false;
let repeatOn = false;
let selectedFormat = 'wav';
let selectedQuality = 'medium';
let activePresetKey = 'flat';
let availableFormats = {};

/* ---- window chrome ---- */
document.getElementById('btnMinimize').addEventListener('click', () => window.waveframe.minimize());
document.getElementById('btnCloseWin').addEventListener('click', () => window.waveframe.close());
const btnMaximize = document.getElementById('btnMaximize');
btnMaximize.addEventListener('click', () => window.waveframe.maximizeToggle());
window.waveframe?.onMaximizedState?.((isMaximized) => {
  btnMaximize.innerHTML = isMaximized ? '&#10064;' : '&#9633;';
  btnMaximize.title = isMaximized ? 'Επαναφορά' : 'Μεγιστοποίηση';
});
document.getElementById('brandVersion').textContent = `v${window.waveframe.version}`;
document.getElementById('aboutVersion').textContent = `v${window.waveframe.version}`;

/* ---- Mini/compact always-on-top mode ---- */
function syncMiniBar() {
  const item = playlist[currentTrackIndex];
  const nameEl = document.getElementById('miniBarName');
  const artEl = document.getElementById('miniBarArt');
  const artImg = document.getElementById('miniBarArtImg');
  if (!nameEl) return;
  nameEl.textContent = (item && item.name) || t('player.noTrack');
  if (item && item.picture) { artImg.src = item.picture; artEl.classList.add('has-art'); }
  else { artImg.removeAttribute('src'); artEl.classList.remove('has-art'); }
}
document.getElementById('btnMiniMode').addEventListener('click', () => {
  document.body.classList.add('mini-mode');
  window.waveframe.setMiniMode(true);
  syncMiniBar();
});
document.getElementById('miniBarExpand').addEventListener('click', () => {
  document.body.classList.remove('mini-mode');
  window.waveframe.setMiniMode(false);
});
document.getElementById('miniBarPlay').addEventListener('click', async () => {
  if (currentTrackIndex === -1 && playlist.length > 0) { playTrackAt(0); return; }
  await engine.togglePlay();
  syncPlayButton();
});
document.getElementById('miniBarPrev').addEventListener('click', goPrev);
document.getElementById('miniBarNext').addEventListener('click', goNext);
els.btnOpenHelp.addEventListener('click', () => window.waveframe.openHelp());

/* ---- tabs ---- */
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === 'player') resizeCanvas();
  });
});

els.btnTogglePlaylist.addEventListener('click', () => {
  els.playlistDrawer.classList.toggle('open');
});

/* ---- resizable playlist ---- */
const playlistResizeHandle = document.getElementById('playlistResizeHandle');
let playlistDragStartY = null, playlistDragStartH = null;
function setPlaylistHeight(px) {
  const clamped = Math.max(120, Math.min(500, px));
  els.playlist.style.setProperty('--playlist-h', `${clamped}px`);
  localStorage.setItem('waveframe.playlistHeight', String(clamped));
}
playlistResizeHandle.addEventListener('mousedown', (e) => {
  playlistDragStartY = e.clientY;
  playlistDragStartH = els.playlist.getBoundingClientRect().height;
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (playlistDragStartY === null) return;
  setPlaylistHeight(playlistDragStartH + (e.clientY - playlistDragStartY));
});
window.addEventListener('mouseup', () => { playlistDragStartY = null; });
const savedPlaylistH = localStorage.getItem('waveframe.playlistHeight');
if (savedPlaylistH) els.playlist.style.setProperty('--playlist-h', `${savedPlaylistH}px`);

/* ---- EQ rack ---- */
EQ_FREQS.forEach((freq, i) => {
  const wrap = document.createElement('div');
  wrap.className = 'eq-band';
  const val = document.createElement('span');
  val.className = 'band-val';
  val.textContent = '0';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '-12'; input.max = '12'; input.step = '0.5'; input.value = '0';
  input.addEventListener('input', () => {
    const db = parseFloat(input.value);
    engine.setEqBand(i, db);
    val.textContent = db.toFixed(1);
    activePresetKey = null;
    highlightActivePreset();
  });
  const label = document.createElement('span');
  label.className = 'band-freq';
  label.textContent = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
  wrap.appendChild(val); wrap.appendChild(input); wrap.appendChild(label);
  els.eqRack.appendChild(wrap);
  wrap._input = input; wrap._val = val;
});

/* ---- EQ curve (parametric-style draggable view) ---- */
const eqCurveCanvas = document.getElementById('eqCurveCanvas');
const eqCtx = eqCurveCanvas.getContext('2d');
const eqViewSeg = document.getElementById('eqViewSeg');

function resizeEqCurve() {
  const rect = eqCurveCanvas.getBoundingClientRect();
  if (rect.width === 0) return;
  eqCurveCanvas.width = rect.width * devicePixelRatio;
  eqCurveCanvas.height = rect.height * devicePixelRatio;
  drawEqCurve();
}
setTimeout(resizeEqCurve, 0);
window.addEventListener('resize', resizeEqCurve);

function eqBandX(i, w) { return (i / (EQ_FREQS.length - 1)) * w; }
function eqDbToY(db, h) { return h / 2 - (db / 12) * (h / 2 - 12 * devicePixelRatio); }
function eqYToDb(y, h) {
  const db = ((h / 2 - y) / (h / 2 - 12 * devicePixelRatio)) * 12;
  return Math.max(-12, Math.min(12, db));
}
function drawEqCurve() {
  const w = eqCurveCanvas.width, h = eqCurveCanvas.height;
  if (!w || !h) return;
  eqCtx.clearRect(0, 0, w, h);
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#7c6cf0';
  eqCtx.strokeStyle = 'rgba(148,148,171,0.25)';
  eqCtx.lineWidth = 1;
  eqCtx.beginPath(); eqCtx.moveTo(0, h / 2); eqCtx.lineTo(w, h / 2); eqCtx.stroke();

  const points = engine.state.eqBands.map((db, i) => ({ x: eqBandX(i, w), y: eqDbToY(db, h) }));
  eqCtx.strokeStyle = accent;
  eqCtx.lineWidth = 2.5 * devicePixelRatio;
  eqCtx.beginPath();
  eqCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1], p1 = points[i];
    eqCtx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
  }
  eqCtx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  eqCtx.stroke();

  eqCtx.fillStyle = accent;
  points.forEach((p) => {
    eqCtx.beginPath();
    eqCtx.arc(p.x, p.y, 4 * devicePixelRatio, 0, Math.PI * 2);
    eqCtx.fill();
  });
}

let draggingEqBand = null;
function eqPointFromEvent(e) {
  const rect = eqCurveCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * devicePixelRatio,
    y: (e.clientY - rect.top) * devicePixelRatio,
  };
}
function nearestEqBand(x, w) {
  let best = 0, bestDist = Infinity;
  EQ_FREQS.forEach((_, i) => {
    const d = Math.abs(eqBandX(i, w) - x);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}
function updateEqBandFromCurve(index, y) {
  const db = eqYToDb(y, eqCurveCanvas.height);
  engine.setEqBand(index, db);
  const band = els.eqRack.children[index];
  band._input.value = db;
  band._val.textContent = db.toFixed(1);
  activePresetKey = null;
  highlightActivePreset();
  drawEqCurve();
}
eqCurveCanvas.addEventListener('mousedown', (e) => {
  const { x, y } = eqPointFromEvent(e);
  draggingEqBand = nearestEqBand(x, eqCurveCanvas.width);
  updateEqBandFromCurve(draggingEqBand, y);
});
window.addEventListener('mousemove', (e) => {
  if (draggingEqBand === null) return;
  updateEqBandFromCurve(draggingEqBand, eqPointFromEvent(e).y);
});
window.addEventListener('mouseup', () => { draggingEqBand = null; });

eqViewSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-eq-view]');
  if (!btn) return;
  const view = btn.dataset.eqView;
  [...eqViewSeg.children].forEach((b) => b.classList.toggle('active', b === btn));
  els.eqRack.classList.toggle('dep-hidden', view === 'curve');
  eqCurveCanvas.classList.toggle('dep-hidden', view !== 'curve');
  if (view === 'curve') { resizeEqCurve(); drawEqCurve(); }
});

function setEqUi(bands) {
  bands.forEach((db, i) => {
    const band = els.eqRack.children[i];
    band._input.value = db;
    band._val.textContent = db.toFixed(1);
  });
}

/* ---- presets ---- */
function renderPresetGrid() {
  els.presetGrid.innerHTML = '';
  PRESETS.forEach((preset) => {
    const card = document.createElement('button');
    card.className = 'preset-card';
    card.innerHTML = `<h3><span class="preset-icon">${preset.icon}</span>${t(`preset.${preset.key}.name`)}</h3><p>${t(`preset.${preset.key}.desc`)}</p>`;
    card.addEventListener('click', () => {
      engine.applyEqBands(preset.bands);
      setEqUi(preset.bands);
      activePresetKey = preset.key;
      highlightActivePreset();
    });
    card._key = preset.key;
    els.presetGrid.appendChild(card);
  });
  highlightActivePreset();
}
function highlightActivePreset() {
  [...els.presetGrid.children].forEach((c) => c.classList.toggle('active', c._key === activePresetKey));
}

/* ---- user presets ---- */
function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(USER_PRESET_KEY)) || []; } catch { return []; }
}
function saveUserPresets(list) { localStorage.setItem(USER_PRESET_KEY, JSON.stringify(list)); }
function renderUserPresets() {
  const list = loadUserPresets();
  els.userPresetList.innerHTML = '';
  if (list.length === 0) {
    els.userPresetList.innerHTML = `<p class="empty-hint">${t('enhance.noUserPresets')}</p>`;
    return;
  }
  list.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'user-preset-item';
    row.innerHTML = `<span>${p.name}</span>`;
    const applyBtn = document.createElement('button');
    applyBtn.textContent = '▶';
    applyBtn.addEventListener('click', () => applyUserPreset(p));
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      const l = loadUserPresets();
      l.splice(idx, 1);
      saveUserPresets(l);
      renderUserPresets();
    });
    row.appendChild(applyBtn);
    row.appendChild(delBtn);
    els.userPresetList.appendChild(row);
  });
}

function applyUserPreset(p) {
  engine.applyEqBands(p.bands);
  setEqUi(p.bands);
  if (typeof p.bassBoost === 'number') {
    engine.setBassBoost(p.bassBoost);
    els.bassBoost.value = String(p.bassBoost);
    els.bassBoostVal.textContent = `${p.bassBoost.toFixed(1)} dB`;
    setKnobPct(els.knobBassBoost, p.bassBoost / 12);
  }
  if (typeof p.volumeBoost === 'number') {
    engine.setVolumeBoostDb(p.volumeBoost);
    els.volBoost.value = String(p.volumeBoost);
    els.volBoostVal.textContent = `${p.volumeBoost.toFixed(1)} dB`;
    setKnobPct(els.knobVolBoost, p.volumeBoost / 12);
  }
  if (typeof p.surround === 'number') {
    engine.setSurround(p.surround);
    els.surround.value = String(p.surround);
    els.surroundVal.textContent = `${Math.round(p.surround)}%`;
    setKnobPct(els.knobSurround, p.surround / 100);
  }
  if (typeof p.compressor === 'boolean') setSwitchState(els.swCompressor, p.compressor, (on) => engine.setCompressor(on));
  if (typeof p.reverb === 'boolean') setSwitchState(els.swReverb, p.reverb, (on) => engine.setReverb(on));
  if (typeof p.exciter === 'boolean') setSwitchState(els.swExciter, p.exciter, (on) => engine.setExciter(on));
  activePresetKey = null;
  highlightActivePreset();
}

els.btnSavePreset.addEventListener('click', async () => {
  const name = await showInputDialog(t('enhance.presetNamePromptTitle'));
  if (!name) return;
  const list = loadUserPresets();
  list.push({
    name,
    bands: [...engine.state.eqBands],
    bassBoost: engine.state.bassBoost,
    volumeBoost: engine.state.volumeBoost,
    surround: engine.state.surround,
    compressor: engine.state.compressor,
    reverb: engine.state.reverb,
    exciter: engine.state.exciter,
  });
  saveUserPresets(list);
  renderUserPresets();
});

/* ---- transport ---- */
function updateTrackNameUi() {
  const slot = engine.slots[engine.activeSlot];
  const item = playlist[currentTrackIndex];
  els.trackName.textContent = (item && item.name) || slot.name || t('player.noTrack');
  const sub = item ? [item.artist, item.album].filter(Boolean).join(' — ') : '';
  els.trackSub.textContent = sub;
  if (item && item.picture) {
    els.albumArtImg.src = item.picture;
    els.albumArt.classList.add('has-art');
  } else {
    els.albumArtImg.removeAttribute('src');
    els.albumArt.classList.remove('has-art');
  }
  syncVisAlbumArt(item && item.picture);
  syncOsNowPlaying();
  syncMiniBar();
  syncMediaSession();
}
function syncMediaSession() {
  // Standard Web MediaSession API — Chromium wires this straight through to
  // Windows' System Media Transport Controls (volume flyout, lock screen,
  // Bluetooth headset buttons), no native module needed.
  if (!('mediaSession' in navigator)) return;
  const item = playlist[currentTrackIndex];
  if (item) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.name || '',
      artist: item.artist || '',
      album: item.album || '',
      artwork: item.picture ? [{ src: item.picture, sizes: '512x512', type: 'image/png' }] : [],
    });
  } else {
    navigator.mediaSession.metadata = null;
  }
}
function syncOsNowPlaying() {
  const item = playlist[currentTrackIndex];
  const title = item ? item.name : null;
  const playing = !!(engine.activeEl && !engine.activeEl.paused);
  window.waveframe?.updateNowPlaying?.({ title, playing });
}
function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
setInterval(() => {
  if (document.hidden) return; // κρυμμένο/ελαχιστοποιημένο παράθυρο: καμία ενημέρωση UI
  const el = engine.activeEl;
  if (el && el.duration) {
    els.seek.value = String((el.currentTime / el.duration) * 1000);
    els.timeLabel.textContent = `${fmtTime(el.currentTime)} / ${fmtTime(el.duration)}`;
  }
}, 250);
els.seek.addEventListener('input', () => engine.seekTo(parseFloat(els.seek.value) / 1000));

els.btnPlay.addEventListener('click', async () => {
  if (currentTrackIndex === -1 && playlist.length > 0) { playTrackAt(0); return; }
  await engine.togglePlay();
  syncPlayButton();
});
function syncPlayButton() {
  els.btnPlay.textContent = engine.activeEl.paused ? '▶' : '⏸';
  syncOsNowPlaying();
  const miniPlay = document.getElementById('miniBarPlay');
  if (miniPlay) miniPlay.textContent = engine.activeEl.paused ? '▶' : '⏸';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = engine.activeEl.paused ? 'paused' : 'playing';
  }
}
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => engine.togglePlay().then(syncPlayButton));
  navigator.mediaSession.setActionHandler('pause', () => engine.togglePlay().then(syncPlayButton));
  navigator.mediaSession.setActionHandler('previoustrack', () => goPrev());
  navigator.mediaSession.setActionHandler('nexttrack', () => goNext());
}
engine.slots.forEach((s) => {
  s.el.addEventListener('play', syncPlayButton);
  s.el.addEventListener('pause', syncPlayButton);
  s.el.addEventListener('ended', () => { if (engine.activeSlot === engine.slots.indexOf(s)) onTrackEnded(); });
  s.el.addEventListener('error', () => {
    if (!s.el.src || engine.activeSlot !== engine.slots.indexOf(s)) return;
    showAlertDialog(t('player.loadErrorTitle'), t('player.loadErrorMsg'));
  });
});
function onTrackEnded() {
  if (repeatOn && playlist.length === 1) { playTrackAt(currentTrackIndex); return; }
  goNext();
}
function computeLoudnessGain(buffer) {
  let sumSquares = 0, count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const step = Math.max(1, Math.floor(data.length / 200000));
    for (let i = 0; i < data.length; i += step) { sumSquares += data[i] * data[i]; count++; }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  const rmsDb = 20 * Math.log10(rms || 1e-6);
  const targetDb = -18;
  const gainDb = Math.max(-12, Math.min(12, targetDb - rmsDb));
  return Math.pow(10, gainDb / 20);
}
// Ένα ΚΟΙΝΟ AudioContext μόνο για decodeAudioData (ανάλυση έντασης/export). Πριν, κάθε κομμάτι/export
// δημιουργούσε νέο AudioContext που δεν έκλεινε ποτέ — το Chromium επιτρέπει περιορισμένο αριθμό ταυτόχρονων
// contexts, οπότε μετά από λίγα κομμάτια η κανονικοποίηση έπεφτε σιωπηλά σε gain 1 και το export αποτύγχανε.
let sharedDecodeCtx = null;
function getDecodeCtx() {
  if (!sharedDecodeCtx || sharedDecodeCtx.state === 'closed') {
    sharedDecodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedDecodeCtx;
}
async function analyzeLoudness(item) {
  if (typeof item.normGain === 'number') return item.normGain;
  try {
    const arrayBuf = item.file ? await item.file.arrayBuffer() : await (await fetch(item.url)).arrayBuffer();
    const buffer = await getDecodeCtx().decodeAudioData(arrayBuf);
    item.normGain = computeLoudnessGain(buffer);
  } catch {
    item.normGain = 1;
  }
  return item.normGain;
}

function playTrackAt(index) {
  if (index < 0 || index >= playlist.length) return;
  currentTrackIndex = index;
  const item = playlist[index];
  engine.setNormalizationGain(1);
  analyzeLoudness(item).then((gain) => {
    if (playlist[currentTrackIndex] === item) engine.setNormalizationGain(gain);
  });
  engine.switchTrack((slotIndex) => {
    const slot = engine.slots[slotIndex];
    // Απελευθέρωση του προηγούμενου blob URL αυτού του slot — πριν διέρρεε ένα blob URL ανά κομμάτι.
    if (slot.el.src && slot.el.src.startsWith('blob:')) URL.revokeObjectURL(slot.el.src);
    slot.el.src = item.file ? URL.createObjectURL(item.file) : item.url;
    slot.name = item.name;
  }, () => { updateTrackNameUi(); syncPlayButton(); renderPlaylist(); });
}
function goNext() {
  if (playlist.length === 0) return;
  let next;
  if (shuffleOn) next = Math.floor(Math.random() * playlist.length);
  else { next = currentTrackIndex + 1; if (next >= playlist.length) next = repeatOn ? 0 : -1; }
  if (next === -1) return;
  playTrackAt(next);
}
function goPrev() {
  if (playlist.length === 0) return;
  playTrackAt(currentTrackIndex <= 0 ? playlist.length - 1 : currentTrackIndex - 1);
}
els.btnNext.addEventListener('click', goNext);
els.btnPrev.addEventListener('click', goPrev);
els.btnShuffle.addEventListener('click', () => { shuffleOn = !shuffleOn; els.btnShuffle.classList.toggle('active', shuffleOn); });
els.btnRepeat.addEventListener('click', () => { repeatOn = !repeatOn; els.btnRepeat.classList.toggle('active', repeatOn); });
els.btnMute.addEventListener('click', () => {
  const m = !engine.state.muted;
  engine.setMuted(m);
  els.btnMute.classList.toggle('active', m);
  els.btnMute.textContent = m ? '🔇' : '🔊';
});
els.volume.addEventListener('input', () => engine.setVolume(parseInt(els.volume.value, 10) / 100));

/* ---- in-app keyboard shortcuts ---- */
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return; // never hijack typing
  switch (e.key) {
    case ' ':
      e.preventDefault();
      els.btnPlay.click();
      break;
    case 'ArrowRight':
      if (engine.activeEl.duration) engine.activeEl.currentTime = Math.min(engine.activeEl.duration, engine.activeEl.currentTime + 5);
      break;
    case 'ArrowLeft':
      if (engine.activeEl.duration) engine.activeEl.currentTime = Math.max(0, engine.activeEl.currentTime - 5);
      break;
    case 'ArrowUp':
      e.preventDefault();
      els.volume.value = String(Math.min(100, parseInt(els.volume.value, 10) + 5));
      els.volume.dispatchEvent(new Event('input'));
      break;
    case 'ArrowDown':
      e.preventDefault();
      els.volume.value = String(Math.max(0, parseInt(els.volume.value, 10) - 5));
      els.volume.dispatchEvent(new Event('input'));
      break;
    case 'm': case 'M':
      els.btnMute.click();
      break;
    case 'n': case 'N':
      goNext();
      break;
    case 'p': case 'P':
      goPrev();
      break;
    default:
      break;
  }
});
engine.setVolume(0.8);

/* ---- sources ---- */
els.fileInput.addEventListener('change', () => {
  addFilesToPlaylist([...els.fileInput.files]);
  els.fileInput.value = '';
});
function addFilesToPlaylist(files) {
  const wasEmpty = playlist.length === 0;
  const added = files.map((file) => {
    const item = { file, path: file.path || null, name: file.name.replace(/\.[^/.]+$/, '') };
    playlist.push(item);
    return item;
  });
  renderPlaylist();
  if (wasEmpty && playlist.length > 0) playTrackAt(0);
  added.forEach((item) => enrichTrackMetadata(item));
}

async function enrichTrackMetadata(item) {
  if (!item.path) return;
  const meta = await window.waveframe.readMetadata(item.path);
  if (!meta) return;
  if (meta.title) item.name = meta.artist ? `${meta.artist} - ${meta.title}` : meta.title;
  item.artist = meta.artist || null;
  item.album = meta.album || null;
  item.picture = meta.picture || null;
  renderPlaylist();
  if (playlist[currentTrackIndex] === item) updateTrackNameUi();
}

const PLAYLIST_KEY = 'waveframe.playlist';
function pathToFileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\/+/, '');
}

// "Open with Waveframe" from Explorer (file association) or double-clicking
// an audio file while the app is already running (forwarded via second-instance).
window.waveframe.onOpenFile((filePath) => {
  const name = filePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '');
  const item = { path: filePath, url: pathToFileUrl(filePath), name };
  playlist.push(item);
  renderPlaylist();
  playTrackAt(playlist.length - 1);
  enrichTrackMetadata(item);
});
function savePlaylist() {
  const serializable = playlist
    .filter((item) => item.path || item.url)
    .map((item) => ({ path: item.path || null, url: item.path ? null : item.url || null, name: item.name }));
  localStorage.setItem(PLAYLIST_KEY, JSON.stringify(serializable));
}
function restorePlaylist() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(PLAYLIST_KEY)) || []; } catch { saved = []; }
  if (saved.length === 0) return;
  saved.forEach((entry) => {
    if (entry.path) playlist.push({ path: entry.path, url: pathToFileUrl(entry.path), name: entry.name });
    else if (entry.url) playlist.push({ url: entry.url, name: entry.name });
  });
  renderPlaylist();
}
document.body.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.body.addEventListener('dragleave', () => document.body.classList.remove('drag-over'));
document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('audio/'));
  if (files.length) addFilesToPlaylist(files);
});
els.btnUrl.addEventListener('click', async () => {
  const url = await showInputDialog(t('player.urlPromptTitle'));
  if (!url) return;
  const wasEmpty = playlist.length === 0;
  playlist.push({ url, name: url.split('/').pop() || url });
  renderPlaylist();
  if (wasEmpty) playTrackAt(playlist.length - 1);
});
els.btnMic.addEventListener('click', async () => {
  try { await engine.startMic(); els.trackName.textContent = t('player.micLabel'); }
  catch (err) { await showAlertDialog(t('player.micErrorTitle'), err.message); }
});
els.btnTestTone.addEventListener('click', () => {
  engine.playTestTone();
  els.trackName.textContent = t('player.toneLabel');
});

function renderPlaylist() {
  els.playlist.innerHTML = '';
  els.playlistEmptyHint.style.display = playlist.length ? 'none' : 'block';
  playlist.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = idx === currentTrackIndex ? 'active' : '';
    const thumb = item.picture
      ? `<img class="playlist-thumb" src="${item.picture}" alt="" />`
      : `<span class="playlist-thumb-fallback">🎵</span>`;
    li.innerHTML = `<div class="playlist-track-info">${thumb}<span class="playlist-track-name">${item.name}</span></div>`;
    li.addEventListener('click', () => playTrackAt(idx));
    const rm = document.createElement('button');
    rm.className = 'remove-track';
    rm.textContent = '✕';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      playlist.splice(idx, 1);
      if (idx === currentTrackIndex) { engine.pauseActive(); currentTrackIndex = -1; updateTrackNameUi(); }
      else if (idx < currentTrackIndex) currentTrackIndex--;
      renderPlaylist();
    });
    li.appendChild(rm);
    els.playlist.appendChild(li);
  });
  renderExportTrackList();
  savePlaylist();
}

function renderExportTrackList() {
  // Default: pre-select whatever is currently playing, once, the first
  // time the playlist gets any tracks - after that the user's own
  // checkbox choices are preserved across re-renders.
  if (!exportSelectionInitialized && playlist.length > 0) {
    selectedForExport = new Set([currentTrackIndex >= 0 ? currentTrackIndex : 0]);
    exportSelectionInitialized = true;
  }
  // Drop selections that no longer exist (track removed).
  selectedForExport = new Set([...selectedForExport].filter((i) => i >= 0 && i < playlist.length));

  els.exportTrackList.innerHTML = '';
  if (playlist.length === 0) {
    els.exportTrackList.innerHTML = `<p class="empty-hint">${t('export.tracksEmpty')}</p>`;
    return;
  }
  playlist.forEach((item, idx) => {
    const row = document.createElement('label');
    row.className = 'export-track-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selectedForExport.has(idx);
    cb.addEventListener('change', () => {
      if (cb.checked) selectedForExport.add(idx);
      else selectedForExport.delete(idx);
    });
    const span = document.createElement('span');
    span.textContent = item.name;
    row.appendChild(cb);
    row.appendChild(span);
    els.exportTrackList.appendChild(row);
  });
}

els.crossfade.addEventListener('input', () => { engine.crossfadeSeconds = parseFloat(els.crossfade.value); });

/* ---- effects ---- */
function setKnobPct(knobEl, pct) {
  if (knobEl) knobEl.style.setProperty('--pct', String(Math.max(0, Math.min(1, pct))));
}
els.bassBoost.addEventListener('input', () => {
  const db = parseFloat(els.bassBoost.value);
  engine.setBassBoost(db);
  els.bassBoostVal.textContent = `${db.toFixed(1)} dB`;
  setKnobPct(els.knobBassBoost, db / 12);
});
els.surround.addEventListener('input', () => {
  const pct = parseFloat(els.surround.value);
  engine.setSurround(pct);
  els.surroundVal.textContent = `${Math.round(pct)}%`;
  setKnobPct(els.knobSurround, pct / 100);
});
els.volBoost.addEventListener('input', () => {
  const db = parseFloat(els.volBoost.value);
  engine.setVolumeBoostDb(db);
  els.volBoostVal.textContent = `${db.toFixed(1)} dB`;
  setKnobPct(els.knobVolBoost, db / 12);
});
els.btnResetFx.addEventListener('click', () => {
  engine.resetEffects();
  els.bassBoost.value = '0'; els.bassBoostVal.textContent = '0 dB'; setKnobPct(els.knobBassBoost, 0);
  els.surround.value = '0'; els.surroundVal.textContent = '0%'; setKnobPct(els.knobSurround, 0);
  els.volBoost.value = '0'; els.volBoostVal.textContent = '0 dB'; setKnobPct(els.knobVolBoost, 0);
});
wireSwitch(els.swMasterEnable, (on) => engine.setMasterEnable(on), true);
function wireSwitch(btn, onChange, initial = false) {
  btn.classList.toggle('active', initial);
  btn.addEventListener('click', () => {
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    onChange(on);
  });
}
function setSwitchState(btn, on, onChange) {
  btn.classList.toggle('active', on);
  onChange(on);
}
wireSwitch(els.swCompressor, (on) => engine.setCompressor(on));
wireSwitch(els.swReverb, (on) => engine.setReverb(on));
wireSwitch(els.swExciter, (on) => engine.setExciter(on));
wireSwitch(document.getElementById('swNormalize'), (on) => {
  engine.setNormalizationEnabled(on);
  const item = playlist[currentTrackIndex];
  engine.setNormalizationGain(item && typeof item.normGain === 'number' ? item.normGain : 1);
}, true);
wireSwitch(els.swPreservePitch, (on) => engine.setPreservePitch(on), true);
els.tempo.addEventListener('input', () => {
  const rate = parseFloat(els.tempo.value);
  engine.setTempo(rate);
  els.tempoVal.textContent = `${rate.toFixed(2)}x`;
});

/* ---- export ---- */
async function initFormats() {
  availableFormats = await window.waveframe.getFormats();
  els.formatGrid.innerHTML = '';
  Object.entries(availableFormats).forEach(([key, spec], idx) => {
    const btn = document.createElement('button');
    btn.className = 'format-btn' + (idx === 0 ? ' active' : '');
    btn.textContent = spec.name;
    btn.dataset.format = key;
    btn.addEventListener('click', () => {
      selectedFormat = key;
      [...els.formatGrid.children].forEach((b) => b.classList.toggle('active', b === btn));
    });
    els.formatGrid.appendChild(btn);
  });
  selectedFormat = Object.keys(availableFormats)[0] || 'wav';
}
initFormats();

[...els.qualityGrid.children].forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedQuality = btn.dataset.q;
    [...els.qualityGrid.children].forEach((b) => b.classList.toggle('active', b === btn));
  });
});

let chosenDestFolder = localStorage.getItem('waveframe.destFolder') || window.waveframe.musicPath || null;
if (chosenDestFolder) els.destPath.textContent = chosenDestFolder;

els.btnChooseFolder.addEventListener('click', async () => {
  const result = await window.waveframe.chooseFolder();
  if (result.canceled) return;
  chosenDestFolder = result.folderPath;
  localStorage.setItem('waveframe.destFolder', chosenDestFolder);
  els.destPath.textContent = chosenDestFolder;
});

window.waveframe.onExportProgress((pct) => {
  els.progressFill.style.width = `${Math.round(pct * 100)}%`;
});

async function exportOneTrack(item, q, format) {
  const arrayBuf = item.file ? await item.file.arrayBuffer() : await (await fetch(item.url)).arrayBuffer();
  let decoded;
  try {
    decoded = await getDecodeCtx().decodeAudioData(arrayBuf);
  } catch (err) {
    const decodeErr = new Error('decode-failed');
    decodeErr.code = 'decode-failed';
    throw decodeErr;
  }
  const rendered = await engine.renderOffline(decoded);
  const wavBuffer = encodeWavBuffer(rendered);
  const bitrate = format === 'opus' ? (OPUS_BITRATES[selectedQuality] || 96) : q.bitrate;
  return window.waveframe.exportAudio(wavBuffer, {
    format,
    bitrate,
    sampleRate: q.sampleRate,
    suggestedName: item.name || 'waveframe-export',
    destFolder: chosenDestFolder,
    duration: rendered.duration,
  });
}

els.btnExport.addEventListener('click', async () => {
  const items = [...selectedForExport].sort((a, b) => a - b).map((i) => playlist[i]).filter(Boolean);
  if (items.length === 0) { els.exportStatus.textContent = t('export.needTrack'); return; }

  els.btnExport.disabled = true;
  els.progressTrack.classList.remove('dep-hidden');
  const q = QUALITY[selectedQuality];
  const format = selectedQuality === 'lossless' ? 'flac' : selectedFormat;
  const results = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    els.progressFill.style.width = '0%';
    const label = items.length > 1
      ? t('export.exportingProgress').replace('{n}', i + 1).replace('{total}', items.length).replace('{name}', item.name)
      : t('export.decoding');
    els.exportStatus.textContent = label;
    try {
      const result = await exportOneTrack(item, q, format);
      results.push({ item, result });
      if (result.error === 'missing-ffmpeg') {
        els.exportStatus.textContent = t('export.error') + t('settings.depsMissing') + ' (FFmpeg) — ' + t('tab.settings');
        break;
      }
    } catch (err) {
      console.error(err);
      results.push({ item, error: err });
      const msg = err.code === 'decode-failed' ? t('export.decodeError') : err.message;
      els.exportStatus.textContent = `${item.name}: ${t('export.error')}${msg}`;
    }
  }

  const okCount = results.filter((r) => r.result && !r.result.canceled && !r.result.error).length;
  if (results.every((r) => r.result?.canceled)) els.exportStatus.textContent = t('export.canceled');
  else if (okCount > 0 && okCount === items.length) {
    els.exportStatus.textContent = items.length > 1
      ? `${t('export.done')} (${okCount}/${items.length})`
      : `${t('export.done')} ${results[0].result.filePath}`;
  } else if (okCount > 0) {
    els.exportStatus.textContent = `${t('export.done')} (${okCount}/${items.length})`;
  }

  setTimeout(() => els.progressTrack.classList.add('dep-hidden'), 1200);
  els.btnExport.disabled = false;
});

/* ---- settings: language carousel ---- */
const langCarousel = document.getElementById('langCarousel');
const langTrack = document.getElementById('langTrack');
const langArrowLeft = document.getElementById('langArrowLeft');
const langArrowRight = document.getElementById('langArrowRight');
const langPickPrev = document.getElementById('langPickPrev');
const langPickNext = document.getElementById('langPickNext');

LANGUAGES.forEach((lang) => {
  const btn = document.createElement('button');
  btn.className = 'lang-card';
  btn.dataset.lang = lang.code;
  btn.innerHTML = `<span class="lang-flag">${lang.flag}</span><span class="lang-name">${lang.name}</span>`;
  langTrack.appendChild(btn);
});

function syncLangActiveCard() {
  [...langTrack.children].forEach((c) => c.classList.toggle('active', c.dataset.lang === currentLang));
}

let langPickTimeout = null;
function positionLangPickArrows(card) {
  const wrapRect = langCarousel.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const midY = cardRect.top + cardRect.height / 2 - wrapRect.top;
  langPickPrev.style.top = `${midY}px`;
  langPickNext.style.top = `${midY}px`;
  langPickPrev.style.left = `${cardRect.left - wrapRect.left - 13}px`;
  langPickNext.style.left = `${cardRect.right - wrapRect.left - 13}px`;
}

function pickLanguageAt(index, { confirm = false } = {}) {
  const cards = [...langTrack.children];
  const clamped = Math.max(0, Math.min(cards.length - 1, index));
  const card = cards[clamped];
  cards.forEach((c) => c.classList.remove('picked'));
  card.classList.add('picked');
  langTrack.classList.add('picking');
  card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  positionLangPickArrows(card);
  langPickPrev.classList.toggle('visible', clamped > 0);
  langPickNext.classList.toggle('visible', clamped < cards.length - 1);
  if (confirm) {
    setLanguage(card.dataset.lang);
    syncLangActiveCard();
  }
  clearTimeout(langPickTimeout);
  langPickTimeout = setTimeout(() => {
    langTrack.classList.remove('picking');
    langPickPrev.classList.remove('visible');
    langPickNext.classList.remove('visible');
    cards.forEach((c) => c.classList.remove('picked'));
  }, 900);
}

langTrack.addEventListener('click', (e) => {
  const card = e.target.closest('.lang-card');
  if (!card) return;
  pickLanguageAt([...langTrack.children].indexOf(card), { confirm: true });
});
langPickPrev.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = [...langTrack.children].findIndex((c) => c.classList.contains('picked'));
  pickLanguageAt(current - 1, { confirm: true });
});
langPickNext.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = [...langTrack.children].findIndex((c) => c.classList.contains('picked'));
  pickLanguageAt(current + 1, { confirm: true });
});
langArrowLeft.addEventListener('click', () => langTrack.scrollBy({ left: -160, behavior: 'smooth' }));
langArrowRight.addEventListener('click', () => langTrack.scrollBy({ left: 160, behavior: 'smooth' }));

document.addEventListener('waveframe:language-changed', () => {
  renderPresetGrid();
  renderUserPresets();
});

const btnThemeToggle = document.getElementById('btnThemeToggle');

const SKINS = [
  { key: 'midnight', name: 'Midnight', isLight: false, swatch: 'linear-gradient(135deg, #14141f, #6366f1)' },
  { key: 'light', name: 'Daylight', isLight: true, swatch: 'linear-gradient(135deg, #ffffff, #a5b4fc)' },
  { key: 'retro', name: 'Retro LCD', isLight: false, swatch: 'linear-gradient(135deg, #001a00, #39ff14)' },
  { key: 'sunset', name: 'Sunset', isLight: false, swatch: 'linear-gradient(135deg, #2a1625, #f97316)' },
  { key: 'mono', name: 'Monochrome', isLight: false, swatch: 'linear-gradient(135deg, #1c1c20, #9ca3af)' },
  { key: 'ocean', name: 'Ocean', isLight: false, swatch: 'linear-gradient(135deg, #071b26, #22b8cf)' },
  { key: 'forest', name: 'Forest', isLight: false, swatch: 'linear-gradient(135deg, #0c1f14, #22c55e)' },
  { key: 'rose', name: 'Rose', isLight: false, swatch: 'linear-gradient(135deg, #22101a, #ec4899)' },
  { key: 'amber', name: 'Amber', isLight: false, swatch: 'linear-gradient(135deg, #1c1305, #f59e0b)' },
  { key: 'ice', name: 'Ice', isLight: true, swatch: 'linear-gradient(135deg, #eef7fb, #0ea5e9)' },
  { key: 'lavender', name: 'Lavender', isLight: true, swatch: 'linear-gradient(135deg, #f3effb, #a855f7)' },
  { key: 'crimson', name: 'Crimson', isLight: false, swatch: 'linear-gradient(135deg, #1a0808, #ef4444)' },
  { key: 'emerald', name: 'Emerald', isLight: false, swatch: 'linear-gradient(135deg, #04120e, #10b981)' },
  { key: 'slate', name: 'Slate', isLight: false, swatch: 'linear-gradient(135deg, #10151c, #64748b)' },
  { key: 'coral', name: 'Coral', isLight: true, swatch: 'linear-gradient(135deg, #fff1ec, #fb7185)' },
  { key: 'neon', name: 'Neon', isLight: false, swatch: 'linear-gradient(135deg, #06040f, #d946ef)' },
  { key: 'sepia', name: 'Sepia', isLight: true, swatch: 'linear-gradient(135deg, #f2e8d5, #92400e)' },
  { key: 'graphite', name: 'Graphite', isLight: false, swatch: 'linear-gradient(135deg, #08090b, #a1a1aa)' },
  { key: 'mint', name: 'Mint', isLight: true, swatch: 'linear-gradient(135deg, #eafbf4, #14b8a6)' },
  { key: 'solar', name: 'Solar', isLight: false, swatch: 'linear-gradient(135deg, #1b1406, #eab308)' },
];
SKINS.forEach((skin) => {
  const card = document.createElement('button');
  card.className = 'skin-card' + (skin.key === 'midnight' ? ' active' : '');
  card.dataset.theme = skin.key;
  card.innerHTML = `<span class="skin-swatch"></span><span>${skin.name}</span>`;
  card.querySelector('.skin-swatch').style.background = skin.swatch;
  els.skinGrid.appendChild(card);
});
function isLightSkin(theme) {
  const skin = SKINS.find((s) => s.key === theme);
  return skin ? skin.isLight : false;
}

function applySkin(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('waveframe.skin', theme);
  [...els.skinGrid.children].forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  const light = isLightSkin(theme);
  btnThemeToggle.textContent = light ? '🌙' : '☀️';
  if (!light) localStorage.setItem('waveframe.lastDarkSkin', theme);
  window.waveframe?.sendThemeChange?.(theme);
}

els.skinGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme]');
  if (!btn) return;
  applySkin(btn.dataset.theme);
});

btnThemeToggle.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  if (isLightSkin(current)) {
    applySkin(localStorage.getItem('waveframe.lastDarkSkin') || 'midnight');
  } else {
    applySkin('light');
  }
});

document.getElementById('skinArrowLeft').addEventListener('click', () => els.skinGrid.scrollBy({ left: -200, behavior: 'smooth' }));
document.getElementById('skinArrowRight').addEventListener('click', () => els.skinGrid.scrollBy({ left: 200, behavior: 'smooth' }));

/* ---- custom accent color (overrides the active skin's accent) ---- */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s; const l = (max + min) / 2;
  if (max === min) { h = 0; s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function applyAccentColor(hex) {
  const [h, s, l] = hexToHsl(hex);
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-2', hslToHex(h, s, Math.max(0, l - 10)));
  document.documentElement.style.setProperty('--accent-3', hslToHex(h, s, Math.min(100, l + 12)));
  localStorage.setItem('waveframe.accentColor', hex);
}
function resetAccentColor() {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-2');
  document.documentElement.style.removeProperty('--accent-3');
  localStorage.removeItem('waveframe.accentColor');
  document.getElementById('accentColorPicker').value = '#7c6cf0';
}
document.getElementById('accentColorPicker').addEventListener('input', (e) => applyAccentColor(e.target.value));
document.getElementById('btnAccentReset').addEventListener('click', resetAccentColor);

/* ---- track-change notifications ---- */
const swTrackNotif = document.getElementById('swTrackNotif');
wireSwitch(swTrackNotif, (on) => {
  localStorage.setItem('waveframe.trackNotifications', on ? '1' : '0');
  window.waveframe.setTrackNotifications(on);
}, true);
{
  const savedNotif = localStorage.getItem('waveframe.trackNotifications');
  const enabled = savedNotif === null ? true : savedNotif === '1';
  swTrackNotif.classList.toggle('active', enabled);
  window.waveframe.setTrackNotifications(enabled);
}

/* ---- auto-launch on login ---- */
const swAutostart = document.getElementById('swAutostart');
wireSwitch(swAutostart, (on) => window.waveframe.setAutostart(on));
window.waveframe.getAutostart().then((enabled) => swAutostart.classList.toggle('active', enabled));

/* ---- manual update check (no auto-updater yet) ---- */
// Leave empty until Waveframe has a public GitHub repository to check releases against.
const WAVEFRAME_REPO = '';
document.getElementById('btnCheckUpdates').addEventListener('click', async () => {
  const statusEl = document.getElementById('updateStatus');
  if (!WAVEFRAME_REPO) {
    statusEl.textContent = t('settings.updatesNotConfigured');
    return;
  }
  statusEl.textContent = t('settings.checkingUpdates');
  try {
    const res = await fetch(`https://api.github.com/repos/${WAVEFRAME_REPO}/releases/latest`);
    const data = await res.json();
    const latest = (data.tag_name || '').replace(/^v/, '');
    if (latest && latest !== window.waveframe.version) {
      statusEl.textContent = `${t('settings.updateAvailable')} v${latest}`;
    } else {
      statusEl.textContent = t('settings.upToDate');
    }
  } catch {
    statusEl.textContent = t('settings.updateCheckFailed');
  }
});

/* ---- crash overlay wiring ---- */
document.getElementById('crashDetailsToggle').addEventListener('click', () => {
  document.getElementById('crashDetails').classList.toggle('dep-hidden');
});
document.getElementById('crashDismiss').addEventListener('click', () => {
  document.getElementById('crashOverlay').classList.add('dep-hidden');
});
document.getElementById('crashReload').addEventListener('click', () => location.reload());

const layoutSeg = document.getElementById('layoutSeg');
function applyLayout(layout) {
  document.documentElement.dataset.layout = layout;
  localStorage.setItem('waveframe.layout', layout);
  [...layoutSeg.children].forEach((b) => b.classList.toggle('active', b.dataset.layout === layout));
}
layoutSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-layout]');
  if (!btn) return;
  applyLayout(btn.dataset.layout);
});

const btnStyleSeg = document.getElementById('btnStyleSeg');
function applyBtnStyle(style) {
  document.documentElement.dataset.btnStyle = style;
  localStorage.setItem('waveframe.btnStyle', style);
  [...btnStyleSeg.children].forEach((b) => b.classList.toggle('active', b.dataset.btnStyle === style));
}
btnStyleSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-btn-style]');
  if (!btn) return;
  applyBtnStyle(btn.dataset.btnStyle);
});

els.bgGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bg]');
  if (!btn) return;
  const mode = btn.dataset.bg;
  Backgrounds.setMode(mode);
  localStorage.setItem('waveframe.bg', mode);
  [...els.bgGrid.children].forEach((b) => b.classList.toggle('active', b === btn));
});
document.getElementById('bgArrowLeft').addEventListener('click', () => els.bgGrid.scrollBy({ left: -220, behavior: 'smooth' }));
document.getElementById('bgArrowRight').addEventListener('click', () => els.bgGrid.scrollBy({ left: 220, behavior: 'smooth' }));

/* ---- background hue: auto-cycle or manual ---- */
const bgCanvasEl = document.getElementById('bgCanvas');
const hueModeSeg = document.getElementById('hueModeSeg');
const hueSliderRow = document.getElementById('hueSliderRow');
const hueSlider = document.getElementById('hueSlider');
let hueMode = 'auto';
let autoHue = 0;

function applyHueMode(mode) {
  hueMode = mode;
  localStorage.setItem('waveframe.hueMode', mode);
  [...hueModeSeg.children].forEach((b) => b.classList.toggle('active', b.dataset.hueMode === mode));
  hueSliderRow.classList.toggle('dep-hidden', mode !== 'manual');
  if (mode === 'manual') bgCanvasEl.style.filter = `hue-rotate(${hueSlider.value}deg)`;
}
hueModeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-hue-mode]');
  if (!btn) return;
  applyHueMode(btn.dataset.hueMode);
});
hueSlider.addEventListener('input', () => {
  localStorage.setItem('waveframe.hueValue', hueSlider.value);
  if (hueMode === 'manual') bgCanvasEl.style.filter = `hue-rotate(${hueSlider.value}deg)`;
});
let autoHueFrame = 0;
function tickAutoHue() {
  // Το hue-rotate σε ολόκληρο το canvas φόντου επαναϋπολογίζεται από τη GPU σε ΚΑΘΕ αλλαγή του style —
  // στα 60fps ήταν άσκοπα ακριβό για μια τόσο αργή μετάβαση (0.06°/frame). Ενημερώνουμε 1 στα 4 frames
  // (~15fps) με αντίστοιχα μεγαλύτερο βήμα: ίδια ταχύτητα, 1/4 του κόστους.
  if (hueMode === 'auto' && !document.hidden && (++autoHueFrame % 4 === 0)) {
    autoHue = (autoHue + 0.24) % 360;
    bgCanvasEl.style.filter = `hue-rotate(${autoHue}deg)`;
  }
  requestAnimationFrame(tickAutoHue);
}
requestAnimationFrame(tickAutoHue);

function restorePreferences() {
  const lang = localStorage.getItem('waveframe.lang') || 'el';
  setLanguage(lang);
  syncLangActiveCard();

  applySkin(localStorage.getItem('waveframe.skin') || 'midnight');
  applyLayout(localStorage.getItem('waveframe.layout') || 'default');
  applyBtnStyle(localStorage.getItem('waveframe.btnStyle') || 'rounded');
  const savedAccent = localStorage.getItem('waveframe.accentColor');
  if (savedAccent) {
    applyAccentColor(savedAccent);
    document.getElementById('accentColorPicker').value = savedAccent;
  }

  const bg = localStorage.getItem('waveframe.bg') || 'equalizer';
  Backgrounds.setMode(bg);
  [...els.bgGrid.children].forEach((b) => b.classList.toggle('active', b.dataset.bg === bg));

  hueSlider.value = localStorage.getItem('waveframe.hueValue') || '0';
  applyHueMode(localStorage.getItem('waveframe.hueMode') || 'auto');
}

Backgrounds.setAnalyser(engine.analyser, new Uint8Array(engine.analyser.frequencyBinCount));

/* ------------------------------------------------------------------ */
/* Tutorial                                                            */
/* ------------------------------------------------------------------ */

const TUTORIAL_SLIDES = [
  { icon: '👋', key: 's1' },
  { icon: '🎧', key: 's2' },
  { icon: '🎚️', key: 's3' },
  { icon: '⬇️', key: 's4' },
  { icon: '✨', key: 's5' },
];
let tutorialIndex = 0;
const tutorialOverlay = document.getElementById('tutorialOverlay');
const tutorialSlidesEl = document.getElementById('tutorialSlides');
const tutorialDotsEl = document.getElementById('tutorialDots');
const tutorialBack = document.getElementById('tutorialBack');
const tutorialNext = document.getElementById('tutorialNext');
const tutorialSkip = document.getElementById('tutorialSkip');

function renderTutorial() {
  tutorialSlidesEl.innerHTML = '';
  tutorialDotsEl.innerHTML = '';
  TUTORIAL_SLIDES.forEach((slide, i) => {
    const div = document.createElement('div');
    div.className = 'tutorial-slide' + (i === tutorialIndex ? ' active' : '');
    div.innerHTML = `<div class="tutorial-slide-icon">${slide.icon}</div><h3>${t(`tutorial.${slide.key}.title`)}</h3><p>${t(`tutorial.${slide.key}.desc`)}</p>`;
    tutorialSlidesEl.appendChild(div);

    const dot = document.createElement('div');
    dot.className = 'tutorial-dot' + (i === tutorialIndex ? ' active' : '');
    tutorialDotsEl.appendChild(dot);
  });
  tutorialBack.style.visibility = tutorialIndex === 0 ? 'hidden' : 'visible';
  tutorialNext.textContent = tutorialIndex === TUTORIAL_SLIDES.length - 1 ? t('tutorial.finish') : t('tutorial.next');
}
function openTutorial() {
  tutorialIndex = 0;
  renderTutorial();
  tutorialOverlay.classList.add('open');
}
function closeTutorial() {
  tutorialOverlay.classList.remove('open');
  localStorage.setItem('waveframe.tutorialSeen', '1');
}
tutorialNext.addEventListener('click', () => {
  if (tutorialIndex === TUTORIAL_SLIDES.length - 1) { closeTutorial(); return; }
  tutorialIndex++;
  renderTutorial();
});
tutorialBack.addEventListener('click', () => {
  if (tutorialIndex === 0) return;
  tutorialIndex--;
  renderTutorial();
});
tutorialSkip.addEventListener('click', closeTutorial);
els.btnShowTutorial.addEventListener('click', openTutorial);
document.addEventListener('waveframe:language-changed', () => { if (tutorialOverlay.classList.contains('open')) renderTutorial(); });

/* ---- Backup & Cloud Sync ---- */
function collectBackupData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('waveframe.')) data[key] = localStorage.getItem(key);
  }
  return data;
}
els.btnBackupExport.addEventListener('click', async () => {
  const result = await window.waveframe.exportSettings(collectBackupData());
  if (result.canceled) return;
  els.backupStatus.textContent = result.ok ? t('settings.backupExportOk') : (result.error || t('settings.backupError'));
});
els.btnBackupImport.addEventListener('click', async () => {
  const result = await window.waveframe.importSettings();
  if (result.canceled) return;
  if (!result.ok) { els.backupStatus.textContent = result.error || t('settings.backupError'); return; }
  Object.entries(result.data).forEach(([key, value]) => {
    if (key.startsWith('waveframe.')) localStorage.setItem(key, value);
  });
  await showAlertDialog(t('settings.backupImportTitle'), t('settings.backupImportDone'));
  location.reload();
});

/* ------------------------------------------------------------------ */
/* Visualizer                                                          */
/* ------------------------------------------------------------------ */

const VIS_MODES = [
  { key: 'none', icon: '🖼️', label: 'Album Art' },
  { key: 'bars', icon: '📊', label: 'Bars' },
  { key: 'wave', icon: '〜', label: 'Oscilloscope' },
  { key: 'circular', icon: '◎', label: 'Radial Spectrum' },
  { key: 'mirrorBars', icon: '🪞', label: 'Mirror Bars' },
  { key: 'dualWave', icon: '≈', label: 'Dual Wave' },
  { key: 'particles', icon: '✨', label: 'Particles' },
  { key: 'starfield', icon: '✦', label: 'Starfield' },
  { key: 'tunnel', icon: '🌀', label: 'Tunnel' },
  { key: 'spiral', icon: '🐚', label: 'Spiral' },
  { key: 'battery', icon: '▤', label: 'Battery Bars' },
  { key: 'plasma', icon: '🔮', label: 'Plasma Blobs' },
  { key: 'fireworks', icon: '🎆', label: 'Fireworks' },
  { key: 'ribbon', icon: '🎗️', label: 'Ribbon' },
  { key: 'kaleidoscope', icon: '🔷', label: 'Kaleidoscope' },
  { key: 'rain', icon: '🌧️', label: 'Rain' },
  { key: 'pulseRings', icon: '⭕', label: 'Pulse Rings' },
  { key: 'gridWave', icon: '⛰️', label: 'Grid Wave' },
  { key: 'vortex', icon: '🌪️', label: 'Vortex' },
  { key: 'sunburst', icon: '☀️', label: 'Sunburst' },
  { key: 'bubbles', icon: '🫧', label: 'Bubbles' },
];

let visMode = localStorage.getItem('waveframe.visMode') || 'bars';
let prevVisMode = null;
let particles = [];

const canvas = els.visualizer;
const vctx = canvas.getContext('2d');
const freqData = new Uint8Array(engine.analyser.frequencyBinCount);
const timeData = new Uint8Array(engine.analyser.frequencyBinCount);
const visualizerWrap = document.getElementById('visualizerWrap');
const visAlbumArt = document.getElementById('visAlbumArt');
const visAlbumArtImg = document.getElementById('visAlbumArtImg');
const visPickerGrid = document.getElementById('visPickerGrid');
const btnVisPicker = document.getElementById('btnVisPicker');

function syncVisAlbumArt(picture) {
  if (picture) { visAlbumArtImg.src = picture; visAlbumArt.classList.add('has-art'); }
  else { visAlbumArtImg.removeAttribute('src'); visAlbumArt.classList.remove('has-art'); }
}

VIS_MODES.forEach((m) => {
  const card = document.createElement('button');
  card.className = 'vis-picker-card' + (m.key === visMode ? ' active' : '');
  card.dataset.mode = m.key;
  card.innerHTML = `<span class="vis-picker-icon">${m.icon}</span><span>${m.label}</span>`;
  visPickerGrid.appendChild(card);
});
visualizerWrap.classList.toggle('mode-none', visMode === 'none');
visPickerGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.vis-picker-card');
  if (!card) return;
  visMode = card.dataset.mode;
  localStorage.setItem('waveframe.visMode', visMode);
  [...visPickerGrid.children].forEach((c) => c.classList.toggle('active', c === card));
  visualizerWrap.classList.toggle('mode-none', visMode === 'none');
});
btnVisPicker.addEventListener('click', () => visPickerGrid.classList.toggle('dep-hidden'));

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
}
setTimeout(resizeCanvas, 0);
window.addEventListener('resize', resizeCanvas);

function bandAvg(from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += freqData[i];
  return sum / ((to - from) * 255);
}

function drawBars() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const barCount = 64;
  const step = Math.floor(freqData.length / barCount);
  const barWidth = w / barCount;
  const grad = vctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#c084fc');
  vctx.fillStyle = grad;
  for (let i = 0; i < barCount; i++) {
    const v = freqData[i * step] / 255;
    const barH = v * h;
    vctx.fillRect(i * barWidth + 1, h - barH, barWidth - 2, barH);
  }
}
function drawWave() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  vctx.lineWidth = 2 * devicePixelRatio;
  vctx.strokeStyle = '#a78bfa';
  vctx.beginPath();
  const step = w / timeData.length;
  for (let i = 0; i < timeData.length; i++) {
    const v = timeData[i] / 128 - 1;
    const y = h / 2 + v * h * 0.45;
    if (i === 0) vctx.moveTo(0, y); else vctx.lineTo(i * step, y);
  }
  vctx.stroke();
}
function drawCircular() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const baseR = Math.min(w, h) * 0.18;
  const bars = 90;
  vctx.strokeStyle = '#8b7cf6';
  vctx.lineWidth = 3 * devicePixelRatio;
  for (let i = 0; i < bars; i++) {
    const v = freqData[Math.floor((i / bars) * freqData.length)] / 255;
    const angle = (i / bars) * Math.PI * 2;
    const r1 = baseR;
    const r2 = baseR + v * (Math.min(w, h) * 0.35);
    vctx.beginPath();
    vctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    vctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    vctx.stroke();
  }
}
function drawMirrorBars() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const barCount = 48;
  const step = Math.floor(freqData.length / barCount);
  const barWidth = w / barCount;
  const grad = vctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#c084fc'); grad.addColorStop(0.5, '#6366f1'); grad.addColorStop(1, '#c084fc');
  vctx.fillStyle = grad;
  for (let i = 0; i < barCount; i++) {
    const v = freqData[i * step] / 255;
    const barH = v * h * 0.45;
    vctx.fillRect(i * barWidth + 1, h / 2 - barH, barWidth - 2, barH * 2);
  }
}
function drawDualWave() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const step = w / timeData.length;
  vctx.lineWidth = 2 * devicePixelRatio;
  [{ color: '#a78bfa', scale: 0.4, offset: 0 }, { color: 'rgba(192,132,252,0.6)', scale: 0.28, offset: 10 }].forEach((layer) => {
    vctx.strokeStyle = layer.color;
    vctx.beginPath();
    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i] / 128 - 1;
      const y = h / 2 + v * h * layer.scale + layer.offset;
      if (i === 0) vctx.moveTo(0, y); else vctx.lineTo(i * step, y);
    }
    vctx.stroke();
  });
}
function drawParticles() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const bass = bandAvg(0, 16);
  if (Math.random() < 0.15 + bass * 0.5) {
    particles.push({ x: Math.random() * w, y: h, vy: -(1 + bass * 4) * devicePixelRatio, r: (2 + bass * 4) * devicePixelRatio, life: 1 });
  }
  particles.forEach((p) => { p.y += p.vy; p.life -= 0.01; });
  particles = particles.filter((p) => p.life > 0 && p.y > -20);
  vctx.fillStyle = '#c084fc';
  particles.forEach((p) => {
    vctx.globalAlpha = Math.max(0, p.life);
    vctx.beginPath(); vctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); vctx.fill();
  });
  vctx.globalAlpha = 1;
}
function drawStarfield() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const treble = bandAvg(freqData.length - 32, freqData.length);
  if (particles.length < 120) particles.push({ a: Math.random() * Math.PI * 2, r: 0, speed: 1 + Math.random() * 2 });
  particles.forEach((p) => { p.r += p.speed * (1 + treble * 3); });
  particles = particles.filter((p) => p.r < Math.max(w, h));
  vctx.fillStyle = '#e9d5ff';
  particles.forEach((p) => {
    const x = cx + Math.cos(p.a) * p.r, y = cy + Math.sin(p.a) * p.r;
    vctx.beginPath(); vctx.arc(x, y, 1.5 * devicePixelRatio, 0, Math.PI * 2); vctx.fill();
  });
}
let tunnelT = 0;
function drawTunnel() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  tunnelT += 0.02;
  const rings = 10;
  for (let i = 0; i < rings; i++) {
    const v = freqData[Math.floor((i / rings) * freqData.length)] / 255;
    const r = (i / rings) * Math.min(w, h) * 0.5 + v * 20;
    vctx.strokeStyle = `rgba(139,124,246,${0.15 + v * 0.5})`;
    vctx.lineWidth = 2 * devicePixelRatio;
    vctx.beginPath();
    vctx.arc(cx, cy, r, tunnelT + i, tunnelT + i + Math.PI * 1.5);
    vctx.stroke();
  }
}
let spiralT = 0;
function drawSpiral() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  spiralT += 0.015;
  const n = 80;
  vctx.fillStyle = '#a78bfa';
  for (let i = 0; i < n; i++) {
    const v = freqData[Math.floor((i / n) * freqData.length)] / 255;
    const angle = i * 0.35 + spiralT;
    const r = (i / n) * Math.min(w, h) * 0.48;
    const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
    vctx.beginPath(); vctx.arc(x, y, (1.5 + v * 3) * devicePixelRatio, 0, Math.PI * 2); vctx.fill();
  }
}
function drawBattery() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cols = 32, rows = 12;
  const cw = w / cols, ch = h / rows;
  for (let c = 0; c < cols; c++) {
    const v = freqData[Math.floor((c / cols) * freqData.length)] / 255;
    const lit = Math.round(v * rows);
    for (let r = 0; r < rows; r++) {
      if (r < rows - lit) continue;
      vctx.fillStyle = r < rows * 0.25 ? '#ef4444' : r < rows * 0.5 ? '#f97316' : '#6366f1';
      vctx.fillRect(c * cw + 1, r * ch + 1, cw - 2, ch - 2);
    }
  }
}
let plasmaT = 0;
function drawPlasma() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  plasmaT += 0.02;
  const bass = bandAvg(0, 16);
  const mid = bandAvg(16, 64);
  const blobs = [
    { x: w * (0.3 + Math.sin(plasmaT) * 0.1), y: h * 0.5, r: 60 + bass * 100, color: '#6366f1' },
    { x: w * (0.7 + Math.cos(plasmaT * 1.3) * 0.1), y: h * 0.5, r: 50 + mid * 90, color: '#c084fc' },
  ];
  blobs.forEach((b) => {
    const grad = vctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * devicePixelRatio);
    grad.addColorStop(0, b.color); grad.addColorStop(1, 'transparent');
    vctx.globalAlpha = 0.55; vctx.fillStyle = grad;
    vctx.fillRect(0, 0, w, h);
  });
  vctx.globalAlpha = 1;
}
let lastBassPeak = 0;
function drawFireworks() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const bass = bandAvg(0, 12);
  const now = performance.now();
  if (bass > 0.62 && now - lastBassPeak > 260) {
    lastBassPeak = now;
    const cx = Math.random() * w, cy = h * (0.25 + Math.random() * 0.3);
    const hue = Math.floor(Math.random() * 360);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * (2 + Math.random() * 2), vy: Math.sin(a) * (2 + Math.random() * 2), life: 1, hue });
    }
  }
  particles.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.life -= 0.015; });
  particles = particles.filter((p) => p.life > 0);
  particles.forEach((p) => {
    vctx.globalAlpha = Math.max(0, p.life);
    vctx.fillStyle = `hsl(${p.hue}, 85%, 65%)`;
    vctx.beginPath(); vctx.arc(p.x, p.y, 2 * devicePixelRatio, 0, Math.PI * 2); vctx.fill();
  });
  vctx.globalAlpha = 1;
}
let ribbonT = 0;
function drawRibbon() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  ribbonT += 0.03;
  const vol = bandAvg(0, freqData.length);
  vctx.strokeStyle = '#8b7cf6';
  vctx.lineWidth = (4 + vol * 22) * devicePixelRatio;
  vctx.lineCap = 'round';
  vctx.beginPath();
  for (let x = 0; x <= w; x += 6) {
    const y = h / 2 + Math.sin(x * 0.01 + ribbonT) * h * 0.22 * (0.4 + vol);
    if (x === 0) vctx.moveTo(x, y); else vctx.lineTo(x, y);
  }
  vctx.stroke();
}
function drawKaleidoscope() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const segments = 8, n = 40;
  for (let s = 0; s < segments; s++) {
    vctx.save();
    vctx.translate(cx, cy);
    vctx.rotate((s / segments) * Math.PI * 2);
    vctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = freqData[Math.floor((i / n) * freqData.length)] / 255;
      const r = (i / n) * Math.min(w, h) * 0.5;
      const x = r, y = Math.sin(i * 0.5) * v * 30;
      if (i === 0) vctx.moveTo(x, y); else vctx.lineTo(x, y);
    }
    vctx.strokeStyle = 'rgba(192,132,252,0.6)';
    vctx.lineWidth = 2 * devicePixelRatio;
    vctx.stroke();
    vctx.restore();
  }
}
function drawRain() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const vol = bandAvg(0, freqData.length);
  if (particles.length < 200 && Math.random() < 0.3 + vol * 0.6) {
    particles.push({ x: Math.random() * w, y: -10, vy: (4 + Math.random() * 5) * devicePixelRatio, len: (10 + Math.random() * 20) * devicePixelRatio });
  }
  particles.forEach((p) => { p.y += p.vy; });
  particles = particles.filter((p) => p.y - p.len < h);
  vctx.strokeStyle = 'rgba(139,124,246,0.55)';
  vctx.lineWidth = 1.5 * devicePixelRatio;
  particles.forEach((p) => {
    vctx.beginPath(); vctx.moveTo(p.x, p.y - p.len); vctx.lineTo(p.x, p.y); vctx.stroke();
  });
}
let lastRingPeak = 0;
function drawPulseRings() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const bass = bandAvg(0, 12);
  const now = performance.now();
  if (bass > 0.55 && now - lastRingPeak > 200) {
    lastRingPeak = now;
    particles.push({ r: 10, life: 1 });
  }
  particles.forEach((p) => { p.r += 4 * devicePixelRatio; p.life -= 0.02; });
  particles = particles.filter((p) => p.life > 0);
  particles.forEach((p) => {
    vctx.globalAlpha = Math.max(0, p.life);
    vctx.strokeStyle = '#c084fc';
    vctx.lineWidth = 3 * devicePixelRatio;
    vctx.beginPath(); vctx.arc(cx, cy, p.r, 0, Math.PI * 2); vctx.stroke();
  });
  vctx.globalAlpha = 1;
}
let gridT = 0;
function drawGridWave() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  gridT += 0.05;
  const cols = 24;
  vctx.strokeStyle = 'rgba(99,102,241,0.5)';
  vctx.lineWidth = 1.5 * devicePixelRatio;
  for (let row = 0; row < 5; row++) {
    vctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const v = freqData[Math.floor((c / cols) * freqData.length)] / 255;
      const x = (c / cols) * w;
      const y = h * (0.3 + row * 0.15) - v * 40 * devicePixelRatio - row * 10 + Math.sin(gridT + c * 0.3) * 4;
      if (c === 0) vctx.moveTo(x, y); else vctx.lineTo(x, y);
    }
    vctx.stroke();
  }
}
function drawVortex() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const treble = bandAvg(freqData.length - 32, freqData.length);
  if (particles.length < 100) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.min(w, h) * 0.5;
    particles.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a, r });
  }
  particles.forEach((p) => { p.r -= (1 + treble * 4) * devicePixelRatio; p.a += 0.05; p.x = cx + Math.cos(p.a) * p.r; p.y = cy + Math.sin(p.a) * p.r; });
  particles = particles.filter((p) => p.r > 4);
  vctx.fillStyle = '#e9d5ff';
  particles.forEach((p) => { vctx.beginPath(); vctx.arc(p.x, p.y, 2 * devicePixelRatio, 0, Math.PI * 2); vctx.fill(); });
}
function drawSunburst() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const n = 48;
  for (let i = 0; i < n; i++) {
    const v = freqData[Math.floor((i / n) * freqData.length)] / 255;
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.8) / n) * Math.PI * 2;
    const r = Math.min(w, h) * 0.12 + v * Math.min(w, h) * 0.38;
    vctx.beginPath();
    vctx.moveTo(cx, cy);
    vctx.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    vctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    vctx.closePath();
    vctx.fillStyle = `hsla(${260 - v * 60}, 70%, 65%, 0.5)`;
    vctx.fill();
  }
}
function drawBubbles() {
  const w = canvas.width, h = canvas.height;
  vctx.clearRect(0, 0, w, h);
  const mid = bandAvg(16, 64);
  if (particles.length < 60 && Math.random() < 0.1 + mid * 0.3) {
    particles.push({ x: Math.random() * w, y: h + 10, r: (4 + Math.random() * 16) * devicePixelRatio, vy: -(0.5 + Math.random() * 1.5) * devicePixelRatio });
  }
  particles.forEach((p) => { p.y += p.vy; });
  particles = particles.filter((p) => p.y + p.r > 0);
  vctx.strokeStyle = 'rgba(167,139,250,0.7)';
  vctx.lineWidth = 1.5 * devicePixelRatio;
  particles.forEach((p) => { vctx.beginPath(); vctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); vctx.stroke(); });
}

const VIS_DRAW = {
  bars: drawBars, wave: drawWave, circular: drawCircular, mirrorBars: drawMirrorBars,
  dualWave: drawDualWave, particles: drawParticles, starfield: drawStarfield, tunnel: drawTunnel,
  spiral: drawSpiral, battery: drawBattery, plasma: drawPlasma, fireworks: drawFireworks,
  ribbon: drawRibbon, kaleidoscope: drawKaleidoscope, rain: drawRain, pulseRings: drawPulseRings,
  gridWave: drawGridWave, vortex: drawVortex, sunburst: drawSunburst, bubbles: drawBubbles,
};

const meterBars = els.miniMeter ? Array.from(els.miniMeter.children) : [];
function updateMiniMeter() {
  if (!meterBars.length) return;
  let sum = 0;
  for (let i = 0; i < 48; i++) sum += freqData[i];
  const level = sum / (48 * 255);
  meterBars.forEach((bar, i) => {
    const threshold = (i + 1) / meterBars.length;
    bar.classList.toggle('lit', level >= threshold * 0.85);
  });
}
const tabPlayerEl = document.getElementById('tab-player');
function renderLoop() {
  if (!document.hidden) {
    // Skip the (potentially expensive, especially the particle-based) canvas
    // drawing when the Player tab isn't even visible — real CPU/battery win,
    // since a hidden `.tab-pane { display: none }` doesn't stop rAF on its own.
    if (tabPlayerEl.classList.contains('active')) {
      if (visMode !== prevVisMode) { particles = []; prevVisMode = visMode; }
      if (visMode !== 'none') {
        engine.analyser.getByteFrequencyData(freqData);
        engine.analyser.getByteTimeDomainData(timeData);
        const draw = VIS_DRAW[visMode] || drawBars;
        draw();
      }
    }
    updateMiniMeter();
  }
  requestAnimationFrame(renderLoop);
}
renderLoop();

/* ------------------------------------------------------------------ */
/* Dependencies (FFmpeg)                                              */
/* ------------------------------------------------------------------ */

const depFfmpegStatus = document.getElementById('depFfmpegStatus');
const btnInstallDeps = document.getElementById('btnInstallDeps');
const depsProgress = document.getElementById('depsProgress');

async function refreshDepsStatus() {
  const status = await window.waveframe.checkDeps();
  const ok = status.ffmpeg.ok;
  depFfmpegStatus.textContent = ok ? t('settings.depsOk') : t('settings.depsMissing');
  depFfmpegStatus.className = 'dep-status ' + (ok ? 'ok' : 'missing');
  btnInstallDeps.style.display = ok ? 'none' : 'inline-block';
}

window.waveframe.onDepsProgress(({ phase, pct }) => {
  if (phase === 'download') depsProgress.textContent = t('settings.depsDownloading') + Math.round(pct * 100) + '%';
  else if (phase === 'extract') depsProgress.textContent = t('settings.depsExtracting');
  else if (phase === 'done') depsProgress.textContent = t('settings.depsDone');
});

btnInstallDeps.addEventListener('click', async () => {
  btnInstallDeps.disabled = true;
  depsProgress.textContent = t('settings.depsDownloading') + '0%';
  try {
    const result = await window.waveframe.installDeps();
    if (result.ok) await refreshDepsStatus();
    else depsProgress.textContent = t('settings.depsError') + result.error;
  } catch (err) {
    depsProgress.textContent = t('settings.depsError') + err.message;
  } finally {
    btnInstallDeps.disabled = false;
  }
});

document.addEventListener('waveframe:language-changed', () => refreshDepsStatus());

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

renderPresetGrid();
renderUserPresets();
restorePreferences();
restorePlaylist();
updateTrackNameUi();
refreshDepsStatus();

window.waveframe.onMediaKey((action) => {
  if (action === 'playpause') { if (currentTrackIndex === -1 && playlist.length > 0) playTrackAt(0); else engine.togglePlay().then(syncPlayButton); }
  else if (action === 'next') goNext();
  else if (action === 'prev') goPrev();
  else if (action === 'stop') { engine.pauseActive(); syncPlayButton(); }
});

/* ---- Taskbar thumbnail toolbar icons (drawn on a canvas, no image assets needed) ---- */
function drawThumbIcon(draw) {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  draw(ctx);
  return c.toDataURL('image/png');
}
window.waveframe?.setThumbbarIcons?.({
  prev: drawThumbIcon((ctx) => {
    ctx.fillRect(8, 8, 3, 16);
    ctx.beginPath(); ctx.moveTo(24, 8); ctx.lineTo(24, 24); ctx.lineTo(13, 16); ctx.closePath(); ctx.fill();
  }),
  next: drawThumbIcon((ctx) => {
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(8, 24); ctx.lineTo(19, 16); ctx.closePath(); ctx.fill();
    ctx.fillRect(21, 8, 3, 16);
  }),
  play: drawThumbIcon((ctx) => {
    ctx.beginPath(); ctx.moveTo(10, 7); ctx.lineTo(10, 25); ctx.lineTo(25, 16); ctx.closePath(); ctx.fill();
  }),
  pause: drawThumbIcon((ctx) => {
    ctx.fillRect(9, 7, 5, 18);
    ctx.fillRect(18, 7, 5, 18);
  }),
});

if (!localStorage.getItem('waveframe.tutorialSeen')) {
  setTimeout(openTutorial, 400);
}

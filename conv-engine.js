'use strict';
// Node-side engine of the audio converter: runs ffmpeg, probes files, plans collision-free output names next to the original.
// No Electron imports (unit/real-conversion tests use it directly); IPC glue is in conv-main.js. The original file is only ever read.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./renderer/convlib.js');

const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wma', 'aiff', 'aif', 'alac', 'ape', 'wv', 'mka', 'mp2', 'ac3', 'amr'];
const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'ts', 'mpg', 'mpeg', '3gp'];

function runFfmpeg(ffmpegPath, args, { duration = 0, onProgress } = {}) {
  let child = null, cancelled = false;
  const promise = new Promise((resolve, reject) => {
    let tail = '';
    try { child = spawn(ffmpegPath, args, { windowsHide: true }); } catch (e) { return reject(e); }
    child.stdout.on('data', () => {});
    child.stderr.on('data', (c) => {
      const s = c.toString();
      tail = (tail + s).slice(-6000);
      const t = L.parseFfmpegTime(s);
      if (t != null && duration > 0 && onProgress) onProgress(Math.min(0.99, t / duration));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (cancelled) return reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      resolve({ code, stderr: tail });
    });
  });
  return { promise, cancel() { cancelled = true; if (child) try { child.kill(); } catch (_) { /* gone */ } } };
}

async function probe(ffmpegPath, file) {
  const r = await runFfmpeg(ffmpegPath, ['-hide_banner', '-i', file]).promise; // exit code 1 is normal (no output file)
  return L.parseProbe(r.stderr);
}

// Decodes the whole file to the null muxer: proves it is a valid, decodable stream and returns how long it really is.
async function verifyDecodes(ffmpegPath, file) {
  const r = await runFfmpeg(ffmpegPath, ['-hide_banner', '-v', 'error', '-stats', '-i', file, '-f', 'null', '-']).promise;
  const decoded = L.parseFfmpegTime(r.stderr);
  const info = await probe(ffmpegPath, file);
  return { ok: r.code === 0 && !/error/i.test(r.stderr.replace(/time=.*/g, '')), decodedSeconds: decoded, ...info };
}

// outDir (optional) puts the result in that folder instead of next to the input (created if missing).
function planOutput(input, options, exists = fs.existsSync, outDir) {
  const spec = L.FORMATS[options.format];
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const out = L.buildOutputPath({ inputPath: input, ext: spec.ext, suffix: options.suffix, pathApi: path, exists, dir: outDir || undefined });
  const tmp = path.join(path.dirname(out), `.waveframe-${process.pid}-${crypto.randomBytes(4).toString('hex')}.${spec.ext}`);
  return { out, tmp };
}

// Moves the finished temp file to its final name; if that name got taken meanwhile, picks the next free one.
function finalize(tmp, input, options, outDir) {
  const spec = L.FORMATS[options.format];
  const out = L.buildOutputPath({ inputPath: input, ext: spec.ext, suffix: options.suffix, pathApi: path, exists: fs.existsSync, dir: outDir || undefined });
  fs.renameSync(tmp, out);
  return out;
}

async function runToTemp({ ffmpegPath, input, options, mode, source, duration, onProgress, outDir }) {
  const { tmp } = planOutput(input, options, fs.existsSync, outDir);
  const args = L.buildFfmpegArgs({ input: source, output: tmp, options, mode });
  const run = runFfmpeg(ffmpegPath, args, { duration, onProgress });
  const promise = run.promise.then((r) => {
    if (r.code !== 0 || !fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (_) { /* none */ } throw new Error(r.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || `ffmpeg exited with code ${r.code}`); }
    return { output: finalize(tmp, input, options, outDir) };
  }, (e) => { try { fs.unlinkSync(tmp); } catch (_) { /* none */ } throw e; });
  return { promise, cancel: run.cancel };
}

// ffmpeg reads the original and does everything (decode any audio / video audio track, trim, rate, channels, codec).
async function convertDirect({ ffmpegPath, input, options, onProgress, outDir }) {
  const info = await probe(ffmpegPath, input);
  if (!info.hasAudio) throw Object.assign(new Error('no-audio'), { code: 'no-audio' });
  const span = (options.trimEnd > 0 ? Math.min(options.trimEnd, info.duration || options.trimEnd) : info.duration) - options.trimStart;
  return runToTemp({ ffmpegPath, input, options, mode: 'direct', source: input, duration: span > 0 ? span : info.duration, onProgress, outDir });
}

// The renderer already applied trim/rate/channels/effects/gain and sent a WAV: for WAV output it is written as is, otherwise ffmpeg encodes it.
async function convertFromWav({ ffmpegPath, input, wavBytes, options, onProgress, duration, outDir }) {
  if (options.format === 'wav') {
    const { tmp } = planOutput(input, options, fs.existsSync, outDir);
    fs.writeFileSync(tmp, Buffer.from(wavBytes));
    if (onProgress) onProgress(1);
    return { promise: Promise.resolve({ output: finalize(tmp, input, options, outDir) }), cancel() {} };
  }
  if (!ffmpegPath) throw Object.assign(new Error('no-ffmpeg'), { code: 'no-ffmpeg' });
  const wavTmp = path.join(require('os').tmpdir(), `waveframe-conv-${process.pid}-${crypto.randomBytes(4).toString('hex')}.wav`);
  fs.writeFileSync(wavTmp, Buffer.from(wavBytes));
  const job = await runToTemp({ ffmpegPath, input, options, mode: 'encode', source: wavTmp, duration, onProgress, outDir });
  const cleanup = () => { try { fs.unlinkSync(wavTmp); } catch (_) { /* none */ } };
  return { promise: job.promise.finally(cleanup), cancel: job.cancel };
}

// ffmpeg decodes anything it knows to 32-bit float WAV when the renderer's own decoder cannot (WMA, AIFF, some video containers).
async function predecodeToWav({ ffmpegPath, input, sampleRate }) {
  const tmp = path.join(require('os').tmpdir(), `waveframe-pre-${process.pid}-${crypto.randomBytes(4).toString('hex')}.wav`);
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-vn', '-map', '0:a:0', ...(sampleRate > 0 ? ['-ar', String(sampleRate)] : []), '-c:a', 'pcm_f32le', '-f', 'wav', tmp];
  const r = await runFfmpeg(ffmpegPath, args).promise;
  if (r.code !== 0) { try { fs.unlinkSync(tmp); } catch (_) { /* none */ } throw new Error('predecode-failed'); }
  const bytes = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return bytes;
}

module.exports = { AUDIO_EXTS, VIDEO_EXTS, runFfmpeg, probe, verifyDecodes, planOutput, convertDirect, convertFromWav, predecodeToWav };

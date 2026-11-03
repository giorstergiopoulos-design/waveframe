'use strict';
// Video encoding engine (Opsis Media Suite step 1, 2.1.0): ffmpeg encoder detection, probing, thumbnails and the encode job with
// hardware -> software fallback, optional two-pass, cancel and cleanup. Electron-free (unit and real-transcode tests use it directly).
// Shares runFfmpeg / naming with the audio converter (conv-engine.js) so there is ONE ffmpeg mechanism; arguments are always arrays.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('./renderer/convlib.js');
const V = require('./renderer/vidlib.js');
const { runFfmpeg } = require('./conv-engine.js');

const encoderCache = new Map();

// Runs ffmpeg and returns ALL of stdout + stderr (capped at 1 MB): the encoder list is longer than runFfmpeg's progress tail.
function capture(ffmpegPath, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let out = ''; let child;
    try { child = spawn(ffmpegPath, args, { windowsHide: true }); } catch (_) { return resolve(''); }
    const timer = setTimeout(() => { try { child.kill(); } catch (_) { /* gone */ } }, timeoutMs);
    const take = (c) => { if (out.length < 1024 * 1024) out += c.toString(); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', () => { clearTimeout(timer); resolve(out); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

// Asks ffmpeg what it can encode and which hardware accelerators it knows. Cached per binary.
async function detectEncoders(ffmpegPath) {
  if (encoderCache.has(ffmpegPath)) return encoderCache.get(ffmpegPath);
  const res = {
    encoders: V.parseEncoders(await capture(ffmpegPath, ['-hide_banner', '-encoders'])),
    hwaccels: V.parseHwaccels(await capture(ffmpegPath, ['-hide_banner', '-hwaccels'])),
  };
  encoderCache.set(ffmpegPath, res);
  return res;
}

async function probeVideo(ffmpegPath, file) {
  const r = await runFfmpeg(ffmpegPath, ['-hide_banner', '-i', file]).promise; // exit code 1 is normal (no output file)
  return V.parseProbe(r.stderr);
}

// One frame as a small PNG data URL (preview of the file). stdout is captured and capped at 2 MB.
function thumbnail(ffmpegPath, file, atSec = 1) {
  return new Promise((resolve) => {
    const at = Number.isFinite(atSec) && atSec >= 0 ? atSec : 1;
    const chunks = []; let n = 0; let child;
    try { child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { windowsHide: true }); } catch (_) { return resolve(null); }
    child.stdout.on('data', (c) => { n += c.length; if (n > 2 * 1024 * 1024) child.kill(); else chunks.push(c); });
    child.stderr.on('data', () => {});
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(n > 0 && n <= 2 * 1024 * 1024 ? 'data:image/png;base64,' + Buffer.concat(chunks).toString('base64') : null));
  });
}

function removePassFiles(prefix) {
  try {
    const dir = path.dirname(prefix), base = path.basename(prefix);
    for (const f of fs.readdirSync(dir)) if (f.startsWith(base)) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* in use */ } }
  } catch (_) { /* gone */ }
}

const lastLines = (text) => String(text).split(/\r?\n/).filter(Boolean).slice(-3).join(' ');

// Encodes one video (or extracts its audio / makes a GIF). Tries the available encoders of the chosen codec in order (hardware first, then
// software): a failing hardware encoder (no GPU, missing driver) falls through to the next one. Two passes run only for encoders that
// support -pass. Returns { promise -> { output, encoder, fellBackFrom }, cancel() }; a half-written file is removed on error and on cancel.
async function encodeVideo({ ffmpegPath, input, options, available, onProgress, outDir }) {
  const info = await probeVideo(ffmpegPath, input);
  if (!info.video && !options.audioOnly) throw Object.assign(new Error('no-video'), { code: 'no-video' });
  if (options.audioOnly && !info.audio.length) throw Object.assign(new Error('no-audio'), { code: 'no-audio' });
  const needsEncoder = !options.audioOnly && !options.gif;
  const order = needsEncoder ? V.encoderOrder(options.codec, available) : [null];
  if (!order.length) throw Object.assign(new Error('no-encoder'), { code: 'no-encoder' });
  const ext = V.outputExt(options);
  const span = (options.trimEnd > 0 ? Math.min(options.trimEnd, info.duration || options.trimEnd) : info.duration) - options.trimStart;
  const duration = span > 0 ? span : info.duration;
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const finalPath = () => L.buildOutputPath({ inputPath: input, ext, suffix: options.suffix, pathApi: path, exists: fs.existsSync, dir: outDir || undefined });
  let current = null, cancelled = false, tmp = null, passLog = null;
  const cleanup = () => { if (tmp) { try { fs.unlinkSync(tmp); } catch (_) { /* none */ } } if (passLog) removePassFiles(passLog); tmp = null; passLog = null; };
  const run = (args, scale, offset) => {
    current = runFfmpeg(ffmpegPath, args, { duration, onProgress: (p) => { if (onProgress) onProgress(offset + p * scale); } });
    return current.promise;
  };
  const promise = (async () => {
    let lastError = null, firstTried = null;
    for (const enc of order) {
      if (cancelled) break;
      const twoPass = !!enc && options.passes === 2 && V.canTwoPass(enc);
      tmp = path.join(path.dirname(finalPath()), `.waveframe-${process.pid}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
      passLog = twoPass ? path.join(os.tmpdir(), `waveframe-pass-${process.pid}-${crypto.randomBytes(4).toString('hex')}`) : null;
      try {
        if (twoPass) {
          const r1 = await run(V.buildArgs({ input, output: tmp, options, encoder: enc, pass: 1, passLog, info }), 0.5, 0);
          if (r1.code !== 0) throw new Error(lastLines(r1.stderr) || 'pass 1 failed');
          const r2 = await run(V.buildArgs({ input, output: tmp, options, encoder: enc, pass: 2, passLog, info }), 0.5, 0.5);
          if (r2.code !== 0) throw new Error(lastLines(r2.stderr) || 'pass 2 failed');
        } else {
          const r = await run(V.buildArgs({ input, output: tmp, options, encoder: enc, info }), 1, 0);
          if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(lastLines(r.stderr) || `ffmpeg exited with code ${r.code}`);
        }
        const out = finalPath();
        fs.renameSync(tmp, out);
        if (passLog) removePassFiles(passLog);
        tmp = null; passLog = null;
        if (onProgress) onProgress(1);
        return { output: out, encoder: enc, fellBackFrom: firstTried };
      } catch (e) {
        cleanup();
        if (cancelled || (e && e.code === 'cancelled')) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
        lastError = e;
        if (!firstTried) firstTried = enc;
      }
    }
    if (cancelled) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    throw lastError || new Error('encode failed');
  })();
  return { promise, cancel() { cancelled = true; if (current) current.cancel(); } };
}

module.exports = { capture, detectEncoders, probeVideo, thumbnail, encodeVideo };

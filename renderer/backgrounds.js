'use strict';

const Backgrounds = (() => {
  const canvas = document.getElementById('bgCanvas');
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = window.innerWidth, H = window.innerHeight;
  function resizeCanvas() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.scale(DPR, DPR);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  let mode = 'equalizer';
  let t = 0;
  let analyserRef = null;
  let freqDataRef = null;

  function accentColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      a: styles.getPropertyValue('--accent-2').trim() || '#6366f1',
      b: styles.getPropertyValue('--accent-3').trim() || '#7c3aed',
      bg: styles.getPropertyValue('--bg').trim() || '#0b0b14',
    };
  }

  function drawEqualizer() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    let bars = 48;
    let data = null;
    if (analyserRef && freqDataRef) {
      analyserRef.getByteFrequencyData(freqDataRef);
      data = freqDataRef;
    }
    const barW = W / bars;
    const grad = ctx.createLinearGradient(0, H, 0, H * 0.25);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < bars; i++) {
      let v;
      if (data) {
        v = data[Math.floor((i / bars) * data.length)] / 255;
      } else {
        v = (Math.sin(t * 1.6 + i * 0.4) * 0.5 + 0.5) * 0.6;
      }
      const barH = Math.max(4, v * H * 0.55);
      ctx.fillRect(i * barW + 1, H - barH, barW - 2, barH);
    }
    ctx.globalAlpha = 1;
  }

  function drawWaves() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const layers = [
      { amp: 40, freq: 0.006, speed: 0.4, alpha: 0.18, y: H * 0.35, color: a },
      { amp: 60, freq: 0.004, speed: -0.25, alpha: 0.16, y: H * 0.55, color: b },
      { amp: 30, freq: 0.008, speed: 0.55, alpha: 0.14, y: H * 0.75, color: a },
    ];
    layers.forEach((l) => {
      ctx.beginPath();
      ctx.moveTo(0, l.y);
      for (let x = 0; x <= W; x += 8) {
        const y = l.y + Math.sin(x * l.freq + t * l.speed) * l.amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = l.color;
      ctx.globalAlpha = l.alpha;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawNebula() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const blobs = [
      { x: W * 0.3, y: H * 0.35, r: 260, color: a, speed: 0.15 },
      { x: W * 0.7, y: H * 0.6, r: 220, color: b, speed: -0.1 },
    ];
    blobs.forEach((blob, i) => {
      const ox = Math.cos(t * blob.speed + i) * 60;
      const oy = Math.sin(t * blob.speed * 1.3 + i) * 40;
      const grad = ctx.createRadialGradient(blob.x + ox, blob.y + oy, 0, blob.x + ox, blob.y + oy, blob.r);
      grad.addColorStop(0, blob.color);
      grad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    });
    ctx.globalAlpha = 1;

    // Faint rotating vinyl ring, bottom-right.
    const cx = W - 140, cy = H - 100, r = 90;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.12);
    ctx.strokeStyle = a;
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r - i * 14, 0, Math.PI * 1.6);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawNone() {
    const { bg } = accentColors();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }

  let starfieldStars = null;
  function drawStarfield() {
    const { a, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!starfieldStars) {
      starfieldStars = Array.from({ length: 140 }, () => ({
        a: Math.random() * Math.PI * 2, r: Math.random() * Math.max(W, H) * 0.5,
        speed: 0.15 + Math.random() * 0.3, size: 0.5 + Math.random() * 1.5,
      }));
    }
    const cx = W / 2, cy = H / 2;
    ctx.fillStyle = a;
    starfieldStars.forEach((s) => {
      s.r += s.speed;
      if (s.r > Math.max(W, H) * 0.75) s.r = 0;
      const x = cx + Math.cos(s.a) * s.r, y = cy + Math.sin(s.a) * s.r;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(x, y, s.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawAurora() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const bands = [
      { y: H * 0.2, amp: 50, freq: 0.003, speed: 0.1, color: a },
      { y: H * 0.4, amp: 70, freq: 0.0025, speed: -0.07, color: b },
      { y: H * 0.6, amp: 40, freq: 0.004, speed: 0.12, color: a },
    ];
    bands.forEach((band) => {
      const grad = ctx.createLinearGradient(0, band.y - band.amp, 0, band.y + band.amp);
      grad.addColorStop(0, 'transparent'); grad.addColorStop(0.5, band.color); grad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, band.y);
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, band.y + Math.sin(x * band.freq + t * band.speed) * band.amp);
      ctx.lineTo(W, band.y + band.amp * 2); ctx.lineTo(0, band.y + band.amp * 2);
      ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawVinylSpin() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.08);
    ctx.strokeStyle = a; ctx.globalAlpha = 0.18;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath(); ctx.arc(0, 0, r - i * (r / 12), 0, Math.PI * 2); ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = b; ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  let driftParticles = null;
  function drawParticleDrift() {
    const { a, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!driftParticles) {
      driftParticles = Array.from({ length: 60 }, () => ({
        x: Math.random() * W, y: Math.random() * H, vy: -(0.2 + Math.random() * 0.4), r: 1 + Math.random() * 2.5,
      }));
    }
    ctx.fillStyle = a;
    driftParticles.forEach((p) => {
      p.y += p.vy;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawGradientMesh() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const blobs = [
      { x: 0.2, y: 0.3, r: 0.35, color: a, sx: 0.08, sy: 0.05 },
      { x: 0.8, y: 0.25, r: 0.3, color: b, sx: -0.06, sy: 0.07 },
      { x: 0.5, y: 0.75, r: 0.4, color: a, sx: 0.05, sy: -0.06 },
    ];
    blobs.forEach((blob, i) => {
      const x = (blob.x + Math.sin(t * blob.sx + i) * 0.08) * W;
      const y = (blob.y + Math.cos(t * blob.sy + i) * 0.08) * H;
      const r = blob.r * Math.max(W, H);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, blob.color); grad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.2; ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    });
    ctx.globalAlpha = 1;
  }

  function drawPulseGrid() {
    const { a, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const spacing = 48;
    const cols = Math.ceil(W / spacing), rows = Math.ceil(H / spacing);
    ctx.fillStyle = a;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const dist = Math.sqrt(i * i + j * j);
        const pulse = (Math.sin(t * 1.2 - dist * 0.3) + 1) / 2;
        ctx.globalAlpha = 0.08 + pulse * 0.18;
        const size = 1.5 + pulse * 2.5;
        ctx.beginPath(); ctx.arc(i * spacing, j * spacing, size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  let bokehLights = null;
  function drawBokeh() {
    const { a, b, bg } = accentColors();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!bokehLights) {
      bokehLights = Array.from({ length: 18 }, () => ({
        x: Math.random() * W, y: Math.random() * H, r: 20 + Math.random() * 60,
        vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
        color: Math.random() > 0.5 ? a : b,
      }));
    }
    ctx.fillStyle = bg;
    bokehLights.forEach((l) => {
      l.x += l.vx; l.y += l.vy;
      if (l.x < -l.r) l.x = W + l.r;
      if (l.x > W + l.r) l.x = -l.r;
      if (l.y < -l.r) l.y = H + l.r;
      if (l.y > H + l.r) l.y = -l.r;
      const grad = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      grad.addColorStop(0, l.color); grad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.16; ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame() {
    // Respect the OS "reduce motion" preference: keep showing the chosen
    // background (don't force it off), just stop it from continuously animating.
    if (!reduceMotion) t += 0.016;
    if (mode === 'equalizer') drawEqualizer();
    else if (mode === 'waves') drawWaves();
    else if (mode === 'nebula') drawNebula();
    else if (mode === 'starfield') drawStarfield();
    else if (mode === 'aurora') drawAurora();
    else if (mode === 'vinylspin') drawVinylSpin();
    else if (mode === 'particledrift') drawParticleDrift();
    else if (mode === 'mesh') drawGradientMesh();
    else if (mode === 'grid') drawPulseGrid();
    else if (mode === 'bokeh') drawBokeh();
    else drawNone();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setMode(m) { mode = m; },
    setAnalyser(analyser, freqData) { analyserRef = analyser; freqDataRef = freqData; },
  };
})();

'use strict';
// Video player tab (2.3.0, taken over from Opsis Media Player Pro): playlist, resume position, bookmarks, recent files, saved playlists,
// subtitles (SRT/VTT/ASS next to the video or chosen by hand, delay, size, colour) and the Suite's equaliser on the video's sound.
// Local files stream through the read-only wfmedia: protocol of the main process; the pure helpers live in vplib.js (unit-tested).

(function () {
  const VP = window.WaveframeVp;
  const api = window.waveframe;
  const $ = (id) => document.getElementById(id);
  const K = { recent: 'waveframe.video.recent', resume: 'waveframe.video.resume', bookmarks: 'waveframe.video.bookmarks', subs: 'waveframe.video.subs', playlists: 'waveframe.video.playlists', speed: 'waveframe.video.speed', queue: 'waveframe.video.queue' };
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ } };
  const fmt = (s, vars) => Object.entries(vars || {}).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

  let ab = { stage: 'off', a: 0, b: 0 }, pic = { brightness: 100, contrast: 100, saturation: 100, rotate: 0, flipH: false, flipV: false }, stopAfter = false;
  let video, list = [], idx = -1, subSrc = [], subSel = -1, subDelay = 0, saveTimer = 0, built = false, fx = null;

  const say = (text) => { const e = $('vpStatus'); if (e) e.textContent = text || ''; };
  const current = () => (idx >= 0 ? list[idx] : null);

  /* ---------------- playlist ---------------- */
  function renderList() {
    const ul = $('vpList'); ul.textContent = '';
    list.forEach((p, i) => {
      const li = document.createElement('li'); if (i === idx) li.classList.add('current');
      const b = document.createElement('button'); b.className = 'vp-name'; b.textContent = VP.titleOf(p); b.title = p; b.addEventListener('click', () => playAt(i));
      const x = document.createElement('button'); x.className = 'vp-x'; x.textContent = '✕'; x.setAttribute('aria-label', t('vp.remove')); x.addEventListener('click', () => removeAt(i));
      li.append(b, x); ul.append(li);
    });
    put(K.queue, list.slice(0, VP.LIMITS.playlist));
  }
  function addPaths(paths, play) {
    const ok = (paths || []).filter(VP.playable);
    if (!ok.length) { say(t('vp.unsupported')); return; }
    const first = list.length;
    for (const p of ok) if (list.length < VP.LIMITS.playlist) list.push(p);
    renderList();
    if (play && first < list.length) playAt(first);
  }
  function removeAt(i) {
    list.splice(i, 1);
    if (i < idx) idx--; else if (i === idx) { idx = -1; stop(); }
    renderList();
  }
  function stop() { saveResume(); video.pause(); video.removeAttribute('src'); video.load(); $('vpFrame').classList.remove('has-media'); }

  function playAt(i) {
    if (i < 0 || i >= list.length) return;
    saveResume();
    idx = i; const p = list[i];
    clearSubs();
    if (VP.isUrl(p)) video.removeAttribute('crossorigin'); else video.crossOrigin = 'anonymous';
    video.src = VP.mediaUrl(p);
    $('vpFrame').classList.add('has-media');
    video.playbackRate = Number($('vpSpeed').value) || 1;
    renderList(); renderBookmarks();
    put(K.recent, VP.pushRecent(get(K.recent, []), p)); fillRecent();
    say(fmt(t('vp.playing'), { name: VP.titleOf(p) }));
    window.dispatchEvent(new CustomEvent('waveframe:video-playing'));
    video.play().catch(() => { /* the error event reports unsupported media */ });
    if (!VP.isUrl(p)) loadSiblingSubs(p);
    refreshFx();
  }
  const next = (d) => { if (list.length) playAt((idx + d + list.length) % list.length); };

  /* ---------------- resume ---------------- */
  function saveResume() {
    const it = current(); if (!it || !video.duration) return;
    const pos = video.currentTime * 1000, act = VP.resumeAction(pos, video.duration * 1000);
    const map = get(K.resume, {});
    if (act === 'save') map[it] = Math.round(pos); else if (act === 'clear') delete map[it]; else return;
    put(K.resume, VP.limitResume(map));
  }

  /* ---------------- bookmarks ---------------- */
  function renderBookmarks() {
    const ul = $('vpBookmarks'); ul.textContent = '';
    const it = current(); if (!it) return;
    for (const b of VP.sortedBookmarks(get(K.bookmarks, []), it)) {
      const li = document.createElement('li');
      const go = document.createElement('button'); go.className = 'vp-name'; go.textContent = VP.clock(b.ms); go.addEventListener('click', () => { video.currentTime = b.ms / 1000; });
      const x = document.createElement('button'); x.className = 'vp-x'; x.textContent = '✕'; x.setAttribute('aria-label', t('vp.remove'));
      x.addEventListener('click', () => { put(K.bookmarks, get(K.bookmarks, []).filter((m) => !(m.path === it && m.ms === b.ms))); renderBookmarks(); });
      li.append(go, x); ul.append(li);
    }
  }
  function addBookmark() {
    const it = current(); if (!it) return;
    put(K.bookmarks, VP.addBookmark(get(K.bookmarks, []), it, video.currentTime * 1000)); renderBookmarks();
    say(fmt(t('vp.bookmarkAdded'), { time: VP.clock(video.currentTime * 1000) }));
  }

  /* ---------------- subtitles ---------------- */
  function clearSubs() { subSrc = []; subSel = -1; subDelay = 0; $('vpSubDelay').textContent = '0 s'; rebuildTrack(); fillSubSelect(); }
  function fillSubSelect() {
    const sel = $('vpSubTrack'); sel.textContent = '';
    const off = document.createElement('option'); off.value = '-1'; off.textContent = t('vp.subOff'); sel.append(off);
    subSrc.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = s.name; sel.append(o); });
    sel.value = String(subSel);
  }
  function rebuildTrack() {
    video.querySelectorAll('track').forEach((tr) => { if (tr.src.startsWith('blob:')) URL.revokeObjectURL(tr.src); tr.remove(); });
    if (subSel < 0 || !subSrc[subSel]) return;
    const s = subSrc[subSel], r = VP.subtitleToVtt(s.text, s.ext, subDelay * 1000);
    if (!r.cues) { say(t('vp.subEmpty')); return; }
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.label = s.name; tr.default = true;
    tr.src = URL.createObjectURL(new Blob([r.vtt], { type: 'text/vtt' }));
    video.append(tr);
    tr.addEventListener('load', () => { if (video.textTracks[0]) video.textTracks[0].mode = 'showing'; });
    if (video.textTracks[0]) video.textTracks[0].mode = 'showing';
  }
  function preferredIndex() {
    const langs = (get(K.subs, {}).languages) || ['el', 'en'];
    for (const l of langs) { const i = subSrc.findIndex((s) => new RegExp(`[._-]${l}([._-]|$)`, 'i').test(s.name.replace(/\.[^.]+$/, ''))); if (i >= 0) return i; }
    return 0;
  }
  async function loadSiblingSubs(p) {
    const found = await api.vpSubsFor(p).catch(() => []);
    if (current() !== p || !found.length) return;
    subSrc = found; subSel = preferredIndex(); fillSubSelect(); rebuildTrack();
  }
  async function loadSubFile() {
    const f = await api.vpPickSub(); if (!f) return;
    subSrc.push({ name: f.name, ext: f.ext, text: f.text }); subSel = subSrc.length - 1; fillSubSelect(); rebuildTrack();
  }
  function setDelay(d) { subDelay = Math.round(d * 10) / 10; $('vpSubDelay').textContent = `${subDelay > 0 ? '+' : ''}${subDelay} s`; rebuildTrack(); }
  function applySubStyle() {
    const s = get(K.subs, {});
    const size = Number($('vpSubSize').value) || 16, color = $('vpSubColor').value || '#ffffff';
    video.style.setProperty('--vp-sub-size', String(Math.round(size / 16 * 100)));
    video.style.setProperty('--vp-sub-color', color);
    put(K.subs, { ...s, fontSize: size, color });
  }

  /* ---------------- sound: the Suite's equaliser on the video ---------------- */
  function refreshFx() {
    const btn = $('vpFx'); if (!fx || !btn) return;
    const on = btn.getAttribute('aria-pressed') === 'true';
    const bands = (typeof engine !== 'undefined' && engine.state && engine.state.eqBands) || [];
    fx.filters.forEach((f, i) => { f.gain.value = on ? Number(bands[i]) || 0 : 0; });
    fx.bass.gain.value = on && typeof engine !== 'undefined' && engine.state ? Number(engine.state.bassBoost) || 0 : 0;
  }
  function toggleFx() {
    const btn = $('vpFx'), on = btn.getAttribute('aria-pressed') !== 'true';
    if (on && VP.isUrl(current())) { say(t('vp.fxLocalOnly')); return; }
    if (!fx) {
      try {
        const ctx = new AudioContext(), src = ctx.createMediaElementSource(video), freqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        const filters = freqs.map((f, i) => { const n = ctx.createBiquadFilter(); n.type = i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking'; n.frequency.value = f; n.Q.value = 1; return n; });
        const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 100;
        let node = src; for (const f of [...filters, bass]) { node.connect(f); node = f; }
        node.connect(ctx.destination);
        fx = { ctx, filters, bass };
      } catch (_) { say(t('vp.fxFailed')); return; }
    }
    btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('active', on);
    if (fx.ctx.state === 'suspended') fx.ctx.resume();
    refreshFx();
  }

  /* ---------------- saved playlists, recent ---------------- */
  function fillPlaylists() {
    const sel = $('vpPlSelect'); sel.textContent = '';
    const names = Object.keys(get(K.playlists, {}));
    if (!names.length) { const o = document.createElement('option'); o.value = ''; o.textContent = t('vp.none'); sel.append(o); return; }
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = `${n} (${get(K.playlists, {})[n].length})`; sel.append(o); }
  }
  function fillRecent() {
    const sel = $('vpRecent'); sel.textContent = '';
    const r = get(K.recent, []).filter(VP.playable);
    const o0 = document.createElement('option'); o0.value = ''; o0.textContent = r.length ? t('vp.choose') : t('vp.none'); sel.append(o0);
    for (const p of r) { const o = document.createElement('option'); o.value = p; o.textContent = VP.titleOf(p); o.title = p; sel.append(o); }
  }
  async function savePlaylist() {
    if (!list.length) return;
    const name = await showInputDialog(t('vp.plName'));
    if (!name) return;
    const all = get(K.playlists, {}); all[String(name).slice(0, 60)] = list.slice(0, VP.LIMITS.playlist); put(K.playlists, all); fillPlaylists();
    say(fmt(t('vp.plSaved'), { name }));
  }
  async function importM3u() {
    const lists = await api.mppPickM3u(); if (!lists.length) return;
    const all = get(K.playlists, {}); let n = 0;
    for (const l of lists) { all[l.name] = l.items; n++; }
    put(K.playlists, all); fillPlaylists();
    say(fmt(t('vp.m3uImported'), { n }));
  }

  /* ---------------- repeat, frame step, A-B, snapshot, picture, info (2.3.1) ---------------- */
  function applyPicture() {
    const css = VP.pictureCss(pic, video.clientWidth, video.clientHeight);
    video.style.filter = css.filter; video.style.transform = css.transform;
  }
  function onEnded() {
    saveResume();
    if (stopAfter) { stopAfter = false; $('vpStopAfter').checked = false; return; }
    const n = VP.nextIndex($('vpRepeat').value, idx, list.length);
    if (n === idx && n >= 0) { video.currentTime = 0; video.play().catch(() => {}); } else if (n >= 0) playAt(n);
  }
  function stepFrame(d) { video.pause(); video.currentTime = Math.max(0, video.currentTime + d / 25); }
  function toggleAB() {
    ab = VP.abStep(ab, video.currentTime);
    if (ab.stage === 'a') say(fmt(t('vp.abA'), { time: VP.clock(ab.a * 1000) }));
    else if (ab.stage === 'loop') say(fmt(t('vp.abB'), { a: VP.clock(ab.a * 1000), b: VP.clock(ab.b * 1000) }));
    else say(t('vp.abOff'));
  }
  async function snapshot() {
    if (!current() || !video.videoWidth) return;
    try {
      const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('empty');
      const r = await api.photoSave({ format: 'png', name: VP.titleOf(current()), bytes: await blob.arrayBuffer() });
      say(r && r.ok ? t('vp.snapSaved') : r && r.canceled ? '' : t('ph.saveFailed'));
    } catch (_) { say(t('ph.saveFailed')); }
  }
  async function fileInfo() {
    const it = current(); if (!it) return;
    const p = VP.isUrl(it) ? null : await api.vidProbe(it).catch(() => null);
    const lines = [VP.titleOf(it)];
    if (video.videoWidth) lines.push(`${video.videoWidth}×${video.videoHeight} · ${VP.clock(video.duration * 1000)}`);
    if (p) {
      if (p.video) lines.push(`${p.video.codec} ${p.video.width}×${p.video.height}${p.video.fps ? ' · ' + p.video.fps + ' fps' : ''}`);
      for (const a of p.audio) lines.push(`${a.codec}${a.channels ? ' · ' + a.channels : ''}${a.lang ? ' · ' + a.lang : ''}`);
      for (const sb of p.subtitles) lines.push(`${sb.codec}${sb.lang ? ' · ' + sb.lang : ''}`);
    } else lines.push(t('vp.infoNone'));
    await showAlertDialog(t('vp.info'), lines.join('\n'));
  }
  function aria() { $('vpFramePrev').setAttribute('aria-label', t('vp.framePrev')); $('vpFramePrev').title = t('vp.framePrev'); $('vpFrameNext').setAttribute('aria-label', t('vp.frameNext')); $('vpFrameNext').title = t('vp.frameNext'); }

  /* ---------------- build ---------------- */
  function build() {
    if (built) return; built = true;
    video = $('vpVideo');
    for (const s of VP.SPEEDS) { const o = document.createElement('option'); o.value = String(s); o.textContent = `${s}×`; $('vpSpeed').append(o); }
    $('vpSpeed').value = String(get(K.speed, 1)); if (!$('vpSpeed').value) $('vpSpeed').value = '1';
    const subs = get(K.subs, {});
    if (subs.fontSize) $('vpSubSize').value = String(subs.fontSize);
    if (subs.color) $('vpSubColor').value = subs.color;
    applySubStyle();
    list = (get(K.queue, [])).filter(VP.playable).slice(0, VP.LIMITS.playlist);
    renderList(); fillPlaylists(); fillRecent(); fillSubSelect();

    $('vpOpen').addEventListener('click', async () => addPaths(await api.vpPick('files'), true));
    $('vpOpenFolder').addEventListener('click', async () => addPaths(await api.vpPick('folder'), true));
    $('vpOpenUrl').addEventListener('click', async () => { const u = await showInputDialog(t('vp.urlPrompt')); if (u && /^https?:\/\/\S+$/i.test(u.trim())) addPaths([u.trim()], true); else if (u) say(t('vp.unsupported')); });
    $('vpPrev').addEventListener('click', () => next(-1));
    $('vpNext').addEventListener('click', () => next(1));
    $('vpSpeed').addEventListener('change', () => { video.playbackRate = Number($('vpSpeed').value) || 1; put(K.speed, video.playbackRate); });
    $('vpFx').addEventListener('click', toggleFx);
    $('vpFull').addEventListener('click', () => { const f = $('vpFrame'); if (document.fullscreenElement) document.exitFullscreen(); else f.requestFullscreen().catch(() => {}); });
    $('vpSubTrack').addEventListener('change', () => { subSel = Number($('vpSubTrack').value); rebuildTrack(); });
    $('vpSubLoad').addEventListener('click', loadSubFile);
    $('vpSubMinus').addEventListener('click', () => setDelay(subDelay - 0.5));
    $('vpSubPlus').addEventListener('click', () => setDelay(subDelay + 0.5));
    $('vpSubSize').addEventListener('input', applySubStyle);
    $('vpSubColor').addEventListener('input', applySubStyle);
    $('vpBookmark').addEventListener('click', addBookmark);
    $('vpClear').addEventListener('click', () => { list = []; idx = -1; stop(); renderList(); renderBookmarks(); });
    $('vpSavePl').addEventListener('click', savePlaylist);
    $('vpImportM3u').addEventListener('click', importM3u);
    $('vpPlLoad').addEventListener('click', () => { const l = get(K.playlists, {})[$('vpPlSelect').value]; if (l) { list = []; idx = -1; addPaths(l, true); } });
    $('vpPlDelete').addEventListener('click', () => { const all = get(K.playlists, {}); delete all[$('vpPlSelect').value]; put(K.playlists, all); fillPlaylists(); });
    $('vpRecent').addEventListener('change', () => { const p = $('vpRecent').value; if (p) addPaths([p], true); $('vpRecent').value = ''; });

    video.addEventListener('loadedmetadata', () => {
      ab = { stage: 'off', a: 0, b: 0 };
      const it = current(); if (!it) return;
      const pos = get(K.resume, {})[it];
      if (pos > 0 && pos / 1000 < video.duration - 10) { video.currentTime = pos / 1000; say(fmt(t('vp.resumed'), { time: VP.clock(pos) })); }
    });
    video.addEventListener('error', () => say(t('vp.cantPlay')));
    video.addEventListener('ended', onEnded);
    video.addEventListener('timeupdate', () => { if (ab.stage === 'loop' && video.currentTime >= ab.b) video.currentTime = ab.a; });
    $('vpStopAfter').addEventListener('change', () => { stopAfter = $('vpStopAfter').checked; });
    $('vpFramePrev').addEventListener('click', () => stepFrame(-1));
    $('vpFrameNext').addEventListener('click', () => stepFrame(1));
    $('vpAB').addEventListener('click', toggleAB);
    $('vpSnap').addEventListener('click', snapshot);
    $('vpInfo').addEventListener('click', fileInfo);
    const picIn = () => { pic.brightness = Number($('vpBright').value); pic.contrast = Number($('vpContrast').value); pic.saturation = Number($('vpSat').value); applyPicture(); };
    for (const id of ['vpBright', 'vpContrast', 'vpSat']) $(id).addEventListener('input', picIn);
    $('vpRot').addEventListener('click', () => { pic.rotate = (pic.rotate + 90) % 360; applyPicture(); });
    $('vpFlipH').addEventListener('click', () => { pic.flipH = !pic.flipH; applyPicture(); });
    $('vpFlipV').addEventListener('click', () => { pic.flipV = !pic.flipV; applyPicture(); });
    $('vpPicReset').addEventListener('click', () => { pic = { brightness: 100, contrast: 100, saturation: 100, rotate: 0, flipH: false, flipV: false }; $('vpBright').value = $('vpContrast').value = $('vpSat').value = '100'; applyPicture(); });
    $('vpRepeat').value = get('waveframe.video.repeat', 'off'); $('vpRepeat').addEventListener('change', () => put('waveframe.video.repeat', $('vpRepeat').value));
    aria(); document.addEventListener('waveframe:language-changed', aria);
    video.addEventListener('pause', saveResume);
    video.addEventListener('play', () => window.dispatchEvent(new CustomEvent('waveframe:video-playing')));
    saveTimer = setInterval(() => { if (!video.paused) saveResume(); }, 5000);
    window.addEventListener('beforeunload', saveResume);
    window.addEventListener('waveframe:storage-changed', () => { fillPlaylists(); fillRecent(); renderBookmarks(); const s = get(K.subs, {}); if (s.fontSize) $('vpSubSize').value = String(s.fontSize); if (s.color) $('vpSubColor').value = s.color; applySubStyle(); });
    document.addEventListener('waveframe:language-changed', () => { fillSubSelect(); fillPlaylists(); fillRecent(); });

    const frame = $('vpFrame');
    frame.addEventListener('dragover', (e) => { e.preventDefault(); frame.classList.add('drag'); });
    frame.addEventListener('dragleave', () => frame.classList.remove('drag'));
    frame.addEventListener('drop', (e) => {
      e.preventDefault(); frame.classList.remove('drag');
      const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
      const sub = paths.find((p) => /\.(srt|vtt|ass|ssa)$/i.test(p));
      const media = paths.filter((p) => !/\.(srt|vtt|ass|ssa)$/i.test(p));
      if (media.length) addPaths(media, true);
      else if (sub && current()) say(t('vp.dropSubUseButton'));
    });
    document.addEventListener('keydown', (e) => {
      if (!$('tab-video').classList.contains('active') || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key; let used = true;
      if (k === ' ') { if (video.paused) video.play(); else video.pause(); }
      else if (k === 'ArrowRight') video.currentTime += e.shiftKey ? 30 : 5;
      else if (k === 'ArrowLeft') video.currentTime -= e.shiftKey ? 30 : 5;
      else if (k === 'ArrowUp') video.volume = Math.min(1, video.volume + 0.05);
      else if (k === 'ArrowDown') video.volume = Math.max(0, video.volume - 0.05);
      else if (k === 'm' || k === 'M') video.muted = !video.muted;
      else if (k === 'f' || k === 'F') $('vpFull').click();
      else if (k === 'n' || k === 'N') next(1);
      else if (k === 'p' || k === 'P') next(-1);
      else if (k === 'b' || k === 'B') addBookmark();
      else if (k === '.') stepFrame(1);
      else if (k === ',') stepFrame(-1);
      else if (k === 'l' || k === 'L') toggleAB();
      else if (k === 's' || k === 'S') snapshot();
      else used = false;
      if (used) e.preventDefault();
    });
  }

  window.WaveframeVideoPlayer = {
    show() { build(); },
    open(p) { build(); addPaths([p], true); },
    pause() { if (built && video && !video.paused) video.pause(); },
    get playing() { return built && video && !video.paused; },
  };
  build();
})();

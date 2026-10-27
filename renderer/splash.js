'use strict';
// Welcome guide + "Opsis family" window. Runs in its own renderer process, laid over the main window; it only talks to the
// main process through window.splashApi (see splash-preload.js). All catalogue text is inserted with textContent.

(async function () {
  const api = window.splashApi;
  const $ = (id) => document.getElementById(id);
  const PAGES = 6;
  const init = await api.init();
  if (!init) return;

  const lang = I18N[init.lang] ? init.lang : 'en';
  // New splash strings exist in Greek and English; other languages fall back to English (not Greek) here.
  const tr = (k, vars) => {
    let s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || I18N.el[k] || k;
    if (vars) for (const [n, v] of Object.entries(vars)) s = s.split(`{${n}}`).join(String(v));
    return s;
  };
  document.documentElement.lang = lang;
  const reduced = init.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) document.body.classList.add('reduced');
  const slow = init.slow > 0 && init.slow <= 20 ? init.slow : 1;
  const dur = (ms) => (reduced ? 140 : ms) * slow;
  const isFamily = init.kind === 'family';
  document.body.classList.add(isFamily ? 'family' : 'welcome');

  const card = $('card');
  let closing = false;

  /* ---------- animation helpers ---------- */
  function transformToTarget(target) {
    const r = card.getBoundingClientRect();
    if (!target || reduced) return 'scale(0.94)';
    const s = Math.max(0.02, target.w / r.width);
    const dx = target.x + target.w / 2 - (r.left + r.width / 2);
    const dy = target.y + target.h / 2 - (r.top + r.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${s})`;
  }
  function enter() {
    document.body.classList.add('ready');
    const hidden = transformToTarget(init.target);
    const ms = dur(480);
    card.animate([{ transform: hidden, opacity: reduced ? 0 : 0.15 }, { transform: 'none', opacity: 1 }], { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)' });
    $('backdrop').animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms });
  }
  async function collapse(dontShow) {
    if (closing) return;
    closing = true;
    document.body.classList.add('closing');
    let target = init.target;
    try { const res = await api.requestClose(dontShow); if (res && res.target) target = res.target; } catch (_) { /* animate anyway */ }
    const ms = dur(420);
    const to = transformToTarget(target);
    const a = card.animate([{ transform: 'none', opacity: 1 }, { transform: to, opacity: reduced ? 0 : 0.1 }], { duration: ms, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
    $('backdrop').animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' });
    a.finished.then(() => api.done(), () => api.done());
  }

  /* ---------- welcome guide ---------- */
  let page = 0;
  function buildWelcome() {
    $('heroSub').textContent = `v${init.version}`;
    $('cardTitle').textContent = 'Waveframe';
    card.setAttribute('aria-label', tr('splash.guideLabel'));
    const pages = $('pages'), dots = $('dots');
    for (let i = 1; i <= PAGES; i++) {
      const el = document.createElement('div');
      el.className = 'page';
      el.setAttribute('role', 'group');
      const h = document.createElement('h2'); h.textContent = tr(`splash.p${i}.title`);
      const p = document.createElement('p'); p.className = 'intro'; p.textContent = tr(`splash.p${i}.intro`);
      const ul = document.createElement('ul');
      for (const line of tr(`splash.p${i}.l`).split('\n')) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
      el.append(h, p, ul);
      pages.appendChild(el);
      const d = document.createElement('div'); d.className = 'dot'; dots.appendChild(d);
    }
    $('dontShow').checked = !!init.dontShow;
    $('dontShowLabel').textContent = tr('splash.dontShow');
    $('btnSkip').textContent = tr('splash.skip');
    $('btnBack').textContent = tr('splash.back');
    showPage(0);
  }
  function showPage(i) {
    page = Math.max(0, Math.min(PAGES - 1, i));
    [...$('pages').children].forEach((el, n) => { el.classList.toggle('active', n === page); el.setAttribute('aria-hidden', n === page ? 'false' : 'true'); });
    [...$('dots').children].forEach((el, n) => el.classList.toggle('active', n === page));
    $('dots').setAttribute('aria-label', tr('splash.page', { n: page + 1, total: PAGES }));
    $('btnBack').style.visibility = page === 0 ? 'hidden' : 'visible';
    $('btnNext').textContent = page === PAGES - 1 ? tr('splash.finish') : tr('splash.next');
  }

  /* ---------- family showcase ---------- */
  const svgNs = 'http://www.w3.org/2000/svg';
  function barsIcon() {
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', '#fff');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
    ['M2 10v3', 'M6 6v11', 'M10 3v18', 'M14 8v7', 'M18 5v13', 'M22 10v3'].forEach((d, i) => {
      const p = document.createElementNS(svgNs, 'path'); p.setAttribute('d', d); p.setAttribute('class', 'bar'); p.style.animationDelay = `${i * 0.08}s`; svg.appendChild(p);
    });
    return svg;
  }
  function hueOf(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  const cards = new Map();

  function mkBtn(label, cls, onClick) {
    const b = document.createElement('button'); b.className = `btn small ${cls || ''}`; b.textContent = label; b.addEventListener('click', onClick); return b;
  }
  function renderCard(a, rel) {
    const c = cards.get(a.id);
    const el = c.el;
    el.querySelector('.state').className = 'state';
    const st = el.querySelector('.state');
    const actions = el.querySelector('.app-actions');
    actions.textContent = '';
    if (a.installed) {
      const upd = rel && rel.update;
      st.classList.add(upd ? 'upd' : 'ok');
      st.textContent = upd ? tr('splash.updateAvail', { v: rel.version }) : (a.version ? tr('splash.installedV', { v: a.version }) : tr('splash.installed'));
      if (a.canOpen) actions.appendChild(mkBtn(tr('splash.open'), 'primary', () => run(a, 'open')));
      if (upd) actions.appendChild(mkBtn(tr('splash.update'), a.canOpen ? '' : 'primary', () => run(a, 'install')));
    } else {
      st.classList.add('no');
      st.textContent = tr('splash.notInstalled') + (rel ? ` · ${tr('splash.latest', { v: rel.version })}` : '');
      actions.appendChild(mkBtn(tr('splash.install'), 'primary', () => run(a, 'install')));
    }
    actions.appendChild(mkBtn(tr('splash.details'), 'ghost', () => run(a, 'details')));
  }
  async function run(a, action) {
    const msg = cards.get(a.id).el.querySelector('.app-msg');
    msg.textContent = action === 'install' ? tr('splash.checking') : '';
    let res;
    try { res = await api.action(a.id, action); } catch (_) { res = { status: 'error' }; }
    if (res.status === 'downloaded') msg.textContent = tr('splash.downloaded');
    else if (res.status === 'page' && action === 'install') msg.textContent = tr('splash.openedPage');
    else if (res.status === 'failed' || res.status === 'error') msg.textContent = tr('splash.failed');
    else msg.textContent = '';
  }
  async function buildFamily() {
    $('cardTitle').textContent = tr('splash.familyTitle');
    $('heroSub').textContent = tr('splash.familySub');
    card.setAttribute('aria-label', tr('splash.familyTitle'));
    $('welcomeBody').classList.add('dep-hidden');
    $('familyBody').classList.remove('dep-hidden');
    for (const id of ['dontShowWrap', 'btnSkip', 'btnBack']) $(id).classList.add('dep-hidden');
    $('btnNext').textContent = tr('splash.close');
    const data = await api.catalogue();
    if (!data) return;
    if (data.source === 'embedded') $('familyNote').textContent = '';
    for (const a of data.apps) {
      const el = document.createElement('article'); el.className = 'app-card' + (a.self ? ' self' : '');
      const top = document.createElement('div'); top.className = 'app-top';
      const icon = document.createElement('div'); icon.className = 'app-icon';
      if (a.self) { icon.style.background = 'linear-gradient(135deg, var(--accent-2), var(--accent-3))'; icon.appendChild(barsIcon()); }
      else if (a.hasIcon) { icon.classList.add('has-img'); const im = document.createElement('img'); im.alt = ''; im.src = `appicons/${a.id}.png`; icon.appendChild(im); }
      else { const h = hueOf(a.name); icon.style.background = `linear-gradient(135deg, hsl(${h} 70% 52%), hsl(${(h + 40) % 360} 70% 40%))`; icon.textContent = a.name.replace(/^Opsis\s+/, '').charAt(0).toUpperCase(); }
      const names = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'app-name'; nm.textContent = a.name;
      const tg = document.createElement('div'); tg.className = 'app-tag'; tg.textContent = a.tagline;
      names.append(nm, tg);
      top.append(icon, names);
      if (a.self) { const b = document.createElement('span'); b.className = 'badge-here'; b.textContent = tr('splash.here'); top.appendChild(b); }
      const ul = document.createElement('ul');
      for (const line of a.bullets) { const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); }
      const st = document.createElement('div'); st.className = 'state';
      const actions = document.createElement('div'); actions.className = 'app-actions';
      const msg = document.createElement('div'); msg.className = 'app-msg'; msg.setAttribute('role', 'status');
      el.append(top, ul, st, actions, msg);
      $('grid').appendChild(el);
      cards.set(a.id, { el, a });
      renderCard(a, null);
    }
    api.onProgress((p) => { const c = cards.get(p.id); if (c) c.el.querySelector('.app-msg').textContent = tr('splash.downloading', { n: p.pct }); });
    api.releases().then((rels) => { if (rels) for (const [id, rel] of Object.entries(rels)) { const c = cards.get(id); if (c) renderCard(c.a, rel); } }).catch(() => {});
  }

  /* ---------- wiring ---------- */
  const closeNow = () => collapse(isFamily ? false : $('dontShow').checked);
  $('btnX').addEventListener('click', closeNow);
  $('btnSkip').addEventListener('click', closeNow);
  $('btnNext').addEventListener('click', () => { if (isFamily || page === PAGES - 1) closeNow(); else showPage(page + 1); });
  $('btnBack').addEventListener('click', () => showPage(page - 1));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeNow(); }
    else if (!isFamily && e.key === 'ArrowRight') { e.preventDefault(); if (page < PAGES - 1) showPage(page + 1); }
    else if (!isFamily && e.key === 'ArrowLeft') { e.preventDefault(); showPage(page - 1); }
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...card.querySelectorAll('button, input')].filter((x) => x.offsetParent !== null && !x.disabled && x.style.visibility !== 'hidden');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $('btnX').setAttribute('aria-label', tr('splash.close'));

  if (isFamily) await buildFamily(); else buildWelcome();
  requestAnimationFrame(() => { enter(); $('btnNext').focus(); });
})();

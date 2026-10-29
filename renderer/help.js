'use strict';

document.getElementById('helpVersion').textContent = `v${window.waveframe?.version || '2.0.0'}`;
document.getElementById('licenseYear').textContent = String(new Date().getFullYear());

window.waveframe?.onThemeSync?.((theme) => {
  document.documentElement.dataset.theme = theme;
});

document.querySelectorAll('.help-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.help-tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.help-pane').forEach((p) => {
      p.classList.toggle('active', p.id === `help-${btn.dataset.tab}`);
    });
  });
});

document.getElementById('helpWelcome').addEventListener('click', () => window.waveframe?.openWelcome?.());
document.getElementById('helpFamily').addEventListener('click', () => window.waveframe?.openFamily?.());

// full license texts (renderer/licenses.js)
for (const [k, v] of Object.entries(window.WAVEFRAME_LICENSES || {})) { const el = document.getElementById(`lic-${k}`); if (el) el.textContent = v; }

// The newest changelog entry is shown in the app's language (all 20); older entries stay in the static (Greek) text.
{
  const lang = new URLSearchParams(location.search).get('lang') || 'el';
  const ul = document.getElementById('changelogV200');
  if (ul && typeof I18N !== 'undefined') {
    const pick = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || I18N.el[k];
    for (let i = 1; i <= 4; i++) { const li = document.createElement('li'); li.textContent = pick(`help.v200.${i}`); ul.appendChild(li); }
  }
}

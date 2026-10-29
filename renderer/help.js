'use strict';

document.getElementById('helpVersion').textContent = `v${window.waveframe?.version || '1.10.0'}`;
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

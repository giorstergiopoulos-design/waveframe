'use strict';

document.getElementById('helpVersion').textContent = `v${window.waveframe?.version || '1.7.0'}`;
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

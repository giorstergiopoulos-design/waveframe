'use strict';
// Localisation coverage: every language has exactly the same keys and placeholders as the Greek reference,
// nothing is left in English in the non-English languages, and every key used by the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'renderer');
const I18N = new Function('localStorage', 'document', fs.readFileSync(path.join(root, 'i18n.js'), 'utf8') + ';return I18N;')({ getItem: () => null, setItem() {} }, {});
const LANGS = Object.keys(I18N);
const ph = (s) => (String(s).match(/\{[a-z]+\}/gi) || []).sort().join(',');

test('there are 20 languages', () => assert.equal(LANGS.length, 20));

test('every language has exactly the keys of the Greek reference (no missing, no extra, no empty)', () => {
  const ref = Object.keys(I18N.el);
  for (const l of LANGS) {
    const keys = Object.keys(I18N[l]);
    assert.deepEqual(ref.filter((k) => !(k in I18N[l])), [], `${l}: missing keys`);
    assert.deepEqual(keys.filter((k) => !(k in I18N.el)), [], `${l}: extra keys`);
    assert.deepEqual(keys.filter((k) => !String(I18N[l][k]).trim()), [], `${l}: empty values`);
  }
});

test('placeholders ({n}, {v}, {why} ...) are identical in every language', () => {
  for (const l of LANGS) for (const k of Object.keys(I18N.el)) assert.equal(ph(I18N[l][k]), ph(I18N.el[k]), `${l}:${k}`);
});

test('new 1.7-1.9 texts are really translated: no language except English repeats the English long text', () => {
  const newKeys = Object.keys(I18N.en).filter((k) => /^(splash|conv|upd|dl|ff)\./.test(k) && I18N.en[k].length >= 30);
  for (const l of LANGS.filter((x) => x !== 'en')) {
    const same = newKeys.filter((k) => I18N[l][k] === I18N.en[k]);
    assert.deepEqual(same, [], `${l}: English leftovers`);
  }
});

test('no raw keys or stray Greek in the Latin/Cyrillic languages for the new texts', () => {
  const greek = /[Ͱ-Ͽ]/;
  for (const l of LANGS.filter((x) => x !== 'el')) {
    for (const k of Object.keys(I18N.en).filter((x) => /^(splash|conv|upd|dl|ff|settings\.(suite|notify|openFamily|openWelcome)|tab\.converter)/.test(x))) {
      assert.ok(!greek.test(I18N[l][k]), `${l}:${k} contains Greek`);
      assert.ok(I18N[l][k] !== k && !/^(splash|conv|settings|tab)\.[\w.]+$/.test(I18N[l][k]), `${l}:${k} looks like a raw key`);
    }
  }
});

test('every key referenced by the code exists in the Greek reference', () => {
  const used = new Set();
  for (const f of ['app.js', 'converter.js', 'splash.js', 'index.html']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of s.matchAll(/data-i18n(?:-title)?="([\w.]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) used.add(m[1]);
    for (const m of s.matchAll(/\btr\(\s*['"]([\w.]+)['"]/g)) used.add(m[1]);
  }
  // keys built from a pattern in splash.js (splash.p1..p6.*) and converter.js (conv.st.*, conv.preset.*)
  for (let i = 1; i <= 6; i++) for (const s of ['title', 'intro', 'l']) used.add(`splash.p${i}.${s}`);
  for (const s of ['wait', 'work', 'done', 'cancelled']) used.add(`conv.st.${s}`);
  for (const s of ['low', 'medium', 'high', 'lossless']) used.add(`conv.preset.${s}`);
  const missing = [...used].filter((k) => !(k in I18N.el) && !k.includes('$'));
  assert.deepEqual(missing, []);
});

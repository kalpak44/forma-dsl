import { test } from 'node:test';
import assert from 'node:assert/strict';

import pkg from 'forma-dsl/package.json' with { type: 'json' };

import { createPage } from './dom.js';
import { currentTheme, initTheme, initReveals, initFacts, initCopy, initSite, THEME_EVENT } from '../src/site.js';

/** The two queries the page asks about, spelled exactly as the modules ask them. */
const MOTION = '(prefers-reduced-motion: reduce)';
const LIGHT = '(prefers-color-scheme: light)';

/**
 * @param {string} body The body markup.
 * @returns {ReturnType<typeof createPage>} A page with the queries answered `false`.
 */
function page(body) {
  const p = createPage(`<!doctype html><html><body>${body}</body></html>`);
  p.media(MOTION, false);
  p.media(LIGHT, false);
  return p;
}

test('the theme in force is the one on the document, defaulting to dark', () => {
  const p = page('');
  assert.equal(currentTheme(), 'dark');

  p.document.documentElement.dataset.theme = 'light';
  assert.equal(currentTheme(), 'light');

  p.document.documentElement.dataset.theme = 'sepia';
  assert.equal(currentTheme(), 'dark');
});

test('the button toggles the theme, remembers it, and announces it', () => {
  const p = page('<button id="theme"></button>');
  /** @type {string[]} */
  const announced = [];
  addEventListener(THEME_EVENT, (event) => announced.push(/** @type {CustomEvent} */ (event).detail));

  initTheme();
  const button = /** @type {HTMLElement} */ (p.document.getElementById('theme'));

  button.click();
  assert.equal(currentTheme(), 'light');
  assert.equal(localStorage.getItem('forma:theme'), 'light');

  button.click();
  assert.equal(currentTheme(), 'dark');
  assert.deepEqual(announced, ['light', 'dark']);
});

test('a page with no theme button wires nothing', () => {
  page('');
  initTheme();
  // Nothing to assert beyond it not throwing: the guard is the behaviour.
  assert.equal(currentTheme(), 'dark');
});

test('the OS is followed until the button is pressed, and not after', () => {
  const p = page('<button id="theme"></button>');
  initTheme();

  p.media(LIGHT, true);
  assert.equal(currentTheme(), 'light');
  p.media(LIGHT, false);
  assert.equal(currentTheme(), 'dark');

  /** @type {HTMLElement} */ (p.document.getElementById('theme')).click();
  assert.equal(currentTheme(), 'light');

  // An explicit choice is remembered, so the OS changing no longer moves the page.
  p.media(LIGHT, false);
  assert.equal(currentTheme(), 'light');
});

test('a browser that refuses storage still themes and still toggles', () => {
  const p = page('<button id="theme"></button>');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    },
  });

  initTheme();
  /** @type {HTMLElement} */ (p.document.getElementById('theme')).click();
  assert.equal(currentTheme(), 'light');

  // Nothing was remembered, so the OS is still being followed.
  p.media(LIGHT, false);
  assert.equal(currentTheme(), 'dark');
});

test('reveals arrive as they scroll in, once each', () => {
  const p = page('<p class="reveal" id="a"></p><p class="reveal" id="b"></p>');
  initReveals();
  const a = /** @type {HTMLElement} */ (p.document.getElementById('a'));
  const b = /** @type {HTMLElement} */ (p.document.getElementById('b'));

  p.intersect(a, false);
  assert.equal(a.classList.contains('in'), false);

  p.intersect(a, true);
  assert.equal(a.classList.contains('in'), true);
  assert.equal(b.classList.contains('in'), false);

  // Shown once and then let go: re-reporting it must not be able to hide it again.
  a.classList.remove('in');
  p.intersect(a, true);
  assert.equal(a.classList.contains('in'), false);
});

test('a reader who asked for no motion gets everything at once', () => {
  const p = page('<p class="reveal" id="a"></p>');
  p.media(MOTION, true);
  initReveals();
  assert.equal(/** @type {HTMLElement} */ (p.document.getElementById('a')).classList.contains('in'), true);
});

test('a page with nothing to reveal observes nothing', () => {
  const p = page('<p id="a"></p>');
  initReveals();
  p.intersect(/** @type {HTMLElement} */ (p.document.getElementById('a')), true);
  assert.equal(p.document.querySelectorAll('.in').length, 0);
});

test('the facts come from the published package', () => {
  const p = page('<b data-fill="version"></b><b data-fill="deps"></b><b data-fill="year"></b><b data-fill="none"></b>');
  initFacts();

  const text = (/** @type {string} */ key) =>
    /** @type {HTMLElement} */ (p.document.querySelector(`[data-fill="${key}"]`)).textContent;

  assert.equal(text('version'), `v${pkg.version}`);
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.equal(text('deps'), `${deps.length} · ${deps.join(', ')}`);
  assert.equal(text('year'), String(new Date().getFullYear()));
  assert.equal(text('none'), '');
});

test('copy puts the block on the clipboard and says so, then goes back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = page('<pre id="snippet">npm install forma-dsl</pre><button data-copy="snippet">copy</button>');

  /** @type {string[]} */
  const written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (/** @type {string} */ text) => { written.push(text); return Promise.resolve(); } },
  });

  initCopy();
  const button = /** @type {HTMLElement} */ (p.document.querySelector('[data-copy]'));
  button.click();
  await Promise.resolve();

  assert.deepEqual(written, ['npm install forma-dsl']);
  assert.equal(button.textContent, 'copied');
  assert.equal(button.classList.contains('done'), true);

  t.mock.timers.tick(1800);
  assert.equal(button.textContent, 'copy');
  assert.equal(button.classList.contains('done'), false);
});

test('a refused clipboard tells the reader what to press instead', async () => {
  const p = page('<pre id="snippet">x</pre><button data-copy="snippet">copy</button>');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error('denied')) },
  });

  initCopy();
  /** @type {HTMLElement} */ (p.document.querySelector('[data-copy]')).click();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(/** @type {HTMLElement} */ (p.document.querySelector('[data-copy]')).textContent, 'press ⌘C');
});

test('a copy button naming a block that is not there does nothing', async () => {
  const p = page('<button data-copy="missing">copy</button>');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error('should not be called')) },
  });

  initCopy();
  /** @type {HTMLElement} */ (p.document.querySelector('[data-copy]')).click();
  await Promise.resolve();

  assert.equal(/** @type {HTMLElement} */ (p.document.querySelector('[data-copy]')).textContent, 'copy');
});

test('initSite wires every page part in one call', () => {
  const p = page(`
    <button id="theme"></button>
    <p class="reveal" id="a"></p>
    <b data-fill="version"></b>
  `);
  initSite();

  /** @type {HTMLElement} */ (p.document.getElementById('theme')).click();
  assert.equal(currentTheme(), 'light');

  p.intersect(/** @type {HTMLElement} */ (p.document.getElementById('a')), true);
  assert.equal(/** @type {HTMLElement} */ (p.document.getElementById('a')).classList.contains('in'), true);
  assert.equal(/** @type {HTMLElement} */ (p.document.querySelector('[data-fill]')).textContent, `v${pkg.version}`);
});

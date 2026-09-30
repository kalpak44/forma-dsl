import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

import { createPage } from './dom.js';
import { DEMOS } from '../src/demos.js';
import { QUICKSTART } from '../src/quickstart.js';
import { MCP_SETUP } from '../src/mcp.js';

// The entries import a stylesheet, which only a bundler resolves.
register('./vite-imports.js', import.meta.url);

/**
 * @param {string} name A page in this app.
 * @returns {string} Its markup, as the browser is served it.
 */
const markup = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

// What these assert is the seam between the markup and the code: every id and hook the
// entry looks up is one a rename in the HTML can quietly take away, leaving a page that
// loads, reports nothing, and does none of what it is there to do.
test('the legal sheets get the shell, and nothing that needs a GPU', async () => {
  const page = createPage(markup('privacy.html'));
  page.media('(prefers-reduced-motion: reduce)', false);
  page.media('(prefers-color-scheme: light)', false);

  await import('../src/legal.js');

  /** @type {HTMLElement} */ (page.document.getElementById('theme')).click();
  assert.equal(page.document.documentElement.dataset.theme, 'light');
  assert.notEqual(page.document.querySelector('[data-fill="year"]')?.textContent, '');
  assert.equal(page.document.querySelector('canvas'), null);
});

test('the landing page wires the quickstart, the hero and the demo to its own markup', async () => {
  const page = createPage(markup('index.html'));
  page.media('(prefers-reduced-motion: reduce)', false);
  page.media('(prefers-color-scheme: light)', false);
  const hero = /** @type {HTMLCanvasElement} */ (page.document.getElementById('hero-canvas'));

  // three reports the missing context itself, on the path this test exists to take.
  const complained = console.error;
  console.error = () => {};
  try {
    await import('../src/main.js');
  } finally {
    console.error = complained;
  }

  for (const [id, snippet] of [['quickstart', QUICKSTART], ['mcp-setup', MCP_SETUP]]) {
    const block = /** @type {HTMLElement} */ (page.document.querySelector(`#${id} code`));
    assert.equal(block.textContent, snippet, `${id} carries exactly what its module holds`);
    assert.ok(block.querySelectorAll('span').length > 0, 'highlighted by the demo\'s own classifier');
  }

  // No WebGL here, which is the path a browser without it takes: the scene is dropped and
  // the demo keeps going without a viewport.
  assert.equal(hero.isConnected, false);
  assert.equal(/** @type {HTMLCanvasElement} */ (page.document.getElementById('stage')).hidden, true);

  const tabs = [...page.document.querySelectorAll('#tabs .tab')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), DEMOS.map((demo) => demo.name));
});

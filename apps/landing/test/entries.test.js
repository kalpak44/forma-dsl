import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

import { createPage } from './dom.js';
import { DEMOS } from '../src/demos.js';
import { QUICKSTART_CODE, QUICKSTART_INSTALL } from '../src/quickstart.js';
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

  const painted = (id) => /** @type {HTMLElement} */ (page.document.querySelector(`#${id} code`));

  for (const [id, snippet] of [
    ['quickstart-install', QUICKSTART_INSTALL],
    ['quickstart', QUICKSTART_CODE],
    ['mcp-setup', MCP_SETUP],
  ]) {
    assert.equal(painted(id).textContent, snippet, `${id} carries exactly what its module holds`);
  }

  // The two blocks that are code have to come out coloured. The install line is one bare
  // command with no comment, string or number in it, so there is nothing to colour and a
  // span count of zero is the right answer rather than a missing classifier.
  for (const id of ['quickstart', 'mcp-setup']) {
    assert.ok(painted(id).querySelectorAll('span').length > 0, `${id} is highlighted`);
  }
  assert.equal(painted('quickstart-install').querySelectorAll('span').length, 0);

  // No WebGL here, which is the path a browser without it takes: the scene is dropped and
  // the demo keeps going without a viewport.
  assert.equal(hero.isConnected, false);
  assert.equal(/** @type {HTMLCanvasElement} */ (page.document.getElementById('stage')).hidden, true);

  const tabs = [...page.document.querySelectorAll('#tabs .tab')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), DEMOS.map((demo) => demo.name));

  // The terminal waits to be scrolled to, so it is empty here. What this catches is the
  // seam: the id main.js looks up has to be the one the markup carries, or the section
  // loads and stays blank forever. What it then writes is console.test.js's business.
  for (const id of ['tty', 'tty-mcp']) {
    const tty = /** @type {HTMLElement} */ (page.document.getElementById(id));
    assert.ok(tty, `the markup carries #${id}, which main.js wires a terminal to`);
    assert.equal(tty.querySelectorAll('.tty-line').length, 0, 'and nothing runs before it is seen');
  }
});

/**
 * The landing page's entry point: the shell, the scene behind the headline, and the demo.
 *
 * Each of the three is independent. A browser that cannot give us WebGL still gets a page
 * that reads, and a demo that fails to load a kernel still leaves the source on screen.
 */

import './styles.css';

import { initSite } from './site.js';
import { Hero } from './hero.js';
import { Demo } from './demo.js';
import { QUICKSTART } from './quickstart.js';
import { MCP_SETUP } from './mcp.js';
import { segments, paint } from './highlight.js';

initSite();

/**
 * @param {string} id An element id.
 * @returns {HTMLElement | null} The element, if the page has one.
 */
const $ = (id) => document.getElementById(id);

// Both static snippets are highlighted with the same classifier the demo types through, so
// no code block on the page can drift apart from the others in colour.
for (const [id, snippet] of [['quickstart', QUICKSTART], ['mcp-setup', MCP_SETUP]]) {
  const block = $(id)?.querySelector('code');
  if (block) paint(block, segments(snippet), snippet.length);
}

const heroCanvas = /** @type {HTMLCanvasElement | null} */ ($('hero-canvas'));
if (heroCanvas) {
  try {
    // Constructing it starts the loop, and it keeps itself alive through the listeners and
    // the frame callback it registers, so nothing here needs to hold the instance.
    new Hero(heroCanvas);
  } catch {
    // No WebGL. The wash over the canvas is a background in its own right.
    heroCanvas.remove();
  }
}

const root = $('demo');
const code = $('source')?.querySelector('code');
const stage = /** @type {HTMLCanvasElement | null} */ ($('stage'));
const tabs = $('tabs');
const status = $('status');
const params = $('params');
const tris = $('tris');
const ms = $('ms');
const replay = $('replay');

if (root && code && stage && tabs && status && params && tris && ms && replay) {
  new Demo({ root, tabs, code, canvas: stage, status, params, tris, ms, replay }).start();
}

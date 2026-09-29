import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { EvaluationContext, describeParameters } from 'forma-dsl';

import { createPage } from './dom.js';
import { DEMOS } from '../src/demos.js';

// The demo imports the kernel's wasm through Vite, so the module cannot be loaded at all
// until Node is taught that specifier — which is why it is imported after the hooks.
register('./vite-imports.js', import.meta.url);
const { Demo } = await import('../src/demo.js');

/** The query the demo asks about, spelled exactly as it asks it. */
const MOTION = '(prefers-reduced-motion: reduce)';

/** The markup the demo drives. */
const PANEL = `<!doctype html><html><body>
  <section id="demo">
    <div id="tabs"></div>
    <pre id="source"><code></code></pre>
    <canvas id="stage"></canvas>
    <div id="status"></div>
    <div id="params"></div>
    <b id="tris"></b><b id="ms"></b>
    <button id="replay"></button>
  </section>
</body></html>`;

/**
 * A viewport that records instead of drawing.
 *
 * @param {object} [behaviour] What it should do when asked to show something.
 * @param {Error} [behaviour.throwOnShow] An error to raise instead of showing.
 * @returns {object} The stand-in.
 */
function fakeStage({ throwOnShow } = {}) {
  return {
    shown: [],
    frames: 0,
    resumed: 0,
    show(parts) {
      if (throwOnShow) throw throwOnShow;
      this.shown.push(parts);
    },
    frame() { this.frames += 1; },
    resumeRotation() { this.resumed += 1; },
  };
}

/**
 * @param {object} [options] Overrides.
 * @param {boolean} [options.reduced] Whether the reader asked for no motion.
 * @param {object} [options.stage] The viewport to hand the demo.
 * @param {boolean} [options.noWebgl] Whether building the viewport should fail.
 * @returns {object} The demo, its page, and the elements worth asserting on.
 */
function mounted({ reduced = false, stage = fakeStage(), noWebgl = false } = {}) {
  const page = createPage(PANEL);
  page.media(MOTION, reduced);

  const id = (/** @type {string} */ name) => /** @type {HTMLElement} */ (page.document.getElementById(name));
  const elements = {
    root: id('demo'),
    tabs: id('tabs'),
    code: /** @type {HTMLElement} */ (id('source').querySelector('code')),
    canvas: /** @type {HTMLCanvasElement} */ (id('stage')),
    status: id('status'),
    params: id('params'),
    tris: id('tris'),
    ms: id('ms'),
    replay: id('replay'),
  };

  const create = noWebgl
    ? () => { throw new Error('no WebGL'); }
    : () => stage;

  return { page, elements, stage, demo: new Demo(elements, create) };
}

/** Lets the solves and kernel waits already in flight get as far as they can. */
const settle = async (rounds = 40) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => { setImmediate(resolve); });
};

/**
 * Runs one demo to the point where it has been typed out and solved.
 *
 * @param {object} page The page, whose clock the typing is timed off.
 * @param {object} demo The demo.
 * @param {number} index Which one to play.
 * @returns {Promise<void>} Resolves once the status line says what happened.
 */
async function playThrough(page, demo, index) {
  page.clock(0);
  void demo.play(index);
  await settle();
  page.clock(60_000);
  page.frames(2);
  await settle();
}

// One kernel for the file. The demo memoizes its own load, so this only decides whether the
// first solve waits on a WASM instantiation or on nothing at all.
before(async () => { (await EvaluationContext.create()).dispose(); });

test('the tabs name the demos, and the first is current', () => {
  const { elements, demo } = mounted();
  const tabs = [...elements.tabs.querySelectorAll('.tab')];

  assert.deepEqual(tabs.map((tab) => tab.textContent), DEMOS.map((d) => d.name));
  assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['true', ...tabs.slice(1).map(() => 'false')]);
  assert.equal(demo.stage !== null, true);
});

test('a browser with no WebGL still gets the language, typed and solved', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo } = mounted({ noWebgl: true });

  assert.equal(demo.stage, null);
  assert.equal(elements.canvas.hidden, true);

  await playThrough(page, demo, 0);
  assert.match(elements.status.textContent ?? '', /^solved/);
});

test('nothing is fetched until the panel is scrolled to', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo } = mounted({ reduced: true });

  demo.start();
  page.intersect(elements.root, false);
  await settle(2);
  assert.equal(elements.status.textContent, '');

  page.intersect(elements.root, true);
  await settle();
  assert.match(elements.status.textContent ?? '', /^solved/);
});

test('the document is typed out, a character at a time, and then solved', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo, stage } = mounted();

  page.clock(0);
  void demo.play(0);
  await settle();
  // The kernel is asked for and the typing starts in the same turn, so it is the typing
  // the reader sees while it arrives rather than a spinner.
  assert.equal(elements.status.textContent, 'typing…');

  page.clock(140);
  page.frames();
  const partial = elements.code.textContent ?? '';
  assert.ok(partial.length > 0 && partial.length < DEMOS[0].source.length);
  assert.equal(elements.code.querySelectorAll('i.caret').length, 1, 'a caret while it types');

  page.clock(60_000);
  page.frames(2);
  await settle();

  assert.equal(elements.code.textContent, DEMOS[0].source);
  assert.equal(elements.code.querySelectorAll('i.caret').length, 0, 'no caret once it stops');
  assert.match(elements.status.textContent ?? '', /^solved · \d+ parts?$/);
  assert.equal(stage.shown.length, 1);
  assert.equal(stage.frames, 1, 'a new model is framed');
  assert.ok(Number((elements.tris.textContent ?? '').replace(/\D/g, '')) > 0);
  assert.match(elements.ms.textContent ?? '', /^\d+ ms$/);
});

test('a reader who asked for no motion gets the document at once and no drag', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { elements, demo, stage } = mounted({ reduced: true });

  void demo.play(0);
  await settle();

  assert.equal(elements.code.textContent, DEMOS[0].source);
  assert.match(elements.status.textContent ?? '', /^solved/);

  // The drag would start 700 ms after the solve. Stopping short of the dwell keeps the
  // next demo out of it, so a second solve here could only be that drag.
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(stage.shown.length, 1);
});

test('the controls are the document\'s own parameters, and moving one re-solves', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo, stage } = mounted({ reduced: true });

  await playThrough(page, demo, 0);

  const numbers = describeParameters(DEMOS[0].source).filter((d) => d.type === 'number');
  const rows = [...elements.params.querySelectorAll('.param')];
  assert.equal(rows.length, numbers.length);

  const input = /** @type {HTMLInputElement} */ (elements.params.querySelector(`[data-param="${numbers[0].name}"]`));
  assert.equal(input.value, String(numbers[0].default));
  assert.equal(input.min, String(numbers[0].min));
  assert.equal(input.max, String(numbers[0].max));

  const shown = stage.shown.length;
  input.value = String(Number(numbers[0].max));
  input.dispatchEvent(new page.window.Event('input'));
  await settle();

  assert.equal(stage.shown.length, shown + 1);
  assert.equal(stage.resumed, 1, 'the turntable is handed back its own model');
  assert.equal(elements.params.querySelector('.param-value')?.textContent, String(numbers[0].max));
  assert.equal(stage.frames, 1, 'a parameter nudge does not move the camera');
});

test('a document with no numeric parameters gets no controls', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const index = DEMOS.findIndex((d) => !describeParameters(d.source).some((p) => p.type === 'number'));
  if (index === -1) return;

  const { page, elements, demo } = mounted({ reduced: true });
  await playThrough(page, demo, index);
  assert.equal(elements.params.children.length, 0);
});

test('the demo drags a parameter to the far end, and settles the camera once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo, stage } = mounted();

  await playThrough(page, demo, 0);
  const descriptor = describeParameters(DEMOS[0].source)
    .find((d) => d.type === 'number' && d.min !== undefined && d.max !== undefined);
  const input = /** @type {HTMLInputElement} */ (elements.params.querySelector(`[data-param="${descriptor.name}"]`));

  t.mock.timers.tick(700);
  await settle();
  assert.equal(input.classList.contains('auto'), true, 'the control shows it is being moved');

  for (let step = 0; step < 20; step += 1) {
    t.mock.timers.tick(200);
    await settle();
  }

  // From the default towards whichever end is further away, which here is the top.
  assert.equal(Number(input.value), Number(descriptor.max));
  assert.equal(input.classList.contains('auto'), false);
  assert.ok(stage.shown.length > 10, 're-solved as it went');
  assert.equal(stage.frames, 2, 'framed once for the model and once when the drag settles');
});

test('taking hold of the viewport stops the demo driving itself', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo, stage } = mounted();

  await playThrough(page, demo, 0);
  elements.canvas.dispatchEvent(new page.window.Event('pointerdown'));

  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(stage.shown.length, 1, 'no drag, and no move on to the next demo');
});

test('a tab supersedes whatever is running, and replay restarts it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { elements, demo, stage } = mounted({ reduced: true });

  void demo.play(0);
  const tabs = [...elements.tabs.querySelectorAll('.tab')];
  /** @type {HTMLElement} */ (tabs[1]).click();
  await settle();

  assert.equal(elements.code.textContent, DEMOS[1].source);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'true', 'false', 'false']);
  // The superseded run solved nothing: it checked its own number and stopped.
  assert.equal(stage.shown.length, 1);

  elements.replay.click();
  await settle();
  assert.equal(elements.code.textContent, DEMOS[1].source);
  assert.equal(stage.shown.length, 2);
});

test('it works through the examples on its own', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo } = mounted({ reduced: true });

  await playThrough(page, demo, DEMOS.length - 1);
  t.mock.timers.tick(3000);
  await settle();

  // Past the last one it starts again from the first rather than stopping.
  assert.equal(elements.code.textContent, DEMOS[0].source);
});

test('a solve that fails says why, on the status line', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, elements, demo } = mounted({
    reduced: true,
    stage: fakeStage({ throwOnShow: new Error('the GPU went away') }),
  });

  await playThrough(page, demo, 0);
  assert.equal(elements.status.className, 'status error');
  assert.equal(elements.status.textContent, 'the GPU went away');
});

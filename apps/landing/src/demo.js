/**
 * The demo: the editor, driving itself.
 *
 * It types a document out, solves it with the real library, and then picks up a parameter
 * and drags it — re-solving on every step, exactly as the editor does when you move a
 * slider. Nothing is pre-rendered and nothing is a video; the controls under the viewport
 * are live, and taking hold of one hands the whole thing over to the reader.
 */

/** @import { ParameterDescriptor } from 'forma-dsl' */

import { render, describeParameters, loadKernel, EvaluationContext, FormaError } from 'forma-dsl';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

import { DEMOS } from './demos.js';
import { segments, paint } from './highlight.js';
import { Stage } from './stage.js';

/** Milliseconds per character while typing, before the per-character jitter. */
const TYPE_MS = 7;

/** How long the finished model is left alone before the next demo starts. */
const DWELL_MS = 2600;

/** How long a simulated drag of a parameter takes, end to end. */
const DRAG_MS = 2100;

/** How many times the model is re-solved across that drag. */
const DRAG_STEPS = 14;

/**
 * Tells the kernel where Vite put the wasm, and starts fetching it.
 *
 * Kicked off when the demo is first scrolled to rather than on load: it is several
 * megabytes, and the hero above it has to paint immediately.
 *
 * @returns {Promise<void>} Settles once the kernel has loaded, or has failed to.
 */
function prefetchKernel() {
  return loadKernel({ locateFile: () => wasmUrl }).then(() => {}, () => {});
}

/**
 * @param {number} ms How long to wait.
 * @returns {Promise<void>} A promise that settles then.
 */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A number formatted the way the editor's readout formats it: no trailing noise, but the
 * step's precision kept when there is one.
 *
 * @param {number} value The value.
 * @returns {string} The text to show.
 */
const readable = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * The demo, for the life of the page.
 *
 * Every phase checks the run it belongs to against the current one, which is how a tab
 * press or a replay stops the sequence already in flight without leaving a half-typed
 * document behind.
 */
export class Demo {
  /** @type {number} Bumped whenever something supersedes what is running. */
  #run = 0;

  /** @type {boolean} Whether the reader has taken the controls. */
  #manual = false;

  /** @type {number} Which demo is on screen. */
  #index = 0;

  /** @type {EvaluationContext | null} One context for the life of the page, so the cache pays. */
  #context = null;

  /** @type {Record<string, number>} The parameter values the current document is solved with. */
  #params = {};

  /**
   * @param {object} elements The parts of the page the demo drives.
   * @param {HTMLElement} elements.root The demo panel, watched for the first scroll into view.
   * @param {HTMLElement} elements.tabs Where the example tabs go.
   * @param {HTMLElement} elements.code The `<code>` the source is typed into.
   * @param {HTMLCanvasElement} elements.canvas The viewport.
   * @param {HTMLElement} elements.status The status line.
   * @param {HTMLElement} elements.params Where the parameter controls go.
   * @param {HTMLElement} elements.tris The triangle-count readout.
   * @param {HTMLElement} elements.ms The solve-time readout.
   * @param {HTMLElement} elements.replay The replay button.
   * @param {(canvas: HTMLCanvasElement) => Stage} [createStage] How the viewport is built.
   *   A parameter so the sequence can be driven without a GPU; the default is the real one.
   */
  constructor(elements, createStage = (canvas) => new Stage(canvas)) {
    /** @type {typeof elements} The elements the demo writes to. */
    this.el = elements;

    /** @type {Stage | null} The viewport, or null where WebGL is unavailable. */
    this.stage = null;
    try {
      this.stage = createStage(elements.canvas);
    } catch {
      // A browser with no WebGL still gets the language, typed out and solved; it simply
      // has nowhere to draw the result.
      elements.canvas.hidden = true;
    }

    this.#buildTabs();
    elements.replay.addEventListener('click', () => this.play(this.#index));
    elements.canvas.addEventListener('pointerdown', () => { this.#manual = true; });
  }

  /**
   * Starts the sequence the first time the panel is scrolled to, and not before: the kernel
   * is a large download that a reader who never reaches this section should never pay for.
   *
   * @returns {void}
   */
  start() {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void this.play(0);
    }, { rootMargin: '0px 0px -20% 0px' });
    observer.observe(this.el.root);
  }

  /**
   * @returns {void}
   */
  #buildTabs() {
    DEMOS.forEach((demo, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.textContent = demo.name;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(index === 0));
      tab.addEventListener('click', () => { void this.play(index); });
      this.el.tabs.append(tab);
    });
  }

  /**
   * @param {number} index Which tab is current.
   * @returns {void}
   */
  #markTab(index) {
    this.el.tabs.querySelectorAll('.tab').forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
    });
  }

  /**
   * @param {string} kind Which colour to use.
   * @param {string} text What to say.
   * @returns {void}
   */
  #setStatus(kind, text) {
    this.el.status.className = `status ${kind}`;
    this.el.status.textContent = text;
  }

  /**
   * Plays one demo from the top: type it, solve it, operate it, then move on.
   *
   * @param {number} index Which demo to play.
   * @returns {Promise<void>} Resolves when the sequence ends or is superseded.
   */
  async play(index) {
    const run = ++this.#run;
    this.#index = index;
    this.#manual = false;
    this.#markTab(index);

    const demo = DEMOS[index];
    const parts = segments(demo.source);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.#setStatus('busy', 'loading kernel…');
    const ready = prefetchKernel();

    await this.#type(run, parts, demo.source.length, reduced);
    if (run !== this.#run) return;

    await ready;
    if (run !== this.#run) return;

    this.#params = defaults(describeParameters(demo.source));
    this.#buildControls(describeParameters(demo.source), demo.source);
    if (!await this.#solve(run, demo.source, true)) return;

    if (!reduced && !this.#manual) {
      await wait(700);
      if (run !== this.#run) return;
      await this.#drag(run, demo.source, describeParameters(demo.source));
    }
    if (run !== this.#run) return;

    // Left to itself the demo works through the examples the way a tutorial would. A
    // reader who touched anything keeps what they were shown instead.
    await wait(DWELL_MS);
    if (run !== this.#run || this.#manual) return;
    void this.play((index + 1) % DEMOS.length);
  }

  /**
   * Types the document out, a few characters per frame.
   *
   * Timed off the clock rather than off the frame count, so a slow frame skips ahead
   * instead of stretching the whole document out.
   *
   * @param {number} run The run this belongs to.
   * @param {ReturnType<typeof segments>} parts The highlighted document.
   * @param {number} total How many characters it has.
   * @param {boolean} reduced Whether the reader asked for no motion.
   * @returns {Promise<void>} Resolves when the last character is on screen.
   */
  async #type(run, parts, total, reduced) {
    if (reduced) {
      paint(this.el.code, parts, total, false);
      return;
    }

    this.#setStatus('busy', 'typing…');
    const started = performance.now();

    await new Promise((resolve) => {
      const frame = () => {
        if (run !== this.#run) return resolve(undefined);
        const shown = Math.min(total, Math.round((performance.now() - started) / TYPE_MS));
        paint(this.el.code, parts, shown, true);
        if (shown >= total) return resolve(undefined);
        return requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    paint(this.el.code, parts, total, false);
  }

  /**
   * Solves the document with the parameters currently set, and shows it.
   *
   * @param {number} run The run this belongs to.
   * @param {string} source The document.
   * @param {boolean} reframe Whether to move the camera, which is only right when the model
   *   is new rather than when a parameter nudged the one already on screen.
   * @returns {Promise<boolean>} Whether it succeeded and still belongs to the current run.
   */
  async #solve(run, source, reframe) {
    this.#setStatus('busy', 'solving…');
    const started = performance.now();

    try {
      this.#context ??= await EvaluationContext.create();
      const result = await render(source, { params: this.#params, context: this.#context });
      if (run !== this.#run) return false;

      const triangles = result.parts.reduce((sum, part) => sum + part.mesh.triangleCount, 0);
      this.el.tris.textContent = triangles.toLocaleString();
      this.el.ms.textContent = `${Math.round(performance.now() - started)} ms`;

      this.stage?.show(result.parts);
      if (reframe) this.stage?.frame();
      this.#setStatus('ok', `solved · ${result.parts.length} part${result.parts.length === 1 ? '' : 's'}`);

      // Everything the new tree cannot reach is freed; WASM objects are not collected for
      // us, and this page re-solves every few seconds for as long as it is open.
      this.#context.collect(result.parts.map((part) => part.node));
      return true;
    } catch (error) {
      if (run !== this.#run) return false;
      const message = error instanceof FormaError || error instanceof Error ? error.message : String(error);
      this.#setStatus('error', message);
      return false;
    }
  }

  /**
   * Builds the controls under the viewport, one per declared parameter.
   *
   * They are real inputs rather than a picture of some: moving one re-solves the document,
   * which is the whole of what the editor does.
   *
   * @param {ReadonlyArray<ParameterDescriptor>} descriptors The document's inputs.
   * @param {string} source The document, to re-solve when one moves.
   * @returns {void}
   */
  #buildControls(descriptors, source) {
    this.el.params.replaceChildren();

    for (const descriptor of descriptors) {
      if (descriptor.type !== 'number') continue;

      const row = document.createElement('label');
      row.className = 'param';

      const name = document.createElement('span');
      name.className = 'param-name';
      name.textContent = descriptor.name;

      const value = document.createElement('span');
      value.className = 'param-value';
      value.textContent = readable(Number(this.#params[descriptor.name]));

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(descriptor.min ?? 1);
      input.max = String(descriptor.max ?? 100);
      input.step = String(descriptor.step ?? 1);
      input.value = String(this.#params[descriptor.name]);
      input.dataset.param = descriptor.name;

      input.addEventListener('input', () => {
        // A drag by hand supersedes the autopilot rather than fighting it for the value.
        this.#manual = true;
        this.#run += 1;
        const run = this.#run;
        this.#params[descriptor.name] = Number(input.value);
        value.textContent = readable(Number(input.value));
        this.stage?.resumeRotation();
        void this.#solve(run, source, false);
      });

      row.append(name, value, input);
      this.el.params.append(row);
    }
  }

  /**
   * Picks up the first parameter with room to move and drags it, re-solving as it goes.
   *
   * This is the part that shows what the language is for: the document does not change, and
   * the solid does.
   *
   * @param {number} run The run this belongs to.
   * @param {string} source The document.
   * @param {ReadonlyArray<ParameterDescriptor>} descriptors The document's inputs.
   * @returns {Promise<void>} Resolves when the drag finishes or is superseded.
   */
  async #drag(run, source, descriptors) {
    const descriptor = descriptors.find((d) => d.type === 'number' && d.min !== undefined && d.max !== undefined);
    if (!descriptor) return;

    const input = /** @type {HTMLInputElement | null} */ (
      this.el.params.querySelector(`[data-param="${descriptor.name}"]`));
    const readout = input?.parentElement?.querySelector('.param-value');
    const from = Number(this.#params[descriptor.name]);
    const min = Number(descriptor.min);
    const max = Number(descriptor.max);
    // Towards whichever end is further away, so the movement is always worth watching.
    const to = (from - min) > (max - from) ? min : max;

    input?.classList.add('auto');
    for (let step = 1; step <= DRAG_STEPS; step += 1) {
      if (run !== this.#run || this.#manual) break;
      // Eased, because a linear sweep reads as a progress bar rather than as a hand.
      const t = step / DRAG_STEPS;
      const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
      const value = Math.round((from + (to - from) * eased) / Number(descriptor.step ?? 1))
        * Number(descriptor.step ?? 1);

      this.#params[descriptor.name] = value;
      if (input) input.value = String(value);
      if (readout) readout.textContent = readable(value);

      if (!await this.#solve(run, source, false)) return;
      await wait(DRAG_MS / DRAG_STEPS);
    }
    input?.classList.remove('auto');
    // A parameter can grow the model well past what was framed for its default, so the
    // camera settles once at the end — during the drag it would be chasing the solid.
    if (run === this.#run && !this.#manual) this.stage?.frame();
  }
}

/**
 * The values a document starts at: what each parameter declares, or the middle of its range
 * when it declares nothing.
 *
 * @param {ReadonlyArray<ParameterDescriptor>} descriptors The document's inputs.
 * @returns {Record<string, number>} A value per numeric parameter.
 */
function defaults(descriptors) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const descriptor of descriptors) {
    if (descriptor.type !== 'number') continue;
    const fallback = ((descriptor.min ?? 0) + (descriptor.max ?? 10)) / 2;
    out[descriptor.name] = Number(descriptor.default ?? fallback);
  }
  return out;
}

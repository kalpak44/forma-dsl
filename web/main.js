/** @import { ParameterDescriptor, ParameterValue, RenderedPart, RenderResult } from '../src/index.js' */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { linter, lintGutter } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { formaLanguage } from './language.js';
import { Viewer } from './viewer.js';
import { EXAMPLES } from './examples.js';
import { render, describeParameters, loadKernel, toBinarySTL, FormaError } from '../src/index.js';
import { EvaluationContext } from '../src/core/context.js';

/**
 * @param {string} id An element id.
 * @returns {HTMLElement} The element.
 */
const $ = (id) => document.getElementById(id);

const DEFAULT_EXAMPLE = 'Hex key holder';
const STORAGE_KEY = 'forma:source';

/** How long to wait after a keystroke before rendering. */
const TYPING_DELAY = 250;

/** The same, for a slider, which produces far more events and cheaper edits. */
const DRAG_DELAY = 60;

/** How much the model's size must change before the camera reframes. */
const REFRAME_THRESHOLD = 0.25;

// --- failure surfaces ---------------------------------------------------------------

/**
 * Reports something that makes the editor unusable at all.
 *
 * The alternative is a blank canvas beside a status line that never changes, which reads as
 * a hung app rather than an unsupported browser.
 *
 * @param {string} message What went wrong, in the reader's terms.
 * @returns {void}
 */
function fatal(message) {
  const el = $('fatal');
  el.textContent = message;
  el.hidden = false;
}

/**
 * localStorage, for browsers that have it.
 *
 * It throws outright when storage is blocked, rather than returning null, and it is read
 * during module initialisation — an unguarded access takes the whole app down.
 */
const storage = {
  /**
   * @param {string} key The key.
   * @returns {string | null} The stored value, or null if there is none or storage is blocked.
   */
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },

  /**
   * @param {string} key The key.
   * @param {string} value The value.
   * @returns {void}
   */
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* blocked or over quota; not fatal */ }
  },
};

addEventListener('unhandledrejection', (event) => {
  console.error('unhandled rejection', event.reason);
});

// Vite fingerprints the wasm, so the module cannot find it by its own relative path. The
// rejection is handled where it matters, in run(); this only keeps it from being unhandled.
loadKernel({ locateFile: () => wasmUrl }).catch(() => {});

// --- viewer ---------------------------------------------------------------------------

/** @type {Viewer | null} Null when the browser could not give us WebGL. */
let viewer = null;
try {
  viewer = new Viewer(/** @type {HTMLCanvasElement} */ ($('canvas')));
} catch (error) {
  fatal(`This browser could not start WebGL, so the 3D preview is unavailable. ${error.message}`);
}

/** Everything that outlives one render. */
const state = {
  /** @type {Record<string, ParameterValue>} Values chosen with the parameter controls. */
  params: {},
  /** @type {Array<{ from: number, to: number, severity: string, message: string }>} */
  lastDiagnostics: [],
  /** @type {number} The model's extent when the camera last framed it. */
  lastExtent: 0,
  /** @type {EvaluationContext | null} One context for the life of the page. */
  context: null,
  /** @type {RenderedPart[]} What is currently on screen, kept for STL export. */
  parts: [],
  /** @type {number} Increments per render, so a stale one can tell it has been superseded. */
  generation: 0,
};

// --- editor -----------------------------------------------------------------------

const formaLinter = linter(() => state.lastDiagnostics, { delay: 0 });

const editor = new EditorView({
  parent: $('editor'),
  state: EditorState.create({
    doc: storage.get(STORAGE_KEY) ?? EXAMPLES[DEFAULT_EXAMPLE],
    extensions: [
      basicSetup,
      oneDark,
      formaLanguage(),
      lintGutter(),
      formaLinter,
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { schedule(0); return true; } }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          storage.set(STORAGE_KEY, update.state.doc.toString());
          schedule();
        }
      }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' } }),
    ],
  }),
});

// --- diagnostics ------------------------------------------------------------------

/**
 * Maps a FormaError's line and column onto a document offset so the editor can underline it.
 *
 * @param {Error} error The failure.
 * @returns {{ from: number, to: number, severity: string, message: string }} A CodeMirror
 *   diagnostic. An error with no position is attached to the start of the document, which is
 *   at least somewhere the reader can see it.
 */
function diagnosticFor(error) {
  const doc = editor.state.doc;
  if (!(error instanceof FormaError) || !error.loc) {
    return { from: 0, to: 0, severity: 'error', message: error.message };
  }
  const line = doc.line(Math.min(Math.max(error.loc.line, 1), doc.lines));
  const from = Math.min(line.from + Math.max(error.loc.column - 1, 0), line.to);
  return { from, to: line.to, severity: 'error', message: error.message };
}

/**
 * @param {'ok' | 'busy' | 'error'} kind Which colour to use.
 * @param {string} text What to say.
 * @returns {void}
 */
function setStatus(kind, text) {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

/**
 * @param {Error} error The failure to report.
 * @returns {void}
 */
function showError(error) {
  state.lastDiagnostics = [diagnosticFor(error)];
  // An empty transaction, purely to make the linter re-read `lastDiagnostics`.
  editor.dispatch({});
  setStatus('error', error.message);
  $('problem').textContent = error.message;
  $('problem').hidden = false;
}

/** @returns {void} */
function clearError() {
  state.lastDiagnostics = [];
  editor.dispatch({});
  $('problem').hidden = true;
}

// --- parameter controls -----------------------------------------------------------

/**
 * Whether a value the user already chose still suits a param.
 *
 * A param's control follows its declared type, not the type of its default: a param with no
 * default has no type to read off, and a vector param read as a default-less string would be
 * handed to the model as text.
 *
 * @param {ParameterValue} value The held value.
 * @param {string} type The param's declared or inferred type.
 * @returns {boolean} Whether the value is still usable.
 */
function matchesType(value, type) {
  switch (type) {
    case 'number': case 'angle': return typeof value === 'number';
    case 'bool': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'vector': case 'list': return Array.isArray(value);
    default: return false;
  }
}

/**
 * @param {ParameterDescriptor} descriptor The param.
 * @returns {ParameterValue} Its default, or something usable when it has none.
 */
function initialValue(descriptor) {
  if (descriptor.default !== undefined) return descriptor.default;
  switch (descriptor.type) {
    case 'bool': return false;
    case 'string': return '';
    case 'vector': case 'list': return [0, 0, 0];
    default: return descriptor.min ?? 0;
  }
}

/**
 * Parses a vector typed into a text field.
 *
 * Accepts `[10, 20]` and `10, 20` alike — a person editing a vector should not have to
 * reproduce the brackets.
 *
 * @param {string} text What was typed.
 * @returns {number[] | null} The components, or null if it does not read as a vector.
 */
function parseVector(text) {
  const parts = text.replace(/[[\]]/g, '').split(',').map((s) => Number(s.trim()));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * Records a chosen value and asks for a re-render.
 *
 * @param {string} name The param's name.
 * @param {ParameterValue} value Its new value.
 * @param {number} delay How long to wait before rendering.
 * @returns {void}
 */
function chooseValue(name, value, delay) {
  state.params[name] = value;
  schedule(delay);
}

/**
 * A slider, with the value beside it.
 *
 * @param {ParameterDescriptor} descriptor The param.
 * @param {number} value Its current value.
 * @returns {HTMLElement[]} The controls to place in the row.
 */
function numberControl(descriptor, value) {
  const readout = document.createElement('span');
  readout.className = 'param-value';
  readout.textContent = String(value);

  // A param with no declared bounds still needs a usable track; spanning zero to twice the
  // default keeps the handle mid-track rather than pinned at one end.
  const min = descriptor.min ?? Math.min(0, value * 2);
  const max = descriptor.max ?? Math.max(value * 2, value + 10);
  const step = descriptor.step ?? (max - min > 20 ? 1 : 0.1);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    readout.textContent = input.value;
    chooseValue(descriptor.name, Number(input.value), DRAG_DELAY);
  });

  return [readout, input];
}

/**
 * @param {ParameterDescriptor} descriptor The param.
 * @param {boolean} value Its current value.
 * @returns {HTMLElement[]} The controls to place in the row.
 */
function boolControl(descriptor, value) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => chooseValue(descriptor.name, input.checked, 0));
  return [input];
}

/**
 * A text field that only commits when what was typed reads as a vector, and otherwise puts
 * back the last good value rather than sending the model something it cannot use.
 *
 * @param {ParameterDescriptor} descriptor The param.
 * @param {number[]} value Its current value.
 * @returns {HTMLElement[]} The controls to place in the row.
 */
function vectorControl(descriptor, value) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
  input.addEventListener('change', () => {
    const parsed = parseVector(input.value);
    if (!parsed) {
      const held = state.params[descriptor.name];
      input.value = Array.isArray(held) ? held.join(', ') : '';
      return;
    }
    chooseValue(descriptor.name, parsed, 0);
  });
  return [input];
}

/**
 * @param {ParameterDescriptor} descriptor The param.
 * @param {ParameterValue} value Its current value.
 * @returns {HTMLElement[]} The controls to place in the row.
 */
function textControl(descriptor, value) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = String(value ?? '');
  input.addEventListener('change', () => chooseValue(descriptor.name, input.value, 0));
  return [input];
}

/** Which control each param type gets. Anything not listed falls back to a text field. */
const CONTROLS = {
  number: numberControl,
  angle: numberControl,
  bool: boolControl,
  vector: vectorControl,
  list: vectorControl,
};

/**
 * Rebuilds the parameter panel, but only when the set of params actually changed.
 *
 * Rebuilding on every keystroke would throw away the control the user is mid-drag on.
 *
 * @param {string} source The current document.
 * @returns {void}
 */
function rebuildParameterPanel(source) {
  const panel = $('params');
  let descriptors;
  try {
    descriptors = describeParameters(source);
  } catch {
    return; // The renderer reports the real error; a half-typed document is not worth a second one.
  }

  const signature = descriptors.map((d) => `${d.name}:${d.type}:${d.min}:${d.max}:${d.step}`).join('|');
  if (signature === panel.dataset.signature) return;
  panel.dataset.signature = signature;
  panel.textContent = '';

  // Values the user has already chosen survive an edit elsewhere in the document, but only
  // where the param still exists and still has the type the value was chosen for.
  const kept = {};
  for (const d of descriptors) {
    const held = state.params[d.name];
    if (held !== undefined && matchesType(held, d.type)) kept[d.name] = held;
  }
  state.params = kept;

  for (const descriptor of descriptors) {
    const value = state.params[descriptor.name] ?? initialValue(descriptor);
    // A param with no default has no value until one is supplied, so supply it now rather
    // than letting the render fail on a document the editor is meant to be driving.
    if (descriptor.required) state.params[descriptor.name] = value;

    const row = document.createElement('label');
    row.className = 'param';

    const name = document.createElement('span');
    name.className = 'param-name';
    name.textContent = descriptor.name;
    row.append(name);

    const build = CONTROLS[descriptor.type] ?? textControl;
    row.append(...build(descriptor, value));

    if (descriptor.description) row.title = descriptor.description;
    panel.append(row);
  }
}

// --- rendering --------------------------------------------------------------------

/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

/**
 * Asks for a render, replacing any already pending.
 *
 * @param {number} [delay] How long to wait first.
 * @returns {void}
 */
function schedule(delay = TYPING_DELAY) {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(run, delay);
}

/**
 * The one context for the life of the page.
 *
 * The digest cache is the reason a re-render after an edit is cheap, and a context created
 * per render would start empty every time — the cache would only ever serve repeats within a
 * single model. Bounding what it holds is `collect`'s job, not the constructor's.
 *
 * @returns {Promise<EvaluationContext>} The context.
 * @throws {Error} If the kernel cannot be loaded. The failed context is dropped, so a later
 *   keystroke retries rather than being stuck with it.
 */
async function contextForRender() {
  if (state.context && !state.context.disposed) return state.context;
  try {
    state.context = await EvaluationContext.create();
    return state.context;
  } catch (error) {
    state.context = null;
    throw error;
  }
}

/**
 * Frames the model, but only when its size changed materially.
 *
 * Dragging a slider that thickens a wall should not fly the camera somewhere new on every
 * step.
 *
 * @param {ReadonlyArray<RenderedPart>} parts What was just rendered.
 * @returns {void}
 */
function reframeIfResized(parts) {
  const extent = parts.reduce((max, part) => {
    const box = part.concrete.boundingBox();
    return Math.max(max, ...box.max.map(Math.abs), ...box.min.map(Math.abs));
  }, 0);

  if (Math.abs(extent - state.lastExtent) / Math.max(extent, 1) > REFRAME_THRESHOLD) {
    viewer.frame();
    state.lastExtent = extent;
  }
}

/**
 * @param {RenderResult} result What was just rendered.
 * @returns {void}
 */
function reportSuccess(result) {
  const { parts, stats } = result;
  const triangles = parts.reduce((n, p) => n + p.mesh.triangleCount, 0);
  setStatus('ok', `${parts.length} part${parts.length === 1 ? '' : 's'} · ${triangles.toLocaleString()} triangles · ${stats.evaluated} evaluated, ${stats.cacheHits} cached · ${stats.milliseconds} ms`);
  $('parts').textContent = parts.map((p) => p.name).join(', ');
}

/**
 * Renders the current document into the viewer.
 *
 * @returns {Promise<void>} Resolves once the render has painted or reported.
 */
async function run() {
  if (!viewer) return;

  const source = editor.state.doc.toString();
  rebuildParameterPanel(source);

  // Every run gets a generation. A slow render whose source has already been edited must not
  // paint over the newer one, which is what makes fast typing flicker between states.
  const generation = ++state.generation;
  setStatus('busy', 'rendering…');

  let context;
  try {
    context = await contextForRender();
  } catch (error) {
    if (generation !== state.generation) return;
    setStatus('error', `could not load the geometry kernel: ${error.message}`);
    fatal('The geometry kernel (WebAssembly) failed to load. Check the network tab and reload.');
    return;
  }
  if (generation !== state.generation) return;

  try {
    const result = await render(source, { params: state.params, context });
    // A superseded render still leaves its work in the cache, which the newer one is likely
    // to want; it just must not paint, and must not collect against a stale tree.
    if (generation !== state.generation) return;

    state.parts = result.parts;
    viewer.show(result.parts);
    reframeIfResized(result.parts);
    clearError();
    reportSuccess(result);

    // Free what this tree can no longer reach. Done after the parts are handed to the viewer
    // and held in state, so nothing still points at what is about to be released.
    context.collect(result.parts.map((part) => part.node));
  } catch (error) {
    if (generation !== state.generation) return;
    showError(error);
  }
}

// --- toolbar ----------------------------------------------------------------------

const picker = /** @type {HTMLSelectElement} */ ($('example'));
for (const name of Object.keys(EXAMPLES)) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  picker.append(option);
}

picker.addEventListener('change', () => {
  if (!picker.value) return;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: EXAMPLES[picker.value] } });
  state.params = {};
  state.lastExtent = 0;
  picker.value = '';
  schedule(0);
});

/**
 * Hands the browser one STL holding every part.
 *
 * The format has no notion of separate objects, and a slicer reading a multi-solid STL
 * treats it as one mesh anyway.
 *
 * @returns {void}
 */
function exportSTL() {
  if (!state.parts.length || !state.context) return;

  const single = state.parts.length === 1;
  const merged = single
    ? state.parts[0].concrete
    : state.context.wasm.Manifold.union(state.parts.map((p) => p.concrete));

  let data;
  try {
    data = toBinarySTL(merged, 'forma-dsl');
  } finally {
    // The merged solid is ours, not the cache's, so it is ours to free — including when the
    // conversion above throws.
    if (!single) merged.delete();
  }

  const url = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'model.stl';
  link.click();
  // Revoked on the next task, not inline: the download reads the blob after the click
  // returns, and revoking first loses the file on a large model.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

$('export').addEventListener('click', exportSTL);
$('edges').addEventListener('change', (event) => {
  viewer?.setEdgesVisible(/** @type {HTMLInputElement} */ (event.target).checked);
});
$('frame').addEventListener('click', () => viewer?.frame());

schedule(0);

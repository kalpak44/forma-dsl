import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { linter, lintGutter } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { formaLanguage } from './language.js';
import { Viewer } from './viewer.js';
import { EXAMPLES } from './examples.js';
import { render, describeParameters, loadKernel, toBinarySTL, FormaError } from '../src/index.js';
import { EvaluationContext } from '../src/core/context.js';

// Vite fingerprints the wasm, so the module cannot find it by its own relative path.
loadKernel({ locateFile: () => wasmUrl });

const $ = (id) => document.getElementById(id);
const viewer = new Viewer($('canvas'));

const state = {
  params: {},
  lastDiagnostics: [],
  lastExtent: 0,
  context: null,
  parts: [],
  generation: 0,
};

// --- editor -----------------------------------------------------------------------

const formaLinter = linter(() => state.lastDiagnostics, { delay: 0 });

const editor = new EditorView({
  parent: $('editor'),
  state: EditorState.create({
    doc: localStorage.getItem('forma:source') ?? EXAMPLES['Hex key holder'],
    extensions: [
      basicSetup,
      oneDark,
      formaLanguage(),
      lintGutter(),
      formaLinter,
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { schedule(0); return true; } }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          localStorage.setItem('forma:source', update.state.doc.toString());
          schedule();
        }
      }),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' } }),
    ],
  }),
});

// --- diagnostics ------------------------------------------------------------------

/// Maps a FormaError's line/column onto a document offset so the editor can underline it.
function diagnosticFor(error) {
  const doc = editor.state.doc;
  if (!(error instanceof FormaError) || !error.loc) {
    return { from: 0, to: 0, severity: 'error', message: error.message };
  }
  const line = doc.line(Math.min(Math.max(error.loc.line, 1), doc.lines));
  const from = Math.min(line.from + Math.max(error.loc.column - 1, 0), line.to);
  return { from, to: line.to, severity: 'error', message: error.message };
}

function setStatus(kind, text) {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

function showError(error) {
  state.lastDiagnostics = [diagnosticFor(error)];
  editor.dispatch({});
  setStatus('error', error.message);
  $('problem').textContent = error.message;
  $('problem').hidden = false;
}

function clearError() {
  state.lastDiagnostics = [];
  editor.dispatch({});
  $('problem').hidden = true;
}

// --- parameter controls -----------------------------------------------------------

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

  const kept = {};
  for (const d of descriptors) {
    if (state.params[d.name] !== undefined && typeof state.params[d.name] === typeof d.default) {
      kept[d.name] = state.params[d.name];
    }
  }
  state.params = kept;

  for (const descriptor of descriptors) {
    const row = document.createElement('label');
    row.className = 'param';

    const name = document.createElement('span');
    name.className = 'param-name';
    name.textContent = descriptor.name;
    row.append(name);

    const value = state.params[descriptor.name] ?? descriptor.default;

    if (typeof descriptor.default === 'number') {
      const readout = document.createElement('span');
      readout.className = 'param-value';
      readout.textContent = String(value);

      // A param with no declared bounds still needs a usable track; spanning zero to twice
      // the default keeps the handle mid-track rather than pinned at one end.
      const min = descriptor.min ?? Math.min(0, value * 2);
      const max = descriptor.max ?? Math.max(value * 2, value + 10);
      const step = descriptor.step ?? (max - min > 20 ? 1 : 0.1);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = value;
      input.addEventListener('input', () => {
        state.params[descriptor.name] = Number(input.value);
        readout.textContent = input.value;
        schedule(60);
      });

      row.append(readout, input);
    } else if (typeof descriptor.default === 'boolean') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value;
      input.addEventListener('change', () => {
        state.params[descriptor.name] = input.checked;
        schedule(0);
      });
      row.append(input);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(value ?? '');
      input.addEventListener('change', () => {
        state.params[descriptor.name] = input.value;
        schedule(0);
      });
      row.append(input);
    }

    if (descriptor.description) row.title = descriptor.description;
    panel.append(row);
  }
}

// --- rendering --------------------------------------------------------------------

let timer = null;

function schedule(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

async function run() {
  const source = editor.state.doc.toString();
  rebuildParameterPanel(source);

  // Every run gets a generation. A slow render whose source has already been edited must
  // not paint over the newer one, which is what makes fast typing flicker between states.
  const generation = ++state.generation;
  setStatus('busy', 'rendering…');

  const context = await EvaluationContext.create();
  try {
    const result = await render(source, { params: state.params, context });
    if (generation !== state.generation) { context.dispose(); return; }

    state.context?.dispose();
    state.context = context;
    state.parts = result.parts;

    viewer.show(result.parts);

    // Reframe only when the model's size actually changed. Dragging a slider that thickens
    // a wall should not fly the camera somewhere new on every step.
    const extent = result.parts.reduce((max, part) => {
      const box = part.concrete.boundingBox();
      return Math.max(max, ...box.max.map(Math.abs), ...box.min.map(Math.abs));
    }, 0);
    if (Math.abs(extent - state.lastExtent) / Math.max(extent, 1) > 0.25) {
      viewer.frame();
      state.lastExtent = extent;
    }

    clearError();
    const triangles = result.parts.reduce((n, p) => n + p.mesh.triangleCount, 0);
    setStatus('ok', `${result.parts.length} part${result.parts.length === 1 ? '' : 's'} · ${triangles.toLocaleString()} triangles · ${result.stats.evaluated} evaluated, ${result.stats.cacheHits} cached · ${result.stats.milliseconds} ms`);
    $('parts').textContent = result.parts.map((p) => p.name).join(', ');
  } catch (error) {
    context.dispose();
    if (generation !== state.generation) return;
    showError(error);
  }
}

// --- toolbar ----------------------------------------------------------------------

const picker = $('example');
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

$('export').addEventListener('click', () => {
  if (!state.parts.length) return;
  // One STL holding every part: the format has no notion of separate objects, and a slicer
  // reading a multi-solid STL treats it as one mesh anyway.
  const merged = state.parts.length === 1
    ? state.parts[0].concrete
    : state.context.wasm.Manifold.union(state.parts.map((p) => p.concrete));
  const data = toBinarySTL(merged, 'forma-dsl');
  if (merged !== state.parts[0].concrete) merged.delete();

  const url = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'model.stl';
  link.click();
  // Revoked on the next task, not inline: the download reads the blob after the click
  // returns, and revoking first loses the file on a large model.
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

$('edges').addEventListener('change', (event) => viewer.setEdgesVisible(event.target.checked));
$('frame').addEventListener('click', () => viewer.frame());

schedule(0);

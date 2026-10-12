/**
 * What the editor offers where the cursor is.
 *
 * The real `CompletionContext` is a CodeMirror class with an editor behind it; these drive
 * the completion source through the four things it actually reads, which is enough to assert
 * on what comes back and keeps the test free of a view and a DOM.
 *
 * The point of most of these is not the list but where it comes from: nothing here asserts a
 * hard-coded vocabulary, because a list of block names in a test would be the very thing the
 * source exists to avoid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKS, FUNCTIONS, TYPE_NAMES } from 'forma-dsl';

import { completeForma } from '../src/completion.js';

/**
 * Builds the context a completion source reads, with the cursor marked by `|` in the source.
 *
 * @param {string} marked The document, with one `|` where the cursor is.
 * @param {boolean} [explicit] Whether the reader asked for completion rather than typing.
 * @returns {object} A stand-in for CodeMirror's CompletionContext.
 */
function at(marked, explicit = true) {
  const pos = marked.indexOf('|');
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);

  return {
    pos,
    explicit,
    state: {
      sliceDoc: (from, to) => doc.slice(from, to),
      doc: { toString: () => doc },
    },
    // CodeMirror anchors whatever it is handed to the cursor before matching, so the stub
    // has to as well, or `/\w*/` would match the empty string at the start of the line.
    matchBefore(re) {
      const line = doc.slice(doc.lastIndexOf('\n', pos - 1) + 1, pos);
      const found = line.match(new RegExp(`${re.source}$`));
      if (!found) return null;
      return { from: pos - found[0].length, to: pos, text: found[0] };
    },
  };
}

/** The labels of whatever came back, for an assertion that reads as a sentence. */
const labels = (result) => (result ? result.options.map((option) => option.label) : []);

test('every block the language has is offered inside a body', () => {
  const offered = labels(completeForma(at('model "m" {\n  |\n}')));

  assert.deepEqual(
    Object.keys(BLOCKS).filter((name) => !offered.includes(name)),
    [],
    'a block in the registry that completion does not offer means the two have drifted',
  );
});

test('every function and every type name is offered too', () => {
  const offered = labels(completeForma(at('model "m" {\n  box { size = |\n}')));

  assert.deepEqual(Object.keys(FUNCTIONS).filter((name) => !offered.includes(name)), []);
  assert.deepEqual(TYPE_NAMES.filter((name) => !offered.includes(name)), []);
});

test('only the four top-level blocks are offered at the top of a document', () => {
  const offered = labels(completeForma(at('|')));

  assert.deepEqual(offered.sort(), ['component', 'local', 'model', 'param']);
});

test('the top level is where the braces balance, not merely the first line', () => {
  const inside = labels(completeForma(at('model "m" {\n  |\n}')));
  const after = labels(completeForma(at('model "m" {\n  box { size = 1 }\n}\n|')));

  assert.ok(inside.includes('box'));
  assert.deepEqual(after.sort(), ['component', 'local', 'model', 'param']);
});

test('a component the document declares is offered where a block may go', () => {
  const source = 'component "plate" {\n  box { size = 1 }\n}\n\nmodel "m" {\n  |\n}';
  const plate = completeForma(at(source)).options.find((option) => option.label === 'plate');

  assert.equal(plate.detail, 'component');
});

test('params and locals are offered where a value may go', () => {
  const source = 'param wall = 2\nlocal sizes = [1]\n\nmodel "m" {\n  box { size = |1 }\n}';
  const offered = completeForma(at(source)).options;

  assert.equal(offered.find((option) => option.label === 'wall').detail, 'param');
  assert.equal(offered.find((option) => option.label === 'sizes').detail, 'local');
});

test('var. offers the params and nothing else, because that is all var holds', () => {
  const source = 'param wall = 2\nlocal sizes = [1]\n\nmodel "m" {\n  box { size = var.|wall }\n}';

  assert.deepEqual(labels(completeForma(at(source))), ['wall']);
});

test('a document that no longer parses still offers what it last declared', () => {
  const good = 'param wall = 2\n\nmodel "m" {\n  box { size = |1 }\n}';
  assert.ok(labels(completeForma(at(good))).includes('wall'));

  // The same document with the param half-edited: the parse fails, the answer does not.
  const broken = 'param wall = \n\nmodel "m" {\n  box { size = |1 }\n}';
  assert.ok(labels(completeForma(at(broken))).includes('wall'));
});

test('a block completes with a body to type into, not just its name', () => {
  const box = completeForma(at('model "m" {\n  |\n}')).options.find((o) => o.label === 'box');

  assert.equal(typeof box.apply, 'function', 'a snippet applies through a function, a word does not');
});

test('a block says what it takes and what it produces', () => {
  const offered = completeForma(at('model "m" {\n  |\n}')).options;
  const detail = (name) => offered.find((option) => option.label === name).detail;

  assert.equal(detail('rect'), '2D shape');
  assert.equal(detail('box'), '3D shape');
  assert.equal(detail('extrude'), '2D to 3D');
  assert.equal(detail('translate'), '2D or 3D');
});

test('a function says how many arguments it takes', () => {
  const offered = completeForma(at('model "m" {\n  box { size = |\n}')).options;
  const detail = (name) => offered.find((option) => option.label === name).detail;

  assert.equal(detail('abs'), '1 argument');
  assert.equal(detail('pow'), '2 arguments');
  assert.equal(detail('max'), 'variadic');
});

test('typing a prefix completes from where the word began', () => {
  const result = completeForma(at('model "m" {\n  cyl|\n}', false));

  assert.equal(result.from, 'model "m" {\n  '.length);
  assert.ok(labels(result).includes('cylinder'));
});

test('an empty position offers nothing unless the reader asked', () => {
  assert.equal(completeForma(at('model "m" {\n  |\n}', false)), null);
  assert.ok(completeForma(at('model "m" {\n  |\n}', true)));
});

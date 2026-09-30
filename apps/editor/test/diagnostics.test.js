import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FormaError } from 'forma-dsl';

import { Diagnostics, diagnosticFor } from '../src/diagnostics.js';

/**
 * A stand-in for CodeMirror's document, which is all `diagnosticFor` reads of it.
 *
 * @param {string[]} lines The document's lines.
 * @returns {{ lines: number, line: (n: number) => { from: number, to: number } }} The document.
 */
function docOf(lines) {
  const starts = [];
  let at = 0;
  for (const line of lines) { starts.push(at); at += line.length + 1; }
  return {
    lines: lines.length,
    line: (n) => ({ from: starts[n - 1], to: starts[n - 1] + lines[n - 1].length }),
  };
}

test('an error with a position underlines from its column to the end of its line', () => {
  const doc = docOf(['model "m" {', '  box { size = -1 }', '}']);
  const error = new FormaError('size must be positive', { line: 2, column: 3 });

  const d = diagnosticFor(error, doc);
  assert.equal(d.from, 12 + 2);
  assert.equal(d.to, 12 + '  box { size = -1 }'.length);
  assert.equal(d.severity, 'error');
  assert.match(d.message, /size must be positive/);
});

test('an error with no position is attached to the start, where it can still be seen', () => {
  const d = diagnosticFor(new Error('the kernel would not load'), docOf(['model "m" {}']));
  assert.deepEqual({ from: d.from, to: d.to }, { from: 0, to: 0 });
});

test('a line past the end of the document is clamped rather than thrown on', () => {
  const doc = docOf(['model "m" {}']);
  const d = diagnosticFor(new FormaError('late', { line: 99, column: 1 }), doc);
  assert.equal(d.from, 0);
  assert.equal(d.to, 'model "m" {}'.length);
});

test('nothing is underlined until a render has finished', () => {
  assert.deepEqual(new Diagnostics().read(), []);
});

test('a failure is underlined once the render that found it has finished', () => {
  const diagnostics = new Diagnostics();
  diagnostics.fail(new FormaError('bad', { line: 1, column: 1 }), docOf(['model "m" {}']));
  assert.equal(diagnostics.read().length, 1);
});

// The bug this covers: the offsets belong to the document the render was given, so leaving
// them in place across an edit draws the error under whatever text has moved into them.
test('an edit drops the last failure, so no error is drawn against text that has moved', () => {
  const diagnostics = new Diagnostics();
  diagnostics.fail(new FormaError('bad', { line: 2, column: 3 }), docOf(['a', '  box {']));
  assert.equal(diagnostics.read().length, 1);

  diagnostics.invalidate();
  assert.deepEqual(diagnostics.read(), [], 'a stale failure must not survive an edit');
});

test('a render that finds nothing wrong clears what the last one found', () => {
  const diagnostics = new Diagnostics();
  diagnostics.fail(new FormaError('bad', { line: 1, column: 1 }), docOf(['model "m" {}']));
  diagnostics.pass();
  assert.deepEqual(diagnostics.read(), []);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKS, FUNCTIONS } from 'forma-dsl';

import { createPage } from './dom.js';
import { segments, paint } from '../src/highlight.js';
import { DEMOS } from '../src/demos.js';
import { QUICKSTART } from '../src/quickstart.js';

/**
 * @param {string} code The snippet.
 * @returns {Array<[string, string]>} Each segment as a class/text pair.
 */
const classified = (code) => segments(code).map((s) => [s.cls, s.text]);

/**
 * @param {string} code The snippet.
 * @param {string} word The text to look for.
 * @returns {string | undefined} The class it was given, if it is a segment of its own.
 */
const classOf = (code, word) => segments(code).find((s) => s.text === word)?.cls;

// The one property the demo depends on: it paints a prefix of the segments, so a segment
// list that does not cover the source would drop or duplicate characters as it types.
test('the segments concatenate back to the source', () => {
  for (const demo of DEMOS) {
    assert.equal(segments(demo.source).map((s) => s.text).join(''), demo.source);
  }
  assert.equal(segments(QUICKSTART).map((s) => s.text).join(''), QUICKSTART);
  assert.deepEqual(segments(''), []);
});

test('keywords, blocks, functions and constants come from the registries', () => {
  assert.equal(classOf('param height { }', 'param'), 'tok-k');
  assert.equal(classOf('model "x" { }', 'model'), 'tok-k');

  const block = Object.keys(BLOCKS)[0];
  assert.equal(classOf(`${block} { }`, block), 'tok-b');
  // Handled by the evaluator rather than the registry, and still a block on screen.
  assert.equal(classOf('part { }', 'part'), 'tok-b');
  assert.equal(classOf('align { }', 'align'), 'tok-b');

  const fn = Object.keys(FUNCTIONS)[0];
  assert.equal(classOf(`x = ${fn}(1)`, fn), 'tok-f');
  // The same name without the call parentheses is not a call.
  assert.notEqual(classOf(`x = ${fn} + 1`, fn), 'tok-f');

  assert.equal(classOf('x = var.height', 'var'), 'tok-c');
  assert.equal(classOf('param h { type = number }', 'number'), 'tok-c');
  assert.equal(classOf('x = unknown_name', 'unknown_name'), '');
});

test('an attribute is told apart from a comparison', () => {
  assert.equal(classOf('size = 4', 'size'), 'tok-a');
  assert.equal(classOf('if size == 4 { }', 'size'), '');
});

test('comments, strings and numbers win over the names inside them', () => {
  assert.deepEqual(classified('// param'), [['tok-m', '// param']]);
  assert.deepEqual(classified('# param'), [['tok-m', '# param']]);
  assert.deepEqual(classified('/* param\n   model */'), [['tok-m', '/* param\n   model */']]);
  assert.deepEqual(classified('"param \\" model"'), [['tok-s', '"param \\" model"']]);
  assert.equal(classOf('x = 1.5e-3', '1.5e-3'), 'tok-n');
  // A hyphen is part of a name, so this is one identifier rather than a subtraction.
  assert.equal(classOf('a-b = 1', 'a-b'), 'tok-a');
});

test('paint renders a prefix, and only the prefix', () => {
  const page = createPage();
  const target = page.document.createElement('code');
  const parts = segments('param height { default = 20 }');

  paint(target, parts, 0);
  assert.equal(target.textContent, '');

  paint(target, parts, 8);
  assert.equal(target.textContent, 'param he');
  // The first word is complete and coloured; the second is cut mid-segment and still is.
  assert.equal(target.querySelector('.tok-k')?.textContent, 'param');

  paint(target, parts, 1000);
  assert.equal(target.textContent, 'param height { default = 20 }');
  assert.equal(target.querySelectorAll('span').length, segments(target.textContent).filter((s) => s.cls).length);
});

test('paint draws a caret only when asked, and replaces what was there', () => {
  const page = createPage();
  const target = page.document.createElement('code');
  const parts = segments('model "x" { }');

  paint(target, parts, 5, true);
  assert.equal(target.querySelectorAll('i.caret').length, 1);

  paint(target, parts, 5, false);
  assert.equal(target.querySelectorAll('i.caret').length, 0);
  assert.equal(target.textContent, 'model');
});

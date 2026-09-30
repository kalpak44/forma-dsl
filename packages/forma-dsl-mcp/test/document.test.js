/**
 * What the checker reports, and how precisely it points at a mistake.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDocument, disposeSharedContext, excerpt, exportStl } from '../src/document.js';

test.after(() => disposeSharedContext());

const CUBE = 'model "m" { part "body" { box { size = [10, 20, 30] } } }';

test('a valid document reports its parts, measured', async () => {
  const report = await checkDocument(CUBE);

  assert.equal(report.ok, true);
  assert.equal(report.stage, 'rendered');
  assert.deepEqual(report.models, ['m']);
  assert.equal(report.scene.parts.length, 1);

  const [part] = report.scene.parts;
  assert.equal(part.name, 'body');
  assert.deepEqual(part.boundingBox.size, [10, 20, 30]);
  assert.equal(part.volume, 6000);
  assert.equal(part.genus, 0);
  assert.equal(part.empty, false);
  assert.deepEqual(report.scene.boundingBox.size, [10, 20, 30]);
});

test('parsing only skips the kernel and says so', async () => {
  const report = await checkDocument(CUBE, { solve: false });

  assert.equal(report.ok, true);
  assert.equal(report.stage, 'parsed');
  assert.equal(report.scene, undefined);
});

test('a syntax error carries a position and an excerpt', async () => {
  const report = await checkDocument('model "m" {\n  box { size = [1, 1, 1] }\n');

  assert.equal(report.ok, false);
  assert.equal(report.error.stage, 'parse');
  assert.ok(report.error.line >= 1);
  assert.match(report.error.excerpt, /\^/);
});

test('an evaluation error names the block and the attribute', async () => {
  const report = await checkDocument('model "m" { part "p" { box { size = [1, 1, 1]  colour = "red" } } }');

  assert.equal(report.ok, false);
  assert.equal(report.error.stage, 'render');
  assert.match(report.error.message, /unknown attribute "colour"/);
});

test('a 2D part is rejected with the message that says what to do', async () => {
  const report = await checkDocument('model "m" { part "p" { circle { radius = 4 } } }');

  assert.equal(report.ok, false);
  assert.match(report.error.message, /2D — extrude or revolve it/);
});

test('a document with no model is reported before the kernel is asked', async () => {
  const report = await checkDocument('param a = 1');

  assert.equal(report.ok, false);
  assert.equal(report.stage, 'parsed');
  assert.match(report.error.message, /declares no model/);
});

test('params are described, and supplied values reach the geometry', async () => {
  const source = `param height { type = number  default = 5  min = 1  max = 50 }
model "m" { part "p" { box { size = [10, 10, var.height] } } }`;

  const byDefault = await checkDocument(source);
  assert.deepEqual(byDefault.parameters.map((each) => each.name), ['height']);
  assert.equal(byDefault.parameters[0].max, 50);
  assert.deepEqual(byDefault.scene.parts[0].boundingBox.size, [10, 10, 5]);

  const supplied = await checkDocument(source, { params: { height: 32 } });
  assert.deepEqual(supplied.scene.parts[0].boundingBox.size, [10, 10, 32]);
});

test('a required param is reported as required rather than failing the description', async () => {
  const report = await checkDocument('param serial { type = string }\nmodel "m" { part "p" { box { size = [1, 1, 1] } } }');

  assert.equal(report.parameters[0].required, true);
  assert.equal(report.ok, false);
  assert.match(report.error.message, /no default and no value was supplied/);
});

test('a model is chosen by name, and an unknown one is an error', async () => {
  const source = `${CUBE}\nmodel "other" { part "p" { sphere { radius = 3 } } }`;

  const named = await checkDocument(source, { model: 'other' });
  assert.equal(named.scene.model, 'other');

  const missing = await checkDocument(source, { model: 'nope' });
  assert.equal(missing.ok, false);
  assert.match(missing.error.message, /no model named "nope"/);
});

test('the excerpt puts the caret under the column', () => {
  const rendered = excerpt('alpha\nbeta\ngamma', { line: 2, column: 3 });

  assert.deepEqual(rendered.split('\n'), [
    '1 | alpha',
    '2 | beta',
    '  |   ^',
    '3 | gamma',
  ]);
});

test('an error with no position gets no excerpt', () => {
  assert.equal(excerpt('anything', null), undefined);
});

test('a single-part model exports that part as STL', async () => {
  const result = await exportStl(CUBE);

  assert.equal(result.model, 'm');
  assert.equal(result.part, 'body');
  assert.equal(result.triangles, 12);
  // 84-byte header and count, then 50 bytes per triangle.
  assert.equal(result.bytes.length, 84 + 12 * 50);
});

test('a named part is exported on its own, and an unknown one is refused', async () => {
  const source = `model "m" {
  part "a" { box { size = [10, 10, 10] } }
  part "b" { translate { offset = [20, 0, 0]  box { size = [10, 10, 10] } } }
}`;

  const one = await exportStl(source, { part: 'b' });
  assert.equal(one.part, 'b');
  assert.equal(one.triangles, 12);

  const both = await exportStl(source);
  assert.equal(both.part, 'all');
  assert.equal(both.triangles, 24);

  await assert.rejects(
    () => exportStl(source, { part: 'c' }),
    /no part named "c".*it has "a", "b"/,
  );
});

test('a part that solves to nothing is reported rather than passed off as fine', async () => {
  const report = await checkDocument('model "m" { part "p" { extrude { height = 0  rect { size = [4, 4] } } } }');

  // Empty geometry is legal in the language — a param at the end of its range should not
  // break a model — so this has to come back as a measurement, not an error.
  assert.equal(report.ok, true);
  assert.equal(report.scene.parts[0].volume, 0);
  assert.equal(report.scene.parts[0].empty, true);
});

test('the shared context caches across calls', async () => {
  await checkDocument(CUBE);
  const second = await checkDocument(CUBE);

  assert.ok(second.stats.cacheHits > 0, 'a repeated render should hit the digest cache');
});

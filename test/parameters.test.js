import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeParameters, render } from '../src/index.js';

const MODEL = '\nmodel "m" { box { size = 1 } }';

test('a param type is inferred from its default', () => {
  const descriptors = describeParameters(`
    param a = 3
    param b = true
    param c = "x"
    param d = [1, 2]
  ${MODEL}`);
  assert.deepEqual(descriptors.map((d) => d.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(descriptors.map((d) => d.type), ['number', 'bool', 'string', 'vector']);
  assert.deepEqual(descriptors.map((d) => d.required), [false, false, false, false]);
  assert.deepEqual(descriptors.map((d) => d.default), [3, true, 'x', [1, 2]]);
});

test('a declared type wins over the inferred one', () => {
  const [d] = describeParameters(`param turn { type = angle  default = 45 }${MODEL}`);
  assert.equal(d.type, 'angle');
  assert.equal(d.default, 45);
});

test('a param with no default is described as required', () => {
  // Without this the editor cannot build the control that would supply the value, and the
  // document is stuck: it will not render, and nothing offers a way to make it render.
  const [d] = describeParameters(`param width { type = number  min = 1  max = 9  step = 0.5 }${MODEL}`);
  assert.equal(d.required, true);
  assert.equal(d.default, undefined);
  assert.equal(d.type, 'number');
  assert.deepEqual([d.min, d.max, d.step], [1, 9, 0.5]);
});

test('describing a document is not the same as agreeing to render it', async () => {
  const source = 'param width { type = number }\nmodel "m" { box { size = var.width } }';
  assert.equal(describeParameters(source)[0].required, true);
  await assert.rejects(render(source), /has no default and no value was supplied/);

  const r = await render(source, { params: { width: 4 } });
  assert.equal(r.parts[0].concrete.volume(), 64);
  r.context.dispose();
});

test('one unreadable attribute does not cost the other descriptors', () => {
  const descriptors = describeParameters(`
    param a { default = 1  min = nope }
    param b = 2
  ${MODEL}`);
  assert.equal(descriptors.length, 2);
  assert.equal(descriptors[0].default, 1);
  assert.equal(descriptors[0].min, undefined, 'the unreadable min should be dropped, not thrown');
  assert.equal(descriptors[1].default, 2);
});

test('param metadata is carried through untouched', () => {
  const [d] = describeParameters(`
    param wall {
      type = number
      default = 2.5
      min = 1
      max = 6
      step = 0.5
      description = "wall thickness in mm"
    }
  ${MODEL}`);
  assert.equal(d.description, 'wall thickness in mm');
  assert.deepEqual([d.min, d.max, d.step, d.default], [1, 6, 0.5, 2.5]);
});

test('a param declared twice is refused', () => {
  assert.throws(() => describeParameters(`param a = 1\nparam a = 2${MODEL}`), /declared twice/);
});

test('a supplied value overrides the default without editing the source', async () => {
  const source = 'param h = 10\nmodel "m" { box { size = [2, 2, var.h] } }';
  const a = await render(source);
  const b = await render(source, { params: { h: 40 } });
  assert.equal(a.parts[0].concrete.volume(), 40);
  assert.equal(b.parts[0].concrete.volume(), 160);
  a.context.dispose();
  b.context.dispose();
});

test('a part can name itself from a loop variable', async () => {
  const r = await render(`model "m" {
    for i in range(0, 3) {
      part "leg_\${i}" {
        translate { offset = [i * 5, 0, 0]  box { size = 2 } }
      }
    }
  }`);
  assert.deepEqual(r.parts.map((p) => p.name), ['leg_0', 'leg_1', 'leg_2']);
  r.context.dispose();
});

test('a named model can be chosen out of several', async () => {
  const source = `
    model "small" { box { size = [1, 1, 1] } }
    model "large" { box { size = [10, 10, 10] } }`;
  const first = await render(source);
  const chosen = await render(source, { model: 'large' });
  assert.equal(first.name, 'small', 'the first declared model is the default');
  assert.equal(chosen.parts[0].concrete.volume(), 1000);
  await assert.rejects(render(source, { model: 'missing' }), /no model named/);
  first.context.dispose();
  chosen.context.dispose();
});

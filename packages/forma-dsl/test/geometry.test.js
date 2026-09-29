import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, toBinarySTL } from '../src/index.js';

const close = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${what}: expected ~${expected}, got ${actual}`);

test('a box has the volume it claims', async () => {
  const r = await render('model "m" { box { size = [10, 20, 3] } }');
  close(r.parts[0].concrete.volume(), 600, 1e-6, 'volume');
  r.context.dispose();
});

test('difference removes material', async () => {
  const r = await render(`model "m" {
    difference {
      box { size = [10, 10, 10]  center = true }
      cylinder { radius = 2  height = 40  center = true  segments = 256 }
    }
  }`);
  // A 256-segment cylinder is within a thousandth of the true circle.
  close(r.parts[0].concrete.volume(), 1000 - Math.PI * 4 * 10, 1, 'drilled cube');
  r.context.dispose();
});

test('identical subtrees evaluate once', async () => {
  const r = await render(`model "m" {
    for i in range(0, 8) {
      translate {
        offset = [i * 12, 0, 0]
        sphere { radius = 5  segments = 32 }
      }
    }
  }`);
  // Eight spheres, one sphere evaluation: the translations differ, the sphere does not.
  assert.equal(r.stats.cacheHits, 7, `expected 7 cache hits, got ${r.stats.cacheHits}`);
  r.context.dispose();
});

test('align puts geometry where it says', async () => {
  const r = await render(`model "m" {
    align {
      x = "center"  y = "min"  z = 5
      box { size = [10, 10, 10] }
    }
  }`);
  const box = r.parts[0].concrete.boundingBox();
  close(box.min[0], -5, 1e-9, 'centred x');
  close(box.min[1], 0, 1e-9, 'min y');
  close(box.min[2], 5, 1e-9, 'z at 5');
  r.context.dispose();
});

test('2D geometry cannot be rendered without being extruded', async () => {
  await assert.rejects(render('model "m" { circle { radius = 5 } }'), /2D/);
});

test('mixing dimensionalities is refused', async () => {
  await assert.rejects(
    render('model "m" { union { box { size = 1 }  circle { radius = 1 } } }'),
    /2D and 3D/,
  );
});

test('a component cannot use itself', async () => {
  await assert.rejects(
    render('component "loop" { loop { } }\nmodel "m" { loop { } }'),
    /nesting deeper|unknown/,
  );
});

test('parameters change the geometry', async () => {
  const source = 'param h { type = number  default = 10 }\nmodel "m" { box { size = [2, 2, var.h] } }';
  const a = await render(source);
  const b = await render(source, { params: { h: 40 } });
  close(a.parts[0].concrete.volume(), 40, 1e-9, 'default');
  close(b.parts[0].concrete.volume(), 160, 1e-9, 'overridden');
  a.context.dispose();
  b.context.dispose();
});

test('binary STL is well formed', async () => {
  const r = await render('model "m" { box { size = 5 } }');
  const stl = toBinarySTL(r.parts[0].concrete);
  const triangles = new DataView(stl.buffer).getUint32(80, true);
  assert.equal(triangles, 12, 'a cube is 12 triangles');
  assert.equal(stl.length, 84 + triangles * 50);
  r.context.dispose();
});

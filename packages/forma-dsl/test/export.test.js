import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, toRenderMesh, toBinarySTL } from '../src/index.js';

const cube = () => render('model "m" { box { size = [2, 4, 6] } }');

test('a render mesh expands vertices so faces stay flat', async () => {
  const r = await cube();
  const mesh = toRenderMesh(r.parts[0].concrete);

  assert.equal(mesh.triangleCount, 12, 'a box is 12 triangles');
  assert.equal(mesh.positions.length, 12 * 9, 'three vertices per triangle, expanded');
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.vertexCount, 8, 'the kernel still shares its 8 corners');

  for (let t = 0; t < mesh.triangleCount; t++) {
    const [x, y, z] = [mesh.normals[t * 9], mesh.normals[t * 9 + 1], mesh.normals[t * 9 + 2]];
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-6, `triangle ${t} normal is not unit length`);
    // All three vertices of a face carry the same normal, which is what keeps the edge hard.
    for (let v = 1; v < 3; v++) {
      assert.ok(Math.abs(mesh.normals[t * 9 + v * 3] - x) < 1e-6, `triangle ${t} vertex ${v} normal differs`);
    }
  }

  // A box only ever faces along an axis, so every normal component is 0 or ±1.
  for (const n of mesh.normals) {
    assert.ok(Math.abs(n) < 1e-6 || Math.abs(Math.abs(n) - 1) < 1e-6, `unexpected normal component ${n}`);
  }

  r.context.dispose();
});

test('every render mesh vertex lies inside the solid bounding box', async () => {
  const r = await cube();
  const mesh = toRenderMesh(r.parts[0].concrete);
  const box = r.parts[0].concrete.boundingBox();

  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[i + axis];
      assert.ok(
        value >= box.min[axis] - 1e-6 && value <= box.max[axis] + 1e-6,
        `vertex ${i / 3} axis ${axis} is outside the bounding box`,
      );
    }
  }

  r.context.dispose();
});

test('binary STL has the layout a slicer expects', async () => {
  const r = await cube();
  const stl = toBinarySTL(r.parts[0].concrete, 'forma-dsl');
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);

  const triangles = view.getUint32(80, true);
  assert.equal(triangles, 12);
  assert.equal(stl.length, 84 + triangles * 50, 'header plus 50 bytes per triangle');

  const header = new TextDecoder().decode(stl.subarray(0, 9));
  assert.equal(header, 'forma-dsl');

  for (let t = 0; t < triangles; t++) {
    const o = 84 + t * 50;
    const normal = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
    assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-5, `triangle ${t} normal is not unit length`);
    for (let v = 0; v < 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Number.isFinite(view.getFloat32(o + 12 + v * 12 + axis * 4, true)), 'non-finite vertex');
      }
    }
    assert.equal(view.getUint16(o + 48, true), 0, 'the attribute byte count must be zero');
  }

  r.context.dispose();
});

test('an over-long STL header is truncated rather than overrunning the count', async () => {
  const r = await cube();
  const stl = toBinarySTL(r.parts[0].concrete, 'x'.repeat(200));
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);

  // Byte 79 is the last header byte; 80 begins the triangle count and must not be clobbered.
  assert.equal(stl[78], 'x'.charCodeAt(0));
  assert.equal(stl[79], 0, 'the header must stop before the count');
  assert.equal(view.getUint32(80, true), 12);
  assert.equal(stl.length, 84 + 12 * 50);

  r.context.dispose();
});

test('STL triangles agree with the render mesh they came from', async () => {
  const r = await cube();
  const mesh = toRenderMesh(r.parts[0].concrete);
  const stl = toBinarySTL(r.parts[0].concrete);
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);

  for (let t = 0; t < mesh.triangleCount; t++) {
    const o = 84 + t * 50;
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(
        Math.abs(view.getFloat32(o + axis * 4, true) - mesh.normals[t * 9 + axis]) < 1e-5,
        `triangle ${t} normal axis ${axis} differs from the mesh`,
      );
    }
    for (let v = 0; v < 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        const written = view.getFloat32(o + 12 + v * 12 + axis * 4, true);
        const expected = mesh.positions[t * 9 + v * 3 + axis];
        assert.ok(
          Math.abs(written - expected) < 1e-5,
          `triangle ${t} vertex ${v} axis ${axis} differs from the mesh`,
        );
      }
    }
  }

  r.context.dispose();
});

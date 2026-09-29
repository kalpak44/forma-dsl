import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector, Angle, Transform } from '../src/index.js';

const close = (actual, expected, what, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${what}: expected ~${expected}, got ${actual}`);

const closeAll = (actual, expected, what) =>
  expected.forEach((value, i) => close(actual[i], value, `${what}[${i}]`));

/// Applies a transform to a point the way the kernel does, so the tests check the matrix
/// that is actually handed over rather than the constructor that built it.
function apply(transform, point) {
  const n = transform.order;
  const v = [...point, 1];
  const out = [];
  for (let r = 0; r < n; r++) {
    let sum = 0;
    for (let c = 0; c < n; c++) sum += transform.at(r, c) * v[c];
    out.push(sum);
  }
  return out.slice(0, transform.dim);
}

test('translation moves a point by its offset', () => {
  closeAll(apply(Transform.translation([1, 2, 3], 3), [0, 0, 0]), [1, 2, 3], 'origin');
  closeAll(apply(Transform.translation([1, 2, 3], 3), [10, 10, 10]), [11, 12, 13], 'offset point');
  closeAll(apply(Transform.translation([4, 5], 2), [1, 1]), [5, 6], '2D');
});

test('scaling is componentwise, and a scalar scales every axis', () => {
  closeAll(apply(Transform.scaling([2, 3, 4], 3), [1, 1, 1]), [2, 3, 4], 'per axis');
  closeAll(apply(Transform.scaling(2, 3), [1, 2, 3]), [2, 4, 6], 'uniform');
});

test('rotation turns x towards y, in degrees', () => {
  closeAll(apply(Transform.rotation3D([0, 0, 90]), [1, 0, 0]), [0, 1, 0], 'about z');
  closeAll(apply(Transform.rotation3D([90, 0, 0]), [0, 1, 0]), [0, 0, 1], 'about x');
  closeAll(apply(Transform.rotation3D([0, 90, 0]), [0, 0, 1]), [1, 0, 0], 'about y');
  closeAll(apply(Transform.rotation2D(90), [1, 0]), [0, 1], '2D');
});

test('concat applies the right-hand transform first', () => {
  const rotateThenMove = Transform.translation([10, 0, 0], 3).concat(Transform.rotation3D([0, 0, 90]));
  closeAll(apply(rotateThenMove, [1, 0, 0]), [10, 1, 0], 'rotate then translate');

  const moveThenRotate = Transform.rotation3D([0, 0, 90]).concat(Transform.translation([10, 0, 0], 3));
  closeAll(apply(moveThenRotate, [1, 0, 0]), [0, 11, 0], 'translate then rotate');
});

test('identity leaves a point alone and is a concat unit', () => {
  const t = Transform.translation([3, 4, 5], 3);
  closeAll(apply(Transform.identity(3), [7, 8, 9]), [7, 8, 9], 'identity');
  closeAll(t.concat(Transform.identity(3)).toArray(), t.toArray(), 'right unit');
  closeAll(Transform.identity(3).concat(t).toArray(), t.toArray(), 'left unit');
});

test('mirroring reflects across the plane through the origin', () => {
  closeAll(apply(Transform.mirroring([1, 0, 0], 3), [2, 3, 4]), [-2, 3, 4], 'x normal');
  closeAll(apply(Transform.mirroring([0, 0, 1], 3), [2, 3, 4]), [2, 3, -4], 'z normal');
  // The normal is normalised, so its length must not change the result.
  closeAll(apply(Transform.mirroring([5, 0, 0], 3), [2, 3, 4]), [-2, 3, 4], 'unnormalised normal');
  // Reflecting twice is the identity.
  const m = Transform.mirroring([1, 1, 0], 3);
  closeAll(apply(m, apply(m, [2, 3, 4])), [2, 3, 4], 'involution');
});

test('a transform is frozen once built', () => {
  const t = Transform.translation([1, 2, 3], 3);
  assert.throws(() => { t.m[0] = 99; }, TypeError);
  // toArray hands out a copy, so a caller cannot reach back into the transform.
  const copy = t.toArray();
  copy[0] = 99;
  assert.equal(t.at(0, 0), 1);
});

test('vectors do the arithmetic componentwise', () => {
  const v = new Vector([3, 4]);
  close(v.magnitude, 5, 'magnitude');
  close(v.normalized().magnitude, 1, 'normalised');
  close(v.dot([1, 0]), 3, 'dot');
  closeAll(v.plus([1, 1]).toArray(), [4, 5], 'plus');
  closeAll(v.minus([1, 1]).toArray(), [2, 3], 'minus');
  closeAll(v.times(2).toArray(), [6, 8], 'times a scalar');
  closeAll(v.negated().toArray(), [-3, -4], 'negated');
  closeAll(new Vector([1, 0, 0]).cross([0, 1, 0]).toArray(), [0, 0, 1], 'cross');
});

test('normalising a zero vector yields zero rather than NaN', () => {
  closeAll(Vector.zero(3).normalized().toArray(), [0, 0, 0], 'zero');
});

test('Vector.of accepts the shapes a model can produce, and refuses the rest', () => {
  closeAll(Vector.of(2, 3).toArray(), [2, 2, 2], 'a scalar fills every component');
  closeAll(Vector.of([1, 2], 2).toArray(), [1, 2], 'an array');
  closeAll(Vector.of({ x: 1, z: 3 }, 3).toArray(), [1, 0, 3], 'an object, missing keys as zero');
  assert.throws(() => Vector.of([1, 2], 3), /expected 3 components/);
  assert.throws(() => Vector.of(new Vector([1, 2]), 3), /expected a 3D vector/);
  assert.throws(() => Vector.of('nope', 3), /cannot read/);
});

test('angles convert both ways and are read as degrees by default', () => {
  close(Angle.degrees(180).radians, Math.PI, 'degrees to radians');
  close(Angle.radians(Math.PI).degrees, 180, 'radians to degrees');
  close(Angle.turns(0.25).degrees, 90, 'turns');
  close(Angle.of(90).radians, Math.PI / 2, 'a bare number is degrees');
  close(Angle.of(Angle.degrees(90)).degrees, 90, 'an angle passes through');
  close(Angle.degrees(30).plus(60).degrees, 90, 'plus');
  close(Angle.degrees(90).minus(30).degrees, 60, 'minus');
  close(Angle.degrees(45).times(2).degrees, 90, 'times');
  close(Angle.degrees(90).sin, 1, 'sin');
  close(Angle.degrees(0).cos, 1, 'cos');
  assert.throws(() => Angle.of('90'), /cannot read an angle/);
});

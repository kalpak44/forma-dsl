/** @import { Dimensionality } from '../index.js' */
/** @import { VectorLike } from './vector.js' */

import { Vector } from './vector.js';
import { Angle } from './angle.js';

/**
 * An affine transform, held as a column-major matrix of the size the kernel wants: 3x3 for
 * 2D and 4x4 for 3D, both with the last row ignored on the way in.
 *
 * Column-major throughout, because that is what Manifold reads. Storing row-major here and
 * transposing at the boundary would put a silent transpose in the one place a wrong model
 * still renders.
 */
export class Transform {
  /**
   * @param {Dimensionality} dim Whether this transforms 2D or 3D geometry.
   * @param {ReadonlyArray<number>} m The matrix, column-major, `(dim + 1)²` entries.
   */
  constructor(dim, m) {
    /** @type {Dimensionality} Whether this transforms 2D or 3D geometry. */
    this.dim = dim;
    /** @type {ReadonlyArray<number>} The matrix, column-major and frozen. */
    this.m = Object.freeze(m.map(Number));
    Object.freeze(this);
  }

  /**
   * @param {Dimensionality} dim Whether this transforms 2D or 3D geometry.
   * @returns {Transform} The transform that changes nothing.
   */
  static identity(dim) {
    const n = dim + 1;
    const m = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) m[i * n + i] = 1;
    return new Transform(dim, m);
  }

  /** @returns {number} The side length of the matrix, one more than the dimensionality. */
  get order() { return this.dim + 1; }

  /**
   * @param {number} row Row index.
   * @param {number} col Column index.
   * @returns {number} The entry, read out of the column-major storage.
   */
  at(row, col) { return this.m[col * this.order + row]; }

  /**
   * Composes two transforms as `this ∘ other`, so `other` runs first.
   *
   * That order matches how the blocks nest: the transform block closer to the shape is
   * applied to it first.
   *
   * @param {Transform} other The transform to apply before this one.
   * @returns {Transform} The combined transform.
   */
  concat(other) {
    const n = this.order;
    const out = new Array(n * n).fill(0);
    for (let c = 0; c < n; c++) {
      for (let r = 0; r < n; r++) {
        let sum = 0;
        for (let k = 0; k < n; k++) sum += this.at(r, k) * other.at(k, c);
        out[c * n + r] = sum;
      }
    }
    return new Transform(this.dim, out);
  }

  /**
   * @param {VectorLike} offset How far to move, per axis.
   * @param {Dimensionality} dim Whether this transforms 2D or 3D geometry.
   * @returns {Transform} The translation.
   */
  static translation(offset, dim) {
    const v = Vector.of(offset, dim);
    const t = Transform.identity(dim);
    const m = [...t.m];
    const n = dim + 1;
    for (let i = 0; i < dim; i++) m[dim * n + i] = v.components[i];
    return new Transform(dim, m);
  }

  /**
   * @param {VectorLike} factor The scale per axis; a number scales every axis alike.
   * @param {Dimensionality} dim Whether this transforms 2D or 3D geometry.
   * @returns {Transform} The scaling.
   */
  static scaling(factor, dim) {
    const v = Vector.of(factor, dim);
    const n = dim + 1;
    const m = new Array(n * n).fill(0);
    for (let i = 0; i < dim; i++) m[i * n + i] = v.components[i];
    m[dim * n + dim] = 1;
    return new Transform(dim, m);
  }

  /**
   * @param {Angle | number} angle The rotation; a bare number is read as degrees.
   * @returns {Transform} The 2D rotation about the origin.
   */
  static rotation2D(angle) {
    const a = Angle.of(angle);
    const c = a.cos, s = a.sin;
    return new Transform(2, [c, s, 0, -s, c, 0, 0, 0, 1]);
  }

  /**
   * Rotates about x, then y, then z — the order OpenSCAD and Cadova both use, so a model
   * ported from either lands in the same orientation.
   *
   * @param {Vector | ReadonlyArray<number>} angles Degrees about x, y and z.
   * @returns {Transform} The 3D rotation about the origin.
   */
  static rotation3D(angles) {
    const v = Vector.of(angles, 3);
    const [x, y, z] = v.components.map((d) => Angle.of(d));
    const rx = new Transform(3, [1, 0, 0, 0, 0, x.cos, x.sin, 0, 0, -x.sin, x.cos, 0, 0, 0, 0, 1]);
    const ry = new Transform(3, [y.cos, 0, -y.sin, 0, 0, 1, 0, 0, y.sin, 0, y.cos, 0, 0, 0, 0, 1]);
    const rz = new Transform(3, [z.cos, z.sin, 0, 0, -z.sin, z.cos, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return rz.concat(ry).concat(rx);
  }

  /**
   * @param {Angle | number | Vector | ReadonlyArray<number>} angles Degrees. A single
   *   angle in 2D, three in 3D; passing the wrong shape for `dim` is the caller's error.
   * @param {Dimensionality} dim Whether this transforms 2D or 3D geometry.
   * @returns {Transform} The rotation about the origin.
   */
  static rotation(angles, dim) {
    return dim === 2
      ? Transform.rotation2D(/** @type {Angle | number} */ (angles))
      : Transform.rotation3D(/** @type {Vector | ReadonlyArray<number>} */ (angles));
  }

  /**
   * Reflects in the plane (or line) through the origin with this normal. The normal is
   * normalised first, so its length does not change the result.
   *
   * @param {Vector | ReadonlyArray<number>} normal The normal of the mirror plane.
   * @param {Dimensionality} dim Whether this transforms 2D or 3D geometry.
   * @returns {Transform} The reflection.
   */
  static mirroring(normal, dim) {
    const n = Vector.of(normal, dim).normalized();
    const order = dim + 1;
    const m = Transform.identity(dim).m.slice();
    for (let c = 0; c < dim; c++) {
      for (let r = 0; r < dim; r++) {
        m[c * order + r] = (r === c ? 1 : 0) - 2 * n.components[r] * n.components[c];
      }
    }
    return new Transform(dim, m);
  }

  /** @returns {number[]} A copy of the matrix, safe for the caller to keep. */
  toArray() { return [...this.m]; }
}

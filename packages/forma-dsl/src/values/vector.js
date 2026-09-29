/**
 * Anything a model can write where a vector is wanted.
 *
 * A bare number is accepted as shorthand for every component, which is what lets
 * `scale { factor = 2 }` read as naturally as `factor = [2, 1, 1]`.
 *
 * @typedef {Vector | number | ReadonlyArray<number> | Record<string, number>} VectorLike
 */

/**
 * A 2D or 3D vector.
 *
 * One class covers both, because every operation below is componentwise and a separate 3D
 * class would be the same code with one more letter.
 */
export class Vector {
  /**
   * @param {ReadonlyArray<number>} components Two or three components.
   */
  constructor(components) {
    /** @type {ReadonlyArray<number>} The components, frozen. */
    this.components = Object.freeze(components.map(Number));
    Object.freeze(this);
  }

  /**
   * Reads a vector out of whatever the caller had.
   *
   * @param {VectorLike} value A vector, a scalar to broadcast, an array, or an `{x, y, z}`
   *   object whose missing keys are read as zero.
   * @param {number} dimensions How many components the result must have.
   * @returns {Vector} The vector.
   * @throws {TypeError} If the value is the wrong size, or not a shape a vector can be read from.
   */
  static of(value, dimensions) {
    if (value instanceof Vector) {
      if (value.size !== dimensions) {
        throw new TypeError(`expected a ${dimensions}D vector, got ${value.size}D`);
      }
      return value;
    }
    if (typeof value === 'number') {
      return new Vector(new Array(dimensions).fill(value));
    }
    if (Array.isArray(value)) {
      if (value.length !== dimensions) {
        throw new TypeError(`expected ${dimensions} components, got ${value.length}`);
      }
      return new Vector(value);
    }
    if (value && typeof value === 'object') {
      const keys = dimensions === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
      return new Vector(keys.map((k) => value[k] ?? 0));
    }
    throw new TypeError(`cannot read a ${dimensions}D vector from ${typeof value}`);
  }

  /**
   * @param {number} dimensions How many components.
   * @returns {Vector} The origin.
   */
  static zero(dimensions) {
    return new Vector(new Array(dimensions).fill(0));
  }

  /** @returns {number} How many components the vector has. */
  get size() { return this.components.length; }

  /** @returns {number} The first component. */
  get x() { return this.components[0]; }

  /** @returns {number} The second component. */
  get y() { return this.components[1]; }

  /** @returns {number} The third component, or `undefined` in 2D. */
  get z() { return this.components[2]; }

  /**
   * @param {VectorLike} other The right-hand side.
   * @param {(a: number, b: number) => number} f Applied to each pair of components.
   * @returns {Vector} The result.
   */
  #zip(other, f) {
    const rhs = Vector.of(other, this.size);
    return new Vector(this.components.map((v, i) => f(v, rhs.components[i])));
  }

  /**
   * @param {VectorLike} other The right-hand side.
   * @returns {Vector} The componentwise sum.
   */
  plus(other) { return this.#zip(other, (a, b) => a + b); }

  /**
   * @param {VectorLike} other The right-hand side.
   * @returns {Vector} The componentwise difference.
   */
  minus(other) { return this.#zip(other, (a, b) => a - b); }

  /**
   * @param {VectorLike} other The right-hand side; a number scales every component.
   * @returns {Vector} The componentwise product.
   */
  times(other) { return this.#zip(other, (a, b) => a * b); }

  /**
   * @param {VectorLike} other The right-hand side; a number divides every component.
   * @returns {Vector} The componentwise quotient.
   */
  dividedBy(other) { return this.#zip(other, (a, b) => a / b); }

  /** @returns {Vector} The vector pointing the other way. */
  negated() { return new Vector(this.components.map((v) => -v)); }

  /**
   * @param {VectorLike} other The right-hand side.
   * @returns {number} The dot product.
   */
  dot(other) {
    const rhs = Vector.of(other, this.size);
    return this.components.reduce((sum, v, i) => sum + v * rhs.components[i], 0);
  }

  /** @returns {number} The length of the vector. */
  get magnitude() { return Math.sqrt(this.dot(this)); }

  /**
   * A zero vector normalises to itself rather than to NaN, so a degenerate normal cannot
   * quietly poison a transform downstream.
   *
   * @returns {Vector} The vector scaled to unit length.
   */
  normalized() {
    const m = this.magnitude;
    return m === 0 ? this : new Vector(this.components.map((v) => v / m));
  }

  /**
   * @param {Vector | ReadonlyArray<number>} other The right-hand side; must be 3D.
   * @returns {Vector} The cross product.
   */
  cross(other) {
    const b = Vector.of(other, 3);
    const [ax, ay, az] = this.components;
    const [bx, by, bz] = b.components;
    return new Vector([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
  }

  /** @returns {number[]} A copy of the components, safe for the caller to keep. */
  toArray() { return [...this.components]; }

  /** @returns {string} The components in parentheses, for diagnostics. */
  toString() { return `(${this.components.join(', ')})`; }
}

/**
 * @param {number} x The first component.
 * @param {number} y The second component.
 * @returns {Vector} A 2D vector.
 */
export const vector2 = (x, y) => new Vector([x, y]);

/**
 * @param {number} x The first component.
 * @param {number} y The second component.
 * @param {number} z The third component.
 * @returns {Vector} A 3D vector.
 */
export const vector3 = (x, y, z) => new Vector([x, y, z]);

/// A 2D or 3D vector. One class covers both, because every operation below is
/// componentwise and a separate 3D class would be the same code with one more letter.
export class Vector {
  constructor(components) {
    this.components = Object.freeze(components.map(Number));
    Object.freeze(this);
  }

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

  static zero(dimensions) {
    return new Vector(new Array(dimensions).fill(0));
  }

  get size() { return this.components.length; }
  get x() { return this.components[0]; }
  get y() { return this.components[1]; }
  get z() { return this.components[2]; }

  #zip(other, f) {
    const rhs = Vector.of(other, this.size);
    return new Vector(this.components.map((v, i) => f(v, rhs.components[i])));
  }

  plus(other) { return this.#zip(other, (a, b) => a + b); }
  minus(other) { return this.#zip(other, (a, b) => a - b); }
  times(other) { return this.#zip(other, (a, b) => a * b); }
  dividedBy(other) { return this.#zip(other, (a, b) => a / b); }
  negated() { return new Vector(this.components.map((v) => -v)); }

  dot(other) {
    const rhs = Vector.of(other, this.size);
    return this.components.reduce((sum, v, i) => sum + v * rhs.components[i], 0);
  }

  get magnitude() { return Math.sqrt(this.dot(this)); }

  normalized() {
    const m = this.magnitude;
    return m === 0 ? this : new Vector(this.components.map((v) => v / m));
  }

  cross(other) {
    const b = Vector.of(other, 3);
    const [ax, ay, az] = this.components;
    const [bx, by, bz] = b.components;
    return new Vector([ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]);
  }

  toArray() { return [...this.components]; }
  toString() { return `(${this.components.join(', ')})`; }
}

export const vector2 = (x, y) => new Vector([x, y]);
export const vector3 = (x, y, z) => new Vector([x, y, z]);

/**
 * An angle, stored in radians and read in whichever unit the caller wants.
 *
 * The kernel takes degrees and the trigonometry takes radians, so an unwrapped number would
 * be ambiguous at exactly the call sites where getting it wrong produces a model that is
 * subtly wrong rather than an error.
 *
 * Note that the unit names appear twice, as static factories and as instance accessors:
 * `Angle.degrees(90)` builds one, `angle.degrees` reads one back. They are different
 * namespaces and do not collide.
 */
export class Angle {
  /**
   * Prefer the named factories; this takes radians, which is rarely the unit at hand.
   *
   * @param {number} radians The angle in radians.
   */
  constructor(radians) {
    /** @type {number} The angle in radians. */
    this.radians = Number(radians);
    Object.freeze(this);
  }

  /**
   * @param {number} value An angle in degrees.
   * @returns {Angle} The angle.
   */
  static degrees(value) { return new Angle((Number(value) * Math.PI) / 180); }

  /**
   * @param {number} value An angle in radians.
   * @returns {Angle} The angle.
   */
  static radians(value) { return new Angle(value); }

  /**
   * @param {number} value A number of full turns, so `0.25` is a right angle.
   * @returns {Angle} The angle.
   */
  static turns(value) { return new Angle(Number(value) * 2 * Math.PI); }

  /**
   * Accepts an Angle or a bare number, which is read as degrees — the unit a person writing
   * a model thinks in.
   *
   * @param {Angle | number} value An angle, or a number of degrees.
   * @returns {Angle} The angle.
   * @throws {TypeError} If the value is neither an Angle nor a number.
   */
  static of(value) {
    if (value instanceof Angle) return value;
    if (typeof value === 'number') return Angle.degrees(value);
    throw new TypeError(`cannot read an angle from ${typeof value}`);
  }

  /** @returns {number} The angle in degrees. */
  get degrees() { return (this.radians * 180) / Math.PI; }

  /**
   * @param {Angle | number} other An angle, or a number of degrees.
   * @returns {Angle} The sum.
   */
  plus(other) { return new Angle(this.radians + Angle.of(other).radians); }

  /**
   * @param {Angle | number} other An angle, or a number of degrees.
   * @returns {Angle} The difference.
   */
  minus(other) { return new Angle(this.radians - Angle.of(other).radians); }

  /**
   * @param {number} factor A plain multiplier, not an angle.
   * @returns {Angle} The scaled angle.
   */
  times(factor) { return new Angle(this.radians * factor); }

  /** @returns {number} The sine of the angle. */
  get sin() { return Math.sin(this.radians); }

  /** @returns {number} The cosine of the angle. */
  get cos() { return Math.cos(this.radians); }

  /** @returns {number} The tangent of the angle. */
  get tan() { return Math.tan(this.radians); }

  /** @returns {string} The angle in degrees, for diagnostics. */
  toString() { return `${this.degrees}°`; }
}

/** Shorthand for {@link Angle.degrees}. */
export const degrees = Angle.degrees;

/** Shorthand for {@link Angle.radians}. */
export const radians = Angle.radians;

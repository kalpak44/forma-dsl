/// An angle, stored in radians and read in whichever unit the caller wants.
///
/// The kernel takes degrees and the trigonometry takes radians, so an unwrapped number
/// would be ambiguous at exactly the call sites where getting it wrong produces a model
/// that is subtly wrong rather than an error.
export class Angle {
  constructor(radians) {
    this.radians = Number(radians);
    Object.freeze(this);
  }

  static degrees(value) { return new Angle((Number(value) * Math.PI) / 180); }
  static radians(value) { return new Angle(value); }
  static turns(value) { return new Angle(Number(value) * 2 * Math.PI); }

  /// Accepts an Angle or a bare number, which is read as degrees — the unit a person
  /// writing a model thinks in.
  static of(value) {
    if (value instanceof Angle) return value;
    if (typeof value === 'number') return Angle.degrees(value);
    throw new TypeError(`cannot read an angle from ${typeof value}`);
  }

  get degrees() { return (this.radians * 180) / Math.PI; }

  plus(other) { return new Angle(this.radians + Angle.of(other).radians); }
  minus(other) { return new Angle(this.radians - Angle.of(other).radians); }
  times(factor) { return new Angle(this.radians * factor); }

  get sin() { return Math.sin(this.radians); }
  get cos() { return Math.cos(this.radians); }
  get tan() { return Math.tan(this.radians); }

  toString() { return `${this.degrees}°`; }
}

export const degrees = Angle.degrees;
export const radians = Angle.radians;

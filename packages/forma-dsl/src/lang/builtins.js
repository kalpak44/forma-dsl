/** @import { AttributeReader, BlockDefinition, Dimensionality, FunctionDefinition, SourceLocation } from '../index.js' */

import { GeometryNode } from '../core/node.js';
import { Transform } from '../values/transform.js';
import { Angle } from '../values/angle.js';
import { FormaError } from './lexer.js';

/**
 * Renders names as a quoted, comma-separated list, for an error message that has to say
 * which ones it means.
 *
 * @param {ReadonlyArray<string>} names The names.
 * @returns {string} The list, each name in double quotes.
 */
export function quoteAll(names) {
  return names.map((name) => `"${name}"`).join(', ');
}

/**
 * The evaluated attributes of one block, read with the type each one is meant to be.
 *
 * Every block reads its attributes through this, so a bad value names the block and the
 * attribute rather than surfacing later as a kernel error about a NaN vertex.
 *
 * Reading through it is also what tracks which attributes were used, so
 * {@link Args#checkUnused} can reject the ones that were not.
 */
export class Args {
  /**
   * @param {string} type The block's name, used in every error message.
   * @param {Record<string, unknown>} values The evaluated attributes.
   * @param {SourceLocation} loc Where the block was written.
   */
  constructor(type, values, loc) {
    /** @type {string} The block's name. */
    this.type = type;
    /** @type {Record<string, unknown>} The evaluated attributes. */
    this.values = values;
    /** @type {SourceLocation} Where the block was written. */
    this.loc = loc;
    /** @type {Set<string>} Which attributes have been read. */
    this.used = new Set();
  }

  /**
   * Tests for an attribute without marking it used, so a block can branch on which of two
   * spellings was given and still reject the one it did not read.
   *
   * @param {string} name The attribute.
   * @returns {boolean} Whether it was given.
   */
  has(name) { return this.values[name] !== undefined; }

  /**
   * @param {string} name The attribute.
   * @param {unknown} [fallback] Used when the attribute was not given.
   * @returns {unknown} The value, unchecked.
   */
  raw(name, fallback) {
    this.used.add(name);
    const value = this.values[name];
    return value === undefined ? fallback : value;
  }

  /**
   * @param {string} name The attribute.
   * @param {string} expected What it should have been, phrased to follow "must be".
   * @returns {never} Never returns.
   * @throws {FormaError} Always.
   */
  fail(name, expected) {
    throw new FormaError(`${this.type}: "${name}" must be ${expected}`, this.loc);
  }

  /**
   * @param {string} name The attribute.
   * @param {number} [fallback] Used when the attribute was not given.
   * @returns {number} The value.
   * @throws {FormaError} If it is not a finite number.
   */
  number(name, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(name, 'a finite number');
    return /** @type {number} */ (value);
  }

  /**
   * @param {string} name The attribute.
   * @returns {number | undefined} The value, or undefined when it was not given.
   * @throws {FormaError} If it was given but is not a finite number.
   */
  optionalNumber(name) {
    return this.has(name) ? this.number(name) : undefined;
  }

  /**
   * @param {string} name The attribute.
   * @param {number} [fallback] Used when the attribute was not given.
   * @returns {number} The value.
   * @throws {FormaError} If it is not a whole finite number.
   */
  int(name, fallback) {
    const value = this.number(name, fallback);
    if (!Number.isInteger(value)) this.fail(name, 'a whole number');
    return value;
  }

  /**
   * @param {string} name The attribute.
   * @param {boolean} [fallback] Used when the attribute was not given.
   * @returns {boolean} The value.
   * @throws {FormaError} If it is not a boolean.
   */
  bool(name, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value !== 'boolean') this.fail(name, 'true or false');
    return /** @type {boolean} */ (value);
  }

  /**
   * @param {string} name The attribute.
   * @param {string} [fallback] Used when the attribute was not given.
   * @returns {string} The value.
   * @throws {FormaError} If it is not a string.
   */
  string(name, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value !== 'string') this.fail(name, 'a string');
    return /** @type {string} */ (value);
  }

  /**
   * @param {string} name The attribute.
   * @param {ReadonlyArray<string>} allowed The accepted values.
   * @param {string} [fallback] Used when the attribute was not given.
   * @returns {string} The value.
   * @throws {FormaError} If it is not one of the accepted values.
   */
  enum(name, allowed, fallback) {
    const value = this.string(name, fallback);
    if (!allowed.includes(value)) {
      this.fail(name, `one of ${quoteAll(allowed)}`);
    }
    return value;
  }

  /**
   * Reads a vector attribute, accepting a single number as shorthand for every component,
   * which is what makes `scale { factor = 2 }` read naturally beside `factor = [2, 1, 1]`.
   *
   * @param {string} name The attribute.
   * @param {Dimensionality} dim How many components are wanted.
   * @param {number | ReadonlyArray<number>} [fallback] Used when the attribute was not given.
   * @returns {number[]} The components.
   * @throws {FormaError} If it is neither a number nor an array of the right length.
   */
  vector(name, dim, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value === 'number') return new Array(dim).fill(value);
    if (Array.isArray(value) && value.length === dim && value.every((v) => typeof v === 'number')) {
      return value.map(Number);
    }
    return this.fail(name, `a number or an array of ${dim} numbers`);
  }

  /**
   * @param {string} name The attribute.
   * @param {Angle | number} [fallback] Used when the attribute was not given.
   * @returns {Angle} The angle; a bare number is read as degrees.
   * @throws {FormaError} If it is neither an angle nor a number.
   */
  angle(name, fallback) {
    const value = this.raw(name, fallback);
    if (value instanceof Angle) return value;
    if (typeof value === 'number') return Angle.degrees(value);
    return this.fail(name, 'an angle in degrees');
  }

  /**
   * Rejects anything the block did not read.
   *
   * A misspelled attribute is otherwise silent, and the model renders subtly wrong with
   * nothing to point at.
   *
   * @returns {void}
   * @throws {FormaError} If any attribute went unread.
   */
  checkUnused() {
    const extra = Object.keys(this.values).filter((k) => !this.used.has(k));
    if (extra.length) {
      const plural = extra.length > 1 ? 's' : '';
      throw new FormaError(`${this.type}: unknown attribute${plural} ${quoteAll(extra)}`, this.loc);
    }
  }
}

/**
 * Reads a radius written either way.
 *
 * `radius = 5` and `diameter = 10` are the same circle; accepting both and refusing both at
 * once keeps a model from silently preferring one.
 *
 * @param {AttributeReader} args The block's attributes.
 * @param {number} [fallback] Used when neither was given.
 * @returns {number} The radius.
 * @throws {FormaError} If both spellings were given.
 */
function radiusOf(args, fallback) {
  if (args.has('radius') && args.has('diameter')) {
    throw new FormaError(`${args.type}: give either "radius" or "diameter", not both`, args.loc);
  }
  if (args.has('diameter')) return args.number('diameter') / 2;
  return args.number('radius', fallback);
}

// --- shape construction --------------------------------------------------------------

/**
 * The corners of a regular polygon, centred on the origin.
 *
 * @param {number} sides How many sides.
 * @param {number} radius Distance from the centre to a corner.
 * @param {number} rotation Where the first corner sits, in radians.
 * @returns {number[][]} The corners, counter-clockwise.
 */
function regularPolygonPoints(sides, radius, rotation) {
  const points = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (2 * Math.PI * i) / sides;
    points.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return points;
}

/**
 * A rectangle with rounded corners, centred on the origin.
 *
 * Built by shrinking the rectangle and offsetting it back out, because the offset is what
 * produces a true arc at each corner. The radius is clamped so it cannot exceed half the
 * shorter side and invert the shape.
 *
 * @param {ReadonlyArray<number>} size Width and height.
 * @param {number} radius Corner radius.
 * @param {number} segments How many segments per corner; 0 asks the kernel to choose.
 * @returns {GeometryNode} The rounded rectangle.
 */
function roundedRect(size, radius, segments) {
  const [w, h] = size;
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return GeometryNode.shape(2, 'rect', { size: [w, h], center: true });
  const inner = GeometryNode.shape(2, 'rect', { size: [w - 2 * r, h - 2 * r], center: true });
  return GeometryNode.unary('offset', inner, {
    amount: r, joinType: 'Round', miterLimit: 2, segments,
  });
}

/**
 * Moves a shape built around the origin so it sits in the positive quadrant instead, unless
 * the block asked to keep it centred.
 *
 * @param {GeometryNode} node The centred shape.
 * @param {AttributeReader} args The block's attributes, read for `center`.
 * @param {ReadonlyArray<number>} size The shape's width and height.
 * @returns {GeometryNode} The shape, placed.
 */
function placed(node, args, size) {
  return args.bool('center', false)
    ? node
    : GeometryNode.transformed(node, Transform.translation([size[0] / 2, size[1] / 2], 2));
}

/**
 * Every block the language understands, by name.
 *
 * `dim` is the block's output dimensionality; `takes` is what its children must be. An
 * operation that says `takes: 'same'` passes its children's dimensionality through, which is
 * what lets translate and hull work unchanged in 2D and 3D.
 *
 * @type {Record<string, BlockDefinition>}
 */
export const BLOCKS = {
  // 2D shapes
  rect: {
    dim: 2, leaf: true,
    build: (a) => GeometryNode.shape(2, 'rect', {
      size: a.vector('size', 2), center: a.bool('center', false),
    }),
  },
  rounded_rect: {
    dim: 2, leaf: true,
    build: (a) => {
      const size = a.vector('size', 2);
      return placed(roundedRect(size, a.number('radius', 1), a.int('segments', 0)), a, size);
    },
  },
  circle: {
    dim: 2, leaf: true,
    build: (a) => GeometryNode.shape(2, 'circle', {
      radius: radiusOf(a, 1), segments: a.int('segments', 0),
    }),
  },
  ellipse: {
    dim: 2, leaf: true,
    build: (a) => {
      // A scaled unit circle, so the two radii stay exact rather than being approximated.
      const radii = a.vector('radii', 2);
      const unit = GeometryNode.shape(2, 'circle', { radius: 1, segments: a.int('segments', 0) });
      return GeometryNode.transformed(unit, Transform.scaling(radii, 2));
    },
  },
  regular_polygon: {
    dim: 2, leaf: true,
    build: (a) => {
      const sides = a.int('sides');
      if (sides < 3) a.fail('sides', 'at least 3');
      // Across-flats is the measurement a hex key or a nut is specified by, so it is worth
      // accepting directly rather than making every model divide by cos(pi/n).
      let radius;
      if (a.has('width_across_flats')) radius = a.number('width_across_flats') / 2 / Math.cos(Math.PI / sides);
      else if (a.has('width_across_corners')) radius = a.number('width_across_corners') / 2;
      else radius = radiusOf(a, 1);
      const rotation = a.angle('rotation', 0).radians;
      return GeometryNode.shape(2, 'polygon', {
        contours: [regularPolygonPoints(sides, radius, rotation)], fillRule: 'NonZero',
      });
    },
  },
  stadium: {
    dim: 2, leaf: true,
    build: (a) => {
      // Fully rounded on the short axis, which is what makes it a stadium rather than a
      // rounded rectangle that happens to look like one.
      const size = a.vector('size', 2);
      const r = Math.min(size[0], size[1]) / 2;
      return placed(roundedRect(size, r, a.int('segments', 0)), a, size);
    },
  },
  polygon: {
    dim: 2, leaf: true,
    build: (a) => {
      const points = a.raw('points');
      if (!Array.isArray(points) || points.length < 3) a.fail('points', 'an array of at least 3 points');
      // One contour or several: a nested array is read as a list of contours, so a shape
      // with a hole in it can be written without a separate difference.
      const contours = Array.isArray(points[0][0]) ? points : [points];
      return GeometryNode.shape(2, 'polygon', {
        contours,
        fillRule: a.enum('fill_rule', ['EvenOdd', 'NonZero', 'Positive', 'Negative'], 'NonZero'),
      });
    },
  },

  // 3D shapes
  box: {
    dim: 3, leaf: true,
    build: (a) => GeometryNode.shape(3, 'box', {
      size: a.vector('size', 3), center: a.bool('center', false),
    }),
  },
  sphere: {
    dim: 3, leaf: true,
    build: (a) => GeometryNode.shape(3, 'sphere', {
      radius: radiusOf(a, 1), segments: a.int('segments', 0),
    }),
  },
  cylinder: {
    dim: 3, leaf: true,
    build: (a) => {
      // One radius for a plain cylinder, or two for a frustum; mixing them is the error.
      const base = a.has('radius') || a.has('diameter') ? radiusOf(a, 1) : undefined;
      const bottom = a.optionalNumber('bottom_radius') ?? base;
      const top = a.optionalNumber('top_radius') ?? base;
      if (bottom === undefined || top === undefined) {
        throw new FormaError('cylinder: give "radius"/"diameter", or both "bottom_radius" and "top_radius"', a.loc);
      }
      return GeometryNode.shape(3, 'cylinder', {
        height: a.number('height'), bottomRadius: bottom, topRadius: top,
        segments: a.int('segments', 0), center: a.bool('center', false),
      });
    },
  },
  cone: {
    dim: 3, leaf: true,
    build: (a) => GeometryNode.shape(3, 'cylinder', {
      height: a.number('height'), bottomRadius: radiusOf(a, 1),
      topRadius: a.number('top_radius', 0), segments: a.int('segments', 0),
      center: a.bool('center', false),
    }),
  },
  torus: {
    dim: 3, leaf: true,
    build: (a) => {
      // A circle pushed out to the ring radius and revolved, which is what a torus is.
      const ring = a.number('radius');
      const tube = a.number('tube_radius');
      const section = GeometryNode.transformed(
        GeometryNode.shape(2, 'circle', { radius: tube, segments: a.int('tube_segments', 0) }),
        Transform.translation([ring, 0], 2),
      );
      return GeometryNode.unary('revolve', section,
        { degrees: a.angle('angle', 360).degrees, segments: a.int('segments', 0) }, 3);
    },
  },

  // Booleans
  union: { takes: 'same', combine: 'list', build: (a, children) => GeometryNode.union(children) },
  difference: { takes: 'same', combine: 'list', build: (a, children) => GeometryNode.difference(children) },
  intersection: { takes: 'same', combine: 'list', build: (a, children) => GeometryNode.intersection(children) },

  // Transforms
  translate: {
    takes: 'same',
    build: (a, child) => GeometryNode.transformed(child, Transform.translation(a.vector('offset', child.dim), child.dim)),
  },
  rotate: {
    takes: 'same',
    build: (a, child) => {
      if (child.dim === 2) {
        return GeometryNode.transformed(child, Transform.rotation2D(a.angle('angle')));
      }
      // `angles = [x, y, z]` or the axes named one at a time; both read naturally depending
      // on whether the model is turning about one axis or several.
      const angles = a.has('angles') ? a.vector('angles', 3) : [a.number('x', 0), a.number('y', 0), a.number('z', 0)];
      return GeometryNode.transformed(child, Transform.rotation3D(angles));
    },
  },
  scale: {
    takes: 'same',
    build: (a, child) => GeometryNode.transformed(child, Transform.scaling(a.vector('factor', child.dim), child.dim)),
  },
  mirror: {
    takes: 'same',
    build: (a, child) => GeometryNode.transformed(child, Transform.mirroring(a.vector('normal', child.dim), child.dim)),
  },

  // 2D → 3D
  extrude: {
    dim: 3, takes: 2,
    build: (a, child) => GeometryNode.unary('extrude', child, {
      height: a.number('height'),
      twist: a.angle('twist', 0).degrees,
      divisions: a.int('divisions', 0),
      scaleTop: a.vector('scale_top', 2, 1),
      center: a.bool('center', false),
    }, 3),
  },
  revolve: {
    dim: 3, takes: 2,
    build: (a, child) => GeometryNode.unary('revolve', child, {
      degrees: a.angle('angle', 360).degrees, segments: a.int('segments', 0),
    }, 3),
  },

  // 3D → 2D
  project: { dim: 2, takes: 3, build: (a, child) => GeometryNode.unary('projection', child, { type: 'full' }, 2) },
  slice: { dim: 2, takes: 3, build: (a, child) => GeometryNode.unary('projection', child, { type: 'slice', z: a.number('z', 0) }, 2) },

  // Refinement
  offset: {
    takes: 2,
    build: (a, child) => GeometryNode.unary('offset', child, {
      amount: a.number('amount'),
      joinType: a.enum('join', ['Square', 'Round', 'Miter'], 'Round'),
      miterLimit: a.number('miter_limit', 2),
      segments: a.int('segments', 0),
    }),
  },
  hull: { takes: 'same', build: (a, child) => GeometryNode.unary('hull', child) },
  refine: { takes: 3, build: (a, child) => GeometryNode.unary('refine', child, { edgeLength: a.number('edge_length') }) },
  simplify: { takes: 'same', build: (a, child) => GeometryNode.unary('simplify', child, { tolerance: a.number('tolerance', 1e-6) }) },
  smooth: {
    takes: 3,
    build: (a, child) => GeometryNode.unary('smooth', child, {
      minSharpAngle: a.number('min_sharp_angle', 60), minSmoothness: a.number('min_smoothness', 0),
    }),
  },
  trim: {
    takes: 3,
    build: (a, child) => GeometryNode.unary('trim', child, {
      normal: a.vector('normal', 3), offset: a.number('offset', 0),
    }),
  },
};

// --- expression functions --------------------------------------------------------------

/**
 * Wraps a plain numeric function as a builtin.
 *
 * @param {string} name What the language calls it.
 * @param {(...args: number[]) => number} f The implementation.
 * @param {number} [arity] How many arguments it takes.
 * @returns {[string, FunctionDefinition]} An entry for the registry.
 */
const numeric = (name, f, arity = 1) => [name, { arity, call: (args) => f(...args) }];

/**
 * How many values `range` will produce before giving up.
 *
 * Guarded rather than trusted: `range(0, 1e9)` would otherwise allocate until the tab dies,
 * and in a live editor that is every keystroke while the number is being typed.
 */
const MAX_RANGE = 100000;

/** @type {Record<string, FunctionDefinition>} */
export const FUNCTIONS = Object.fromEntries([
  numeric('abs', Math.abs), numeric('floor', Math.floor), numeric('ceil', Math.ceil),
  numeric('round', Math.round), numeric('sqrt', Math.sqrt), numeric('sign', Math.sign),
  numeric('pow', Math.pow, 2), numeric('atan2', Math.atan2, 2),
  numeric('log', Math.log), numeric('exp', Math.exp),
  // Trigonometry takes and returns degrees, because every angle a model writes is in
  // degrees and a stray radian conversion is invisible until the part is printed.
  numeric('sin', (d) => Math.sin((d * Math.PI) / 180)),
  numeric('cos', (d) => Math.cos((d * Math.PI) / 180)),
  numeric('tan', (d) => Math.tan((d * Math.PI) / 180)),
  numeric('asin', (v) => (Math.asin(v) * 180) / Math.PI),
  numeric('acos', (v) => (Math.acos(v) * 180) / Math.PI),
  numeric('atan', (v) => (Math.atan(v) * 180) / Math.PI),
  // The variadic ones flatten, so `max(sizes)` and `max(a, b)` both work.
  ['min', { arity: null, call: (args) => Math.min(...args.flat()) }],
  ['max', { arity: null, call: (args) => Math.max(...args.flat()) }],
  ['sum', { arity: null, call: (args) => args.flat().reduce((a, b) => a + b, 0) }],
  ['len', { arity: 1, call: ([v]) => (Array.isArray(v) || typeof v === 'string' ? v.length : 0) }],
  ['concat', { arity: null, call: (args) => args.flat() }],
  ['reverse', { arity: 1, call: ([v]) => [...v].reverse() }],
  ['contains', { arity: 2, call: ([list, v]) => list.includes(v) }],
  ['join', { arity: 2, call: ([sep, list]) => list.join(sep) }],
  ['str', { arity: 1, call: ([v]) => String(v) }],
  ['num', { arity: 1, call: ([v]) => Number(v) }],
  ['range', { arity: null, call: (args) => range(args) }],
]);

/**
 * Builds a list of numbers, as `range(end)`, `range(start, end)` or `range(start, end, step)`.
 *
 * A backwards range is empty rather than infinite, which is what a loop written around a
 * parameter needs when the parameter crosses zero.
 *
 * @param {number[]} args The arguments as written.
 * @returns {number[]} The values, excluding the end.
 * @throws {FormaError} If the step is zero, or the range would exceed {@link MAX_RANGE}.
 */
function range(args) {
  const [start, end, step] = args.length === 1 ? [0, args[0], 1] : [args[0], args[1], args[2] ?? 1];
  if (step === 0) throw new FormaError('range: step cannot be 0');

  const out = [];
  for (let v = start; step > 0 ? v < end : v > end; v += step) {
    out.push(v);
    if (out.length > MAX_RANGE) throw new FormaError(`range: more than ${MAX_RANGE} values`);
  }
  return out;
}

/** Names that stand for a fixed number. */
export const CONSTANTS = { pi: Math.PI, e: Math.E };

/**
 * Type names are ordinary identifiers that stand for themselves, so `type = number` in a
 * param block needs no keyword and no quoting — the same trade Terraform makes.
 */
export const TYPE_NAMES = ['number', 'string', 'bool', 'vector', 'list', 'angle'];

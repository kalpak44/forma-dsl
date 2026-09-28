import { GeometryNode } from '../core/node.js';
import { Transform } from '../values/transform.js';
import { Angle } from '../values/angle.js';
import { FormaError } from './lexer.js';

// --- attribute reading ---------------------------------------------------------------
// Every block reads its attributes through these, so a bad value names the block and the
// attribute rather than surfacing later as a kernel error about a NaN vertex.

export class Args {
  constructor(type, values, loc) {
    this.type = type;
    this.values = values;
    this.loc = loc;
    this.used = new Set();
  }

  has(name) { return this.values[name] !== undefined; }

  raw(name, fallback) {
    this.used.add(name);
    const value = this.values[name];
    return value === undefined ? fallback : value;
  }

  fail(name, expected) {
    throw new FormaError(`${this.type}: "${name}" must be ${expected}`, this.loc);
  }

  number(name, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value !== 'number' || !Number.isFinite(value)) this.fail(name, 'a finite number');
    return value;
  }

  optionalNumber(name) {
    return this.has(name) ? this.number(name) : undefined;
  }

  int(name, fallback) {
    const value = this.number(name, fallback);
    if (!Number.isInteger(value)) this.fail(name, 'a whole number');
    return value;
  }

  bool(name, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value !== 'boolean') this.fail(name, 'true or false');
    return value;
  }

  string(name, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value !== 'string') this.fail(name, 'a string');
    return value;
  }

  enum(name, allowed, fallback) {
    const value = this.string(name, fallback);
    if (!allowed.includes(value)) {
      this.fail(name, `one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
    }
    return value;
  }

  /// A vector attribute accepts a single number as shorthand for every component, which is
  /// what makes `scale { factor = 2 }` read naturally beside `factor = [2, 1, 1]`.
  vector(name, dim, fallback) {
    const value = this.raw(name, fallback);
    if (typeof value === 'number') return new Array(dim).fill(value);
    if (Array.isArray(value) && value.length === dim && value.every((v) => typeof v === 'number')) {
      return value.map(Number);
    }
    this.fail(name, `a number or an array of ${dim} numbers`);
  }

  angle(name, fallback) {
    const value = this.raw(name, fallback);
    if (value instanceof Angle) return value;
    if (typeof value === 'number') return Angle.degrees(value);
    this.fail(name, 'an angle in degrees');
  }

  /// Rejects anything the block does not read. A misspelled attribute is otherwise silent,
  /// and the model renders subtly wrong with nothing to point at.
  checkUnused() {
    const extra = Object.keys(this.values).filter((k) => !this.used.has(k));
    if (extra.length) {
      throw new FormaError(`${this.type}: unknown attribute${extra.length > 1 ? 's' : ''} ${extra.map((e) => `"${e}"`).join(', ')}`, this.loc);
    }
  }
}

/// `radius = 5` and `diameter = 10` are the same circle; accepting both and refusing both
/// at once keeps a model from silently preferring one.
function radiusOf(args, fallback) {
  if (args.has('radius') && args.has('diameter')) {
    throw new FormaError(`${args.type}: give either "radius" or "diameter", not both`, args.loc);
  }
  if (args.has('diameter')) return args.number('diameter') / 2;
  return args.number('radius', fallback);
}

// --- shape construction --------------------------------------------------------------

function regularPolygonPoints(sides, radius, rotation) {
  const points = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (2 * Math.PI * i) / sides;
    points.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return points;
}

function roundedRect(size, radius, segments) {
  const [w, h] = size;
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return GeometryNode.shape(2, 'rect', { size: [w, h], center: true });
  const inner = GeometryNode.shape(2, 'rect', { size: [w - 2 * r, h - 2 * r], center: true });
  return GeometryNode.unary('offset', inner, {
    amount: r, joinType: 'Round', miterLimit: 2, segments,
  });
}

// --- the block registry ---------------------------------------------------------------
//
// `dim` is the block's output dimensionality; `takes` is what its children must be. An
// operation that says `takes: 'same'` passes its children's dimensionality through, which
// is what lets translate and hull work unchanged in 2D and 3D.

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
      const node = roundedRect(size, a.number('radius', 1), a.int('segments', 0));
      return a.bool('center', false)
        ? node
        : GeometryNode.transformed(node, Transform.translation([size[0] / 2, size[1] / 2], 2));
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
      const [w, h] = a.vector('size', 2);
      const r = Math.min(w, h) / 2;
      const node = roundedRect([w, h], r, a.int('segments', 0));
      return a.bool('center', false)
        ? node
        : GeometryNode.transformed(node, Transform.translation([w / 2, h / 2], 2));
    },
  },
  polygon: {
    dim: 2, leaf: true,
    build: (a) => {
      const points = a.raw('points');
      if (!Array.isArray(points) || points.length < 3) a.fail('points', 'an array of at least 3 points');
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

const numeric = (name, f, arity = 1) => [name, { arity, call: (args) => f(...args) }];

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
  ['range', {
    arity: null,
    call: (args) => {
      const [a, b, step] = args.length === 1 ? [0, args[0], 1] : [args[0], args[1], args[2] ?? 1];
      if (step === 0) throw new FormaError('range: step cannot be 0');
      const out = [];
      // Guarded rather than trusted: `range(0, 10, -1)` would otherwise allocate until the
      // tab dies, and in a live editor that is every keystroke while typing the minus.
      for (let v = a; step > 0 ? v < b : v > b; v += step) {
        out.push(v);
        if (out.length > 100000) throw new FormaError('range: more than 100000 values');
      }
      return out;
    },
  }],
]);

export const CONSTANTS = { pi: Math.PI, e: Math.E };

/// Type names are ordinary identifiers that stand for themselves, so `type = number` in a
/// param block needs no keyword and no quoting — the same trade Terraform makes.
export const TYPE_NAMES = ['number', 'string', 'bool', 'vector', 'list', 'angle'];

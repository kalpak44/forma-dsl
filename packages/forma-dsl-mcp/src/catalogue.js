/**
 * What the server knows about every construct in the language.
 *
 * The descriptions and the attribute tables are written here; the structural facts — which
 * blocks exist, what dimensionality each produces and takes, which functions exist and with
 * what arity — are read from the package's own registries at load time and merged in. Where
 * the two disagree, the registry wins and `catalogueDrift` says so, which is what
 * `test/catalogue.test.js` asserts is empty. A block added to the language therefore cannot
 * ship without this file learning about it.
 */
/** @import { BlockDefinition } from 'forma-dsl' */

import { BLOCKS, CONSTANTS, FUNCTIONS } from 'forma-dsl';

/**
 * @typedef {object} Attribute
 * @property {string} name How it is written.
 * @property {string} type What kind of value it takes.
 * @property {string} [default] The value used when it is not given, or `required`.
 * @property {string[]} [values] The accepted values, for an enum.
 * @property {string} description What it does.
 */

/**
 * @typedef {object} Entry
 * @property {string} name The block's name.
 * @property {string} group Which section of the language it belongs to.
 * @property {string} summary One line, for a listing.
 * @property {Attribute[]} attributes What it accepts.
 * @property {string} example A snippet that renders.
 * @property {string[]} [notes] The things that surprise people.
 * @property {2 | 3} [dim] Output dimensionality, where it is fixed.
 * @property {2 | 3 | 'same'} [takes] What its children must be.
 * @property {boolean} [leaf] True for a shape, which takes no children.
 * @property {boolean} [ordered] True where the order of children changes the result.
 */

/** A vector attribute sized by whatever the children are. */
const SAME_VECTOR = 'vector matching the children (2 numbers in 2D, 3 in 3D)';

/** The `center` attribute, which several shapes share verbatim. */
const CENTER = {
  name: 'center', type: 'bool', default: 'false',
  description: 'true centres the shape on the origin; otherwise its minimum corner sits there',
};

/** The `segments` attribute, which every curved shape shares verbatim. */
const SEGMENTS = {
  name: 'segments', type: 'integer', default: '0',
  description: 'Straight edges used to approximate the curve; 0 lets the kernel decide',
};

/**
 * Every block, described.
 *
 * @type {Entry[]}
 */
const BLOCK_ENTRIES = [
  // --- 2D shapes ------------------------------------------------------------------------
  {
    name: 'rect', group: '2D shapes', summary: 'An axis-aligned rectangle.',
    attributes: [
      { name: 'size', type: '2-vector', default: 'required', description: 'Width and height' },
      CENTER,
    ],
    example: 'rect { size = [40, 20]  center = true }',
  },
  {
    name: 'rounded_rect', group: '2D shapes',
    summary: 'A rectangle with true arcs at the corners.',
    attributes: [
      {
        name: 'size', type: '2-vector', default: 'required',
        description: 'Width and height, measured over the rounded corners',
      },
      {
        name: 'radius', type: 'number', default: '1',
        description: 'Corner radius, clamped to half the shorter side so it cannot invert',
      },
      { ...SEGMENTS, description: 'Segments per corner arc; 0 lets the kernel decide' },
      CENTER,
    ],
    example: 'rounded_rect { size = [62, 13]  radius = 6.5  center = true }',
    notes: ['`rounded_rect { size = [10, 10]  radius = 5 }` is a circle of diameter 10 — `size` is the outer size.'],
  },
  {
    name: 'circle', group: '2D shapes', summary: 'A circle, from a radius or a diameter.',
    attributes: [
      { name: 'radius', type: 'number', default: '1', description: 'Centre to edge' },
      { name: 'diameter', type: 'number', description: 'An alternative spelling of the same thing' },
      SEGMENTS,
    ],
    example: 'circle { diameter = 24  segments = 64 }',
    notes: [
      'Give `radius` or `diameter`, never both.',
      'Always centred; there is no `center` attribute.',
    ],
  },
  {
    name: 'ellipse', group: '2D shapes', summary: 'A circle scaled to two exact radii.',
    attributes: [
      { name: 'radii', type: '2-vector', default: 'required', description: 'Semi-axes along X and Y' },
      { ...SEGMENTS, description: 'Segments around the unit circle before it is scaled' },
    ],
    example: 'ellipse { radii = [30, 18] }',
    notes: ['Always centred; there is no `center` attribute.'],
  },
  {
    name: 'regular_polygon', group: '2D shapes',
    summary: 'An n-gon, sized across flats, across corners, or by radius.',
    attributes: [
      { name: 'sides', type: 'integer', default: 'required', description: 'At least 3' },
      {
        name: 'width_across_flats', type: 'number',
        description: 'Distance between opposite flats — how a nut or a hex key is specified',
      },
      { name: 'width_across_corners', type: 'number', description: 'Distance between opposite corners' },
      { name: 'radius', type: 'number', default: '1', description: 'Centre to corner' },
      { name: 'diameter', type: 'number', description: 'Twice the radius' },
      {
        name: 'rotation', type: 'angle', default: '0',
        description: 'Where the first corner sits, in degrees',
      },
    ],
    example: 'regular_polygon { sides = 6  width_across_flats = 5.5 }',
    notes: ['A hexagon with no `rotation` has a corner on +X, not a flat. Add `rotation = 30` to turn a flat to the front.'],
  },
  {
    name: 'stadium', group: '2D shapes',
    summary: 'A rectangle fully rounded on its short axis.',
    attributes: [
      {
        name: 'size', type: '2-vector', default: 'required',
        description: 'Width and height, over the rounded ends',
      },
      { ...SEGMENTS, description: 'Segments per end arc' },
      CENTER,
    ],
    example: 'stadium { size = [30, 6]  center = true }',
  },
  {
    name: 'polygon', group: '2D shapes',
    summary: 'An explicit outline, or several contours with holes.',
    attributes: [
      {
        name: 'points', type: 'list', default: 'required',
        description: 'A list of [x, y] points, or a list of such lists for several contours',
      },
      {
        name: 'fill_rule', type: 'enum', default: '"NonZero"',
        values: ['EvenOdd', 'NonZero', 'Positive', 'Negative'],
        description: 'How overlapping contours are resolved',
      },
    ],
    example: 'polygon { points = [[0, 0], [26, 0], [24, 6], [0, 74]] }',
    notes: ['At least 3 points. A nested list is read as several contours, which is how a hole is written without a `difference`.'],
  },

  // --- 3D shapes ------------------------------------------------------------------------
  {
    name: 'box', group: '3D shapes', summary: 'An axis-aligned cuboid.',
    attributes: [
      { name: 'size', type: '3-vector', default: 'required', description: 'X, Y and Z extents' },
      CENTER,
    ],
    example: 'box { size = [40, 20, 10]  center = true }',
  },
  {
    name: 'sphere', group: '3D shapes', summary: 'A sphere, centred on the origin.',
    attributes: [
      { name: 'radius', type: 'number', default: '1', description: 'Centre to surface' },
      { name: 'diameter', type: 'number', description: 'An alternative spelling of the same thing' },
      { ...SEGMENTS, description: 'Segments around the equator; 0 lets the kernel decide' },
    ],
    example: 'sphere { radius = 12  segments = 48 }',
    notes: ['Give `radius` or `diameter`, never both.'],
  },
  {
    name: 'cylinder', group: '3D shapes', summary: 'A cylinder, or a frustum from two radii.',
    attributes: [
      { name: 'height', type: 'number', default: 'required', description: 'Along Z' },
      { name: 'radius', type: 'number', description: 'Both ends alike' },
      { name: 'diameter', type: 'number', description: 'An alternative spelling of `radius`' },
      { name: 'bottom_radius', type: 'number', description: 'The end at Z = 0' },
      { name: 'top_radius', type: 'number', description: 'The end at Z = height' },
      SEGMENTS,
      {
        ...CENTER,
        description: 'true centres it on Z = 0; otherwise it stands on the XY plane',
      },
    ],
    example: 'cylinder { radius = 5  height = 20 }',
    notes: ['Give `radius`/`diameter`, or both `bottom_radius` and `top_radius`. One end radius on its own is an error.'],
  },
  {
    name: 'cone', group: '3D shapes', summary: 'A cone, or a truncated cone.',
    attributes: [
      { name: 'height', type: 'number', default: 'required', description: 'Along Z' },
      { name: 'radius', type: 'number', default: '1', description: 'The base, at Z = 0' },
      { name: 'diameter', type: 'number', description: 'An alternative spelling of `radius`' },
      { name: 'top_radius', type: 'number', default: '0', description: '0 gives a point' },
      SEGMENTS,
      { ...CENTER, description: 'As for `cylinder`' },
    ],
    example: 'cone { radius = 10  height = 25 }',
  },
  {
    name: 'torus', group: '3D shapes', summary: 'A ring, optionally a partial arc.',
    attributes: [
      {
        name: 'radius', type: 'number', default: 'required',
        description: 'Centre of the ring to centre of the tube',
      },
      {
        name: 'tube_radius', type: 'number', default: 'required',
        description: 'Radius of the tube itself',
      },
      { name: 'angle', type: 'angle', default: '360', description: 'How far round to sweep, in degrees' },
      { ...SEGMENTS, description: 'Segments around the ring' },
      {
        name: 'tube_segments', type: 'integer', default: '0',
        description: "Segments around the tube's cross-section",
      },
    ],
    example: 'torus { radius = 20  tube_radius = 4 }',
    notes: ['The outer radius of the result is `radius + tube_radius`.'],
  },

  // --- booleans -------------------------------------------------------------------------
  {
    name: 'union', group: 'Booleans', summary: 'Everything added together.',
    attributes: [],
    example: 'union { box { size = [10, 10, 10] }  sphere { radius = 7 } }',
    notes: ['Rarely needed: several children in a row are unioned anyway. Write it when the grouping makes the document read better.'],
  },
  {
    name: 'difference', group: 'Booleans', ordered: true,
    summary: 'The first child, with every later child cut out of it.',
    attributes: [],
    example: 'difference {\n  box { size = [20, 20, 10] }\n  cylinder { radius = 5  height = 30 }\n}',
    notes: [
      'The only block where the order of children matters.',
      'A cutter should overshoot the body at both ends, or the coincident faces make a zero-thickness skin.',
    ],
  },
  {
    name: 'intersection', group: 'Booleans', summary: 'Only what every child shares.',
    attributes: [],
    example: 'intersection { sphere { radius = 10 }  box { size = [14, 14, 14]  center = true } }',
  },

  // --- transforms -----------------------------------------------------------------------
  {
    name: 'translate', group: 'Transforms', summary: 'Moves geometry.',
    attributes: [
      {
        name: 'offset', type: SAME_VECTOR, default: 'required',
        description: 'How far to move along each axis',
      },
    ],
    example: 'translate { offset = [0, 0, 10]  box { size = [4, 4, 4] } }',
  },
  {
    name: 'rotate', group: 'Transforms', summary: 'Turns geometry about the origin.',
    attributes: [
      { name: 'angles', type: '3-vector', description: '3D only. Degrees about X, Y and Z at once' },
      { name: 'x', type: 'number', default: '0', description: '3D only. Degrees about X' },
      { name: 'y', type: 'number', default: '0', description: '3D only. Degrees about Y' },
      { name: 'z', type: 'number', default: '0', description: '3D only. Degrees about Z' },
      {
        name: 'angle', type: 'angle', default: 'required',
        description: '2D only. Degrees, counter-clockwise',
      },
    ],
    example: 'rotate { z = 45  box { size = [20, 4, 4] } }',
    notes: [
      '3D rotations apply X, then Y, then Z, matching OpenSCAD.',
      'Rotation is about the origin, not about the shape. Centre it first, or translate afterwards.',
      '`angle` is the 2D spelling and `x`/`y`/`z`/`angles` are the 3D ones. Using the wrong one is `rotate: unknown attribute`.',
    ],
  },
  {
    name: 'scale', group: 'Transforms', summary: 'Scales geometry about the origin.',
    attributes: [
      {
        name: 'factor', type: SAME_VECTOR, default: 'required',
        description: 'Multiplier per axis. A single number scales every axis alike',
      },
    ],
    example: 'scale { factor = [1, 1, 2]  sphere { radius = 10 } }',
  },
  {
    name: 'mirror', group: 'Transforms',
    summary: 'Reflects geometry in a plane through the origin.',
    attributes: [
      {
        name: 'normal', type: SAME_VECTOR, default: 'required',
        description: 'Normal of the mirror plane; normalised first, so its length does not matter',
      },
    ],
    example: 'mirror { normal = [1, 0, 0]  bracket { } }',
    notes: ['A mirror replaces the geometry rather than adding to it. For a symmetric pair, union the original with the mirrored copy.'],
  },

  // --- 2D <-> 3D ------------------------------------------------------------------------
  {
    name: 'extrude', group: '2D to 3D',
    summary: 'Sweeps a 2D profile along +Z, with optional twist and taper.',
    attributes: [
      { name: 'height', type: 'number', default: 'required', description: 'How far to sweep, along +Z' },
      { name: 'twist', type: 'angle', default: '0', description: 'Degrees of rotation from bottom to top' },
      {
        name: 'scale_top', type: '2-vector', default: '1',
        description: 'Size of the top face relative to the bottom; a single number scales both axes',
      },
      {
        name: 'divisions', type: 'integer', default: '0',
        description: 'Intermediate layers, needed for a smooth twist or taper',
      },
      {
        ...CENTER,
        description: 'true centres the result on Z = 0; otherwise it stands on the XY plane',
      },
    ],
    example: 'extrude { height = 20  rounded_rect { size = [40, 20]  radius = 4  center = true } }',
    notes: ['`height = 0` produces empty geometry rather than an error.'],
  },
  {
    name: 'revolve', group: '2D to 3D',
    summary: 'Turns a 2D profile about the Y axis into a solid of revolution.',
    attributes: [
      { name: 'angle', type: 'angle', default: '360', description: 'How far round to sweep, in degrees' },
      { ...SEGMENTS, description: 'Segments around; 0 lets the kernel decide' },
    ],
    example: 'revolve { polygon { points = [[0, 0], [26, 0], [24, 6], [0, 74]] } }',
    notes: [
      "The profile is written in the XY plane and its Y becomes the result's Z, so a profile drawn upwards from [0, 0] stands on the XY plane.",
      'A profile that crosses X = 0 produces a spike through the middle. Keep every point at X ≥ 0.',
    ],
  },
  {
    name: 'project', group: '3D to 2D', summary: 'The shadow of a solid on the XY plane.',
    attributes: [],
    example: 'extrude { height = 2  project { bracket { } } }',
  },
  {
    name: 'slice', group: '3D to 2D', summary: 'The cross-section of a solid at one Z.',
    attributes: [{ name: 'z', type: 'number', default: '0', description: 'The plane to cut at' }],
    example: 'slice { z = 12  bracket { } }',
  },

  // --- refinement -----------------------------------------------------------------------
  {
    name: 'offset', group: 'Refinement', summary: 'Grows or shrinks a 2D outline.',
    attributes: [
      { name: 'amount', type: 'number', default: 'required', description: 'Positive grows, negative shrinks' },
      {
        name: 'join', type: 'enum', default: '"Round"', values: ['Square', 'Round', 'Miter'],
        description: 'How convex corners are treated',
      },
      {
        name: 'miter_limit', type: 'number', default: '2',
        description: 'How far a mitred corner may extend before it is squared off',
      },
      { ...SEGMENTS, description: 'Segments per rounded corner' },
    ],
    example: 'extrude { height = 3  offset { amount = 2  rect { size = [40, 20] } } }',
    notes: ['2D only. To shell a solid, offset the profile and extrude, or subtract a scaled copy.'],
  },
  {
    name: 'hull', group: 'Refinement', summary: 'The convex hull of everything inside.',
    attributes: [],
    example: 'hull {\n  cylinder { radius = 5  height = 4 }\n  translate { offset = [40, 0, 0]  cylinder { radius = 8  height = 4 } }\n}',
    notes: ['A hull has no concavities, so it swallows holes. Cut them afterwards.'],
  },
  {
    name: 'refine', group: 'Refinement', summary: 'Subdivides edges longer than a limit.',
    attributes: [
      {
        name: 'edge_length', type: 'number', default: 'required',
        description: 'No edge longer than this survives',
      },
    ],
    example: 'smooth { min_sharp_angle = 40  refine { edge_length = 1  bracket { } } }',
    notes: ['Triangle count grows with the square of the reduction. Refine the smallest piece that needs it.'],
  },
  {
    name: 'simplify', group: 'Refinement', summary: 'Removes vertices within a tolerance.',
    attributes: [
      { name: 'tolerance', type: 'number', default: '1e-6', description: 'How far a vertex may move' },
    ],
    example: 'simplify { tolerance = 0.05  shell { } }',
  },
  {
    name: 'smooth', group: 'Refinement', summary: 'Rounds edges below a sharpness threshold.',
    attributes: [
      {
        name: 'min_sharp_angle', type: 'number', default: '60',
        description: 'Degrees. Edges sharper than this stay sharp',
      },
      {
        name: 'min_smoothness', type: 'number', default: '0',
        description: 'How strongly to smooth, from 0 to 1',
      },
    ],
    example: 'smooth { min_sharp_angle = 40  refine { edge_length = 1  body { } } }',
    notes: ['Smoothing moves existing vertices, so it does nothing on a solid with no vertices to move. `refine` first.'],
  },
  {
    name: 'trim', group: 'Refinement', summary: 'Cuts a solid with a half-space.',
    attributes: [
      {
        name: 'normal', type: '3-vector', default: 'required',
        description: "The plane's normal; everything on the normal's side is removed",
      },
      {
        name: 'offset', type: 'number', default: '0',
        description: 'How far the plane sits along the normal from the origin',
      },
    ],
    example: 'trim { normal = [0, 0, 1]  offset = 10  sphere { radius = 15 } }',
  },

  // --- align ----------------------------------------------------------------------------
  {
    name: 'align', group: 'Placement',
    summary: 'Moves geometry so a measured feature of its bounding box lands where you say.',
    takes: 'same',
    attributes: [
      {
        name: 'x', type: '"min" | "center" | "max" | number', description: 'What to do along X',
      },
      { name: 'y', type: '"min" | "center" | "max" | number', description: 'Along Y' },
      { name: 'z', type: '"min" | "center" | "max" | number', description: 'Along Z; 3D children only' },
    ],
    example: 'align { x = "center"  y = "center"  z = 0  composed_thing { } }',
    notes: [
      'The keywords put a named feature at 0; a number puts the *minimum* face at that coordinate. `z = 5` means "sit this on a surface at height 5".',
      'The only block that measures, so it costs a kernel round-trip. Prefer `center = true` on a single shape.',
      'An axis that is not given is left alone. The spelling is `"center"`.',
    ],
  },

  // --- scene ----------------------------------------------------------------------------
  {
    name: 'part', group: 'Scene',
    summary: 'A separately coloured piece of the rendered scene. Belongs directly in a model.',
    takes: 3,
    attributes: [
      { name: 'color', type: 'string', default: '"#b8c4d0"', description: 'Any CSS colour; usually #rrggbb' },
      {
        name: 'opacity', type: 'number', default: '1',
        description: 'Display only; 0 is invisible, 1 is opaque',
      },
    ],
    example: 'part "body" { color = "#6f7d8c"  box { size = [40, 20, 10] } }',
    notes: [
      'The label is an expression, so a part in a loop can name itself: `part "leg_${i}"`.',
      'A part inside a transform or a boolean is silently dropped. Put the transform inside the part.',
      'A part cannot contain another part, cannot be empty, and cannot come out of a component.',
      'Every part must be 3D by the time it renders.',
    ],
  },
];

/**
 * The four top-level declarations, which are grammar rather than blocks and so are not in
 * the block registry.
 *
 * @type {Entry[]}
 */
const DECLARATIONS = [
  {
    name: 'param', group: 'Declarations',
    summary: 'A declared input, read as `var.NAME`. What the editor turns into a control.',
    attributes: [
      { name: 'default', type: 'any', description: 'The value used when the caller supplies none. Without it the param is required' },
      {
        name: 'type', type: 'enum', values: ['number', 'string', 'bool', 'vector', 'list', 'angle'],
        description: 'Which control to build. Written bare, without quotes. Inferred from `default` when omitted',
      },
      { name: 'min', type: 'number', description: 'Lower bound of the control. Advisory — never enforced' },
      { name: 'max', type: 'number', description: 'Upper bound of the control. Advisory — never enforced' },
      { name: 'step', type: 'number', description: 'Granularity of the control. Advisory' },
      { name: 'description', type: 'string', description: 'Help text' },
      { name: 'options', type: 'list', description: 'A fixed set of choices, for a dropdown. Advisory' },
    ],
    example: 'param height { type = number  default = 20  min = 8  max = 40  step = 1 }\nparam wall = 2.5',
    notes: [
      'This is the one block that does not reject attributes it does not understand — a param block is metadata.',
      '`min`, `max`, `step` and `options` shape the editor control and nothing else. Clamp in the model if a bound matters.',
      "A default may refer to params declared above it by their bare name, but never to `var` — `var` is assembled after every param resolves.",
      'A param declared inside a `model` must have a default and cannot be set from outside.',
      '`param s` on its own is a syntax error; write `param s { }` for a required one.',
    ],
  },
  {
    name: 'local', group: 'Declarations', summary: 'A named value, computed once.',
    attributes: [],
    example: 'local sizes = [1.5, 2, 2.5, 3]\nlocal radius = var.diameter / 2',
    notes: [
      'Top-level locals are resolved strictly in source order; a local inside a body is not ordered.',
      'Locals hold values, never geometry. To name geometry, declare a `component`.',
      'Locals are not in `var`. Read one by its bare name.',
      'A duplicate local silently replaces the first, everywhere.',
    ],
  },
  {
    name: 'component', group: 'Declarations',
    summary: 'A reusable parameterised block, callable exactly like a builtin.',
    attributes: [],
    example: 'component "rounded_box" {\n  param size   = [20, 20, 10]\n  param radius = 3\n  extrude {\n    height = size.z\n    rounded_rect { size = [size.x, size.y]  radius = radius  center = true }\n  }\n}',
    notes: [
      'Params are read by their bare name inside the body; there is no `var.` for them.',
      'Only declared params may be passed. There is no pass-through.',
      'A component body cannot see the call site — it is evaluated in a fresh scope rooted at the document.',
      'A component cannot declare parts, cannot shadow a builtin, and cannot recurse.',
      'Reuse is free: the same call with the same arguments is one node in the tree, evaluated once.',
    ],
  },
  {
    name: 'model', group: 'Declarations',
    summary: 'Something to render. A document may declare several; `render` builds one.',
    attributes: [],
    example: 'model "riser" {\n  part "body" {\n    color = "#6f7d8c"\n    box { size = [40, 20, 10] }\n  }\n}',
    notes: [
      'With no name, the first model in the document is built.',
      'Geometry written outside any part becomes one default part named after the model.',
      'A model must produce geometry, and every part must be 3D.',
    ],
  },
];

/**
 * The two control-flow constructs, which appear where a block appears.
 *
 * @type {Entry[]}
 */
const CONTROL_FLOW = [
  {
    name: 'for', group: 'Control flow', summary: 'Repeats a body once per item in a list.',
    attributes: [],
    example: 'for i, size in sizes {\n  translate { offset = [i * 8, 0, 0]  cylinder { radius = size / 2  height = 10 } }\n}',
    notes: [
      'One name binds the value; two bind the index and then the value.',
      'Everything every iteration produces is handed to the enclosing block.',
      'The sequence must be a list. `range(a, b)` excludes `b`, and is empty rather than infinite when it runs backwards.',
      'There is no break, no continue and no accumulator.',
    ],
  },
  {
    name: 'if', group: 'Control flow', summary: 'Includes a body only when a condition holds.',
    attributes: [],
    example: 'if var.reinforced {\n  box { size = [40, 40, 4] }\n} else {\n  box { size = [40, 40, 2] }\n}',
    notes: [
      'Judged by truthiness: `0`, `""`, `[]`, `null` and `false` are falsy.',
      '`else if` chains. An `if` that takes no branch produces nothing, which is an error where something was required.',
      'Not an expression. For a value that depends on a condition, use `cond ? a : b`.',
    ],
  },
];

/**
 * Merges the structural facts from the block registry into the described entries.
 *
 * @param {Entry} entry The described entry.
 * @returns {Entry} The entry, with `dim`, `takes` and `leaf` taken from the registry.
 */
function withRegistry(entry) {
  /** @type {BlockDefinition | undefined} */
  const definition = BLOCKS[entry.name];
  if (!definition) return entry;
  return {
    ...entry,
    ...(definition.dim ? { dim: definition.dim } : {}),
    ...(definition.takes ? { takes: definition.takes } : {}),
    ...(definition.leaf ? { leaf: true } : {}),
  };
}

/** Every construct the language has, by name. */
export const CONSTRUCTS = new Map(
  [...DECLARATIONS, ...CONTROL_FLOW, ...BLOCK_ENTRIES.map(withRegistry)]
    .map((entry) => [entry.name, entry]),
);

/**
 * What each builtin function is for. The arity comes from the registry.
 *
 * @type {Record<string, string>}
 */
const FUNCTION_DESCRIPTIONS = {
  abs: 'Magnitude, discarding the sign',
  floor: 'Rounds towards −∞',
  ceil: 'Rounds towards +∞',
  round: 'Rounds to the nearest integer, halves upwards',
  sqrt: 'Square root. A negative input gives NaN, which fails where it is used',
  sign: '-1, 0 or 1',
  pow: 'pow(x, y) — x raised to y',
  atan2: 'atan2(y, x) — degrees, in the correct quadrant',
  log: 'Natural logarithm',
  exp: 'e raised to x',
  sin: 'Takes degrees, returns a ratio',
  cos: 'Takes degrees, returns a ratio',
  tan: 'Takes degrees, returns a ratio',
  asin: 'Takes a ratio, returns degrees',
  acos: 'Takes a ratio, returns degrees',
  atan: 'Takes a ratio, returns degrees',
  min: 'The smallest value. Flattens, so min(list) and min(a, b) both work',
  max: 'The largest value. Flattens, so max(list) and max(a, b) both work',
  sum: 'Everything added together; 0 for no arguments',
  len: 'Length of a list or a string; 0 for anything else',
  concat: 'Every argument flattened into one list',
  reverse: 'A list, back to front',
  contains: 'contains(list, value) — whether the list holds it',
  join: 'join(separator, list) — the items as one string',
  str: 'The value as a string',
  num: 'The value as a number; non-numeric text gives NaN',
  range: 'range(end), range(start, end) or range(start, end, step). Excludes the end; capped at 100000 values',
};

/** Every builtin function, with its arity and what it does. */
export const LANGUAGE_FUNCTIONS = Object.keys(FUNCTIONS)
  .sort((a, b) => a.localeCompare(b))
  .map((name) => ({
    name,
    arity: FUNCTIONS[name].arity === null ? 'variadic' : FUNCTIONS[name].arity,
    description: FUNCTION_DESCRIPTIONS[name] ?? '',
  }));

/** Every named constant, with its value. */
export const LANGUAGE_CONSTANTS = Object.entries(CONSTANTS)
  .map(([name, value]) => ({ name, value }));

/**
 * Where the descriptions here and the registries in the package disagree.
 *
 * A block gained, lost or renamed in the library shows up here rather than as a confidently
 * wrong answer to a caller. The test asserts this is empty, so the two cannot drift apart
 * without the build saying so.
 *
 * @returns {string[]} One line per disagreement; empty when they agree.
 */
export function catalogueDrift() {
  /** @type {string[]} */
  const drift = [];

  const described = new Set(BLOCK_ENTRIES.map((entry) => entry.name));
  for (const name of Object.keys(BLOCKS)) {
    if (!described.has(name)) drift.push(`block "${name}" exists in the library but is not described here`);
  }
  for (const name of described) {
    // `align` and `part` are evaluator constructs rather than registry entries, and are
    // described here because a caller has no way to tell the difference.
    if (!BLOCKS[name] && !['align', 'part'].includes(name)) {
      drift.push(`block "${name}" is described here but no longer exists in the library`);
    }
  }

  for (const name of Object.keys(FUNCTIONS)) {
    if (!FUNCTION_DESCRIPTIONS[name]) drift.push(`function "${name}" exists in the library but is not described here`);
  }
  for (const name of Object.keys(FUNCTION_DESCRIPTIONS)) {
    if (!FUNCTIONS[name]) drift.push(`function "${name}" is described here but no longer exists in the library`);
  }

  return drift;
}

/**
 * Renders one construct as Markdown, which is what a tool result carries.
 *
 * @param {Entry} entry The construct.
 * @returns {string} The description.
 */
export function formatConstruct(entry) {
  const lines = [`## \`${entry.name}\``, '', entry.summary, ''];

  /** @type {string[]} */
  const facts = [];
  if (entry.dim) facts.push(`produces ${entry.dim}D`);
  if (entry.leaf) facts.push('a leaf — it takes no children');
  else if (entry.takes === 'same') facts.push("takes 2D or 3D children, passing the dimensionality through");
  else if (entry.takes) facts.push(`takes ${entry.takes}D children`);
  if (entry.ordered) facts.push('the order of its children matters');
  if (facts.length) lines.push(`*${facts.join('; ')}.*`, '');

  if (entry.attributes.length) {
    lines.push('| Attribute | Type | Default | Description |', '| --- | --- | --- | --- |');
    for (const attribute of entry.attributes) {
      const type = attribute.values
        ? attribute.values.map((value) => `\`"${value}"\``).join(' ')
        : attribute.type;
      lines.push(`| \`${attribute.name}\` | ${type} | ${attribute.default ?? '—'} | ${attribute.description} |`);
    }
    lines.push('');
  }

  lines.push('```hcl', entry.example, '```', '');
  if (entry.notes?.length) lines.push(...entry.notes.map((note) => `- ${note}`), '');

  return lines.join('\n');
}

# Values

Three small immutable classes the evaluator works in: [`Vector`](#vector),
[`Angle`](#angle) and [`Transform`](#transform). Documents never see them directly — a
document writes lists and bare numbers — but they are exported for anyone building geometry
through the [`GeometryNode`](geometry-node.md) API.

```js
import { Vector, Angle, Transform } from 'forma-dsl';
```

All three are frozen on construction. Every method returns a new value.

---

## `Vector`

A 2D or 3D vector. One class covers both, because every operation is componentwise and a
separate 3D class would be the same code with one more letter.

### Construction

| | |
| --- | --- |
| `new Vector([x, y])` | From components |
| `Vector.of(value, dimensions)` | From anything vector-like |
| `Vector.zero(dimensions)` | The origin |

`Vector.of` accepts a `Vector`, a **number** — broadcast to every component — an array, or an
`{x, y, z}` object whose missing keys read as zero. This is what makes
`scale { factor = 2 }` work the same as `factor = [2, 2, 2]`.

### Properties

| Property | Description |
| --- | --- |
| `components` | The components, frozen |
| `size` | How many there are |
| `x`, `y`, `z` | The first, second and third. `z` is `undefined` in 2D |
| `magnitude` | Length |

### Methods

| Method | Description |
| --- | --- |
| `plus(other)` `minus(other)` | Componentwise |
| `times(other)` `dividedBy(other)` | Componentwise; a number scales every component |
| `negated()` | The other way round |
| `dot(other)` | Dot product |
| `cross(other)` | Cross product. 3D only |
| `normalized()` | Scaled to unit length |
| `toArray()` | A copy, safe to keep |

#### Caveats

- **A zero vector normalises to itself**, not to NaN, so a degenerate normal cannot quietly
  poison a transform downstream.
- `Vector.of` throws if the size does not match what was asked for.

---

## `Angle`

An angle, stored in radians and read in whichever unit the caller wants.

The kernel takes degrees and JavaScript's trigonometry takes radians, so a bare number would
be ambiguous at exactly the call sites where getting it wrong produces a model that is subtly
wrong rather than an error.

**Every angle the language reads or writes is in degrees.** Radians appear only here.

### Construction

| | |
| --- | --- |
| `Angle.degrees(v)` | From degrees |
| `Angle.radians(v)` | From radians |
| `Angle.turns(v)` | From full turns, so `0.25` is a right angle |
| `Angle.of(v)` | From an `Angle`, or a **number read as degrees** |
| `new Angle(radians)` | Rarely the unit at hand; prefer the factories |

### Properties and methods

| | Description |
| --- | --- |
| `radians` | The angle in radians |
| `degrees` | The angle in degrees |
| `sin` `cos` `tan` | Trigonometry, as properties |
| `plus(other)` `minus(other)` | Other may be an `Angle` or a number of degrees |
| `times(factor)` | A plain multiplier, not an angle |

The unit names appear twice — `Angle.degrees(90)` builds one, `angle.degrees` reads one back.
They are different namespaces and do not collide.

---

## `Transform`

An affine transform, held column-major at the size the kernel wants: 3×3 for 2D and 4×4 for
3D.

Column-major throughout, because that is what Manifold reads. Storing row-major and
transposing at the boundary would put a silent transpose in the one place a wrong model still
renders.

### Construction

| | |
| --- | --- |
| `Transform.identity(dim)` | Changes nothing |
| `Transform.translation(offset, dim)` | Moves |
| `Transform.scaling(factor, dim)` | Scales about the origin |
| `Transform.rotation2D(angle)` | Rotates about the origin. A bare number is degrees |
| `Transform.rotation3D(angles)` | Degrees about X, Y and Z |
| `Transform.rotation(angles, dim)` | Dispatches to whichever of the two fits |
| `Transform.mirroring(normal, dim)` | Reflects in the plane through the origin |

### Properties and methods

| | Description |
| --- | --- |
| `dim` | 2 or 3 |
| `m` | The matrix, column-major and frozen |
| `order` | Side length — one more than `dim` |
| `at(row, col)` | One entry, read out of column-major storage |
| `concat(other)` | `this ∘ other` — **`other` runs first** |
| `toArray()` | A copy, safe to keep |

#### Caveats

- **3D rotation applies X, then Y, then Z**, matching OpenSCAD, so a model ported from there
  lands in the same orientation.
- **`concat` applies its argument first.** That order matches how blocks nest: the transform
  closest to the shape is applied to it first.
- `mirroring` normalises the normal, so its length does not change the result.
- Every transform is about the **origin**. To act about some other point, translate there,
  act, and translate back.

---

## Usage

### Composing a placement

```js
import { Transform, GeometryNode } from 'forma-dsl';

// Rotate, then move — the argument to concat runs first.
const placement = Transform.translation([30, 0, 0], 3)
  .concat(Transform.rotation3D([0, 0, 45]));

const placed = GeometryNode.transformed(shape, placement);
```

Reading it as blocks, that is:

```hcl
translate { offset = [30, 0, 0]  rotate { z = 45  shape { } } }
```

### Rotating about a point

```js
const about = (point, rotation) => Transform.translation(point, 3)
  .concat(rotation)
  .concat(Transform.translation(new Vector(point).negated().toArray(), 3));

const spun = GeometryNode.transformed(shape, about([20, 20, 0], Transform.rotation3D([0, 0, 30])));
```

### Working in degrees

```js
import { Angle } from 'forma-dsl';

const a = Angle.degrees(30);
a.sin;         // 0.5
a.radians;     // 0.5235987755982988
a.plus(60).degrees;   // 90 — a bare number is read as degrees
```

### Vector arithmetic

```js
import { Vector } from 'forma-dsl';

const size = new Vector([40, 30, 12]);
const wall = 2;

const inner = size.minus(new Vector([wall * 2, wall * 2, 0]));
inner.toArray();      // [36, 26, 12]

Vector.of(3, 3).toArray();          // [3, 3, 3] — a scalar broadcasts
Vector.of({ x: 1, z: 5 }, 3).toArray();  // [1, 0, 5] — missing keys are zero
```

---

## Troubleshooting

### `expected 3 components, got 2`

`Vector.of` was asked for a dimensionality the value does not have. In a document this
surfaces more helpfully as `translate: "offset" must be a number or an array of 3 numbers`.

### `cannot read an angle from string`

`Angle.of` takes an `Angle` or a number. A string is not coerced — that would let `"90deg"`
silently become `NaN`.

### My composed transform is applied in the wrong order

`concat` runs its **argument** first. `a.concat(b)` means "do `b`, then `a`", matching how
the equivalent nested blocks read.

### My rotation moved the shape instead of turning it

Every transform is about the origin. Centre the geometry, rotate, then translate.

### Non-uniform scaling made my circle an ellipse

Expected — that is how [`ellipse`](../reference/shapes-2d.md#ellipse) is built internally, and
it is the cheapest route to an ellipsoid from a sphere.

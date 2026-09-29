# Transforms

Four operations that move geometry without changing its shape. Each works in 2D and 3D, and
passes its children's dimensionality through.

All four **union their children first**, so a transform applied to several blocks moves them
together:

```hcl
translate {
  offset = [0, 0, 10]
  box { size = [4, 4, 4] }
  sphere { radius = 3 }       // both move
}
```

Nested transforms collapse into a single matrix before they reach the kernel, so a deep stack
of `translate` and `rotate` blocks costs one operation rather than one per level.

---

## `translate`

Moves geometry.

```hcl
translate { offset = [10, 0, 5]  box { size = [4, 4, 4] } }
translate { offset = [10, 0]     rect { size = [4, 4] } }      // 2D
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `offset` | vector of the child's dimensionality | **required** | How far to move along each axis |

#### Caveats

- `offset` must have as many components as the child has dimensions — 2 for a cross-section,
  3 for a solid. A mismatch is `translate: "offset" must be a number or an array of 3
  numbers`.
- A single number broadcasts to every axis, which is rarely what you want here but is
  consistent with every other vector attribute.

---

## `rotate`

Turns geometry about the origin. **All angles are in degrees.**

```hcl
rotate { z = 45  box { size = [20, 4, 4] } }                    // 3D, one axis
rotate { angles = [0, 90, 45]  box { size = [20, 4, 4] } }      // 3D, all three
rotate { angle = 30  rect { size = [20, 4] } }                  // 2D
```

#### Attributes — 3D children

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `angles` | 3-vector | — | Degrees about X, Y and Z at once |
| `x`, `y`, `z` | number | `0` | Degrees about that axis, named one at a time |

#### Attributes — 2D children

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `angle` | angle | **required** | Degrees, counter-clockwise |

#### Caveats

- **Rotation is about the origin, not about the geometry.** To spin something in place, put
  it at the origin, rotate, then translate — or build it centred in the first place.
- In 3D the axes are applied **X, then Y, then Z**, matching OpenSCAD, so a model ported from
  there lands in the same orientation. Composing rotations in a different order requires
  separate `rotate` blocks.
- `angles` and the named axes are alternatives. Using `angle` on a 3D child, or `x`/`y`/`z`
  on a 2D one, is an unknown attribute.

---

## `scale`

Scales geometry about the origin.

```hcl
scale { factor = 2  sphere { radius = 5 } }
scale { factor = [1, 1, 0.5]  sphere { radius = 5 } }    // flattened
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `factor` | vector of the child's dimensionality | **required** | Multiplier per axis. A single number scales every axis alike |

#### Caveats

- Scaling is about the origin, so anything not centred there also moves.
- A negative factor mirrors as well as scales, and flips the winding. Prefer
  [`mirror`](#mirror) when reflection is what you mean.
- A factor of `0` collapses the geometry to nothing.
- Non-uniform scaling of a curved surface changes its radii — a scaled sphere is an
  ellipsoid, which is the cheapest way to get one.

---

## `mirror`

Reflects geometry in the plane through the origin with the given normal.

```hcl
mirror { normal = [1, 0, 0]  bracket { } }      // reflect across the YZ plane
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `normal` | vector of the child's dimensionality | **required** | The normal of the mirror plane. Normalised first, so its length does not matter |

#### Caveats

- The plane always passes through the **origin**. To mirror about some other plane,
  translate to the origin, mirror, and translate back.
- In 2D, `normal` describes a line rather than a plane.
- `mirror` replaces the geometry with its reflection; it does not keep the original. For a
  symmetric pair, union both:

  ```hcl
  union {
    bracket { }
    mirror { normal = [1, 0, 0]  bracket { } }
  }
  ```

---

## Usage

### Rotating in place

The origin is the pivot, so centre first:

```hcl
// ✗ the box sweeps around the origin
rotate { z = 30  box { size = [40, 10, 4] } }

// ✓ centred, so it turns on the spot
rotate { z = 30  box { size = [40, 10, 4]  center = true } }

// ✓ or move it back afterwards
translate { offset = [20, 5, 0]  rotate { z = 30  box { size = [40, 10, 4]  center = true } } }
```

### Order of operations

Blocks nest inside-out: the transform closest to the shape is applied first.

```hcl
translate {          // …then moved 50 along X
  offset = [50, 0, 0]
  rotate {           // the box is rotated first…
    z = 45
    box { size = [20, 4, 4]  center = true }
  }
}
```

Swapping the two gives a different result — rotating a translated box sweeps it around the
origin on an arc of radius 50.

### Radial patterns

Rotate a translated copy, once per step:

```hcl
for i in range(0, 8) {
  rotate {
    z = i * 45
    translate { offset = [30, 0, 0]  cylinder { radius = 3  height = 10 } }
  }
}
```

Because identity is content identity, this costs **one** cylinder and eight transforms — the
cylinder node is the same node every time round the loop.

### Mirrored pairs

```hcl
component "hinge_leaf" { ... }

model "hinge" {
  part "left"  { hinge_leaf { } }
  part "right" { mirror { normal = [1, 0, 0]  hinge_leaf { } } }
}
```

### Ellipsoids and tapers

Non-uniform `scale` is the simplest route to shapes the primitives do not offer:

```hcl
scale { factor = [1, 0.6, 1]  sphere { radius = 20  segments = 64 } }
```

---

## Troubleshooting

### `translate: "offset" must be a number or an array of 3 numbers`

The offset has the wrong number of components for its child. 2D children want two, 3D
children want three — and a 2D shape stays 2D until it is extruded:

```hcl
translate { offset = [1, 2, 3]  rect { size = [4, 4] } }   // ✗ rect is 2D
translate { offset = [1, 2]     rect { size = [4, 4] } }   // ✓
```

### `rotate: unknown attribute "angle"`

`angle` is the 2D spelling. A 3D child takes `x`, `y`, `z` or `angles`:

```hcl
rotate { angle = 45  box { size = [1, 1, 1] } }    // ✗
rotate { z = 45      box { size = [1, 1, 1] } }    // ✓
```

The reverse — `z` on a 2D child — fails the same way.

### `"translate" needs at least one shape inside it`

Transforms need something to act on. Often the body contains only a
[`part`](part.md), which contributes no geometry to its parent, or an `if` that took no
branch.

### My rotated part flew off across the scene

Rotation is about the origin. A shape 200 mm out rotates around a 200 mm arc. Centre it,
rotate, then move it where it belongs.

### My mirrored copy vanished

`mirror` replaces rather than adds. Union the original with the reflection if you want both.

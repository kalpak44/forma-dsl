# 3D shapes

Five leaf blocks producing solids. They take attributes and never contain other blocks.

| Block | Sized by | Centred by default |
| --- | --- | --- |
| [`box`](#box) | `size` | no |
| [`sphere`](#sphere) | `radius` or `diameter` | always |
| [`cylinder`](#cylinder) | `height` and one or two radii | no |
| [`cone`](#cone) | `height`, `radius`, `top_radius` | no |
| [`torus`](#torus) | `radius`, `tube_radius` | always |

Anything these cannot express is usually a 2D profile plus
[`extrude`](conversions.md#extrude) or [`revolve`](conversions.md#revolve) — that is where
the real modelling happens.

---

## `box`

An axis-aligned cuboid.

```hcl
box { size = [40, 20, 10] }
box { size = [40, 20, 10]  center = true }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | 3-vector | **required** | X, Y and Z extents |
| `center` | bool | `false` | `true` centres it on the origin; otherwise its minimum corner sits there |

#### Caveats

- A single number is accepted as shorthand for all three, so `size = 10` is a 10 mm cube.
- There is no rounded box. Round a 2D profile and extrude it —
  see [Usage](#rounded-boxes).

---

## `sphere`

```hcl
sphere { radius = 12 }
sphere { diameter = 24  segments = 64 }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `radius` | number | `1` | |
| `diameter` | number | — | An alternative spelling of the same thing |
| `segments` | integer | `0` | Segments around the equator; `0` lets the kernel choose |

#### Caveats

- Give `radius` **or** `diameter`, never both.
- Always centred on the origin.

---

## `cylinder`

A cylinder, or a frustum when the two ends differ.

```hcl
cylinder { radius = 5  height = 20 }
cylinder { diameter = 10  height = 20  center = true }
cylinder { bottom_radius = 12  top_radius = 8  height = 15 }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `height` | number | **required** | Along Z |
| `radius` | number | — | Both ends alike |
| `diameter` | number | — | An alternative spelling of `radius` |
| `bottom_radius` | number | — | The end at Z = 0 |
| `top_radius` | number | — | The end at Z = `height` |
| `segments` | integer | `0` | Segments around; `0` lets the kernel choose |
| `center` | bool | `false` | `true` centres it on Z = 0; otherwise it stands on the XY plane |

#### Caveats

- Give **either** `radius`/`diameter`, **or both** `bottom_radius` and `top_radius`. Anything
  else is `cylinder: give "radius"/"diameter", or both "bottom_radius" and "top_radius"` —
  one radius on its own is ambiguous, and there is no default.
- Unlike every other shape, `radius` has no usable default here: the check runs before the
  fallback would apply.
- `center` affects Z only. X and Y are always centred on the axis.

---

## `cone`

A cone, or a truncated cone.

```hcl
cone { radius = 10  height = 20 }
cone { radius = 10  top_radius = 4  height = 20 }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `height` | number | **required** | Along Z |
| `radius` | number | `1` | The base, at Z = 0 |
| `diameter` | number | — | An alternative spelling of `radius` |
| `top_radius` | number | `0` | `0` gives a point |
| `segments` | integer | `0` | Segments around |
| `center` | bool | `false` | As for [`cylinder`](#cylinder) |

#### Caveats

- `cone` and `cylinder` build the same kind of solid; they differ only in which attributes
  are required and what `top_radius` defaults to. Use whichever reads better — `cone` when
  the top is a point, `cylinder` when both ends matter.

---

## `torus`

A ring, optionally a partial arc.

```hcl
torus { radius = 20  tube_radius = 4 }
torus { radius = 20  tube_radius = 4  angle = 180 }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `radius` | number | **required** | Centre of the ring to centre of the tube |
| `tube_radius` | number | **required** | Radius of the tube itself |
| `angle` | angle | `360` | How far round to sweep, in degrees |
| `segments` | integer | `0` | Segments around the ring |
| `tube_segments` | integer | `0` | Segments around the tube's cross-section |

#### Caveats

- Built as a circle pushed out to `radius` and revolved, which is what a torus is. The outer
  radius of the result is `radius + tube_radius`.
- `tube_radius` greater than `radius` produces self-intersecting geometry. The kernel will
  resolve it into *something*, but not anything you meant.
- An `angle` of `0` or less yields empty geometry rather than an error, so a parameter
  sweeping to zero does not break the model.
- Always centred on the origin, lying in the XY plane.

---

## Usage

### Rounded boxes

There is no rounded-box primitive. Round the 2D profile and extrude it — which also gives
control over whether the vertical edges or the horizontal ones are rounded:

```hcl
component "rounded_box" {
  param size   = [20, 20, 10]
  param radius = 3

  extrude {
    height = size.z
    rounded_rect { size = [size.x, size.y]  radius = radius  center = true }
  }
}
```

For rounding in all three axes, [`smooth`](refinement.md#smooth) or a
[`hull`](refinement.md#hull) of eight spheres are the usual approaches.

### Through-holes

Make the cutter longer than the thing it cuts, and start it below:

```hcl
difference {
  cylinder { radius = 40  height = 8 }

  translate {
    offset = [0, 0, -1]                     // start below the bottom face
    cylinder { radius = 12  height = 10 }   // and finish above the top
  }
}
```

A cutter that ends exactly on a face leaves a zero-thickness coincident surface, which is
slow to resolve and can produce artefacts. One millimetre of overshoot at each end costs
nothing.

### Bolt circles

```hcl
for i in range(0, var.bolts) {
  rotate {
    z = i * 360 / var.bolts
    translate { offset = [var.plate_r - 9, 0, -1]  cylinder { radius = 3  height = 10 } }
  }
}
```

### Rings and fillets from a torus

A torus is the cheapest way to get a circular fillet or a raised thread ridge:

```hcl
for i in range(0, 3) {
  translate {
    offset = [0, 0, 174 + i * 4.5]
    torus { radius = 15.6  tube_radius = 1.1  segments = 96  tube_segments = 16 }
  }
}
```

### Controlling facet count

`segments` is per shape, and it is worth setting on anything that must fit something else:

```hcl
param preview { type = bool  default = true }
local facets = var.preview ? 24 : 128

model "m" {
  cylinder { radius = 10  height = 20  segments = facets }
}
```

Globally, [`setQuality`](../api/kernel.md#setquality) moves the default that `segments = 0`
resolves to.

---

## Troubleshooting

### `cylinder: give "radius"/"diameter", or both "bottom_radius" and "top_radius"`

Either one radius for both ends, or two for a frustum. Giving only `bottom_radius` leaves the
top undefined:

```hcl
cylinder { height = 10  bottom_radius = 5 }                    // ✗
cylinder { height = 10  bottom_radius = 5  top_radius = 5 }    // ✓
cylinder { height = 10  radius = 5 }                           // ✓ simpler
```

### `sphere: give either "radius" or "diameter", not both`

Pass one.

### `"box" is a shape and cannot contain other blocks`

A shape is a leaf. Usually a missing `}` on an earlier line has swallowed the next block.

### `box: "size" must be a number or an array of 3 numbers`

`size` needs three components in 3D. A 2-vector is a common slip when converting a profile:

```hcl
box { size = [40, 20] }       // ✗
box { size = [40, 20, 10] }   // ✓
```

### My cylinder is not where I expect

By default a cylinder stands **on** the XY plane, with its base at Z = 0. `center = true`
puts its middle there instead. The same is true of `box`, whose minimum corner — not its
centre — sits at the origin by default.

### Two solids that touch exactly render with artefacts

Coincident faces are ambiguous. Overlap them by a small amount when unioning, and overshoot
by a small amount when subtracting.

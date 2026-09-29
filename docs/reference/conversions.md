# 2D ↔ 3D

Four operations that change dimensionality. Two give a profile thickness; two take a
cross-section of a solid.

| Block | Direction | Description |
| --- | --- | --- |
| [`extrude`](#extrude) | 2D → 3D | Sweeps a profile along Z |
| [`revolve`](#revolve) | 2D → 3D | Spins a profile about the Y axis |
| [`project`](#project) | 3D → 2D | The shadow of a solid on the XY plane |
| [`slice`](#slice) | 3D → 2D | The cross-section at one Z |

Each unions its children before acting on them, and each insists on the dimensionality it
takes: `"extrude" takes 2D geometry, got 3D`.

---

## `extrude`

Sweeps a 2D profile along Z, optionally twisting and tapering as it goes.

```hcl
extrude { height = 20  circle { radius = 10 } }

extrude {
  height    = 40
  twist     = 90
  scale_top = [0.5, 0.5]
  divisions = 24
  rect { size = [20, 20]  center = true }
}
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `height` | number | **required** | How far to sweep, along +Z |
| `twist` | angle | `0` | Degrees of rotation from bottom to top |
| `scale_top` | 2-vector | `1` | Size of the top face relative to the bottom. A single number scales both axes |
| `divisions` | integer | `0` | Intermediate layers. Needed for a smooth twist or taper |
| `center` | bool | `false` | `true` centres the result on Z = 0; otherwise it stands on the XY plane |

#### Caveats

- **`divisions` matters whenever `twist` or `scale_top` is set.** With the default `0` the
  sides are straight lines between the two end faces, so a twist becomes a single sheared
  step rather than a helix. Set it to the number of intermediate layers you want.
- A `height` of `0` or less yields empty geometry rather than an error, so a parameter
  sweeping to zero does not break the model.
- `scale_top = [0, 0]` gives a point, which is one way to build a pyramid from any profile.
- The profile is swept as drawn — `extrude` does not centre it. A `rect` that is not centred
  produces a box in the positive quadrant.

---

## `revolve`

Spins a 2D profile about the **Y axis** into a solid of revolution.

```hcl
revolve { segments = 96  polygon { points = profile } }
revolve { angle = 180  segments = 64  polygon { points = profile } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `angle` | angle | `360` | How far round to sweep, in degrees |
| `segments` | integer | `0` | Segments around; `0` lets the kernel choose |

#### Caveats

- **The profile is written in the XY plane, and its Y becomes the result's Z.** X is the
  radius. A profile drawn from `[0, 0]` upwards produces a solid standing on the XY plane.
- **Every X must be ≥ 0.** A profile that crosses the axis revolves through itself and the
  result is not what you drew.
- The profile does not have to touch the axis. One that does not produces a tube — which is
  how [`torus`](shapes-3d.md#torus) is built internally.
- An `angle` of `0` or less yields empty geometry rather than an error.

---

## `project`

The shadow a solid casts on the XY plane — its full outline, from any Z.

```hcl
project { bracket { } }
```

#### Attributes

None.

#### Caveats

- Takes 3D geometry and produces 2D: `"project" takes 3D geometry, got 2D`.
- The result is the union of everything, seen from above. Internal voids that are covered
  from above do not appear.

---

## `slice`

The cross-section of a solid at one height.

```hcl
slice { z = 12  bracket { } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `z` | number | `0` | The plane to cut at |

#### Caveats

- Takes 3D geometry and produces 2D.
- A plane that misses the solid gives an empty cross-section, not an error.
- A plane exactly on a flat face is ambiguous — offset it slightly.

---

## Usage

### Profiles are where the modelling happens

Most shapes are easier to describe in 2D and then given thickness. A rounded box, for
instance, has no primitive — it is a rounded rectangle with a height:

```hcl
extrude {
  height = 12
  rounded_rect { size = [40, 30]  radius = 4  center = true }
}
```

### Turning a bottle, a vase, a knob

`revolve` on a hand-written profile is how anything with rotational symmetry is built. Read
the points as (radius, height):

```hcl
local profile = [
  [0, 0], [26, 0], [24, 6], [16, 26],
  [14, 48], [18, 66], [22, 74], [0, 74],
]

// The same silhouette walked inwards by one wall, so the difference leaves a shell.
local cavity = [
  [0, 3], [21, 3], [20, 8], [13, 26],
  [11, 48], [15, 66], [19, 72], [0, 72],
]

model "vase" {
  part "vase" {
    difference {
      revolve { segments = 96  polygon { points = profile } }
      translate {
        offset = [0, 0, 3]
        revolve { segments = 96  polygon { points = cavity } }
      }
    }
  }
}
```

The hollowing is the same trick as anywhere else: the solid minus a slightly smaller copy of
itself.

### Twisted extrusions

A twist needs divisions, or there is nothing to twist between:

```hcl
extrude {
  height    = 60
  twist     = 180
  divisions = 40        // without this the sides are two straight lines
  regular_polygon { sides = 6  radius = 12 }
}
```

### Tapers and pyramids

```hcl
extrude { height = 30  scale_top = 0.4   rect { size = [40, 40]  center = true } }  // frustum
extrude { height = 30  scale_top = 0     rect { size = [40, 40]  center = true } }  // pyramid
```

### Deriving a base plate from a part

`project` turns a finished solid back into an outline, which is useful for a footprint, a
gasket or a support pad:

```hcl
model "m" {
  part "body" { bracket { } }

  part "pad" {
    color = "#c8842f"
    translate {
      offset = [0, 0, -3]
      extrude {
        height = 3
        offset { amount = 2  project { bracket { } } }   // footprint, grown 2 mm
      }
    }
  }
}
```

### Inspecting a cross-section

`slice` is a debugging tool as much as a modelling one — extrude the slice thinly to see
where the walls actually fell:

```hcl
part "section" {
  color = "#ff6b7f"
  extrude { height = 0.5  slice { z = 40  bottle { } } }
}
```

---

## Troubleshooting

### `"extrude" takes 2D geometry, got 3D`

The child is already a solid. Extrusion is for profiles:

```hcl
extrude { height = 10  box { size = [1, 1, 1] } }        // ✗
extrude { height = 10  rect { size = [1, 1] } }          // ✓
```

### `"extrude" cannot mix 2D and 3D shapes`

Two children of different dimensionality. Extrude each profile separately, or union the
profiles before extruding.

### `part "body" is 2D — extrude or revolve it before rendering`

A profile reached the renderer. Somewhere the `extrude` or `revolve` is missing, or is
wrapped around the wrong block.

### My twist looks like a single shear

`divisions` defaults to `0`, which means the extrusion has no intermediate layers. Set it to
20–60 for a smooth twist.

### My revolved solid is inside out, or has a spike through the middle

Part of the profile has a negative X, so it crossed the axis of revolution. Every point must
have X ≥ 0.

### My revolved solid is lying down

`revolve` maps the profile's **Y** to the result's **Z**. A profile written as (x, z) with
the height in the first component produces a solid on its side — swap the components.

### `revolve` produced nothing

Either the `angle` reached `0`, or the profile has zero area. Both yield empty geometry
silently, by design, so that a parameter at the end of its range does not break a model.

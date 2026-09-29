# Refinement

Six operations that change how geometry is built rather than where it is. Most are about
mesh quality or a single cheap cut.

| Block | Takes | Description |
| --- | --- | --- |
| [`offset`](#offset) | 2D | Grows or shrinks an outline |
| [`hull`](#hull) | 2D or 3D | The convex hull of everything inside |
| [`refine`](#refine) | 3D | Subdivides edges longer than a limit |
| [`simplify`](#simplify) | 2D or 3D | Removes vertices within a tolerance |
| [`smooth`](#smooth) | 3D | Rounds edges below a sharpness threshold |
| [`trim`](#trim) | 3D | Cuts a solid with a half-space |

---

## `offset`

Grows or shrinks a 2D outline, keeping true arcs at convex corners.

```hcl
offset { amount = 2  project { bracket { } } }
offset { amount = -1.5  join = "Miter"  rect { size = [40, 20] } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `amount` | number | **required** | Positive grows, negative shrinks |
| `join` | `"Square"` `"Round"` `"Miter"` | `"Round"` | How convex corners are treated |
| `miter_limit` | number | `2` | How far a mitred corner may extend before it is squared off |
| `segments` | integer | `0` | Segments per rounded corner |

#### Caveats

- **2D only.** `"offset" takes 2D geometry, got 3D`. There is no 3D shell operation; build
  one as a `difference` of two profiles, or offset the profile before extruding.
- A negative amount larger than the shape's half-width erases it, leaving empty geometry.
- This is the operation [`rounded_rect`](shapes-2d.md#rounded_rect) is built from — a
  shrunken rectangle offset back out is what makes its corners true arcs.

---

## `hull`

The convex hull of everything inside — the shape a rubber sheet would take around it.

```hcl
hull {
  translate { offset = [0, 0, 0]   sphere { radius = 4 } }
  translate { offset = [40, 0, 0]  sphere { radius = 4 } }
  translate { offset = [20, 30, 0] sphere { radius = 8 } }
}
```

#### Attributes

None.

#### Caveats

- Works in 2D and 3D, passing the dimensionality through.
- Children are unioned first, so the hull is of everything together — which is the point.
- Any concavity is filled in. A hull of a C-shape is a solid blob.

---

## `refine`

Subdivides every edge longer than a limit, producing more, smaller triangles.

```hcl
refine { edge_length = 1  sphere { radius = 20 } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `edge_length` | number | **required** | No edge longer than this survives |

#### Caveats

- 3D only.
- Triangle count grows quadratically as the limit falls. `edge_length = 0.1` on anything
  large will cost seconds and hundreds of megabytes.
- Refining does not change the shape — it only adds vertices, usually so that
  [`smooth`](#smooth) or a downstream deformation has something to work with.

---

## `simplify`

Removes vertices that lie within a tolerance of the surface they are on.

```hcl
simplify { tolerance = 0.01  imported_thing { } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `tolerance` | number | `1e-6` | How far a vertex may move |

#### Caveats

- Works in 2D and 3D.
- The default is small enough to be a no-op on most geometry; it is there so the block can be
  written without arguments while a value is chosen.
- A tolerance near the size of a feature will delete that feature.

---

## `smooth`

Rounds edges whose dihedral angle is below a threshold.

```hcl
smooth { min_sharp_angle = 40  refine { edge_length = 1  blocky_thing { } } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `min_sharp_angle` | number | `60` | Degrees. Edges sharper than this stay sharp |
| `min_smoothness` | number | `0` | How strongly to smooth, from `0` to `1` |

#### Caveats

- 3D only.
- **Smoothing needs vertices to work with.** On a cube there is nothing between the corners
  to move, so the result is barely different. Pair it with [`refine`](#refine).
- This is a mesh operation, not a fillet. For a controlled radius, model the fillet — round
  the profile, or union in a [`torus`](shapes-3d.md#torus).

---

## `trim`

Cuts a solid with a half-space, keeping what is behind the plane.

```hcl
trim { normal = [0, 0, 1]  offset = 20  tall_thing { } }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `normal` | 3-vector | **required** | The plane's normal. Everything on the normal's side is removed |
| `offset` | number | `0` | How far the plane sits along the normal from the origin |

#### Caveats

- 3D only.
- Much cheaper than an `intersection` with a big box, because it is a plane clip rather than
  a boolean between two solids. Use it for flat cuts.
- The cut face is capped, so the result stays a closed solid.

---

## Usage

### Growing a footprint

`offset` after `project` is the standard way to derive a base, a gasket or a clearance
outline from a finished part:

```hcl
extrude {
  height = 3
  offset { amount = 2  project { bracket { } } }
}
```

### Shelling a profile

There is no 3D shell, but offsetting the profile inwards gives the same result for anything
prismatic:

```hcl
difference {
  extrude { height = 20  rounded_rect { size = [40, 30]  radius = 4  center = true } }
  translate {
    offset = [0, 0, 2]
    extrude {
      height = 20
      offset { amount = -2  rounded_rect { size = [40, 30]  radius = 4  center = true } }
    }
  }
}
```

### Organic shapes from a hull

A hull of a few spheres is the quickest route to a smooth, blobby form — a handle, a fillet
between two bosses, a rounded enclosure:

```hcl
component "rounded_enclosure" {
  param size   = [60, 40, 20]
  param radius = 6

  hull {
    for x in [radius, size.x - radius] {
      for y in [radius, size.y - radius] {
        for z in [radius, size.z - radius] {
          translate { offset = [x, y, z]  sphere { radius = radius  segments = 32 } }
        }
      }
    }
  }
}
```

Eight spheres, but one sphere node — content identity means the kernel builds the sphere
once and the hull sees eight transforms of it.

### Flat cuts

`trim` is the cheap way to lop something off:

```hcl
trim { normal = [0, 0, 1]  offset = 15  bottle { } }    // keep everything below z = 15
trim { normal = [-1, 0, 0]  bracket { } }               // keep everything with x ≥ 0
```

For a half-model view, that is one operation instead of an intersection with a box.

### Refine, then smooth

The two go together — smoothing has nothing to move until the mesh is dense enough:

```hcl
smooth {
  min_sharp_angle = 35
  refine { edge_length = 0.8  blocky_thing { } }
}
```

Watch the triangle count; this is the most expensive pair of operations in the language.

---

## Troubleshooting

### `"offset" takes 2D geometry, got 3D`

`offset` works on outlines. To grow a solid, project it, offset the outline and re-extrude —
or offset the profile before it was extruded in the first place.

### `offset: "amount" must be a finite number`

`amount` is required and has no default. A shrink is a negative number, not a missing one.

### My `smooth` did nothing

The mesh has no vertices to move. Refine first, and check that `min_sharp_angle` is above the
angle of the edges you want rounded — the default of `60` leaves every edge on a cube alone.

### `refine` hung the browser

`edge_length` is an absolute length, and triangle count grows quadratically as it falls.
Start an order of magnitude coarser than you think you need.

### My negative offset erased the shape

A negative `amount` larger than half the narrowest part of the outline consumes it entirely.
The result is empty geometry, not an error.

### `hull` swallowed the hole in my part

Hulls are convex; every concavity and every hole is filled. Hull the pieces that need it, and
subtract the holes afterwards:

```hcl
difference {
  hull { ... }
  the_holes { }
}
```

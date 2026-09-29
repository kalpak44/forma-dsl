# 2D shapes

Seven leaf blocks producing cross-sections. They take attributes and never contain other
blocks.

**2D shapes cannot be rendered on their own.** Give them thickness with
[`extrude`](conversions.md#extrude) or [`revolve`](conversions.md#revolve) first, or a part
holding one fails with `part "body" is 2D — extrude or revolve it before rendering`.

| Block | Sized by | Centred by default |
| --- | --- | --- |
| [`rect`](#rect) | `size` | no |
| [`rounded_rect`](#rounded_rect) | `size`, `radius` | no |
| [`circle`](#circle) | `radius` or `diameter` | always |
| [`ellipse`](#ellipse) | `radii` | always |
| [`regular_polygon`](#regular_polygon) | across flats, across corners, or radius | always |
| [`stadium`](#stadium) | `size` | no |
| [`polygon`](#polygon) | `points` | as drawn |

### A note on `segments`

Several shapes take `segments`, the number of straight edges used to approximate a curve.
`0` — the default — means *let the kernel decide* from its global quality settings, which
[`setQuality`](../api/kernel.md#setquality) controls. Set it explicitly when a specific facet
count matters: a hole that must clear a printed bolt, or a preview that must stay cheap.

---

## `rect`

An axis-aligned rectangle.

```hcl
rect { size = [40, 20] }
rect { size = [40, 20]  center = true }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | 2-vector | **required** | Width and height |
| `center` | bool | `false` | `true` centres it on the origin; otherwise its lower-left corner sits there |

---

## `rounded_rect`

A rectangle with true arcs at the corners.

```hcl
rounded_rect { size = [62, 13]  radius = 6.5  center = true }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | 2-vector | **required** | Width and height, over the rounded corners |
| `radius` | number | `1` | Corner radius. Clamped to half the shorter side, so it cannot invert the shape |
| `segments` | integer | `0` | Segments per corner arc; `0` lets the kernel choose |
| `center` | bool | `false` | As for [`rect`](#rect) |

#### Caveats

- Built by shrinking the rectangle and offsetting it back out, which is what makes each
  corner a true arc rather than a chamfer. A `radius` of `0` or less degenerates to a plain
  `rect`.
- `size` is the outer size. `rounded_rect { size = [10, 10] radius = 5 }` is a circle of
  diameter 10.

---

## `circle`

```hcl
circle { radius = 12 }
circle { diameter = 24  segments = 64 }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `radius` | number | `1` | |
| `diameter` | number | — | An alternative spelling of the same thing |
| `segments` | integer | `0` | Segments around the circle; `0` lets the kernel choose |

#### Caveats

- Give `radius` **or** `diameter`, never both: `circle: give either "radius" or "diameter",
  not both`. Both spellings exist because a drilled hole is specified by diameter and a
  fillet by radius, and converting at the call site is where mistakes happen.
- Always centred on the origin. There is no `center` attribute.

---

## `ellipse`

A circle scaled to two exact radii.

```hcl
ellipse { radii = [30, 18] }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `radii` | 2-vector | **required** | Semi-axes along X and Y |
| `segments` | integer | `0` | Segments around the unit circle before scaling |

#### Caveats

- Implemented as a scaled unit circle, so both radii stay exact rather than being
  approximated by a polygon fitted to an ellipse.
- Always centred. There is no `center` attribute — passing one is
  `ellipse: unknown attribute "center"`.

---

## `regular_polygon`

An *n*-sided polygon, sized the way the part it represents is actually specified.

```hcl
regular_polygon { sides = 6  width_across_flats = 5.5 }   // an M3 nut
regular_polygon { sides = 8  radius = 20  rotation = 22.5 }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `sides` | integer | **required** | At least 3 |
| `width_across_flats` | number | — | Distance between opposite flats — how a hex key or a nut is specified |
| `width_across_corners` | number | — | Distance between opposite corners |
| `radius` | number | `1` | Centre to corner. Same as half the across-corners width |
| `diameter` | number | — | Twice the radius |
| `rotation` | angle | `0` | Where the first corner sits, in degrees |

#### Caveats

- Give **one** sizing attribute. They are tried in the order above, so
  `width_across_flats` wins if several are present — do not rely on that; pass one.
- `radius` and `diameter` together are an error, as on [`circle`](#circle).
- Fewer than 3 sides is an error: `regular_polygon: "sides" must be at least 3`.
- Always centred on the origin.
- With `rotation = 0` the first corner is on +X. For a hexagon with **flats** on the X axis,
  use `rotation = 30`.

---

## `stadium`

A rectangle fully rounded on its short axis — the shape of a slot.

```hcl
stadium { size = [40, 8]  center = true }
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | 2-vector | **required** | Width and height, over the rounded ends |
| `segments` | integer | `0` | Segments per end arc |
| `center` | bool | `false` | As for [`rect`](#rect) |

#### Caveats

- The corner radius is always half the **shorter** side. That is what makes it a stadium
  rather than a [`rounded_rect`](#rounded_rect) that happens to look like one, and it means
  the ends are always semicircular however long it is.

---

## `polygon`

An explicit outline, or several contours.

```hcl
polygon {
  points = [
    [0, 0], [26, 0], [24, 6], [16, 26],
    [14, 48], [18, 66], [22, 74], [0, 74],
  ]
}
```

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `points` | list | **required** | A list of `[x, y]` points, or a list of such lists for several contours |
| `fill_rule` | `"EvenOdd"` `"NonZero"` `"Positive"` `"Negative"` | `"NonZero"` | How overlapping contours are resolved |

#### Caveats

- At least three points: `polygon: "points" must be an array of at least 3 points`.
- **A nested list is read as several contours.** `[[0,0],[1,0],[1,1]]` is one triangle;
  `[[[0,0],…],[[2,2],…]]` is two contours, which is how a shape with a hole is written
  without a separate `difference`.
- The outline should not self-intersect. The fill rule decides what happens when it does,
  rather than the shape being rejected.
- Points are not closed for you — the last point connects back to the first automatically, so
  do not repeat it.

---

## Usage

### Profiles for revolving

`polygon` is the workhorse for anything turned on a lathe. The profile is written in the XY
plane with X as the radius and Y as the height, then revolved:

```hcl
local profile = [
  [0, 0], [26, 0], [24, 6], [16, 26],
  [14, 48], [18, 66], [22, 74], [0, 74],
]

model "vase" {
  revolve { segments = 96  polygon { points = profile } }
}
```

Every X must be ≥ 0 — a profile that crosses the axis revolves through itself.

### Slots and keyways

`stadium` extruded is a slot; subtracted, it is a keyway:

```hcl
difference {
  extrude { height = 6  rect { size = [60, 20]  center = true } }
  translate {
    offset = [0, 0, -1]
    extrude { height = 8  stadium { size = [40, 6]  center = true } }
  }
}
```

### Hex sockets sized from the tool

`width_across_flats` is the number printed on the key, so the model says what it means:

```hcl
for i, size in [1.5, 2, 2.5, 3, 4, 5, 6] {
  translate {
    offset = [i * 8, 0, 0]
    extrude { height = 20  regular_polygon { sides = 6  width_across_flats = size + 0.3 } }
  }
}
```

The `+ 0.3` is print clearance — the language has no opinion about fits, so the model states
them.

### Holes without a boolean

A second contour inside the first is a hole, which keeps a two-part profile as one shape:

```hcl
polygon {
  fill_rule = "EvenOdd"
  points = [
    [[0, 0], [40, 0], [40, 30], [0, 30]],    // outline
    [[10, 10], [30, 10], [30, 20], [10, 20]], // hole
  ]
}
```

---

## Troubleshooting

### `part "body" is 2D — extrude or revolve it before rendering`

A 2D shape reached the renderer. Wrap it:

```hcl
extrude { height = 4  circle { radius = 10 } }
```

### `"circle" is a shape and cannot contain other blocks`

A shape is a leaf. Something was nested inside its braces — usually a missing `}` on the
line before, so the next block was swallowed.

### `circle: give either "radius" or "diameter", not both`

Pass one. They mean the same thing and accepting both would let a model disagree with itself.

### `circle: unknown attribute "segements"`

A typo. Every block rejects attributes it did not read, precisely so a misspelling fails
loudly instead of silently rendering the default.

### My rounded rectangle came out as a plain rectangle

`radius` defaults to `1`, which is invisible at most sizes, and it is clamped to half the
shorter side. Check that it is set and that the shape is big enough to show it.

### My hexagon is rotated 30° from what I wanted

`rotation = 0` puts a **corner** on +X. For a flat on +X, use `rotation = 30` — or in general
`180 / sides`.

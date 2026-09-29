# `part`

A separately coloured piece of the rendered scene.

```hcl
model "assembly" {
  part "frame" { color = "#6f7d8c"  box { size = [40, 40, 4] } }
  part "pin"   { color = "#c8842f"  translate { offset = [0, 0, 4]  cylinder { radius = 3  height = 10 } } }
}
```

---

## Reference

### `part "NAME" { ... }`

Groups geometry into one named, coloured piece of the scene. Parts are solved independently
and drawn in their own colour.

A part is **not an operand**. It does not contribute geometry to the block around it, and an
enclosing `translate` will not move it — which is why a part belongs directly in a
[`model`](model.md), or inside a `for` or `if` in one.

#### Label

Optional, and an **expression** rather than a fixed string, so a part built in a loop can
name itself:

```hcl
part "tray_${i}" { ... }
```

Without a label, the part is named `part_<line>` after the line it was written on.

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | string | `"#b8c4d0"` | Any CSS colour the viewer understands. Usually `#rrggbb` |
| `opacity` | number | `1` | `0` is invisible, `1` is opaque. Useful for showing contents through a shell |

#### Returns

Nothing, to the enclosing block. The part travels separately and lands in the scene.

#### Caveats

- **A part cannot contain another part**: `a part cannot contain another part`. Parts are a
  flat list, not a tree.
- **A part nested inside an operation is silently dropped.** `translate { part "p" { … } }`
  discards the part with no error, because an operation collects geometry from its children
  and a part contributes none. Declare parts directly in the model. See
  [Troubleshooting](#a-part-inside-an-operation-disappears).
- **A part cannot be empty**: `a part needs at least one shape inside it`. To make a part
  conditional, put the [`if`](../language/control-flow.md#if) around it, not inside it.
- **A part cannot come out of a [`component`](component.md)**:
  `a component cannot declare parts`. Call the component inside a part instead.
- **Every part must be 3D** by the time it renders:
  `part "body" is 2D — extrude or revolve it before rendering`.
- Several blocks inside a part are implicitly unioned, exactly as anywhere else.
- Nothing rejects two parts with the same name; the viewer will simply list two entries
  called the same thing.

---

## Usage

### Colouring an assembly

The common case. Each physical piece gets a part, and the colours make the render readable:

```hcl
model "water_bottle" {
  part "bottle" { color = "#8fd3e8"  bottle_shell { } }
  part "cap"    { color = "#e2593c"  translate { offset = [0, 0, 170]  cap { } } }
  part "label"  { color = "#f4f1e4"  label_band { } }
}
```

### Showing what is inside

`opacity` makes a shell see-through without changing the geometry:

```hcl
model "assembly" {
  part "case" {
    color   = "#8fa8bd"
    opacity = 0.35            // the board below shows through
    case_shell { }
  }

  part "board" { color = "#2f7d4f"  translate { offset = [0, 0, 3]  board { } } }
}
```

Opacity is a display property. It does not affect the solid, the digest, or an exported STL.

### Parts in a loop

A part label is an expression, so the loop variable can name each one:

```hcl
model "stack" {
  for i in range(0, var.rows) {
    part "tray_${i}" {
      color = i % 2 == 0 ? "#3f7fbf" : "#bf6b3f"
      translate { offset = [0, 0, i * 13]  tray { } }
    }
  }
}
```

### Making a part optional

Put the condition **outside** the part:

```hcl
// ✓
if var.show_label {
  part "label" { color = "#f4f1e4"  label_band { } }
}

// ✗ — when show_label is false this is an empty part, which is an error
part "label" {
  if var.show_label { label_band { } }
}
```

### One part, several pieces of geometry

Everything in a part is unioned, so a part may hold as many blocks as it needs:

```hcl
part "bottle" {
  color = "#8fd3e8"

  difference {                       // the shell…
    bottle_solid { }
    bottle_void { }
  }

  for i in range(0, 3) {             // …plus the thread ridges, same part
    translate { offset = [0, 0, 174 + i * 4.5]  torus { radius = 15.6  tube_radius = 1.1 } }
  }
}
```

---

## How parts reach the renderer

[`render`](../api/render.md) returns one entry per part:

```js
const result = await render(source);

for (const part of result.parts) {
  part.name;      // "bottle"
  part.color;     // "#8fd3e8"
  part.opacity;   // 1
  part.node;      // the GeometryNode — what context.collect() wants
  part.concrete;  // the solved Manifold solid, owned by the context
  part.mesh;      // positions and normals, ready to upload
}
```

Parts are solved independently, so two parts that share a subtree still solve it once — the
digest cache is keyed on content, not on which part asked.

To export one part, pass its `concrete` to [`toBinarySTL`](../api/export.md#tobinarystl).

---

## Troubleshooting

### `a part needs at least one shape inside it`

The part's body produced nothing — usually an `if` inside it that took no branch, or a `for`
over an empty list. Move the condition outside the part.

### `a part cannot contain another part`

Parts are flat. To group several coloured pieces, declare them as siblings in the model. If
the grouping matters for positioning, apply the same `translate` inside each one, or hoist
the shared placement into a [`component`](component.md).

### `a component cannot declare parts`

Geometry comes out of a component; scene structure does not. Invert it:

```hcl
component "shell" { ... }                    // geometry only
model "m" { part "shell" { shell { } } }     // the part lives here
```

### `part "body" is 2D — extrude or revolve it before rendering`

The part holds a cross-section. Extrude or revolve it first — see
[2D ↔ 3D](conversions.md).

### A part inside an operation disappears

A part is not an operand, so an operation collects no geometry from it. What happens next
depends on whether the operation had anything else to work with:

```hcl
// ✗ fails: "translate" needs at least one shape inside it
translate { offset = [0, 0, 10]  part "p" { box { size = [1, 1, 1] } } }

// ✗ worse — renders, but part "p" is silently gone from the scene
translate {
  offset = [0, 0, 10]
  box { size = [1, 1, 1] }
  part "p" { sphere { radius = 1 } }
}

// ✓ the transform belongs inside the part
part "p" { translate { offset = [0, 0, 10]  box { size = [1, 1, 1] } } }
```

Nothing warns about the second case. If a part you declared is missing from the render,
check that it is written directly in the [`model`](model.md) — or inside a `for` or `if` in
one — and not nested inside a transform or a boolean.

### Two parts have the same name

Nothing rejects it. Part names come from an expression, so a loop that computes the same
label twice produces duplicates — include the loop index: `part "leg_${i}"`.

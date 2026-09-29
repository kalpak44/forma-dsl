# `model`

Something to render. A document may declare several; [`render`](../api/render.md) builds one
of them.

```hcl
model "hex_key_holder" {
  part "body" {
    color = "#6f7d8c"
    extrude { height = 20  rounded_rect { size = [62, 13]  radius = 6.5  center = true } }
  }
}
```

---

## Reference

### `model "NAME" { ... }`

Declares a renderable scene. The body is geometry, optionally organised into
[`part`](part.md)s.

#### Body

| Entry | Meaning |
| --- | --- |
| [`part "name" { ... }`](part.md) | A separately coloured piece of the scene |
| geometry blocks | Rendered as one default part named after the model |
| `param NAME { default = expr }` | A constant for this model. Must have a default; not settable from outside |
| `local NAME = expr` | A working value, scoped to the model |
| `for` / `if` | Ordinary control flow, which may produce parts as well as geometry |

#### Returns

A scene: a list of parts, each with a name, a colour, an opacity and a geometry node.

#### Caveats

- **Every part must be 3D.** A 2D part is rejected before it is solved:
  `part "body" is 2D — extrude or revolve it before rendering`.
- **A model must produce something.** An empty body, or one whose only loop ran zero times,
  fails with `model "m" produced no geometry`.
- **Declaring the same model twice is an error**: `model "m" is declared twice`.
- **Model params are not inputs.** They must have defaults and cannot be set by the caller.
  See [Model params](#model-params).
- A document with no model at all fails at render time with `the document declares no model`.

---

## Usage

### Choosing which model renders

With no name, the **first** model in the document is built:

```js
await render(source);                      // the first model
await render(source, { model: 'exploded' }); // by name
```

Naming one that does not exist fails with `no model named "exploded"`. In the editor, the
first model is the one shown.

Several models in one document is the idiomatic way to keep variants of the same object
together — a printable part and the assembly it belongs to, say:

```hcl
component "bracket" { ... }
component "pin"     { ... }

model "printable" {                 // what goes to the slicer
  part "bracket" { bracket { } }
}

model "assembly" {                  // what it looks like assembled
  part "bracket" { color = "#6f7d8c"  bracket { } }
  part "pin"     { color = "#c8842f"  translate { offset = [0, 0, 12]  pin { } } }
}
```

### Parts, and geometry without them

Geometry written straight into a model — outside any `part` — becomes **one default part
named after the model**, coloured `#b8c4d0`:

```hcl
model "riser" {
  box { size = [40, 20, 10] }       // → one part called "riser"
}
```

Mixing the two is allowed. The loose geometry still collapses into a single part, which is
listed after the declared ones:

```hcl
model "m" {
  box { size = [10, 10, 10] }       // → part "m"
  part "pin" { cylinder { radius = 2  height = 20 } }
}
// parts: "pin", then "m"
```

Prefer explicit parts once there is more than one piece — they are what the viewer colours
and lists, and what an exporter can write out separately.

### Model params

A `model` may declare `param` blocks. They are **constants for that model**, not inputs:

```hcl
model "bracket" {
  param thickness { default = 4 }
  param slots     { default = 3 }

  extrude { height = thickness  rect { size = [20, slots * 10] } }
}
```

| | Document `param` | Model `param` |
| --- | --- | --- |
| Default required | No — may be required instead | **Yes**: `model "m": param "s" needs a default` |
| Settable by the caller | Yes, via `render(source, { params })` | No |
| Appears in `describeParameters` | Yes | No |
| Readable as `var.NAME` | Yes | No — bare name only |

Use them to give one model's fixed numbers a name without adding a control to the editor.
For anything the caller should change, declare the param at the top level.

### Building parts in a loop

`for` and `if` may produce parts, not just geometry, so a scene can be generated:

```hcl
model "stacked_trays" {
  for i in range(0, var.rows) {
    part "tray_${i}" {
      color = i % 2 == 0 ? "#3f7fbf" : "#bf6b3f"
      translate { offset = [0, 0, i * 13]  tray { size = [40, 30, 12]  wall = 2 } }
    }
  }
}
```

An optional part goes behind an `if` **around** the part, never inside it — a part with no
geometry is an error:

```hcl
if var.show_label {
  part "label" { color = "#f4f1e4"  ... }
}
```

### Exploded views

A param that displaces one part is the cheapest way to make an assembly inspectable, and
costs nothing when it is zero:

```hcl
param lift { type = number  default = 0  min = 0  max = 90 }

model "assembly" {
  part "body" { body { } }
  part "cap"  { translate { offset = [0, 0, 170 + var.lift]  cap { } } }
}
```

---

## Troubleshooting

### `model "m" produced no geometry`

The body evaluated to nothing. Usual causes:

- an empty body;
- a `for` over an empty list — `range(0, var.n)` where `n` is `0`;
- an `if` with no `else` whose condition was false.

Guard the degenerate case so something is always produced, or make the parameter's minimum
exclude it.

### `part "body" is 2D — extrude or revolve it before rendering`

A part ended up holding a cross-section rather than a solid. 2D shapes cannot be rendered
directly:

```hcl
part "body" { circle { radius = 5 } }                          // ✗
part "body" { extrude { height = 2  circle { radius = 5 } } }  // ✓
```

See [`extrude`](conversions.md#extrude) and [`revolve`](conversions.md#revolve).

### `the document declares no model`

The document has params, locals and components but nothing to render. Add a `model` block.

### `model "m": param "s" needs a default`

A param declared inside a model has no default. Model params cannot be supplied from
outside, so a default is the only way they can ever have a value. Either give it one, or move
the param to the top level where the caller can set it.

### `model "m" is declared twice`

Two models share a name, so `render(source, { model: 'm' })` would be ambiguous. Rename one.

### My `render(source, { params })` value is ignored

The param is probably declared inside the model rather than at the top level. Only top-level
params are settable. Check with [`describeParameters`](../api/describe-parameters.md) — it
lists exactly the params a caller can set.

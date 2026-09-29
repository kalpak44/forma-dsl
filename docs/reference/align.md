# `align`

Moves geometry so a measured feature of its bounding box lands where you say.

```hcl
align {
  x = "center"
  y = "center"
  extrude { height = 20  rounded_rect { size = [62, 13]  radius = 6.5 } }
}
```

`align` is the only block that **measures**. Every other operation builds its node from its
attributes alone; this one has to solve its child first, because where the geometry actually
is cannot be read off the tree.

---

## Reference

### `align { ... }`

Unions its children, measures the bounding box of the result, and translates it.

#### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `x` | `"min"` `"center"` `"max"` or a number | untouched | What to do along X |
| `y` | same | untouched | Along Y |
| `z` | same | untouched | Along Z. 3D children only |

An axis that is not given is left alone.

#### What each value means

| Value | Effect |
| --- | --- |
| `"min"` | The **lowest** face on that axis moves to 0 |
| `"center"` | The **centre** of the bounding box moves to 0 |
| `"max"` | The **highest** face moves to 0 |
| a number *n* | The **lowest** face moves to *n* |

Note the asymmetry: the keywords place a named feature at the origin, while a number places
the *minimum* face at that coordinate. `z = 5` means "sit this on a surface at height 5".

#### Returns

The children, unioned and translated. Dimensionality passes through — a 2D child accepts
`x` and `y` only.

#### Caveats

- **`align` needs a kernel context.** It is the one block that cannot be evaluated without
  one: `align needs a kernel context — render the model rather than building it`. Building a
  node tree with a bare `Evaluator` and no context will fail on it.
- **It costs a kernel round-trip.** The child has to be solved before the alignment can be
  computed, so the subtree is evaluated at build time rather than lazily. The digest cache
  means it is solved only once, but an `align` around something expensive is not free.
- It measures the **bounding box**, not the geometry. For anything that is not
  axis-aligned, the box is larger than the shape.
- Children are unioned first, so several blocks inside one `align` move together.
- A label — `align "name" { }` — is accepted and silently ignored.

---

## Usage

### Centring something that was not built centred

The common case. Many profiles are easier to write from a corner, and then need centring:

```hcl
align {
  x = "center"
  y = "center"
  extrude {
    height = 20
    rounded_rect { size = [62, 13]  radius = 6.5 }   // built in the positive quadrant
  }
}
```

Most shapes take a `center = true` attribute, which is cheaper — it changes how the shape is
built rather than measuring it afterwards. Reach for `align` when the thing being centred is
a **composition** rather than a single shape, and there is no one attribute to set.

### Sitting something on a surface

`z = n` puts the bottom face at *n*:

```hcl
align { z = 0  imported_or_composed_thing { } }      // stand it on the build plate
align { z = 12  pin { } }                            // sit it on top of a 12 mm plate
```

This is how to stack parts without knowing their heights:

```hcl
model "stack" {
  part "base" { align { z = 0   base { } } }
  part "mid"  { align { z = 10  mid { } } }
  part "top"  { align { z = 26  top { } } }
}
```

### Aligning faces

`"max"` and `"min"` put a face on the origin, which is what you want for flush edges:

```hcl
align { x = "max"  bracket { } }     // right-hand face on the YZ plane
```

### Mixing axes

Each axis is independent, and an axis you do not mention is untouched:

```hcl
align {
  x = "center"      // centred left-to-right
  z = 0             // standing on the plate
                    // y is left exactly where it was
  composed_thing { }
}
```

---

## `align` versus `center` versus `translate`

| Approach | When |
| --- | --- |
| `center = true` on the shape | A single primitive. Free — it changes how the shape is built |
| `translate` by a known amount | You already know the dimensions, usually because they are params |
| `align` | The extent is **computed** — a hull, a composition, an offset outline — and writing the arithmetic would mean duplicating it |

A model that knows its own dimensions should use them:

```hcl
param width = 62

// ✓ no measurement needed
translate { offset = [-var.width / 2, 0, 0]  extrude { height = 20  rect { size = [var.width, 13] } } }

// also fine, and does not need to know the width
align { x = "center"  extrude { height = 20  rect { size = [var.width, 13] } } }
```

The second reads better and survives a change to how the profile is built; the first avoids a
kernel round-trip. For anything small, prefer clarity.

---

## Troubleshooting

### `align needs a kernel context — render the model rather than building it`

An `Evaluator` was constructed without a `context`, and the document contains an `align`.
[`render`](../api/render.md) always supplies one, so this only comes up when driving the
evaluator directly:

```js
const evaluator = new Evaluator(program);                      // ✗ no context
const evaluator = new Evaluator(program, { context });         // ✓
```

[`describeParameters`](../api/describe-parameters.md) does not evaluate geometry, so it is
unaffected.

### `align: "x" must be "min", "center", "max" or a number`

The value is a string that is not one of the three keywords — `"middle"` and `"centre"` are
the usual culprits. The spelling is `"center"`.

### `align needs at least one shape inside it`

The body produced nothing — an `if` that took no branch, or a `for` over an empty list.

### `align: unknown attribute "z"` on a 2D shape

A cross-section has no Z. Align it before extruding using `x` and `y`, or after extruding
using all three.

### My model got slower after adding `align`

Each `align` solves its child at evaluation time. Around a cheap shape that is nothing;
around a hull of a hundred spheres it is the whole cost of the model, paid before anything
else starts. Align the small thing, or translate by a known amount instead.

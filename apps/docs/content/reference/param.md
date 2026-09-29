# `param`

A declared input. Params are what the editor turns into controls and what
[`render`](../api/render.md) accepts values for.

```hcl
param height { type = number  default = 20  min = 8  max = 40  step = 1 }
param wall = 2.5
```

---

## Reference

### `param NAME { ... }`

Declares an input at the top level of a document. Read it as `var.NAME`, or by its bare name.

```hcl
param bolts {
  type        = number
  default     = 6
  min         = 3
  max         = 16
  step        = 1
  description = "How many holes on the bolt circle"
}
```

#### Attributes

Every attribute is optional. **Only `default` affects geometry** — the rest describe the
control the editor should build, and are returned verbatim by
[`describeParameters`](../api/describe-parameters.md).

| Attribute | Type | Description |
| --- | --- | --- |
| `default` | any | The value used when the caller supplies none. Without it the param is *required* |
| `type` | `number` `string` `bool` `vector` `list` `angle` | Which control to build. Written bare, without quotes. Inferred from `default` when omitted |
| `min` | number | Lower bound of the control |
| `max` | number | Upper bound of the control |
| `step` | number | Granularity of the control |
| `description` | string | Help text |
| `options` | list | A fixed set of choices, for a dropdown rather than a free field |

Unknown attributes are **not** rejected here — a param block is metadata, and anything in it
is passed through to the descriptor. This is the one block in the language that does not
reject attributes it does not understand.

#### Returns

Nothing. A param binds a name; it produces no geometry.

#### Caveats

- **`min`, `max`, `step` and `options` are not enforced.** They shape the editor's control
  and nothing else. `render(source, { params: { bolts: 9999 } })` succeeds on a param
  declared `max = 16`. Validate in the model if a bound matters —
  `local n = min(max(var.bolts, 3), 16)`.
- A param block may contain **attributes only**. Nested blocks inside it are an error:
  `a param block holds attributes, not nested blocks`.
- Declaring the same param twice is an error: `param "a" is declared twice`.
- A param's `default` may refer to params declared **above** it by their bare name, but not
  to `var` — `var` is assembled after every param has resolved. See
  [Scope](../language/scope.md#the-root-scope).
- A param declared inside a `model` is a different thing: it must have a default and cannot
  be set from outside. See [`model`](model.md#model-params).

---

### `param NAME = expression`

Shorthand for a param whose only attribute is `default`.

```hcl
param thickness = 8
param sizes     = [1.5, 2, 2.5, 3]
```

Identical to `param thickness { default = 8 }`. Use it when the editor needs no bounds and
no description.

---

## Usage

### Reading a param

Both spellings work; `var.` is the convention because it marks the value as an input at the
point of use.

```hcl
param height = 20

model "m" {
  extrude { height = var.height  circle { radius = 10 } }
  //                 ^^^^^^^^^^ or just `height`, same value
}
```

`var` holds **params only**. A [`local`](local.md) with the same name shadows the bare name
but never appears under `var`, which is what makes `var.` unambiguous:

```hcl
param a = 1
local a = 2

model "m" { box { size = [a, var.a, 1] } }   // [2, 1, 1]
```

### Choosing a type

`type` is what the editor reads to decide which control to draw.

```hcl
param count   { type = number  default = 6  min = 1  max = 20  step = 1 }   // slider
param label   { type = string  default = "A" }                              // text field
param hollow  { type = bool    default = true }                             // checkbox
param size    { type = vector  default = [40, 30, 12] }                     // three fields
param sweep   { type = angle   default = 45  min = 0  max = 360 }           // degrees
```

When `type` is omitted it is inferred from the default: a number gives `number`, a boolean
`bool`, a string `string`, a list `vector`. A param with neither a `type` nor a `default`
falls back to `number`.

An `angle` param is an ordinary number as far as the language is concerned — every angle in
forma is in degrees, and the type only tells the editor to label the control that way.

### Declaring a required input

A param with no `default` has no value until one is supplied. Rendering without it fails:

```hcl
param serial { type = string }
```

```
param "serial" has no default and no value was supplied
```

[`describeParameters`](../api/describe-parameters.md) reports it as `required: true`, so a
front end can insist on a value before rendering. This is how a document says "there is no
sensible default for this".

### Deriving one input from another

Params are resolved in source order, so a later default may be written in terms of an
earlier one:

```hcl
param diameter = 72
param wall     = 1.6
param bore     = diameter / 2 - wall * 4     // ✓ bare names of earlier params
```

For a value that is always derived and should never be a control, use a
[`local`](local.md) instead — locals are computed after every param and may use `var.`.

### Offering a fixed set of choices

```hcl
param finish {
  type    = string
  default = "matte"
  options = ["matte", "gloss", "raw"]
}

model "m" {
  part "body" {
    color = var.finish == "gloss" ? "#e8eef4" : "#8f9ba6"
    box { size = [20, 20, 20] }
  }
}
```

`options` is carried through to the descriptor for the editor to render as a dropdown.
Nothing checks that a supplied value is one of them, so branch with a final `else` that is
safe.

---

## Troubleshooting

### `param "height" has no default and no value was supplied`

The document declares the param with no `default`, and the caller passed no value. Either
give it a default, or supply one:

```js
await render(source, { params: { height: 20 } });
```

[`describeParameters`](../api/describe-parameters.md) works on such a document — it is built
to be callable before any value exists, so a front end can discover what to ask for.

### `param "a" is declared twice`

Two top-level `param` blocks share a name. Unlike locals, params are rejected rather than
overwritten, because a duplicated input would make the editor's control ambiguous.

### `a param block holds attributes, not nested blocks`

Something inside the braces was parsed as a block rather than an attribute — usually a
missing `=`:

```hcl
param height { default 20 }     // ✗ parsed as a block named `default`
param height { default = 20 }   // ✓
```

### `unknown name "var"`

A param default referred to `var`. `var` is assembled only after every param has been
resolved, so it does not exist yet:

```hcl
param a = 3
param b = var.a * 2     // ✗ unknown name "var"
param b = a * 2         // ✓ earlier params are in scope by their bare name
```

### The editor ignores my `min` and `max`

They are advisory. The control respects them, but a value supplied through the JavaScript
API does not, and the geometry never sees them. Clamp in the model if it matters:

```hcl
local bolts = max(3, min(16, var.bolts))
```

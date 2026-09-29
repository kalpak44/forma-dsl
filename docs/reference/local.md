# `local`

A named value, computed once and reused.

```hcl
local sizes = [1.5, 2, 2.5, 3, 4, 5, 6]
local radius = var.diameter / 2
```

---

## Reference

### `local NAME = expression`

Binds a name to the result of an expression. Locals hold values, never geometry — to name a
piece of geometry, declare a [`component`](component.md).

#### Parameters

| | |
| --- | --- |
| `NAME` | A plain identifier or a quoted string. It may not contain `${ }` |
| `expression` | Any [expression](../language/expressions.md). Evaluated once, when the local is declared |

#### Returns

Nothing. A local binds a name; it produces no geometry.

#### Caveats

- **Locals are ordered at the top level.** A local may refer to params, to constants and to
  locals declared *above* it — never below. `local a = b` before `local b = 2` fails with
  `unknown name "b"`.
- **Locals inside a body are not ordered.** Every local in one block body is resolved before
  any of that body's blocks are built, so a block may use a local declared after it. See
  [Scope → Body scopes](../language/scope.md#body-scopes).
- **Locals are not in `var`.** `var` holds params only. A local named the same as a param
  shadows the bare name but leaves `var.NAME` pointing at the param.
- **A duplicate local is not an error.** A second `local a` silently replaces the first
  everywhere, including in code written above it. Nothing warns, so treat it as a mistake to
  avoid.
- A local is evaluated once, not per use. It cannot depend on a loop variable declared
  elsewhere, because it is not inside that loop.

---

## Usage

### Naming a derived dimension

The main use: give a computed number a name so the model reads in the vocabulary of the
thing being modelled rather than in arithmetic.

```hcl
param diameter      = 72
param neck_diameter = 28
param wall          = 1.6

local r       = var.diameter / 2
local nr      = var.neck_diameter / 2
local neck_or = nr + var.wall              // outer radius of the neck

model "bottle" {
  cylinder { radius = neck_or  height = 18 }
}
```

Each local may use the ones above it, so a chain of derived measurements stays readable.

### Holding a table of values

A list local is the usual way to drive a `for` loop over irregular data:

```hcl
local sizes = [1.5, 2, 2.5, 3, 4, 5, 6]

model "hex_key_holder" {
  for i, size in sizes {
    translate {
      offset = [(i - (len(sizes) - 1) / 2) * 8, 0, 0]
      extrude { height = 20  regular_polygon { sides = 6  width_across_flats = size } }
    }
  }
}
```

A list of lists works the same way and is how a profile is written:

```hcl
local profile = [
  [0, 0], [26, 0], [24, 6], [16, 26], [0, 74],
]

model "vase" { revolve { polygon { points = profile } } }
```

### Grouping related settings

An object local keeps a set of numbers that belong together from spreading out:

```hcl
local fit = { clearance = 0.3, wall = 1.6, chamfer = 0.6 }

model "m" {
  cylinder { radius = 10 + fit.clearance  height = 4 }
}
```

### Locals inside a block

A local declared inside a body is scoped to that body, which keeps a working value out of
the document's namespace:

```hcl
param width = 120
param wall  = 4

model "frame" {
  part "rail" {
    local span = var.width - var.wall * 2   // only meaningful here
    box { size = [span, 10, 4] }
  }
}
```

---

## `local` versus `param` versus `component`

| Use | When |
| --- | --- |
| [`param`](param.md) | The value is an **input** — someone outside the document should be able to change it |
| `local` | The value is **derived** from params or is a fixed table, and should never be a control |
| [`component`](component.md) | You are naming **geometry**, not a value |

A common shape is a handful of params and a run of locals that turn them into the dimensions
the geometry actually uses:

```hcl
param body_height = 170
param wall        = 1.6

local h   = var.body_height
local top = h + 18
local cavity_top = top + 2      // runs past the opening so the neck is not capped
```

---

## Troubleshooting

### `unknown name "b"`

A top-level local referred to something declared below it. Move the declaration up — locals
are resolved strictly in source order:

```hcl
local a = b * 2     // ✗ b does not exist yet
local b = 2

local b = 2         // ✓
local a = b * 2
```

Inside a block body the rule is relaxed, so this only bites at the top level.

### `unknown name "outer-inner"`

Hyphens are part of an identifier, so `outer-inner` is one name rather than a subtraction.
Put spaces around the operator:

```hcl
local gap = outer - inner
```

### `no attribute "a"` when reading `var.a`

`var` holds params only. A local is reached by its bare name:

```hcl
local a = 2
box { size = [a, 1, 1] }        // ✓
box { size = [var.a, 1, 1] }    // ✗ no attribute "a"
```

### My local is not picking up the loop variable

A local is evaluated where it is written, once. It cannot see a loop variable from a loop it
is not inside. Move the local inside the loop body, or compute the value inline:

```hcl
for i in range(0, 6) {
  local angle = i * 60        // ✓ inside the loop, re-evaluated each iteration
  rotate { z = angle  ... }
}
```

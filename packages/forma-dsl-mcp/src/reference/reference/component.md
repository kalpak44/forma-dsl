# `component`

A reusable, parameterised piece of geometry, callable exactly like a builtin block.

```hcl
component "rounded_box" {
  param size   = [20, 20, 10]
  param radius = 3

  extrude {
    height = size.z
    rounded_rect { size = [size.x, size.y]  radius = radius  center = true }
  }
}

model "m" {
  rounded_box { size = [40, 30, 12]  radius = 4 }
}
```

---

## Reference

### `component "NAME" { ... }`

Declares a block named `NAME`. Its body is ordinary geometry; its `param` declarations are
the attributes a call site may pass.

Once declared, it is called like any other block — the call site cannot tell a component
from a builtin, which is the point.

#### Body

| Entry | Meaning |
| --- | --- |
| `param NAME = expr` or `param NAME { default = expr }` | An input. Without a default, the call site must supply it |
| `local NAME = expr` | A working value, scoped to the component |
| geometry blocks | The component's output. Several are implicitly unioned |
| `for` / `if` | Ordinary control flow |

#### Returns

One geometry node — everything in the body, unioned. The dimensionality is whatever the body
produced, so a component may return 2D or 3D geometry and be used wherever that fits.

#### Caveats

- **A component cannot declare [`part`](part.md)s.** Parts are pieces of the finished scene,
  not operands: `a component cannot declare parts`. Call the component *inside* a part
  instead.
- **A component cannot shadow a builtin.** `component "box"` is an error:
  `component "box" shadows a builtin block`. Components and builtins share one namespace.
- **A component body cannot see the call site.** It is evaluated in a fresh scope rooted at
  the document, so a local where it is used does not leak in. See
  [Scope → Component isolation](../language/scope.md#component-isolation).
- **Only declared params may be passed.** An extra attribute is an error:
  `c: unknown param "t"`. There is no catch-all.
- **A component must produce geometry.** An empty body, or one whose only `if` took no
  branch, fails with `component "c" produced no geometry`.
- **Recursion is not supported.** A component that calls itself has no base case the
  evaluator can see, and hits the nesting limit:
  `nesting deeper than 64 blocks — is a component using itself?`
- A label on a call — `my_component "label" { }` — is accepted and silently ignored.
  Do not rely on it.

---

## Usage

### Declaring inputs

Both `param` forms work, and a param with no default is required at every call site:

```hcl
component "tray" {
  param size = [40, 30, 12]   // has a default; optional at the call site
  param wall = 2
  param lid { }               // no default; every call must pass it

  difference {
    rounded_box { size = size  radius = 4 }
    translate {
      offset = [0, 0, wall]
      rounded_box { size = [size.x - wall * 2, size.y - wall * 2, size.z]  radius = 3 }
    }
  }
}
```

Note the empty braces on `lid`. `param lid` on its own is a **syntax error** — a param needs
either `= expression` or a braced body, even an empty one.

Inside the body, a param is read by its bare name. There is no `var.` for component params;
`var` holds document params only, and those are in scope too.

### Composing components

Components can call other components, which is how a model is built up in layers:

```hcl
component "rounded_box" {
  param size   = [20, 20, 10]
  param radius = 3
  extrude { height = size.z  rounded_rect { size = [size.x, size.y]  radius = radius  center = true } }
}

component "tray" {
  param size = [40, 30, 12]
  param wall = 2
  difference {
    rounded_box { size = size  radius = 4 }
    translate { offset = [0, 0, wall]  rounded_box { size = size - [wall * 2, wall * 2, 0]  radius = 3 } }
  }
}

model "stacked_trays" {
  for i in range(0, var.rows) {
    part "tray_${i}" {
      translate { offset = [0, 0, i * 13]  tray { size = [40, 30, 12]  wall = 2 } }
    }
  }
}
```

Nesting may go 64 levels deep, which is far more than any real model needs.

### Naming a repeated cut

A component does not have to be a whole object. Naming the *negative* of a feature is often
what makes a model readable:

```hcl
component "counterbore" {
  param depth  = 4
  param bolt   = 3
  param head   = 5.5

  union {
    cylinder { radius = bolt  height = 40  center = true }
    translate { offset = [0, 0, -depth]  cylinder { radius = head  height = depth + 40 } }
  }
}

model "plate" {
  difference {
    box { size = [60, 60, 8] }
    for p in [[12, 12], [48, 12], [12, 48], [48, 48]] {
      translate { offset = [p.x, p.y, 8]  counterbore { depth = 3 } }
    }
  }
}
```

### 2D components

A component that produces a 2D shape is used wherever a 2D shape is:

```hcl
component "slot_profile" {
  param length = 30
  param width  = 6

  stadium { size = [length, width]  center = true }
}

model "m" {
  extrude { height = 5  slot_profile { length = 40 } }
}
```

### Reuse is free

Identity in the geometry tree is content identity, so a component called twenty times with
the same arguments is **evaluated once** — its digest is the same each time, and the kernel
sees one node. Calling it twenty times with twenty different sizes does cost twenty
evaluations, because the content genuinely differs.

That makes it worth parameterising a component on what varies and letting position be a
`translate` on the outside: twenty copies of one shape in twenty places cost one shape and
twenty transforms.

---

## Troubleshooting

### `expected {, found "box"`

A `param` with no default and no body:

```hcl
component "c" {
  param s          // ✗ syntax error — the parser is looking for `=` or `{`
  box { size = [s, s, s] }
}

component "c" {
  param s { }      // ✓ declared, required at the call site
  box { size = [s, s, s] }
}
```

### `c: "s" has no default and was not given`

The component declares `s` with no default, and the call passed nothing. Either supply it at
the call site, or give the declaration a default.

### `c: unknown param "t"`

The call passed an attribute the component does not declare — usually a typo, or an
attribute meant for a block inside the component. Components have no pass-through: every
value they need must be declared.

### `component "box" shadows a builtin block`

The name is already a builtin. Pick another — `rounded_box`, `my_box`, `case_body`. See the
[full block list](../README.md#shapes) for what is taken.

### `a component cannot declare parts`

A [`part`](part.md) is a piece of the scene, not geometry an enclosing block can operate on,
so it cannot come out of a component. Invert it — put the part in the model and call the
component inside it:

```hcl
// ✗
component "c" { part "p" { box { size = [1, 1, 1] } } }

// ✓
component "c" { box { size = [1, 1, 1] } }
model "m" { part "p" { c { } } }
```

### `nesting deeper than 64 blocks — is a component using itself?`

Almost always direct or mutual recursion. There is no base case the evaluator can detect,
because a component's body is expanded before any condition inside it is known. Rewrite the
recursion as a [`for`](../language/control-flow.md#for) loop.

### `component "c" produced no geometry`

The body evaluated to nothing — an empty body, a loop over an empty list, or an `if` with no
`else` whose condition was false. A component must return something; guard at the call site
instead:

```hcl
if var.show_ribs { ribs { } }
```

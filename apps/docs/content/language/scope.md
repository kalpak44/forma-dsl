# Scope and names

Every name in a document resolves through a chain of scopes. This page says exactly what is
in each one, and in what order they are built — which is what determines whether a
declaration may refer to another.

---

## The root scope

Built once, before any geometry, in this order:

1. **Constants** — `pi` and `e`.
2. **Type names** — `number`, `string`, `bool`, `vector`, `list`, `angle`, each bound to
   itself as a string, so `type = number` in a param block resolves with no quoting.
3. **Params**, in source order. Each is bound under its bare name as it is resolved, so a
   later param's default may refer to an earlier one.
4. **`var`** — an object holding every resolved param.
5. **Locals**, in source order. Each is bound as it is resolved, so a later local may refer
   to an earlier one.

The order has two consequences worth knowing:

```hcl
param a = 3
param b = a * 2        // ✓ an earlier param, by its bare name
param c = var.a * 2    // ✗ unknown name "var" — var does not exist yet

local d = var.a + 1    // ✓ locals are built after var
local e = f            // ✗ unknown name "f" — a later local
local f = 2
```

---

## `var.` versus the bare name

Every param is reachable two ways: bare, and under `var`.

```hcl
param wall = 2

model "m" {
  box { size = [wall, var.wall, 1] }   // the same value, twice
}
```

They differ when something shadows the bare name. `var` holds **params only** — never
locals, never component params, never loop variables — so `var.NAME` is the unambiguous way
to reach an input:

```hcl
param a = 1
local a = 2            // shadows the bare name

model "m" {
  box { size = [a, var.a, 1] }   // [2, 1, 1]
}
```

Reading a local through `var` fails, because it is not there: `no attribute "a"`.

Prefer `var.` in models for anything that came from a param. It is the convention the
editor's examples follow, and it makes an input visually distinct from a local at the point
of use.

---

## Body scopes

Every block body — a `model`, a `component`, a builtin block, a `for` iteration, an `if`
branch — evaluates in a fresh scope nested inside its parent.

**Locals declared in a body are visible to the whole body**, not only to what follows them,
because every local in a body is resolved before any of its blocks are built:

```hcl
model "m" {
  box { size = [s, 1, 1] }   // ✓ s is already bound
  local s = 4
}
```

That is the opposite of the top-level rule, where locals are strictly ordered. Within one
body, ordering between locals still applies — a body local may not refer to a later body
local.

---

## Component isolation

A [`component`](../reference/component.md) body gets a fresh scope rooted at the **document
root**, not at the call site. A name that happens to exist where the component is used does
not leak into it.

```hcl
local g = 7

component "c" {
  param s = 1
  box { size = [s, g, 1] }     // ✓ its own param, and a document local
}

model "m" {
  local q = 5
  c { }                        // c cannot see q
}
```

Inside a component body, these are in scope:

- its own `param`s, bound from the attributes at the call site
- everything in the root scope — constants, type names, document params (bare and via `var.`)
  and document locals
- its own body locals

Nothing from the caller. Values travel in through params and no other way.

---

## Model params

A `model` may declare its own `param` blocks. They behave like locals with a declaration
syntax, not like document params:

- Each **must** have a default — `model "m": param "s" needs a default`.
- They are **not** settable from outside. `render(source, { params: { s: 9 } })` sets
  document params only; a model param keeps its default.
- They are bound in the model's scope under the bare name, and are not added to `var`.

```hcl
model "bracket" {
  param thickness { default = 4 }    // a fixed constant for this model
  box { size = [20, 20, thickness] }
}
```

For an input the caller can change, declare the param at the top level instead.

---

## Loop variables

[`for`](control-flow.md#for) binds one or two names in a child scope, live for one iteration:

```hcl
for size in sizes { ... }          // size is the value
for i, size in sizes { ... }       // i is the index, size the value
```

The names shadow anything of the same name in an enclosing scope, and are gone after the
loop.

---

## Shadowing summary

Innermost wins. From outermost to innermost:

```
constants and type names
  └─ params (bare)  ·  var  ·  locals
       └─ model scope: model params, model body locals
            └─ block body locals
                 └─ for-loop variables
```

A `component` body cuts the chain: it starts again from the root scope regardless of where
it was called.

---

## What cannot be shadowed

- **Builtin block names.** Declaring `component "box"` is an error:
  `component "box" shadows a builtin block`. Components and builtins share one namespace so
  a call site reads the same either way.
- **Builtin function names.** There are no user-defined functions, so nothing can shadow
  them.
- **Duplicate declarations** of the same kind are errors: `param "a" is declared twice`,
  `component "c" is declared twice`, `model "m" is declared twice`. Locals are the exception:
  a second `local a` is accepted and silently replaces the first everywhere, including in
  code written above it. Nothing warns about it, so treat it as a mistake to avoid rather
  than a feature.

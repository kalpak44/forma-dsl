# Control flow

Two constructs, both of which appear where a block appears and produce geometry rather than
a value. Neither is an expression — for a value that depends on a condition, use
[`cond ? a : b`](expressions.md#conditional).

---

## `for`

Repeats a body once per item in a list.

```hcl
for i in range(0, 6) { ... }        // one name: the value
for i, item in list { ... }          // two names: the index, then the value
```

Everything every iteration produces is collected and handed to the enclosing block, so a
loop inside an operation contributes several children to it:

```hcl
difference {
  extrude { height = 20  rounded_rect { size = [62, 13]  radius = 6.5  center = true } }

  for i, size in sizes {            // each iteration adds one more thing to subtract
    translate {
      offset = [(i - (len(sizes) - 1) / 2) * 8, 0, 2.5]
      extrude { height = 20  regular_polygon { sides = 6  width_across_flats = size } }
    }
  }
}
```

### Reference

| | |
| --- | --- |
| **Sequence** | Any expression that evaluates to a list. Iterating anything else is an error: `for: expected a list to iterate` |
| **Names** | One name binds the value. Two names bind the index and then the value |
| **Scope** | Each iteration gets a fresh child scope holding just those names |
| **Result** | The concatenation of what every iteration produced — geometry, and any `part`s |

#### Caveats

- A loop over an empty list produces nothing. If that is all a model contains, the model
  fails with `model "m" produced no geometry`. Guard the empty case with
  [`if`](#if) when a parameter can legitimately reach zero.
- `range(a, b)` **excludes** `b`, and produces an empty list rather than looping forever when
  the range runs backwards. See [`range`](../reference/functions.md#range).
- Iterating a string does not work — strings are not lists here. Use
  [`len`](../reference/functions.md#len) and index into it if you need the characters.
- There is no `break`, no `continue` and no accumulator. A loop that needs to skip items
  should filter the list it iterates, or wrap its body in an `if`.

### Building parts in a loop

A [`part`](../reference/part.md) inside a loop needs a distinct name, and the loop variable
is how it gets one:

```hcl
model "stacked_trays" {
  for i in range(0, var.rows) {
    part "tray_${i}" {
      color = i % 2 == 0 ? "#3f7fbf" : "#bf6b3f"
      translate { offset = [0, 0, i * 13]  tray { size = [40, 30, 12] } }
    }
  }
}
```

Part labels are expressions, so `"tray_${i}"` is evaluated once per iteration. Two parts with
the same name are not rejected, but the viewer will show two entries called the same thing.

### Radial arrays

The common pattern for anything on a bolt circle:

```hcl
for i in range(0, var.bolts) {
  rotate {
    z = i * 360 / var.bolts
    translate { offset = [var.plate_r - 9, 0, -1]  cylinder { radius = 3  height = 10 } }
  }
}
```

---

## `if`

Includes a body only when a condition holds.

```hcl
if var.reinforced {
  box { size = [40, 40, 4] }
}
```

With an alternative, and chained:

```hcl
if var.style == "round" {
  cylinder { radius = 10  height = 4 }
} else if var.style == "hex" {
  extrude { height = 4  regular_polygon { sides = 6  radius = 10 } }
} else {
  box { size = [20, 20, 4]  center = true }
}
```

### Reference

| | |
| --- | --- |
| **Condition** | Any expression. Judged by [truthiness](expressions.md#truthiness), so `if var.name { }` is true for a non-empty string |
| **Branches** | `else` takes a body; `else if` chains, nested rather than flattened |
| **Scope** | Each branch is its own body scope |
| **Result** | What the taken branch produced, or nothing when no branch is taken |

#### Caveats

- A condition is an ordinary expression, so both branches are *parsed* but only the taken one
  is evaluated. An error inside the untaken branch will not be reported.
- An `if` that takes no branch contributes nothing. Inside an operation that requires
  children, that can turn into `"translate" needs at least one shape inside it`.
- There is no `if` for attributes. Use the conditional operator:
  `color = var.hot ? "#e2593c" : "#3f7fbf"`.

### Making a part optional

Put the `if` **outside** the `part`, not inside it. A part with no geometry is an error
(`a part needs at least one shape inside it`), so guarding the contents is not enough:

```hcl
// ✓ the part exists only when it is wanted
if var.show_label {
  part "label" { color = "#f4f1e4"  ... }
}

// ✗ fails with "a part needs at least one shape inside it" when show_label is false
part "label" {
  if var.show_label { ... }
}
```

### Choosing between shapes

Because `if` produces geometry, it composes inside any operation:

```hcl
difference {
  box { size = [40, 40, 10] }

  if var.through {
    translate { offset = [20, 20, -1]  cylinder { radius = 4  height = 12 } }
  } else {
    translate { offset = [20, 20, 4]   cylinder { radius = 4  height = 7 } }
  }
}
```

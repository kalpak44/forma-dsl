# Expressions

Expressions appear on the right of every attribute, in `for` sequences, in `if` conditions,
in `part` labels and inside `${ }` splices. The language is dynamically typed: values carry
their type, and a mismatch is reported where it is used.

---

## Values

| Type | Literals | Notes |
| --- | --- | --- |
| **number** | `12`, `0.5`, `1e3` | Double precision. Infinities and NaN cannot be written and are rejected where a block reads a number |
| **string** | `"text"`, `"a ${b} c"` | Double quotes only; see [Syntax → Strings](syntax.md#strings) |
| **bool** | `true`, `false` | |
| **list** | `[1, 2, 3]`, `[[0,0], [1,0]]` | Heterogeneous and nestable. A list of numbers is what every block means by a *vector* |
| **object** | `{ w = 3, h = 4 }`, `{ w: 3 }` | `=` and `:` are interchangeable. Read with `.key` |
| **null** | `null` | Falsy; renders as the empty string in interpolation |

There is no separate vector type in the language — a vector is a list of numbers, and blocks
say how many components they want. Where a block wants a vector, a **single number is
accepted as shorthand for every component**, so `scale { factor = 2 }` and
`scale { factor = [2, 2, 2] }` are the same.

---

## Operators

Listed loosest-binding first. Everything in one row has equal precedence and associates left
to right.

| Precedence | Operators | Notes |
| --- | --- | --- |
| 1 (loosest) | `cond ? a : b` | Right-associative |
| 2 | `\|\|` | Short-circuits; always yields a bool |
| 3 | `&&` | Short-circuits; always yields a bool |
| 4 | `==` `!=` | Structural equality |
| 5 | `<` `<=` `>` `>=` | Both sides must be the same type |
| 6 | `+` `-` | |
| 7 | `*` `/` `%` | |
| 8 | `-x` `!x` | Prefix |
| 9 (tightest) | `a.b` `a[i]` `f(x)` | Postfix |

### Arithmetic

`+`, `-`, `*` and `/` are overloaded so that vector maths reads the way it is meant to.

```hcl
2 + 3                  // 5
[10, 20] + [1, 2]      // [11, 22]     componentwise
[10, 20] - [1, 2]      // [9, 18]      componentwise
[10, 20] * 2           // [20, 40]     scalar broadcast
2 * [10, 20]           // [20, 40]     either order
[10, 20] * [2, 3]      // [20, 60]     componentwise
[10, 20] / 2           // [5, 10]      scalar only
10 % 3                 // 1
```

What each accepts:

| Operator | Number ∘ number | List ∘ list | List ∘ number | Number ∘ list | Anything with a string |
| --- | --- | --- | --- | --- | --- |
| `+` | sum | componentwise | ✗ | ✗ | concatenation |
| `-` | difference | componentwise | ✗ | ✗ | ✗ |
| `*` | product | componentwise | broadcast | broadcast | ✗ |
| `/` | quotient | ✗ | broadcast | ✗ | ✗ |
| `%` | remainder | ✗ | ✗ | ✗ | ✗ |

Two lists of different lengths cannot be combined:
`cannot combine vectors of length 2 and 3`.

**Division and modulo by zero are errors**, not `Infinity` or `NaN` — a NaN would otherwise
travel all the way into the kernel and surface as a degenerate vertex a long way from its
cause.

### Concatenation

`+` concatenates when either side is a string. The other side is rendered by the same rules
as [interpolation](#string-interpolation):

```hcl
"part_" + 3            // "part_3"
"size " + [1, 2]       // "size [1, 2]"
```

### Comparison and equality

`==` and `!=` compare structurally, so two lists with the same numbers are equal:

```hcl
[1, 2] == [1, 2]       // true
1 == "1"               // false — different types are never equal
```

`<`, `<=`, `>` and `>=` require both sides to be the same type, and compare numbers
numerically and strings lexicographically. Mixing them is an error:
`cannot compare a number with a string`.

### Logic

`&&` and `||` short-circuit, so the right side is not evaluated when the left decides the
answer — `count > 0 && list[0] > 1` is safe on an empty list. Both always return a bool, even
when given non-bool operands: `1 || false` is `true`, not `1`.

`!x` negates the [truthiness](#truthiness) of any value. Unary `-` requires a number:
`cannot negate a non-number`.

### Conditional

```hcl
color = i % 2 == 0 ? "#3f7fbf" : "#bf6b3f"
```

Binds looser than everything else, so the condition needs no parentheses. It is
right-associative, so `a ? b : c ? d : e` chains as `a ? b : (c ? d : e)`.

---

## Truthiness

Conditions — in `? :`, `&&`, `||`, `!` and [`if`](control-flow.md#if) — accept any value.

| Falsy | Truthy |
| --- | --- |
| `false` | `true` |
| `0` | any other number |
| `""` | any non-empty string |
| `[]` | any non-empty list |
| `null` | any object, including `{}` |

Empty strings and empty lists being falsy is what makes `if var.label { ... }` and
`if var.sizes { ... }` read the way they are written.

---

## Member access and indexing

```hcl
local size = [40, 30, 12]
size.x        // 40
size.y        // 30
size.z        // 12
size[0]       // 40

local opts = { wall = 2, gap = 0.4 }
opts.wall     // 2
opts["wall"]  // 2
```

`.x`, `.y` and `.z` on a **list** are sugar for indices 0, 1 and 2 — they are not a vector
type. They are read on a list of any length, so `[1, 2].z` yields nothing rather than
raising; the failure surfaces later, wherever that nothing is used.

On an **object**, a missing key is an error: `no attribute "wdith"`. Reading a property of
`null` is too: `cannot read "x" of nothing`.

Indexing past the end of a list is *not* an error; it yields undefined, which then usually
fails where it is used. Indexing something that is neither a list, a string nor an object is
an error: `cannot index this value`.

---

## Function calls

```hcl
max(sizes)             // variadic, flattens its arguments
pow(2, 10)
sin(30)                // 0.5 — every angle is in degrees
```

Functions take **positional arguments only**. Named arguments are an error:
`pow: functions take positional arguments`. A fixed-arity function checks its count:
`len takes 1 argument(s), got 2`.

There are no user-defined functions. To name a piece of geometry, declare a
[`component`](../reference/component.md); to name a value, declare a
[`local`](../reference/local.md).

See the [function reference](../reference/functions.md) for all thirty of them.

---

## String interpolation

`${ ... }` splices any expression into a string.

```hcl
part "leg_${i}" { ... }
color = "#${hex}"
description = "wall ${var.wall}mm, ${len(sizes)} slots"
```

How each value renders:

| Value | Rendered as |
| --- | --- |
| number | `3`, `0.5` — JavaScript's default number formatting |
| string | itself |
| bool | `true` / `false` |
| list | `[1, 2, 3]` — elements joined by `, ` inside brackets, recursively |
| `null` | the empty string |
| object | `[object Object]` — not useful; read the fields you want instead |

A splice must contain exactly one expression; anything left over is an error:
`trailing input in ${ }`. Errors raised inside a splice are reported at the position of the
string that contains it, since the splice has no line of its own.

# Functions

Thirty builtin functions, callable in any [expression](../language/expressions.md). They take
**positional arguments only** — named arguments are an error — and there are no user-defined
functions: to name a value declare a [`local`](local.md), and to name geometry declare a
[`component`](component.md).

**Every angle is in degrees**, in both directions: `sin` takes degrees, `atan` returns them.

| | |
| --- | --- |
| [Arithmetic](#arithmetic) | `abs` `floor` `ceil` `round` `sqrt` `sign` `pow` `log` `exp` |
| [Trigonometry](#trigonometry) | `sin` `cos` `tan` `asin` `acos` `atan` `atan2` |
| [Aggregates](#aggregates) | `min` `max` `sum` |
| [Lists](#lists) | `len` `concat` `reverse` `contains` `join` `range` |
| [Conversion](#conversion) | `str` `num` |
| [Constants](#constants) | `pi` `e` |

---

## Arithmetic

| Function | Arity | Description |
| --- | --- | --- |
| `abs(x)` | 1 | Magnitude, discarding the sign |
| `floor(x)` | 1 | Rounds towards −∞ |
| `ceil(x)` | 1 | Rounds towards +∞ |
| `round(x)` | 1 | Rounds to the nearest integer, halves upwards |
| `sqrt(x)` | 1 | Square root. Negative input gives NaN, which fails where it is used |
| `sign(x)` | 1 | `-1`, `0` or `1` |
| `pow(x, y)` | 2 | `x` raised to `y` |
| `log(x)` | 1 | Natural logarithm |
| `exp(x)` | 1 | `e` raised to `x` |

```hcl
local rows = ceil(len(items) / 4)
local step = pow(2, var.doublings)
```

---

## Trigonometry

| Function | Arity | Takes | Returns |
| --- | --- | --- | --- |
| `sin(a)` | 1 | degrees | ratio |
| `cos(a)` | 1 | degrees | ratio |
| `tan(a)` | 1 | degrees | ratio |
| `asin(v)` | 1 | ratio | degrees |
| `acos(v)` | 1 | ratio | degrees |
| `atan(v)` | 1 | ratio | degrees |
| `atan2(y, x)` | 2 | two lengths | degrees, in the correct quadrant |

Degrees throughout is deliberate: every angle a model writes is in degrees, and a stray
radian conversion is invisible until the part is printed.

```hcl
// A point on a bolt circle
local angle = i * 360 / var.bolts
local point = [var.r * cos(angle), var.r * sin(angle)]

// The angle of a slope
local rake = atan2(var.rise, var.run)
```

Note the argument order of `atan2`: **y first**, then x.

---

## Aggregates

| Function | Arity | Description |
| --- | --- | --- |
| `min(...)` | variadic | The smallest value |
| `max(...)` | variadic | The largest value |
| `sum(...)` | variadic | Everything added together; `0` for no arguments |

All three **flatten their arguments**, so a list and a spread of numbers both work:

```hcl
min(3, 7, 2)           // 2
min([3, 7, 2])         // 2
max(sizes)             // the largest entry
sum(thicknesses)       // total stack height
```

This is how a value gets clamped, since the language has no `clamp`:

```hcl
local bolts = max(3, min(16, var.bolts))
```

#### Caveats

- `min()` and `max()` with no arguments return `Infinity` and `-Infinity`, which fail with
  `must be a finite number` wherever a block reads them. Guard an empty list.

---

## Lists

### `len`

`len(value)` → number

The length of a list or a string. Anything else gives `0` — it does not raise.

```hcl
len([1, 2, 3])      // 3
len("abcd")         // 4
len(42)             // 0
```

### `concat`

`concat(...)` → list

Joins lists and values into one flat list.

```hcl
concat([1, 2], [3])        // [1, 2, 3]
concat(sizes, [10, 12])    // sizes with two more entries
```

Flattens one level, like the aggregates.

### `reverse`

`reverse(list)` → list

A reversed copy. The original is untouched.

```hcl
reverse([1, 2, 3])          // [3, 2, 1]
concat(profile, reverse(profile))
```

### `contains`

`contains(list, value)` → bool

Whether the list holds the value. Comparison is by identity for numbers and strings, so it
does not match nested lists structurally.

```hcl
contains(["a", "b"], var.mode)
```

### `join`

`join(separator, list)` → string

Joins a list into a string. **The separator comes first.**

```hcl
join("-", ["M3", "x", "12"])      // "M3-x-12"
join(", ", sizes)
```

### `range`

`range(end)` · `range(start, end)` · `range(start, end, step)` → list

A list of numbers. The end is **excluded**.

```hcl
range(4)              // [0, 1, 2, 3]
range(2, 6)           // [2, 3, 4, 5]
range(0, 10, 2.5)     // [0, 2.5, 5, 7.5]
range(5, 0, -1)       // [5, 4, 3, 2, 1]
range(0, -5)          // []  — backwards with a positive step is empty, not infinite
```

This is what drives most [`for`](../language/control-flow.md#for) loops.

#### Caveats

- **The end is excluded**, so `range(0, var.bolts)` gives exactly `bolts` values.
- A `step` of `0` is an error: `range: step cannot be 0`.
- A range running the wrong way for its step is **empty** rather than infinite, which is what
  a loop written around a parameter needs when the parameter crosses zero.
- More than 100,000 values is an error: `range: more than 100000 values`. The guard exists
  because in a live editor `range(0, 1e9)` is a state the document passes through while the
  number is being typed.
- Floating-point accumulation applies. `range(0, 1, 0.1)` may not end where you expect;
  prefer integer counts and multiply: `for i in range(0, 10) { local t = i / 10 ... }`.

---

## Conversion

| Function | Arity | Description |
| --- | --- | --- |
| `str(v)` | 1 | The value as a string |
| `num(v)` | 1 | The value as a number; non-numeric text gives NaN |

```hcl
part "slot_${str(i)}" { ... }     // though "${i}" already does this
local n = num(var.text_input)
```

String interpolation already converts, so `str` is mostly useful when building a string with
`+`.

---

## Constants

| Name | Value |
| --- | --- |
| `pi` | 3.141592653589793 |
| `e` | 2.718281828459045 |

They are ordinary names in the root scope, so they can be shadowed by a param or a local —
avoid doing so.

```hcl
local circumference = 2 * pi * var.radius
```

Since every angle in the language is in degrees, `pi` comes up less than it would elsewhere —
mostly in arc lengths and areas rather than in rotations.

---

## Usage

### Clamping a parameter

`min`/`max` bounds are advisory in a [`param`](param.md) block. Enforce them where it matters:

```hcl
param bolts { type = number  default = 6  min = 3  max = 16  step = 1 }

local bolts = max(3, min(16, round(var.bolts)))
```

### Laying out an array from a list

`len` gives the count, and the index does the rest:

```hcl
local sizes = [1.5, 2, 2.5, 3, 4, 5, 6]

for i, size in sizes {
  translate {
    offset = [(i - (len(sizes) - 1) / 2) * var.spacing, 0, 0]   // centred on the origin
    ...
  }
}
```

### Polar coordinates

```hcl
for i in range(0, var.count) {
  local a = i * 360 / var.count
  translate {
    offset = [var.r * cos(a), var.r * sin(a), 0]
    cylinder { radius = 2  height = 10 }
  }
}
```

Equivalent to rotating a translated copy, and sometimes easier to read when each item also
needs its own orientation.

### Building a label

```hcl
param sizes = [3, 4, 5]

model "m" {
  part "set_${join("_", var.sizes)}" { ... }     // "set_3_4_5"
}
```

---

## Troubleshooting

### `len takes 1 argument(s), got 2`

A fixed-arity function got the wrong count. The variadic ones — `min`, `max`, `sum`,
`concat`, `range` — accept any number; the rest do not.

### `pow: functions take positional arguments`

Named arguments are not supported: `pow(2, 10)`, never `pow(x = 2, y = 10)`.

### `unknown function "clamp"`

There is no `clamp`, no `abs` on lists, no `map` and no `filter`. Compose what you need from
`min`/`max`, and use a [`for`](../language/control-flow.md#for) loop where you would reach for
`map`.

### `range: step cannot be 0`

A step of zero would never terminate. If the step is computed, guard it.

### `range: more than 100000 values`

Usually a range whose end is a mistyped parameter. The limit is a guard against a live editor
allocating until the tab dies.

### `... must be a finite number`

Something upstream produced `NaN` or `Infinity` — `sqrt` of a negative, `min()` of nothing,
`num("abc")`. The error names the block and attribute that read it, not where it was
produced, so work backwards from there.

### My `join` produced the arguments the wrong way round

The separator is first: `join(", ", list)`.

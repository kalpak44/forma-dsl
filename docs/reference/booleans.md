# Booleans

The three constructive solid geometry operations. Each takes its children as a **list**
rather than unioning them first, which is what makes `difference` meaningful.

All three work in 2D and 3D, but every child must be the same dimensionality:
`"union" cannot mix 2D and 3D shapes`.

---

## `union`

Everything added together.

```hcl
union {
  box { size = [40, 20, 10] }
  translate { offset = [0, 0, 10]  cylinder { radius = 8  height = 6 } }
}
```

#### Attributes

None.

#### Caveats

- **Usually unnecessary.** Sibling blocks are already implicitly unioned, so
  `part "p" { a  b }` and `part "p" { union { a  b } }` are the same. Write `union`
  explicitly when it makes the grouping clearer — typically as one operand of a
  `difference`.
- The order of the children does not affect the result, and does not affect the digest
  either: union members are sorted by subtree size before hashing, so two unions written in a
  different order share a cache entry.
- Empty children are dropped. A union of nothing is empty geometry rather than an error.

---

## `difference`

The first child, with every later child cut out of it.

```hcl
difference {
  cylinder { radius = 40  height = 8 }        // the body

  translate { offset = [0, 0, -1]             // everything after it is removed
    cylinder { radius = 12  height = 10 } }

  for i in range(0, 6) {
    rotate { z = i * 60
      translate { offset = [30, 0, -1]  cylinder { radius = 3  height = 10 } } }
  }
}
```

#### Attributes

None.

#### Caveats

- **Order matters, and only here.** The first child is the body; every later one is a cutter.
  This is the one boolean whose children are never reordered, for exactly that reason.
- A `for` loop inside a difference contributes one cutter per iteration, which is the normal
  way to make an array of holes.
- Subtracting everything leaves empty geometry rather than an error. A part that ends up
  empty renders as nothing.

---

## `intersection`

Only what every child shares.

```hcl
intersection {
  bottle_void { }
  translate { offset = [0, 0, -1]  cylinder { radius = 40  height = 100 } }
}
```

#### Attributes

None.

#### Caveats

- With one child, it is that child. With none, it is an error —
  `"intersection" needs at least one shape inside it`.
- Order does not affect the result.

---

## Usage

### Hollowing a shell

A solid minus a slightly smaller copy of itself. Naming both as components keeps the two
profiles beside each other and lets the digest cache solve each once even when several parts
need them:

```hcl
component "bottle_solid" { revolve { polygon { points = silhouette } } }
component "bottle_void"  { revolve { polygon { points = cavity } } }

model "bottle" {
  part "bottle" {
    difference {
      bottle_solid { }
      bottle_void { }
    }
  }

  part "water" {
    intersection {                       // the same void, reused for free
      bottle_void { }
      translate { offset = [0, 0, -1]  cylinder { radius = 40  height = 130 } }
    }
  }
}
```

### Arrays of holes

A loop inside a `difference` is the standard bolt pattern:

```hcl
difference {
  extrude { height = 8  circle { radius = 40 } }

  for i in range(0, var.bolts) {
    rotate {
      z = i * 360 / var.bolts
      translate { offset = [31, 0, -1]  cylinder { radius = 3  height = 10 } }
    }
  }
}
```

### Trimming to a region

`intersection` with a large primitive is how a shape is cropped:

```hcl
intersection {
  complicated_thing { }
  translate { offset = [-50, -50, 0]  box { size = [100, 100, 12] } }  // keep 0 ≤ z ≤ 12
}
```

For a single flat cut, [`trim`](refinement.md#trim) is cheaper — it cuts with a half-space
and needs no second solid.

### Grouping so a transform applies to several shapes

Every operation *except* these three unions its children first, so this already works:

```hcl
translate {
  offset = [0, 0, 10]
  box { size = [4, 4, 4] }
  sphere { radius = 3 }       // both move together
}
```

Inside a `difference`, though, each child is separate — so to subtract two shapes *as one
body*, group them explicitly:

```hcl
difference {
  plate { }
  union {                      // one cutter made of two shapes
    cylinder { radius = 4  height = 20 }
    translate { offset = [0, 0, 6]  cylinder { radius = 7  height = 20 } }
  }
}
```

Here the `union` is not decorative: without it the two cylinders would be two separate
cutters, which happens to give the same result for a difference — but not for an
`intersection`, where it changes the answer entirely.

---

## Troubleshooting

### `"difference" needs at least one shape inside it`

The body is empty, or everything in it was produced by an `if` that took no branch or a `for`
over an empty list.

### `"union" cannot mix 2D and 3D shapes`

One child is a cross-section and another is a solid. Usually a profile that was meant to be
extruded:

```hcl
union {
  box { size = [10, 10, 10] }
  circle { radius = 3 }                          // ✗ still 2D
  extrude { height = 10  circle { radius = 3 } } // ✓
}
```

### My difference removed nothing

The cutter is not where you think, or does not overlap the body. Check by rendering the
cutter as its own [`part`](part.md) with an opacity, which shows exactly where it sits:

```hcl
part "cutter" { color = "#ff6b7f"  opacity = 0.4  the_cutter { } }
```

### The result has stray faces where two solids meet

Coincident surfaces. Overlap unioned solids slightly, and overshoot cutters past both faces
they pass through.

### My difference is slow

Each cutter is a boolean. A hundred of them in one `difference` is a hundred kernel
operations; unioning the cutters first is often faster, because the union of many small
disjoint solids is cheap and the subtraction then happens once:

```hcl
difference {
  body { }
  union { for i in range(0, 100) { ... } }
}
```

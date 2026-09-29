# Document structure

A forma document is a flat list of top-level blocks. Only four kinds may appear there:
[`param`](../reference/param.md), [`local`](../reference/local.md),
[`component`](../reference/component.md) and [`model`](../reference/model.md). Anything else
at the top level is an error.

```hcl
param wall = 2                       // an input
local sizes = [10, 20, 30]           // a computed value

component "plate" {                  // a reusable block
  param size = [20, 20]
  extrude { height = wall  rect { size = size  center = true } }
}

model "stack" {                      // something to render
  for i, s in sizes {
    translate { offset = [0, 0, i * wall]  plate { size = [s, s] } }
  }
}
```

Order does not matter between declarations of different kinds — a `model` may use a
`component` declared below it. Order does matter among `local`s, which are evaluated top to
bottom. See [Scope and names](scope.md).

---

## The pipeline

```
source ──▶ lexer ──▶ parser ──▶ evaluator ──▶ geometry nodes ──▶ Manifold (WASM) ──▶ mesh
                                    │                │
                                params          digest cache
```

Each stage has a distinct job, and knowing which stage raised an error tells you what kind of
mistake it was.

1. **Lexer** turns characters into tokens. It rejects unknown characters, unterminated
   strings and unterminated block comments.
2. **Parser** turns tokens into an abstract syntax tree. It rejects anything that is not
   grammatical — a missing brace, a keyword used as a block type, a `param` block containing
   nested blocks.
3. **Evaluator** resolves params and locals, then walks the models. It rejects unknown names,
   bad operands, unknown blocks, unknown attributes and dimensionality mismatches. Its output
   is a tree of [geometry nodes](../api/geometry-node.md) — it never calls the kernel itself.
4. **Kernel** solves the node tree into concrete solids, memoized by node digest in an
   [`EvaluationContext`](../api/evaluation-context.md).

The separation between steps 3 and 4 is what makes editing cheap. The evaluator is pure and
fast; the kernel is where the time goes, and it is asked only about subtrees whose content
actually changed.

The one exception is [`align`](../reference/align.md), which has to measure its child before
it can decide where to put it. It is the only block that reaches into the kernel during
evaluation, and the only one that fails when there is no kernel context.

---

## Nesting is composition

There is no separate expression language for geometry. A block's children *are* its operands,
written inside its braces:

```hcl
difference {                    // subtract…
  box { size = [20, 20, 10] }   // …this is the first operand
  cylinder { radius = 5  height = 30 }   // …and this is cut out of it
}
```

**Several children in a row are implicitly unioned.** Every operation except the three
booleans unions its children before acting on them, so a transform applied to two shapes
moves both together:

```hcl
translate {
  offset = [0, 0, 10]
  box { size = [4, 4, 4] }       // these two are unioned first,
  sphere { radius = 3 }          // then the union is moved
}
```

[`difference`](../reference/booleans.md#difference) is the operation where order matters: the
first child is the body and every later child is cut out of it. `union` and `intersection`
receive their children as a list too, but the result does not depend on the order.

An operation with no children is an error; a shape with children is an error.

---

## Dimensionality

Every piece of geometry is either 2D or 3D, and the language tracks which.

- **2D shapes** — `rect`, `rounded_rect`, `circle`, `ellipse`, `regular_polygon`, `stadium`,
  `polygon` — produce cross-sections.
- **3D shapes** — `box`, `sphere`, `cylinder`, `cone`, `torus` — produce solids.
- **Operations** either fix what they accept (`extrude` takes 2D, `refine` takes 3D) or pass
  their children's dimensionality through (`translate`, `rotate`, `hull`, the booleans).

Three rules follow, and each has its own error message:

| Rule | Error when broken |
| --- | --- |
| The children of one block must all be the same dimensionality | `"union" cannot mix 2D and 3D shapes` |
| A block that fixes what it takes must get it | `"extrude" takes 2D geometry, got 3D` |
| Anything rendered must be 3D | `part "body" is 2D — extrude or revolve it before rendering` |

To get from 2D to 3D use [`extrude`](../reference/conversions.md#extrude) or
[`revolve`](../reference/conversions.md#revolve); to go back use
[`project`](../reference/conversions.md#project) or
[`slice`](../reference/conversions.md#slice).

---

## Units and orientation

- **Lengths are unitless.** Every consumer treats them as millimetres — STL has no unit
  either — but nothing in the language enforces that.
- **Angles are always in degrees.** Everywhere: `rotate { z = 90 }`, `revolve { angle = 180 }`,
  `sin(30)`, `param a { type = angle }`. There is no radian form in the language. The
  JavaScript [`Angle`](../api/values.md#angle) class stores radians internally, and that is
  the only place radians appear.
- **Z is up.** `extrude` sweeps along +Z. `revolve` spins a profile written in the XY plane
  about the Y axis, mapping the profile's Y to the result's Z, so a profile drawn from
  `[0, 0]` upwards produces a solid standing on the XY plane.
- **3D rotations apply X, then Y, then Z**, matching OpenSCAD, so a model ported from there
  lands in the same orientation.

---

## Identity is content

The evaluator does not produce a call graph — it produces a tree of immutable nodes, each
carrying a 128-bit digest of its own content and its children's digests. Two structurally
identical subtrees have the same digest and therefore *are* the same node.

That has consequences worth designing around:

- A component used twenty times is evaluated once. Eight spheres in a loop cost one sphere
  and eight transforms.
- Two shapes written with their attributes in a different order still share a cache entry —
  object keys are sorted before they are digested.
- The members of a `union` are sorted by subtree size, so two unions written in a different
  order also share a digest. `difference` is never reordered, because its first child means
  something different from the rest.
- Nested transforms collapse into a single matrix, so a deep stack of `translate` blocks is
  one kernel call rather than one per level.
- The digest is computed from the IEEE bits of every number, never from a runtime-seeded
  hash, so it is the same in every browser and every run.

See [`GeometryNode`](../api/geometry-node.md) for the node types themselves, and
[`EvaluationContext`](../api/evaluation-context.md) for the cache built on top of them.

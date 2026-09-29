# forma Reference

`forma` is a declarative language for describing solids. A document is a list of top-level
blocks; geometry is written by **nesting blocks**, where a block's children are its operands.
The evaluator turns a document into a tree of immutable geometry nodes, and the
[Manifold](https://github.com/elalish/manifold) CSG kernel — compiled to WebAssembly — solves
that tree into meshes.

```hcl
param height { type = number  default = 20  min = 8  max = 40 }

model "riser" {
  part "body" {
    color = "#6f7d8c"

    difference {
      extrude {
        height = var.height
        rounded_rect { size = [40, 20]  radius = 4  center = true }
      }
      translate {
        offset = [0, 0, 3]
        cylinder { radius = 5  height = var.height }
      }
    }
  }
}
```

This reference documents every construct in the language and every function the JavaScript
package exports. For a tour of the project itself — how to run the editor, how to consume the
library from Node — see the [top-level README](../../../README.md).

---

## Learn the language

Read these in order the first time.

| Page | What it covers |
| --- | --- |
| [Document structure](language/overview.md) | The four top-level blocks, the evaluation pipeline, nesting and implicit union, dimensionality |
| [Syntax](language/syntax.md) | Comments, numbers, strings, identifiers, labels, the rule that a newline ends an attribute |
| [Expressions](language/expressions.md) | Values, operators, precedence, truthiness, interpolation, member access |
| [Scope and names](language/scope.md) | What is in scope where, `var.`, shadowing, component isolation |
| [Control flow](language/control-flow.md) | `for` and `if` / `else if` / `else` |

---

## Declarations

The four blocks that may appear at the top level of a document.

| Declaration | Description |
| --- | --- |
| [`param`](reference/param.md) | An input, exposed in the editor as a control and readable as `var.NAME` |
| [`local`](reference/local.md) | A named value, computed once |
| [`component`](reference/component.md) | A reusable parameterised block, callable like any builtin |
| [`model`](reference/model.md) | Something to render. A document may declare several |

---

## Shapes

Leaf blocks. They take attributes and never contain other blocks.

| Block | Dimensionality | Description |
| --- | --- | --- |
| [`rect`](reference/shapes-2d.md#rect) | 2D | An axis-aligned rectangle |
| [`rounded_rect`](reference/shapes-2d.md#rounded_rect) | 2D | A rectangle with true arcs at the corners |
| [`circle`](reference/shapes-2d.md#circle) | 2D | A circle, from a radius or a diameter |
| [`ellipse`](reference/shapes-2d.md#ellipse) | 2D | A circle scaled to two exact radii |
| [`regular_polygon`](reference/shapes-2d.md#regular_polygon) | 2D | An *n*-gon, sized across flats, across corners, or by radius |
| [`stadium`](reference/shapes-2d.md#stadium) | 2D | A rectangle fully rounded on its short axis |
| [`polygon`](reference/shapes-2d.md#polygon) | 2D | An explicit outline, or several contours with holes |
| [`box`](reference/shapes-3d.md#box) | 3D | An axis-aligned cuboid |
| [`sphere`](reference/shapes-3d.md#sphere) | 3D | A sphere |
| [`cylinder`](reference/shapes-3d.md#cylinder) | 3D | A cylinder, or a frustum from two radii |
| [`cone`](reference/shapes-3d.md#cone) | 3D | A cone, or a truncated cone |
| [`torus`](reference/shapes-3d.md#torus) | 3D | A ring, optionally a partial arc |

2D shapes cannot be rendered on their own — [`extrude`](reference/conversions.md#extrude) or
[`revolve`](reference/conversions.md#revolve) them first.

---

## Operations

Blocks that take geometry as children and produce new geometry.

| Block | Takes | Description |
| --- | --- | --- |
| [`union`](reference/booleans.md#union) | 2D or 3D | Everything added together |
| [`difference`](reference/booleans.md#difference) | 2D or 3D | The first child, with every later child cut out of it |
| [`intersection`](reference/booleans.md#intersection) | 2D or 3D | Only what every child shares |
| [`translate`](reference/transforms.md#translate) | 2D or 3D | Moves geometry |
| [`rotate`](reference/transforms.md#rotate) | 2D or 3D | Turns geometry about the origin |
| [`scale`](reference/transforms.md#scale) | 2D or 3D | Scales geometry about the origin |
| [`mirror`](reference/transforms.md#mirror) | 2D or 3D | Reflects geometry in a plane through the origin |
| [`extrude`](reference/conversions.md#extrude) | 2D → 3D | Sweeps a profile along Z, with optional twist and taper |
| [`revolve`](reference/conversions.md#revolve) | 2D → 3D | Turns a profile about the Y axis into a solid of revolution |
| [`project`](reference/conversions.md#project) | 3D → 2D | The shadow of a solid on the XY plane |
| [`slice`](reference/conversions.md#slice) | 3D → 2D | The cross-section of a solid at one Z |
| [`offset`](reference/refinement.md#offset) | 2D | Grows or shrinks an outline |
| [`hull`](reference/refinement.md#hull) | 2D or 3D | The convex hull of everything inside |
| [`refine`](reference/refinement.md#refine) | 3D | Subdivides edges longer than a limit |
| [`simplify`](reference/refinement.md#simplify) | 2D or 3D | Removes vertices within a tolerance |
| [`smooth`](reference/refinement.md#smooth) | 3D | Rounds edges below a sharpness threshold |
| [`trim`](reference/refinement.md#trim) | 3D | Cuts a solid with a half-space |
| [`align`](reference/align.md) | 2D or 3D | Moves geometry so a measured feature of its bounding box lands where you say |

---

## Scene

| Block | Description |
| --- | --- |
| [`part`](reference/part.md) | A separately coloured piece of the rendered scene |

---

## Expressions

| Page | What it covers |
| --- | --- |
| [Functions](reference/functions.md) | `abs`, `min`, `len`, `range`, `sin`, and the rest of the builtin functions |
| [Constants](reference/functions.md#constants) | `pi` and `e` |
| [Operators](language/expressions.md#operators) | Arithmetic, comparison, logic, and what each accepts |

---

## JavaScript API

`src/` is the library; the editor is one consumer of it. Everything below is exported from
the package root and typed by hand-written declarations.

| API | Description |
| --- | --- |
| [`render`](api/render.md) | Compile a document and evaluate one model into renderable parts |
| [`describeParameters`](api/describe-parameters.md) | Read a document's declared params without rendering |
| [`EvaluationContext`](api/evaluation-context.md) | The digest cache and the owner of every WASM object |
| [`GeometryNode`](api/geometry-node.md) | The immutable, content-addressed geometry IR |
| [`loadKernel`, `setQuality`, `resetQuality`](api/kernel.md) | Loading and tuning the Manifold module |
| [`toRenderMesh`, `toBinarySTL`](api/export.md) | Turning a solid into buffers or a file |
| [`Vector`, `Angle`, `Transform`](api/values.md) | The value types the evaluator works in |
| [`Program`, `Evaluator`, `parse`, `tokenize`, …](api/low-level.md) | The compiler stages, and the block and function registries |

---

## Errors

[Every error message](errors.md), what raises it, and what to change — the language's errors
in one place, grouped by the stage that raises them.

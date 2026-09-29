# forma-dsl

[![CI](https://github.com/kalpak44/forma-dsl/actions/workflows/ci.yml/badge.svg)](https://github.com/kalpak44/forma-dsl/actions/workflows/ci.yml)

A declarative DSL for 3D modeling and scene composition, reusable components, and live previews.

Models are written as text — blocks, attributes and expressions in a Terraform-flavored
syntax - parsed in the browser and solved by the [Manifold](https://github.com/elalish/manifold)
CSG kernel compiled to WebAssembly. The editor ships with it: type, and the solid updates.

```hcl
param height { type = number  default = 20  min = 8  max = 40 }

local sizes = [1.5, 2, 2.5, 3, 4, 5, 6]

model "hex_key_holder" {
  part "body" {
    color = "#6f7d8c"

    difference {
      align {
        x = "center"  y = "center"
        extrude {
          height = var.height
          rounded_rect { size = [62, 13]  radius = 6.5  center = true }
        }
      }

      for i, size in sizes {
        translate {
          offset = [(i - (len(sizes) - 1) / 2) * 8, 0, 2.5]
          extrude {
            height = var.height
            regular_polygon { sides = 6  width_across_flats = size + 0.3 }
          }
        }
      }
    }
  }
}
```

## Running it

```bash
npm install
npm run dev      # editor at http://localhost:5173
npm run build    # static bundle in dist/
npm run check    # everything CI runs: lint, types, tests, build, package contents
```

Individually:

| Script | What it does |
| --- | --- |
| `npm test` | Language, geometry, cache, value and export tests |
| `npm run test:coverage` | The same, with Node's coverage reporter |
| `npm run lint` | ESLint over `src/`, `web/`, `test/` and `scripts/` |
| `npm run typecheck` | Checks the published declarations against a usage file |
| `npm run check:package` | Asserts the npm tarball holds the library and nothing else |
| `npm run build:docs` | Renders `docs/` into `dist/docs/`, checking every cross-reference |

## Documentation

[`docs/`](docs/README.md) is the full reference for the language and the JavaScript API —
every block, every function, every error, with usage and troubleshooting for each. It reads
as Markdown in the repository and is published alongside the editor at `/docs/`.

## How it is built

The build is a static site — no server, no backend. Everything, including the geometry
kernel, runs in the browser. Set `VITE_BASE` when it will be served from a subdirectory:
`VITE_BASE=/forma-dsl/ npm run build`. The included [Pages workflow](.github/workflows/pages.yml)
does this on every push to `main`, publishing the editor at the root and the docs under
`/docs/`.

A fork has to turn Pages on once, under **Settings → Pages → Source: GitHub Actions**. The
workflow cannot do it: creating a Pages site needs `administration: write`, which a workflow
token cannot be granted. Until then the build fails at `configure-pages` with
`Get Pages site failed`.

## Using it from Node

`src/` is the library; the editor is one consumer of it. It ships with hand-written
TypeScript declarations, so the API is typed from either language.

```bash
npm install forma-dsl
```

```js
import { render, toBinarySTL, EvaluationContext } from 'forma-dsl';
import { writeFile } from 'node:fs/promises';

const source = `
  param height { type = number  default = 20  min = 8  max = 40 }
  model "riser" {
    extrude {
      height = var.height
      rounded_rect { size = [40, 20]  radius = 4  center = true }
    }
  }
`;

// One context, reused: the digest cache is what makes the second render of a changed
// document cheap, and a fresh context starts empty every time.
const context = await EvaluationContext.create();

for (const height of [10, 20, 30]) {
  const result = await render(source, { params: { height }, context });
  await writeFile(`part-${height}.stl`, toBinarySTL(result.parts[0].concrete));
  // Free what this tree can no longer reach, so a long run stays bounded.
  context.collect(result.parts.map((part) => part.node));
}

context.dispose();
```

`describeParameters(source)` returns what a document declares — name, type, bounds,
description, and whether a value is required — which is everything needed to build controls
for it without rendering anything.

## The language

A document is a list of top-level blocks. Geometry is composed by **nesting blocks**: a
block's children are its operands, and several children in a row are implicitly union.

### Top-level blocks

| Block | Purpose |
| --- | --- |
| `param NAME { … }` or `param NAME = expr` | An input, exposed in the editor as a control. Read as `var.NAME`. |
| `local NAME = expr` | A named value, computed once. |
| `component "NAME" { … }` | A reusable, parameterised block, callable like any builtin. |
| `model "NAME" { … }` | Something to render. A document may declare several. |

A `param` block takes `type`, `default`, `min`, `max`, `step` and `description`. Only
`default` affects geometry; the rest shape the editor control.

### Shapes

2D: `rect`, `rounded_rect`, `circle`, `ellipse`, `regular_polygon`, `stadium`, `polygon`.
3D: `box`, `sphere`, `cylinder`, `cone`, `torus`.

2D shapes cannot be rendered directly — `extrude` or `revolve` them first.

### Operations

`union`, `difference`, `intersection`, `hull`, `translate`, `rotate`, `scale`, `mirror`,
`extrude`, `revolve`, `offset`, `project`, `slice`, `trim`, `refine`, `simplify`, `smooth`,
`align`, `part`.

`difference` subtracts every later child from the first. Every other operation unions its
children before acting on them, so `translate { a  b }` moves both together.

`align` is the one operation that measures: it moves geometry so a face or the centre of
its bounding box lands where you say — `x = "center"`, `y = "min"`, `z = 5`.

### Scenes

A `part "name"` block inside a model is a separately coloured piece of the scene:

```hcl
model "assembly" {
  part "frame" { color = "#6f7d8c"  box { size = [40, 40, 4] } }
  part "pin"   { color = "#c8842f"  translate { offset = [0,0,4] cylinder { radius = 3 height = 10 } } }
}
```

Parts are solved independently and rendered in their own colour. Geometry written directly
in a model, outside any part, becomes one default part.

### Expressions

Numbers, strings, booleans, lists and objects, with `+ - * / %`, comparisons, `&& || !`,
`cond ? a : b`, indexing, `.x`/`.y`/`.z` on lists, and `"${…}"` interpolation. A list and a
number combine componentwise, so `[10, 20] * 2` is `[20, 40]`.

Functions: `abs floor ceil round sqrt sign pow log exp min max sum len concat reverse
contains join str num range`, and `sin cos tan asin acos atan atan2` — **all angles are in
degrees**, everywhere in the language.

### Control flow

```hcl
for i in range(0, 6) { … }        // value
for i, item in list { … }          // index and value
if var.reinforced { … } else { … }
```

## How it works

```
source ──▶ lexer ──▶ parser ──▶ evaluator ──▶ geometry nodes ──▶ Manifold (WASM) ──▶ mesh
                                    │                │
                                params          digest cache
```

The evaluator does not call the kernel. It produces a tree of immutable **geometry nodes**,
each carrying a 128-bit digest of its own content and its children's digests. Identity is
digest identity, so a component used twenty times is one node, evaluated once — eight
spheres in a loop cost one sphere and eight transforms. The digest is computed from the
IEEE bits of every number rather than from a hash the runtime seeds per process, so it is
the same in every browser and every run.

Nodes are the only thing that reaches the kernel, and every result is memoized by digest.
A context is meant to outlive a single render — that is what makes an edit cheap, since only
the subtrees whose content actually changed are re-evaluated. Typing a digit into a
dimension re-solves that wall and nothing else.

WebAssembly objects are not garbage-collected, so an `EvaluationContext` owns everything it
produced. `collect(roots)` frees what the current tree can no longer reach, keeping a
recently-used tail so an undone edit still hits the cache, and `dispose()` frees the lot.
The editor keeps one context for the life of the page and collects after each render.

## Layout

```
src/
  lang/      lexer, parser, evaluator, builtin blocks and functions
  core/      geometry node IR, content digest, evaluation cache, WASM kernel loader
  values/    vectors, angles, affine transforms
  export/    render mesh and binary STL
  index.js   the public API, and index.d.ts describing it
web/         editor, viewer and examples
test/        language, geometry, cache, value, parameter and export tests
scripts/     maintenance checks run by CI
```

`src/` is the library and has one runtime dependency, `manifold-3d`. The editor's
dependencies — CodeMirror, three.js, Vite — are dev-only and are not installed when the
package is consumed from Node. `npm run check:package` keeps that true.

## License

MIT — see [LICENSE](LICENSE).

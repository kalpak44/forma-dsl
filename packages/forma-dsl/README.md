# forma-dsl

[![Release](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml/badge.svg)](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/forma-dsl.svg)](https://www.npmjs.com/package/forma-dsl)

A declarative DSL for 3D modeling and scene composition, with reusable components and live
previews.

Models are written as text — blocks, attributes and expressions in an HCL-like syntax —
parsed and solved by the [Manifold](https://github.com/elalish/manifold) CSG kernel compiled
to WebAssembly. It runs unchanged in Node and in the browser.

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

## The language in one screen

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

Geometry is composed by **nesting blocks**: a block's children are its operands, and several
children in a row are implicitly union. Angles are in degrees, everywhere.

## API

| Export | What it does |
| --- | --- |
| `render(source, options?)` | Compile a document and evaluate one model into renderable parts |
| `describeParameters(source)` | Read a document's declared inputs, without rendering |
| `EvaluationContext` | The digest cache, and the owner of every WASM object |
| `GeometryNode` | The immutable, content-addressed geometry IR |
| `toRenderMesh` · `toBinarySTL` | Buffers for a renderer, or a file for a slicer |
| `Vector` · `Angle` · `Transform` | The value types the evaluator works in |
| `loadKernel` · `setQuality` | Loading and tuning the Manifold module |
| `Program` · `Evaluator` · `parse` · `tokenize` | The compiler stages, for tools |
| `BLOCKS` · `FUNCTIONS` · `CONSTANTS` | The registries, so an editor need not restate them |

Hand-written TypeScript declarations ship with it, so the API is typed from either language.

## Documentation

**[The full reference](https://kalpak44.github.io/forma-dsl/docs/)** — every declaration,
block, function and error, each with usage and troubleshooting. The
**[editor](https://kalpak44.github.io/forma-dsl/)** runs the whole thing in the browser:
type, and the solid updates.

## How it works

```
source ──▶ lexer ──▶ parser ──▶ evaluator ──▶ geometry nodes ──▶ Manifold (WASM) ──▶ mesh
                                    │                │
                                params          digest cache
```

The evaluator does not call the kernel. It produces a tree of immutable geometry nodes, each
carrying a 128-bit digest of its own content and its children's digests. Identity is digest
identity, so a component used twenty times is one node, evaluated once. Nodes are the only
thing that reaches the kernel, and every result is memoized by digest — which is what makes
an edit cheap, since only the subtrees whose content actually changed are re-evaluated.

WebAssembly objects are not garbage-collected, so an `EvaluationContext` owns everything it
produced. `collect(roots)` frees what the current tree can no longer reach; `dispose()` frees
the lot.

One runtime dependency, `manifold-3d`.

## License

MIT — see [LICENSE](LICENSE).

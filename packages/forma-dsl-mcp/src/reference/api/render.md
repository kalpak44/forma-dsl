# `render`

Compiles a document and evaluates one model into renderable parts.

```js
import { render } from 'forma-dsl';

const result = await render(source, { params: { height: 20 } });
```

---

## Reference

### `render(source, options?)`

Parses `source`, resolves its params, evaluates one model into a geometry tree, and solves
every part into a concrete solid and a mesh.

#### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `source` | `string` | The document |
| `options.model` | `string \| null` | Which model to build. Defaults to the **first** the document declares |
| `options.params` | `Record<string, ParameterValue>` | Values for the document's top-level params. Anything not declared is ignored |
| `options.context` | [`EvaluationContext`](evaluation-context.md) `\| null` | A context to reuse. One is created if you do not pass one |

#### Returns

A `Promise<RenderResult>`:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | The model's name |
| `parts` | `RenderedPart[]` | One per [`part`](../reference/part.md) — see below |
| `program` | [`Program`](low-level.md#program) | The parsed document, for inspecting params |
| `context` | `EvaluationContext` | The context that owns every solid in `parts` |
| `stats` | `RenderStats` | `nodes`, `evaluated`, `cacheHits`, `milliseconds` |

Each `RenderedPart`:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | From the part's label |
| `color` | `string` | From the part's `color` attribute |
| `opacity` | `number` | From the part's `opacity` attribute |
| `node` | [`GeometryNode`](geometry-node.md) | The part's tree. This is what `collect` wants |
| `concrete` | `Solid` | The solved Manifold object, **owned by the context** |
| `mesh` | `RenderMesh` | `positions`, `normals`, `triangleCount`, `vertexCount` |

#### Caveats

- **The caller owns `result.context` and must dispose it.** WebAssembly objects are not
  garbage-collected; nothing is freed until you say so.
- **Never call `delete()` on `part.concrete` yourself.** It belongs to the context, which
  may still have it cached under its digest.
- If `render` throws and it created the context itself, that context is disposed before the
  error propagates. A context you supplied is left alone, since you may still want it.
- Params are resolved before any geometry is built, so a missing required param fails
  immediately rather than halfway through a model.
- `options.params` sets **top-level** params only. A param declared inside a `model` is a
  constant — see [model params](../reference/model.md#model-params).

---

## Usage

### Rendering once

```js
import { render, toBinarySTL } from 'forma-dsl';
import { writeFile } from 'node:fs/promises';

const result = await render(source);

await writeFile('part.stl', toBinarySTL(result.parts[0].concrete));

result.context.dispose();
```

A single render can afford to let `render` create the context and dispose it immediately
afterwards. Anything more than that should reuse one.

### Rendering many variants

Reusing a context is the whole point of the digest cache: only the subtrees whose content
actually changed are re-evaluated.

```js
import { render, toBinarySTL, EvaluationContext } from 'forma-dsl';
import { writeFile } from 'node:fs/promises';

const context = await EvaluationContext.create();

for (const height of [10, 20, 30]) {
  const result = await render(source, { params: { height }, context });
  await writeFile(`part-${height}.stl`, toBinarySTL(result.parts[0].concrete));

  // Free what this tree can no longer reach, so a long run stays bounded.
  context.collect(result.parts.map((part) => part.node));
}

context.dispose();
```

The `collect` call is what keeps memory flat across a long run. Without it the context
accumulates every intermediate solid from every variant.

### Driving a live editor

The same pattern, with one context for the life of the page:

```js
const context = await EvaluationContext.create();
let current = null;

async function rerender(source, params) {
  try {
    const result = await render(source, { params, context });
    draw(result.parts);
    current = result;
    context.collect(result.parts.map((part) => part.node));
    return result.stats;
  } catch (error) {
    showProblem(error.message, error.loc);   // FormaError carries a position
    return null;
  }
}
```

Typing a digit into a dimension re-solves that wall and nothing else — `stats.cacheHits`
against `stats.evaluated` shows how much was skipped.

### Choosing a model

```js
await render(source);                          // the first model declared
await render(source, { model: 'assembly' });   // by name
```

To list what a document offers:

```js
const { program } = await render(source);
[...program.models.keys()];    // ['printable', 'assembly']
```

Or without rendering: `Program.parse(source).models.keys()`.

### Exporting each part separately

```js
const result = await render(source);

for (const part of result.parts) {
  await writeFile(`${part.name}.stl`, toBinarySTL(part.concrete, part.name));
}

result.context.dispose();
```

### Reading the statistics

```js
const { stats } = await render(source, { context });

stats.nodes;        // nodes in the tree — a measure of the document's size
stats.evaluated;    // kernel calls actually made, across the context's life
stats.cacheHits;    // how many were avoided
stats.milliseconds; // wall clock for this render
```

`evaluated` and `cacheHits` are running totals on the **context**, not per render, so compare
them across calls rather than reading one in isolation.

---

## Troubleshooting

### `EvaluationContext has been disposed`

Something held on to a result after disposing the context that owns it. `part.concrete` and
`part.mesh` are only valid while the context is alive — copy the mesh arrays out first if you
need them later.

### Memory grows across renders

Add the `collect` call. A reused context caches every solid it has ever built, by design;
`collect(roots)` frees what the current tree can no longer reach.

```js
context.collect(result.parts.map((part) => part.node));
```

### `part "body" is 2D — extrude or revolve it before rendering`

The model produced a cross-section. See [2D ↔ 3D](../reference/conversions.md).

### `align needs a kernel context — render the model rather than building it`

Only happens when driving [`Evaluator`](low-level.md#evaluator) directly without a context.
`render` always supplies one.

### The error has no line number

Most do — `FormaError` carries a `loc` with `line`, `column` and `offset`, and appends it to
the message. A few errors are raised before any position is known (`the document declares no
model`) or inside a value helper that has none (`no attribute "a"`).

```js
try {
  await render(source);
} catch (error) {
  error.loc?.line;   // undefined when the error has no position
}
```

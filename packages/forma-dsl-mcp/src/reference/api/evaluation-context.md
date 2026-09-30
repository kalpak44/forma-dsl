# `EvaluationContext`

Evaluates a geometry tree against the Manifold kernel, memoized by node digest. It is both
the cache that makes editing cheap and the owner of every WebAssembly object produced.

```js
import { EvaluationContext } from 'forma-dsl';

const context = await EvaluationContext.create();
// … render with it …
context.dispose();
```

---

## Reference

### `EvaluationContext.create()`

The only way to build a context, because the kernel loads asynchronously.

Returns `Promise<EvaluationContext>`, with the WASM module ready.

### `context.evaluate(node)`

Solves a [`GeometryNode`](geometry-node.md) and returns the kernel object for it, memoized by
the node's digest.

| | |
| --- | --- |
| **Parameter** | `node: GeometryNode` |
| **Returns** | `Promise<Solid \| Shape>` — a `Manifold` for a 3D node, a `CrossSection` for a 2D one |
| **Throws** | If the context has been disposed |

Concurrent requests for the same node share one evaluation, so a shape used twice in a tree
walked concurrently is built once rather than twice with one copy leaked.

### `context.collect(roots, options?)`

Frees every cached object the given roots can no longer reach.

| | |
| --- | --- |
| **`roots`** | `readonly GeometryNode[]` — the trees still in use |
| **`options.keep`** | `number`, default `512`. How many unreachable entries to keep as a most-recently-used tail |
| **Returns** | `number` — how many objects were freed |

The retained tail matters more than it looks: editing churns the tree, so the entries that
just fell out of it are the ones most likely to come straight back — on an undo, or on the
next character of a number being typed.

### `context.dispose()`

Frees every WASM object the context has produced. The context cannot be used again;
evaluations still in flight free their own results as they land. Disposing twice is harmless.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `wasm` | `Kernel` | The loaded module. Throws if read before `create()` resolved |
| `size` | `number` | How many objects the cache holds |
| `disposed` | `boolean` | Whether `dispose()` has run |
| `stats` | `{ evaluated, hits, freed }` | Running totals for the context's whole life |

---

## Why a context exists

WebAssembly objects are not garbage-collected. Something has to own them, and something has
to decide when they are no longer needed — that is this class.

It is also the cache. Nothing is freed as evaluation proceeds, because an intermediate result
is also a cache entry and a later node may still need it. The two ways out are `collect`,
which frees what the current tree can no longer reach, and `dispose`, which frees the lot.

**A context is meant to outlive a single render.** Reusing one across renders is what makes
the digest cache worth having: a re-render after an edit re-evaluates only the subtrees whose
content actually changed.

---

## Usage

### One context per session

```js
const context = await EvaluationContext.create();

try {
  for (const params of variants) {
    const result = await render(source, { params, context });
    await write(result);
    context.collect(result.parts.map((part) => part.node));
  }
} finally {
  context.dispose();
}
```

The `try`/`finally` matters: a throw halfway through a batch would otherwise leak every solid
built so far.

### In a browser, for the life of the page

The editor keeps one context forever and collects after each render:

```js
const context = await EvaluationContext.create();

async function rerender(source, params) {
  const result = await render(source, { params, context });
  draw(result.parts);
  context.collect(result.parts.map((part) => part.node));
}
```

There is no `dispose` here, and that is correct — the page unloading frees the whole heap.

### Tuning what is kept

The default tail of 512 entries suits an editor. A batch job that renders a thousand
unrelated variants has no use for it:

```js
context.collect(roots, { keep: 0 });     // free everything unreachable
```

A renderer showing a draft and then a final pass of the *same* model might raise it, so the
draft's subtrees survive into the final render.

### Watching the cache work

```js
const before = { ...context.stats };
await render(source, { params: { height: 21 }, context });

const evaluated = context.stats.evaluated - before.evaluated;
const hits = context.stats.hits - before.hits;
console.log(`${evaluated} solved, ${hits} reused`);
```

On a document where one dimension changed, `evaluated` should be a handful and `hits` most of
the tree. If `evaluated` is the whole document every time, something is defeating the cache —
see [Troubleshooting](#every-render-re-evaluates-everything).

### Evaluating a node directly

`render` is the front door, but the context takes any node:

```js
import { GeometryNode, EvaluationContext } from 'forma-dsl';

const context = await EvaluationContext.create();

const box = GeometryNode.shape(3, 'box', { size: [10, 10, 10], center: false });
const solid = await context.evaluate(box);

solid.volume();          // 1000
context.dispose();
```

---

## Ownership rules

1. **Everything a context returns belongs to the context.** Never call `delete()` on a
   `Solid`, a `Shape` or anything hanging off `part.concrete`.
2. **A result is valid only while its context is alive.** After `dispose()`, every object it
   produced is gone. Copy out what you need first — `toRenderMesh` and `toBinarySTL` both
   produce plain typed arrays that outlive the context.
3. **`render` does not dispose a context you supplied.** It disposes only one it created
   itself, and only on failure.

---

## Troubleshooting

### `EvaluationContext has been disposed`

An `evaluate` or a `render` used a context after `dispose()`. Usually an async render that
was still in flight when a page or a test tore the context down — await it first.

### `EvaluationContext used before create() resolved`

The constructor was called directly. Use the factory:

```js
new EvaluationContext();              // ✗ no kernel
await EvaluationContext.create();     // ✓
```

### Memory grows without bound

Add a `collect` after each render, passing the roots that are still in use:

```js
context.collect(result.parts.map((part) => part.node));
```

Without it, every intermediate solid from every render is retained — which is the correct
default, because the context cannot know whether you still hold a reference.

### `collect` freed nothing

It returns `0` when the number of unreachable entries is at or below `keep` — the default 512
tail. That is expected on a small document. Pass `{ keep: 0 }` to see whether anything is
genuinely unreachable.

### Every render re-evaluates everything

Either a fresh context is being created per render — check that the same one is passed back
in — or the document's content genuinely changes on every render. A param that feeds a
dimension changes the digest of everything downstream of it, which is correct; a param that
feeds only one wall should not.

### Solids behave oddly after an error

If `render` threw on a context it created, that context was disposed before the error
propagated, and anything you captured from an earlier successful render on it is now freed.
Supply your own context when you need results to survive a failure.

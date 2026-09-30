# Kernel

Loading the Manifold WebAssembly module, and tuning how finely it approximates curves.

```js
import { loadKernel, setQuality, resetQuality } from 'forma-dsl';
```

Most callers never touch these. [`EvaluationContext.create()`](evaluation-context.md#evaluationcontextcreate)
loads the kernel for you, and `segments` on a shape handles resolution locally. Reach for
this page when bundling needs help finding the `.wasm`, or when a draft pass and a final pass
want different quality.

---

## `loadKernel`

### `loadKernel(options?)`

Loads and sets up the Manifold module, once per page or process.

| | |
| --- | --- |
| **`options.locateFile`** | `() => string` — returns the URL of the `.wasm` file |
| **Returns** | `Promise<Kernel>` — the `manifold-3d` toplevel module |

#### Caveats

- **Memoized on the promise, not the result.** Two models evaluating concurrently at startup
  share one instantiation rather than each starting their own.
- **Only the first call's options take effect.** Later calls get the memoized promise, so
  `locateFile` has to be right the first time.
- A rejected load is *not* memoized — a WASM fetch that lost the network can be retried
  rather than being permanently broken for the page.

### Bundlers and `locateFile`

A bundler that fingerprints assets renames `manifold.wasm`, and the module cannot then find
it by its own relative path. Point at the built URL:

```js
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadKernel } from 'forma-dsl';

await loadKernel({ locateFile: () => wasmUrl });
```

Do this **before** the first `EvaluationContext.create()`, or the default path is what gets
memoized.

In Node, nothing is needed — the module resolves the file itself.

---

## `setQuality`

### `setQuality(options?)`

Sets the resolution used for curved surfaces, globally.

| Option | Type | Description |
| --- | --- | --- |
| `minAngle` | `number` | Smallest angle, in degrees, between adjacent segments of a curve |
| `minEdgeLength` | `number` | Smallest length a curve segment may be shortened to |
| `segments` | `number` | A fixed segment count, overriding both limits above |

Returns `Promise<void>`, resolving once the kernel is loaded and configured. Each option is
left alone when omitted.

#### Caveats

- **These are global to the kernel, not per model.** A viewer that renders a draft and then a
  final pass has to set them around each evaluation, not once at load.
- **Quality settings are not part of a node's digest.** The cache is keyed on content, so a
  solid built at draft quality will be *reused* at final quality unless the cache is cleared.
  See [Usage](#a-draft-pass-and-a-final-pass).
- A shape's own `segments` attribute overrides all of this for that shape. Prefer it whenever
  a specific facet count matters — a hole that must clear a printed bolt should not depend on
  a global.

## `resetQuality`

### `resetQuality()`

Restores the kernel's own defaults. Returns `Promise<void>`.

---

## Usage

### A draft pass and a final pass

Because quality is global and digests do not include it, the cache has to be dropped between
passes — otherwise the final render happily reuses the draft's geometry:

```js
import { setQuality, EvaluationContext, render } from 'forma-dsl';

// Draft: fast, coarse.
await setQuality({ segments: 16 });
let context = await EvaluationContext.create();
const draft = await render(source, { params, context });
draw(draft.parts);
context.dispose();

// Final: a fresh context, so nothing coarse survives.
await setQuality({ minAngle: 1, minEdgeLength: 0.2 });
context = await EvaluationContext.create();
const final = await render(source, { params, context });
draw(final.parts);
```

If instead you want one context throughout, put the resolution in the document so it *is*
part of the digest:

```hcl
param facets { type = number  default = 32  min = 8  max = 160  step = 8 }

model "m" {
  cylinder { radius = 10  height = 20  segments = var.facets }
}
```

That is the better answer for an editor: changing `facets` changes the content, so the cache
does the right thing automatically.

### Global quality for an export

A one-off high-quality export, then back to normal:

```js
await setQuality({ minEdgeLength: 0.1 });
try {
  const context = await EvaluationContext.create();
  const result = await render(source, { params, context });
  await writeFile('final.stl', toBinarySTL(result.parts[0].concrete));
  context.dispose();
} finally {
  await resetQuality();
}
```

### Reaching the kernel directly

`context.wasm` is the loaded module, and every Manifold API is on it:

```js
const context = await EvaluationContext.create();
const { Manifold, CrossSection } = context.wasm;
```

Anything you construct this way is **yours** to delete — the context only owns what it built
itself.

---

## Troubleshooting

### The page 404s on `manifold.wasm`

The bundler renamed it. Pass `locateFile`, before the first context is created:

```js
import wasmUrl from 'manifold-3d/manifold.wasm?url';
await loadKernel({ locateFile: () => wasmUrl });
```

### `locateFile` is being ignored

The kernel was already loaded — the promise is memoized, so only the first call's options
count. Move the `loadKernel` call earlier, before anything creates a context.

### `setQuality` had no effect on an existing model

The geometry was already cached. Quality is not part of the digest, so the cached solid is
returned unchanged. Use a fresh context, or put the segment count in the document where it
becomes part of the content.

### Curves are too coarse in one place only

Set `segments` on that shape rather than moving the global. It is per-shape, it is part of the
digest, and it is visible to whoever reads the model.

# Export

Turning a solved solid into buffers a renderer can upload, or a file a slicer can read.

```js
import { toRenderMesh, toBinarySTL } from 'forma-dsl';
```

Both take a `Solid` — the `concrete` field of a
[rendered part](render.md#returns) — and both return plain typed arrays that **outlive the
context**, so they are what to copy out before disposing.

---

## `toRenderMesh`

### `toRenderMesh(solid)`

Converts a solid into flat arrays for a renderer.

| | |
| --- | --- |
| **Parameter** | `solid: Solid` |
| **Returns** | `RenderMesh` |

| Field | Type | Description |
| --- | --- | --- |
| `positions` | `Float32Array` | Three vertices per triangle, expanded — `triangleCount * 9` floats |
| `normals` | `Float32Array` | One face normal, repeated for all three corners |
| `triangleCount` | `number` | Triangles |
| `vertexCount` | `number` | Vertices **before** expansion, as the kernel counted them |

#### Why vertices are expanded

The kernel returns indexed triangles sharing vertices, which is what a viewer wants for
upload size. But a shared vertex across a hard edge gets one averaged normal and is
smooth-shaded, so a cube reads as a sphere-ish blob. Normals are therefore computed per face
and the vertices expanded, which is what keeps the edge hard.

The cost is that `positions.length / 3` is `triangleCount * 3` rather than `vertexCount`. Use
`vertexCount` only as a measure of the underlying mesh.

#### Caveats

- A degenerate triangle keeps a zero normal rather than dividing by zero and poisoning the
  buffer with NaN.
- [`render`](render.md) already calls this for every part — `part.mesh` is the result. Call
  it yourself only for a solid you built directly.

---

## `toBinarySTL`

### `toBinarySTL(solid, header?)`

Encodes a solid as binary STL.

| | |
| --- | --- |
| **`solid`** | `Solid` |
| **`header`** | `string`, default `'forma-dsl'`. Free text for the 80-byte header, truncated to fit |
| **Returns** | `Uint8Array` — the file |

Binary rather than ASCII: a model of any size is several times smaller and every slicer reads
it.

#### Caveats

- **STL has no units.** Every consumer treats the numbers as millimetres, which is what the
  language's lengths are usually meant to be, but nothing records that.
- **STL has no colour and no parts.** A [`part`](../reference/part.md)'s colour and opacity do
  not survive. Export each part to its own file if they need to stay distinct.
- The header is truncated to 79 bytes so it cannot run into the triangle count that follows.
- Float32 throughout, as the format requires. A model with features far from the origin loses
  precision.

---

## Usage

### Exporting one part

```js
import { render, toBinarySTL } from 'forma-dsl';
import { writeFile } from 'node:fs/promises';

const result = await render(source);
await writeFile('part.stl', toBinarySTL(result.parts[0].concrete));
result.context.dispose();
```

### Exporting every part separately

Colours do not survive STL, so one file per part is how an assembly stays an assembly:

```js
const result = await render(source);

for (const part of result.parts) {
  await writeFile(`${part.name}.stl`, toBinarySTL(part.concrete, `${result.name}/${part.name}`));
}

result.context.dispose();
```

The header is a reasonable place to record where the file came from.

### Downloading from a browser

```js
const stl = toBinarySTL(part.concrete, part.name);
const url = URL.createObjectURL(new Blob([stl], { type: 'model/stl' }));

const a = document.createElement('a');
a.href = url;
a.download = `${part.name}.stl`;
a.click();

URL.revokeObjectURL(url);
```

### Uploading to a renderer

`render` has already produced the mesh, so three.js needs no conversion:

```js
import { BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial } from 'three';

function toThree(part) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(part.mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(part.mesh.normals, 3));

  return new Mesh(geometry, new MeshStandardMaterial({
    color: part.color,
    transparent: part.opacity < 1,
    opacity: part.opacity,
  }));
}
```

### Keeping geometry past the context

Typed arrays are plain memory, so they survive disposal — unlike `part.concrete`:

```js
const result = await render(source);
const saved = result.parts.map((part) => ({
  name: part.name,
  color: part.color,
  stl: toBinarySTL(part.concrete),     // copied out…
}));
result.context.dispose();              // …so this is safe
```

---

## Troubleshooting

### `EvaluationContext has been disposed`

The solid was freed before it was encoded. Export first, dispose after — or copy the arrays
out, which is what the example above does.

### The STL is empty, or has zero triangles

The part solved to empty geometry. Usual causes: a `difference` that removed everything, an
`extrude` whose height reached `0`, a `revolve` whose angle reached `0`. All of these are
silent by design, so a parameter at the end of its range does not break a model.

### My part came in at the wrong scale

STL carries no units. The slicer is assuming millimetres; if the model was written in
centimetres, scale it in the document.

### Colours are missing from the exported file

STL has none. Export parts separately and colour them in the slicer, or use the render mesh
directly if you control the viewer.

### Hard edges look smooth in my renderer

The mesh is already expanded with per-face normals, so this is the renderer recomputing
them. Upload `mesh.normals` as given and do not call anything like
`computeVertexNormals()`.

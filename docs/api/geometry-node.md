# `GeometryNode`

The immutable, content-addressed intermediate representation. The evaluator produces these;
the kernel consumes them.

```js
import { GeometryNode } from 'forma-dsl';

const box = GeometryNode.shape(3, 'box', { size: [10, 10, 10], center: true });
box.digest;       // '3f2a…' — 32 hex characters
box.subtreeSize;  // 1
```

---

## Why it exists

The evaluator never calls the kernel. It produces a tree of nodes, each carrying a 128-bit
digest of its own content and its children's digests, computed once in the constructor and
never from a live walk of the subtree.

**Identity is digest identity.** Two structurally identical subtrees *are* the same node, so
a component used twenty times is evaluated once. That is the whole basis of the cache in
[`EvaluationContext`](evaluation-context.md), and the reason typing a digit into a dimension
re-solves one wall rather than the document.

The digest is computed from the IEEE bits of every number rather than from a hash seeded per
process, so it is identical in every browser and every run.

---

## Reference

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `dim` | `2 \| 3` | Whether this node is a cross-section or a solid |
| `kind` | `string` | What the node does — `shape3d`, `boolean`, `transform`, `extrude`, … |
| `props` | `Record<string, unknown>` | The node's own parameters |
| `children` | `readonly GeometryNode[]` | The operands |
| `digest` | `string` | 128-bit content digest, 32 lowercase hex characters |
| `subtreeSize` | `number` | How many nodes this subtree holds, counting itself |
| `isEmpty` | `boolean` | Whether it stands for no geometry at all |

Nodes are frozen. Every factory returns a new node rather than mutating one.

### Factories

Prefer these to the constructor — they apply the algebraic simplifications that keep the tree
small.

| Factory | Description |
| --- | --- |
| `GeometryNode.empty(dim)` | A node standing for no geometry |
| `GeometryNode.shape(dim, shape, params)` | A leaf primitive — `'box'`, `'circle'`, `'cylinder'`, … |
| `GeometryNode.union(children)` | Everything added together |
| `GeometryNode.difference(children)` | The first child with the rest removed |
| `GeometryNode.intersection(children)` | Only what every child shares |
| `GeometryNode.boolean(op, children)` | The three above, by name |
| `GeometryNode.transformed(child, transform)` | A [`Transform`](values.md#transform) applied |
| `GeometryNode.unary(kind, child, props?, dim?)` | Any single-child operation |

### Simplifications

The factories are not thin wrappers. Each collapses cases that would otherwise cost a kernel
call and a cache entry:

| Written | Becomes |
| --- | --- |
| A boolean with one surviving child | That child |
| A boolean with empty children | The empties dropped |
| A boolean with nothing left | `empty` |
| A union of several children | The children **sorted by subtree size**, so order does not change the digest |
| A transform of a transform | One node with the matrices multiplied |
| Any unary operation on `empty` | `empty` |

`difference` is never reordered: its first child is the body and the rest are cutters.

### Caveats

- **`dim` must be 2 or 3.** Anything else throws `bad dimensionality`.
- **Booleans cannot mix dimensionality**: `cannot combine 2D and 3D geometry in a union`.
- `GeometryNode.unary` defaults its result dimensionality to the child's, which is wrong for
  the operations that change it — pass `dim` explicitly for anything extrude-like.
- Two nodes with the same digest are interchangeable. Nothing stops you building the same
  node twice; the cache will treat both as one.

---

## Usage

### Walking a tree

```js
function* walk(node, seen = new Set()) {
  if (seen.has(node.digest)) return;   // a shared subtree is visited once
  seen.add(node.digest);
  yield node;
  for (const child of node.children) yield* walk(child, seen);
}

const result = await render(source);
const kinds = new Map();

for (const node of walk(result.parts[0].node)) {
  kinds.set(node.kind, (kinds.get(node.kind) ?? 0) + 1);
}
```

Deduplicating on `digest` is what makes the walk reflect what the kernel will actually do —
the tree is a DAG, not a tree, once sharing is taken into account.

### Measuring how much a model shares

```js
const { parts } = await render(source);
const root = parts[0].node;

const unique = new Set();
for (const node of walk(root)) unique.add(node.digest);

console.log(`${root.subtreeSize} nodes written, ${unique.size} distinct`);
```

A large gap is the digest cache doing its job — eight spheres in a loop are one sphere node
and eight transforms.

### Building geometry without the language

The node API is public, so a program can emit geometry directly:

```js
import { GeometryNode, Transform, EvaluationContext, toBinarySTL } from 'forma-dsl';

const context = await EvaluationContext.create();

const pin = GeometryNode.shape(3, 'cylinder', {
  height: 20, bottomRadius: 3, topRadius: 3, segments: 32, center: false,
});

const ring = GeometryNode.union(
  Array.from({ length: 6 }, (_, i) => GeometryNode.transformed(
    pin,
    Transform.rotation3D([0, 0, i * 60]).concat(Transform.translation([30, 0, 0], 3)),
  )),
);

const solid = await context.evaluate(ring);
await writeFile('ring.stl', toBinarySTL(solid));
context.dispose();
```

Note that `pin` is one node used six times — the kernel builds one cylinder.

### Checking whether an edit changed anything

```js
const before = (await render(source, { context })).parts[0].node.digest;
const after = (await render(edited, { context })).parts[0].node.digest;

if (before === after) console.log('the edit did not change the geometry');
```

Reformatting, renaming a local, or reordering the members of a union all leave the digest
untouched.

---

## Node kinds

What the evaluator emits, and what [`EvaluationContext`](evaluation-context.md) knows how to
solve:

| Kind | Children | Notes |
| --- | --- | --- |
| `empty` | 0 | No geometry |
| `shape2d` | 0 | `props.shape` is `rect`, `circle` or `polygon` |
| `shape3d` | 0 | `props.shape` is `box`, `sphere`, `cylinder`, `hull` or `mesh` |
| `boolean` | 2+ | `props.op` is `union`, `difference` or `intersection` |
| `transform` | 1 | `props.transform` is a [`Transform`](values.md#transform) |
| `extrude`, `revolve` | 1 | 2D → 3D |
| `projection` | 1 | 3D → 2D; `props.type` is `full` or `slice` |
| `offset`, `hull`, `refine`, `simplify`, `smooth`, `trim` | 1 | Refinement |

Higher-level blocks do not have their own kinds. `rounded_rect` is a `rect` inside an
`offset`; `torus` is a `circle`, a `transform` and a `revolve`; `cone` is a `cylinder`.

---

## Troubleshooting

### `bad dimensionality 4`

The constructor was called with something other than `2` or `3`.

### `cannot combine 2D and 3D geometry in a union`

A boolean was handed a mix. In a document this surfaces earlier and more helpfully as
`"union" cannot mix 2D and 3D shapes`.

### My hand-built extrude produced a 2D result

`GeometryNode.unary` defaults `dim` to the child's, and an extrude's child is 2D. Pass it:

```js
GeometryNode.unary('extrude', profile, { height: 10, /* … */ }, 3);
```

### Two nodes I expected to be equal have different digests

Digests cover **all** props. A `segments` of `0` and a `segments` of `32` are different
shapes even when they look alike, and a float that differs in the last bit is a different
number. Digest equality is exact, by design — the alternative is a cache that occasionally
returns the wrong solid.

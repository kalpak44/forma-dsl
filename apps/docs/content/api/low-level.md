# Compiler stages

The pipeline, stage by stage, plus the registries the evaluator reads. These are exported so
that editors, linters and tools can reach into the compiler without re-implementing it — the
[editor](../../../editor) uses them for syntax
highlighting and inline diagnostics.

```js
import {
  tokenize, parse, Program, Evaluator, FormaError,
  BLOCKS, FUNCTIONS, CONSTANTS,
} from 'forma-dsl';
```

For ordinary use, [`render`](render.md) and
[`describeParameters`](describe-parameters.md) are the front door.

---

## `tokenize`

### `tokenize(source)`

Turns source into tokens. Returns `Token[]`, ending with an `eof`.

| Field | Type | Description |
| --- | --- | --- |
| `type` | `'ident' \| 'number' \| 'string' \| 'punct' \| 'eof'` | |
| `value` | `any` | A string for `ident` and `punct`, a number for `number`, the parsed runs and splices for `string`, `null` for `eof` |
| `loc` | `SourceLocation` | `{ line, column, offset }` |
| `nlBefore` | `boolean` | Whether a line break preceded this token |

`nlBefore` is what the parser uses to know an attribute has ended. See
[the newline rule](../language/syntax.md#the-newline-rule).

---

## `parse`

### `parse(source)`

Turns source into an abstract syntax tree. Returns a `FormaDocument`.

The AST's shape is an implementation detail of the evaluator and is typed loosely on purpose.
Use [`Program`](#program) to get at declarations in a stable form.

---

## `Program`

### `Program.parse(source)` · `new Program(document)`

A parsed document, indexed by what each declaration is for. Constructing one is what catches
duplicate names and a component that shadows a builtin.

| Property | Type | Description |
| --- | --- | --- |
| `params` | `Map<string, unknown>` | Declared params, in source order |
| `locals` | `unknown[]` | Declared locals, in source order |
| `components` | `Map<string, unknown>` | Declared components |
| `models` | `Map<string, unknown>` | Declared models |

### `program.parameterDescriptors(evaluator?)`

The declared params as [`ParameterDescriptor`](describe-parameters.md#returns)s. Without an
evaluator, every field but the name comes back `undefined` —
[`describeParameters`](describe-parameters.md) is this with one supplied.

#### Listing a document's models without rendering

```js
import { Program } from 'forma-dsl';

const program = Program.parse(source);
[...program.models.keys()];      // ['printable', 'assembly']
```

---

## `Evaluator`

### `new Evaluator(program, options?)`

Turns a program into geometry nodes. Resolving params and locals happens during
**construction**, so every error about a missing or unreadable input surfaces before any
geometry is built.

| Option | Type | Description |
| --- | --- | --- |
| `params` | `Record<string, ParameterValue>` | Values for the document's params |
| `context` | [`EvaluationContext`](evaluation-context.md) `\| null` | Needed only by [`align`](../reference/align.md), which measures its child |
| `requireParams` | `boolean`, default `true` | Off lets a document declaring a required param still be inspected |

| Member | Description |
| --- | --- |
| `program` | The program being evaluated |
| `context` | The kernel context, if any |
| `root` | The document-level [scope](../language/scope.md#the-root-scope) |
| `expression(node, scope)` | Evaluates one expression |
| `model(name?)` | Builds one model into a `Scene`. Defaults to the first declared |

A `Scene` is `{ name, parts, node }`, where `parts` carry `GeometryNode`s and `node` is
everything unioned.

#### Caveats

- **The evaluator does not call the kernel** — except for `align`. Its output is a node tree;
  solving it is [`EvaluationContext`](evaluation-context.md)'s job.
- Without a `context`, a document containing `align` fails with
  `align needs a kernel context — render the model rather than building it`.
- `requireParams: false` is for inspection only. A param with no value is simply absent from
  scope, so evaluating geometry that reads it will fail.

#### Building a node tree without solving it

```js
import { Program, Evaluator } from 'forma-dsl';

const program = Program.parse(source);
const scene = await new Evaluator(program, { params: { height: 20 } }).model();

scene.node.digest;       // identity of the whole model
scene.node.subtreeSize;  // how many nodes it took
```

Useful for diffing two documents, or for caching geometry identity without loading WASM at
all.

---

## `FormaError`

Every error the language raises. Extends `Error`.

| Property | Type | Description |
| --- | --- | --- |
| `name` | `'FormaError'` | |
| `loc` | `SourceLocation \| null` | Where it was raised, when known |

The position is appended to the message as well as kept on the error, so a caller that only
prints `error.message` still tells the reader where to look.

```js
try {
  await render(source, { context });
} catch (error) {
  if (error.loc) {
    markProblem(error.loc.line, error.loc.column, error.message);
  } else {
    showBanner(error.message);
  }
}
```

Not every failure is a `FormaError` — a few come from the kernel, and `render` raises a plain
`Error` for a 2D part. Check `error.loc` rather than the class when all you need is a
position. See [Errors](../errors.md) for the full catalogue.

---

## Registries

### `BLOCKS`

Every block the language understands, by name, as `Record<string, BlockDefinition>`.

| Field | Description |
| --- | --- |
| `dim` | Output dimensionality, where it is fixed regardless of the children |
| `leaf` | True for a shape, which takes no children |
| `takes` | What the children must be; `'same'` passes their dimensionality through |
| `combine` | `'list'` receives every child; anything else receives them unioned |
| `build(args, children?)` | Produces the node |

**[`part`](../reference/part.md) and [`align`](../reference/align.md) are not in it** — the
evaluator handles both itself, because neither is an ordinary geometry operation.

```js
import { BLOCKS } from 'forma-dsl';

Object.keys(BLOCKS).length;                            // the builtin blocks
Object.keys(BLOCKS).filter((k) => BLOCKS[k].leaf);     // just the shapes
```

### `FUNCTIONS`

Every builtin function, as `Record<string, FunctionDefinition>` with `arity` — `null` for
variadic — and `call(args)`.

### `CONSTANTS`

`{ pi, e }`.

#### Driving an editor from the registries

Keeping completion and highlighting honest means reading the registries rather than a
hand-kept list:

```js
import { BLOCKS, FUNCTIONS, CONSTANTS } from 'forma-dsl';

const completions = [
  ...Object.keys(BLOCKS).map((name) => ({ label: name, type: 'class' })),
  ...Object.keys(FUNCTIONS).map((name) => ({ label: name, type: 'function' })),
  ...Object.keys(CONSTANTS).map((name) => ({ label: name, type: 'constant' })),
];
```

The docs site does the same thing for its syntax highlighting, which is why a new block
cannot be added without the documentation's code samples learning about it.

---

## Troubleshooting

### `align needs a kernel context — render the model rather than building it`

Pass a context, or avoid `align` in documents you intend to evaluate without one:

```js
new Evaluator(program, { context: await EvaluationContext.create() });
```

### `param "x" has no default and no value was supplied`

Thrown from the `Evaluator` **constructor**, not from `model()`. Pass `requireParams: false`
to inspect such a document without values.

### My hand-driven evaluation returns nodes, not solids

That is the design. Pass each `part.node` to
[`context.evaluate`](evaluation-context.md#contextevaluatenode), or use
[`render`](render.md), which does both.

### `part` and `align` are missing from `BLOCKS`

Neither is an ordinary block: a `part` is a piece of the scene rather than an operand, and
`align` has to measure its child. Both are handled directly by the evaluator. Add them to any
list you build from `BLOCKS` for an editor.

# `describeParameters`

Reads what a document declares as inputs, without rendering anything.

```js
import { describeParameters } from 'forma-dsl';

const params = describeParameters(source);
```

---

## Reference

### `describeParameters(source)`

Parses `source` and returns one descriptor per top-level [`param`](../reference/param.md), in
source order. No geometry is evaluated and no kernel is loaded — this is the call a front end
makes to build controls before it can have any values to render with.

#### Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `source` | `string` | The document |

#### Returns

`ParameterDescriptor[]`:

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | The param's name |
| `type` | `'number' \| 'string' \| 'bool' \| 'vector' \| 'list' \| 'angle' \| string` | The declared `type`, or one inferred from the default |
| `default` | `ParameterValue \| undefined` | The evaluated default, if there is one |
| `required` | `boolean` | `true` when the param declares no default |
| `min` | `number \| undefined` | Advisory |
| `max` | `number \| undefined` | Advisory |
| `step` | `number \| undefined` | Advisory |
| `description` | `string \| undefined` | Help text |
| `options` | `ParameterValue[] \| undefined` | A fixed set of choices |

#### Caveats

- **Params are read leniently.** A document that declares a required param must be
  describable before anyone could have supplied a value for it, so nothing throws about
  missing values here.
- **One unreadable attribute does not lose the rest.** If a `min` refers to something that
  cannot be resolved yet, that field comes back `undefined` and every other descriptor is
  still returned.
- **`min`, `max`, `step` and `options` are advisory.** Nothing enforces them, including
  [`render`](render.md). Clamp in the model if a bound matters.
- **Model params are not listed.** A `param` inside a `model` is a constant, not an input.
- It still throws on a **syntax error** — the document has to parse.

#### Type inference

When a param declares no `type`, one is inferred from the default:

| Default | Inferred type |
| --- | --- |
| a number | `number` |
| a boolean | `bool` |
| a string | `string` |
| a list | `vector` |
| nothing | `number` |

---

## Usage

### Building controls

```js
const descriptors = describeParameters(source);

for (const p of descriptors) {
  switch (p.type) {
    case 'number':
      addSlider(p.name, {
        value: p.default ?? p.min ?? 0,
        min: p.min, max: p.max, step: p.step,
        title: p.description,
      });
      break;
    case 'bool':
      addCheckbox(p.name, { value: p.default ?? false });
      break;
    case 'string':
      p.options ? addSelect(p.name, p.options) : addTextField(p.name);
      break;
    case 'vector':
      addVectorField(p.name, { value: p.default ?? [0, 0, 0] });
      break;
  }
}
```

### Collecting values to render with

```js
const descriptors = describeParameters(source);

const params = Object.fromEntries(
  descriptors
    .filter((p) => p.default !== undefined)
    .map((p) => [p.name, p.default]),
);

const result = await render(source, { params, context });
```

### Insisting on required inputs

```js
const missing = describeParameters(source)
  .filter((p) => p.required && values[p.name] === undefined)
  .map((p) => p.name);

if (missing.length) {
  throw new Error(`Supply a value for: ${missing.join(', ')}`);
}
```

This is the whole reason `required` exists: a document can declare that there is no sensible
default, and a front end can act on that before rendering fails.

### Re-reading after an edit

`describeParameters` is cheap — a parse, no kernel — so calling it on every edit is
reasonable. Keep any value the user has already set, for a param that still exists with a
compatible type:

```js
function reconcile(source, previous) {
  const next = {};
  for (const p of describeParameters(source)) {
    next[p.name] = p.name in previous ? previous[p.name] : p.default;
  }
  return next;
}
```

---

## Troubleshooting

### A descriptor's `default` is `undefined`

Either the param declares no default — check `required` — or its default could not be
evaluated. A default that refers to a param declared **below** it cannot resolve; params are
read in source order.

### `min` and `max` came back `undefined`

The expression could not be evaluated. That is deliberately not fatal: one unreadable
metadata attribute must not cost the caller every other descriptor.

### My param is not in the list

It is probably declared inside a `model` rather than at the top level. Only top-level params
are inputs; see [model params](../reference/model.md#model-params).

### The values I pass are ignored

`render` accepts values for declared top-level params only, and silently ignores anything
else. Compare the keys you pass against `describeParameters(source).map((p) => p.name)`.

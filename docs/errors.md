# Errors

Every error the language raises, grouped by the stage that raises it. Knowing the stage
narrows the cause: a lexer error is a typo, an evaluator error is a mistake about meaning.

All of them carry a source position where one is known, appended to the message and available
as `error.loc`:

```js
try {
  await render(source, { context });
} catch (error) {
  error.loc?.line;     // undefined when the error has no position
}
```

Most are a [`FormaError`](api/low-level.md#formaerror). A few come from the kernel or from
`render` itself and are plain `Error`s, so test `error.loc` rather than the class.

---

## Lexer

Raised while turning characters into tokens. Always a typo.

| Message | Cause |
| --- | --- |
| `unexpected character "…"` | A character that cannot begin a token — a smart quote, a stray backtick, a non-ASCII dash |
| `unterminated string` | A `"` with no closing `"`, or a literal newline inside one |
| `unterminated block comment` | A `/*` with no `*/`. Block comments do not nest |
| `unknown escape \q` | Only `\n` `\t` `\r` `\"` `\\` `\$` exist |
| `unterminated ${ } in string` | A splice with no closing brace |

---

## Parser

Raised while turning tokens into a tree. Always a grammar mistake.

| Message | Cause |
| --- | --- |
| `expected a block, found "…"` | Something at the top level that is not a block |
| `unknown top-level block "shape"` | Only `param`, `local`, `component` and `model` may appear at the top level |
| `expected an attribute or block, found "…"` | Inside a body, an entry that does not start with a name |
| `expected {, found "…"` | A `param` with no `=` and no body — write `param s { }`. Also a `component` or `model` with no body |
| `expected =, found "…"` | A `local` with no value |
| `expected ident, found "…"` | A keyword where a name was required |
| `"for" cannot be used as a block type` | One of the eleven [keywords](language/syntax.md#keywords) used as a block name |
| `a param block holds attributes, not nested blocks` | Usually a missing `=`: `param h { default 20 }` |
| `a label cannot contain ${ }` | `component` and `model` names must be static. [`part`](reference/part.md) labels may be expressions |
| `expected = or : in an object` | An object literal entry with no separator |
| `unexpected "…"` | A token that cannot begin an expression |
| `trailing input in ${ }` | A splice holding more than one expression |

### `expected {, found "box"`

The most common parser error, and the least obvious. A component param needs `=` or a body,
even an empty one:

```hcl
component "c" {
  param s          // ✗ the parser is looking for `=` or `{`
  box { size = [s, s, s] }
}

component "c" {
  param s { }      // ✓ declared, and required at the call site
  box { size = [s, s, s] }
}
```

---

## Declarations

Raised when the parsed document is indexed.

| Message | Cause |
| --- | --- |
| `param "a" is declared twice` | Two top-level params share a name |
| `component "c" is declared twice` | Two components share a name |
| `model "m" is declared twice` | Two models share a name |
| `component "box" shadows a builtin block` | Components and builtins share one namespace |

Locals are the exception: a duplicate `local` is accepted and silently replaces the first.

---

## Names and expressions

Raised while evaluating.

| Message | Cause |
| --- | --- |
| `unknown name "x"` | Nothing in scope binds it. See [Scope](language/scope.md) |
| `no attribute "x"` | A missing key on an object — including `var.x` for something that is not a param |
| `cannot read "x" of nothing` | A property read on `null` |
| `cannot index this value` | Indexing something that is not a list, string or object |
| `cannot negate a non-number` | Unary `-` on a string, list or bool |
| `cannot apply + to a list and a number` | Operands the operator does not accept. See the [operator table](language/expressions.md#arithmetic) |
| `cannot compare a number with a string` | `<` `<=` `>` `>=` require both sides to be the same type |
| `cannot combine vectors of length 2 and 3` | Componentwise arithmetic on lists of different lengths |
| `division by zero` · `modulo by zero` | Errors rather than `Infinity` or `NaN`, so a degenerate value cannot reach the kernel |
| `unknown function "clamp"` | No such builtin, and there are no user-defined functions |
| `len takes 1 argument(s), got 2` | Wrong argument count for a fixed-arity function |
| `pow: functions take positional arguments` | Named arguments are not supported |
| `range: step cannot be 0` | A zero step would never terminate |
| `range: more than 100000 values` | A guard against a live editor allocating until the tab dies |

### `unknown name "outer-inner"`

Hyphens are part of an identifier, so `outer-inner` is one name. Put spaces around the
operator: `outer - inner`. See [Identifiers](language/syntax.md#identifiers).

### `unknown name "var"`

A param default referred to `var`, which is assembled only after every param has resolved.
Use the earlier param's bare name instead — see
[the root scope](language/scope.md#the-root-scope).

---

## Params

| Message | Cause |
| --- | --- |
| `param "h" has no default and no value was supplied` | A required param with no value. Pass one, or give it a default |
| `model "m": param "s" needs a default` | Model params cannot be set from outside, so a default is the only way they get a value |

---

## Blocks

Raised while building geometry.

| Message | Cause |
| --- | --- |
| `unknown block "bloop"` | Not a builtin and not a declared component. Check the spelling against the [block list](README.md#shapes) |
| `"box" does not take a label` | Only [`part`](reference/part.md) takes a meaningful label |
| `"box" is a shape and cannot contain other blocks` | A shape is a leaf. Usually a missing `}` swallowed the next block |
| `"translate" needs at least one shape inside it` | An operation with nothing to act on |
| `box: unknown attribute "colour"` | Every block rejects attributes it did not read, so a typo fails loudly |
| `attribute "size" is set twice` | The same attribute written twice in one block |
| `box: "size" must be a number or an array of 3 numbers` | Wrong shape of value |
| `circle: "radius" must be a finite number` | A `NaN` or `Infinity` reached the block |
| `regular_polygon: "sides" must be at least 3` | |
| `polygon: "points" must be an array of at least 3 points` | |
| `circle: give either "radius" or "diameter", not both` | They mean the same thing |
| `cylinder: give "radius"/"diameter", or both "bottom_radius" and "top_radius"` | One end radius on its own is ambiguous |
| `offset: "join" must be one of "Square", "Round", "Miter"` | An enum attribute with an unrecognised value |

### `box: unknown attribute "colour"`

Worth dwelling on, because it is the error that saves the most time. A misspelled attribute
would otherwise be silent, and the model would render subtly wrong with nothing to point at.
The one exception is a [`param`](reference/param.md) block, which is metadata and passes
anything through.

---

## Dimensionality

| Message | Cause |
| --- | --- |
| `"union" cannot mix 2D and 3D shapes` | Children of different dimensionality in one block |
| `"extrude" takes 2D geometry, got 3D` | A block that fixes what it takes got the other thing |
| `part "body" is 2D — extrude or revolve it before rendering` | A cross-section reached the renderer |
| `cannot combine 2D and 3D geometry in a union` | The same mistake, from the [node API](api/geometry-node.md) rather than a document |

See [Dimensionality](language/overview.md#dimensionality) for the three rules, and
[2D ↔ 3D](reference/conversions.md) for the way across.

---

## Components

| Message | Cause |
| --- | --- |
| `c: "s" has no default and was not given` | A required component param the call site did not pass |
| `c: unknown param "t"` | Components have no pass-through: every value must be declared |
| `component "c" produced no geometry` | An empty body, a loop over an empty list, or an `if` that took no branch |
| `a component cannot declare parts` | Scene structure belongs in the model |
| `nesting deeper than 64 blocks — is a component using itself?` | Direct or mutual recursion. Rewrite as a `for` loop |

---

## Parts and scenes

| Message | Cause |
| --- | --- |
| `a part cannot contain another part` | Parts are a flat list |
| `a part needs at least one shape inside it` | Put the `if` around the part, not inside it |
| `model "m" produced no geometry` | Nothing was produced. Often a `for` over an empty range |
| `the document declares no model` | Add a `model` block |
| `no model named "x"` | `render(source, { model })` named one that does not exist |

A [`part`](reference/part.md) nested inside an operation raises **nothing** — it is silently
dropped. If a part is missing from a render, check it is written directly in the model.

---

## Control flow

| Message | Cause |
| --- | --- |
| `for: expected a list to iterate` | The sequence is not a list. Strings are not iterable here |

---

## `align`

| Message | Cause |
| --- | --- |
| `align needs a kernel context — render the model rather than building it` | An `Evaluator` built with no context. [`render`](api/render.md) always supplies one |
| `align needs at least one shape inside it` | Nothing to measure |
| `align: "x" must be "min", "center", "max" or a number` | The spelling is `"center"` |

---

## Runtime

Raised by the JavaScript API rather than by a document.

| Message | Cause |
| --- | --- |
| `EvaluationContext has been disposed` | A solid or a render used a context after `dispose()` |
| `EvaluationContext used before create() resolved` | The constructor was called directly. Use `EvaluationContext.create()` |
| `bad dimensionality 4` | `new GeometryNode` with something other than 2 or 3 |
| `expected 3 components, got 2` | `Vector.of` asked for a size the value does not have |
| `cannot read an angle from string` | `Angle.of` takes an `Angle` or a number |

---

## Silent behaviours

Not errors, and each is deliberate — but each has surprised someone. A parameter reaching the
end of its range should not break a model, so these degenerate quietly:

| What | Result |
| --- | --- |
| `extrude { height = 0 }` | Empty geometry |
| `revolve { angle = 0 }` | Empty geometry |
| A `difference` that removes everything | Empty geometry |
| A negative `offset` larger than the shape | Empty geometry |
| `range` running backwards for its step | An empty list |
| A label on `align` or a component call | Ignored |
| A supplied param the document does not declare | Ignored |
| `min`, `max`, `step`, `options` on a param | Advisory; never enforced |
| A duplicate `local` | Replaces the first, everywhere |
| A `part` inside an operation | Dropped from the scene |
| An index past the end of a list | Nothing, which fails later where it is used |

If a model renders but is not what you meant, this table is the place to start.

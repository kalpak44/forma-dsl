# Syntax

The lexical rules, the grammar, and the one whitespace rule that is easy to trip over.

---

## Comments

Three forms, all ignored:

```hcl
// a line comment
#  also a line comment
/* a block comment,
   which may span lines */
```

A block comment that is never closed is an error: `unterminated block comment`. Block
comments do not nest.

---

## Numbers

Decimal, with an optional fraction and an optional exponent.

```hcl
12        0.5       .5        1e3       2.5e-3
```

There is no hexadecimal, no separator, and no unit suffix. A leading `-` is the unary minus
operator, not part of the literal.

`2e` and `2em` are **not** numbers with exponents — the lexer backs out of a bare `e` and
lets it start an identifier, so `2e` lexes as the number `2` followed by the name `e`.

---

## Strings

Double quotes only. A string may not contain a literal newline.

```hcl
"plain"
"with a ${var.count * 2} value spliced in"
"a tab\there, a quote\", a literal \${ not a splice"
```

**Escapes.** Exactly six: `\n`, `\t`, `\r`, `\"`, `\\` and `\$`. Anything else is an error —
`unknown escape \q`. `\$` exists so a literal `${` can be written.

**Interpolation.** `${ ... }` splices in any expression. Braces inside the splice are
counted, so an object literal does not end it early. See
[Expressions → Interpolation](expressions.md#string-interpolation) for how each value type is
rendered.

---

## Identifiers

An identifier starts with a letter or `_` and continues with letters, digits, `_` **or `-`**.

```hcl
height   wall_thickness   _private   min-width   part2
```

> **Hyphens are part of a name.** `a-b` is one identifier, not `a` minus `b`. Write
> subtraction with spaces: `a - b`. This is the single most common surprise in the lexer —
> `local gap = outer-inner` fails with `unknown name "outer-inner"`.

### Keywords

These eleven names introduce a construct and cannot be used as a block type:

```
param   local   component   model   for   if   else   in   true   false   null
```

They can still be used as attribute names and as identifiers in expressions where the
grammar is unambiguous, but avoid it.

### Type names

`number`, `string`, `bool`, `vector`, `list` and `angle` are ordinary identifiers bound to
themselves, so `type = number` in a [`param`](../reference/param.md) block needs no quoting
and no keyword.

---

## Blocks, attributes and labels

A body contains attributes and nested blocks, in any order and in any mix.

```hcl
block_type "label" {
  attribute = expression
  nested_block { ... }
}
```

- **An attribute** is `name = expression`. Setting the same attribute twice in one block is
  an error.
- **A nested block** is an identifier that is *not* followed by `=`, then optional labels,
  then a braced body.
- **A label** is a string or an identifier written between the block type and the brace.

Labels come in two flavours:

| Where | Form | Notes |
| --- | --- | --- |
| `component "name"`, `model "name"` | Static | The name must be a plain string or identifier. `${ }` is rejected: `a label cannot contain ${ }` |
| `part "name"` | An expression | Evaluated at build time, so a part in a loop can name itself: `part "leg_${i}"` |

Blocks that take no label reject one — `"box" does not take a label`. Two blocks accept a
label and quietly ignore it: [`align`](../reference/align.md) and
[component calls](../reference/component.md).

---

## The newline rule

**Outside brackets, a line break ends an expression.** This is what lets attributes be
written one per line with no separators:

```hcl
rect {
  size   = [62, 13]     // ends here
  center = true         // a separate attribute
}
```

Without the rule, `size = [62, 13]` followed by `-4` on the next line would parse as a
subtraction rather than as the start of something new.

Inside `(...)`, `[...]` or a call's argument list, the rule is suspended and an expression may
span as many lines as it likes:

```hcl
polygon {
  points = [
    [0, 0], [26, 0],
    [24, 6], [0, 74],
  ]
}

local total = (
  var.wall * 2
  + var.gap
)
```

To continue an expression across lines at the top level, put the break **inside** brackets,
or end the line with an operator so the parser is still mid-expression:

```hcl
local a = base +          // fine: the line ends mid-expression
          extra

local b = base
          + extra         // NOT a continuation: `local b = base`, then a parse error
```

Trailing commas are allowed in lists, objects and argument lists.

---

## Grammar

An informal EBNF of the whole language. `IDENT`, `NUMBER` and `STRING` are the lexical forms
above.

```ebnf
document    = { declaration } ;

declaration = param | local | component | model ;
param       = "param" label ( "=" expression | body ) ;
local       = "local" label "=" expression ;
component   = "component" label body ;
model       = "model" label body ;

body        = "{" { entry } "}" ;
entry       = param | local | for | if | attribute | block ;
attribute   = IDENT "=" expression ;
block       = IDENT { label } body ;
label       = IDENT | STRING ;

for         = "for" IDENT [ "," IDENT ] "in" expression body ;
if          = "if" expression body [ "else" ( if | body ) ] ;

expression  = conditional ;
conditional = binary [ "?" expression ":" expression ] ;
binary      = unary { binop unary } ;          (* precedence climbing *)
unary       = [ "-" | "!" ] unary | postfix ;
postfix     = primary { "." IDENT | "[" expression "]" | arguments } ;
arguments   = "(" [ expression { "," expression } [ "," ] ] ")" ;
primary     = NUMBER | STRING | "true" | "false" | "null"
            | IDENT | "(" expression ")" | array | object ;
array       = "[" [ expression { "," expression } [ "," ] ] "]" ;
object      = "{" { IDENT ( "=" | ":" ) expression [ "," ] } "}" ;

binop       = "||" | "&&" | "==" | "!=" | "<" | "<=" | ">" | ">="
            | "+" | "-" | "*" | "/" | "%" ;
```

Two things the grammar cannot express:

- A `param` written in braced form may contain attributes only. Nested blocks inside it are
  an error: `a param block holds attributes, not nested blocks`.
- Whether `IDENT` begins an attribute or a block is decided by one token of lookahead: `=`
  means attribute, anything else means block.

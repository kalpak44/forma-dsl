/**
 * The language, compressed to what someone writing a document has to hold in their head.
 *
 * This is deliberately not the reference manual — the manual is bundled too, and
 * `forma_reference` serves it. This is the page that goes into a model's context before it
 * writes anything: the rules that are not guessable, the mistakes that are expensive, and
 * the shape of a working document.
 */

/** The sections, in reading order. Each is a complete thought on its own. */
const SECTIONS = {
  shape: `## The shape of a document

A document is a flat list of four kinds of top-level block. Nothing else may appear there.

| Block | What it is |
| --- | --- |
| \`param NAME = expr\` / \`param NAME { ... }\` | An input. Read it as \`var.NAME\` |
| \`local NAME = expr\` | A named value, computed once |
| \`component "NAME" { ... }\` | Reusable geometry, called like a builtin block |
| \`model "NAME" { ... }\` | Something to render. The first one is the default |

\`\`\`hcl
param height { type = number  default = 20  min = 8  max = 40 }
local wall = 2.5

component "boss" {
  param radius = 5
  cylinder { radius = radius  height = 8 }
}

model "riser" {
  part "body" {
    color = "#6f7d8c"
    difference {
      extrude {
        height = var.height
        rounded_rect { size = [40, 20]  radius = 4  center = true }
      }
      translate { offset = [0, 0, 3]  cylinder { radius = 5  height = var.height } }
    }
  }
}
\`\`\`

Order does not matter between declarations of different kinds — a model may use a component
declared below it. Order does matter among top-level \`local\`s, which resolve top to bottom.`,

  nesting: `## Nesting is composition

There is no expression language for geometry. **A block's children are its operands**,
written inside its braces:

\`\`\`hcl
difference {                             // subtract…
  box { size = [20, 20, 10] }            // …this is the body
  cylinder { radius = 5  height = 30 }   // …and this is cut out of it
}
\`\`\`

**Several children in a row are implicitly unioned.** Every operation except the three
booleans unions its children before acting, so a transform around two shapes moves both:

\`\`\`hcl
translate {
  offset = [0, 0, 10]
  box { size = [4, 4, 4] }       // unioned first…
  sphere { radius = 3 }          // …then the union is moved
}
\`\`\`

\`difference\` is the one operation where order matters: the first child is the body, every
later child is cut out of it. An operation with no children is an error; a shape with
children is an error.`,

  dimensionality: `## Dimensionality

Every piece of geometry is 2D or 3D, and the language tracks which.

- **2D** — \`rect\` \`rounded_rect\` \`circle\` \`ellipse\` \`regular_polygon\` \`stadium\` \`polygon\`
- **3D** — \`box\` \`sphere\` \`cylinder\` \`cone\` \`torus\`
- **Operations** either fix what they take (\`extrude\` takes 2D, \`refine\` takes 3D) or pass
  their children's dimensionality through (\`translate\` \`rotate\` \`scale\` \`mirror\` \`hull\`
  \`simplify\` \`align\`, the booleans).

Three rules, each with its own error:

| Rule | Error when broken |
| --- | --- |
| Children of one block must all be the same dimensionality | \`"union" cannot mix 2D and 3D shapes\` |
| A block that fixes what it takes must get it | \`"extrude" takes 2D geometry, got 3D\` |
| Anything rendered must be 3D | \`part "body" is 2D — extrude or revolve it before rendering\` |

2D → 3D with \`extrude\` or \`revolve\`; 3D → 2D with \`project\` or \`slice\`.`,

  units: `## Units and orientation

- **Lengths are unitless.** Every consumer treats them as millimetres.
- **Angles are always degrees.** Everywhere — \`rotate { z = 90 }\`, \`revolve { angle = 180 }\`,
  \`sin(30)\`, \`param a { type = angle }\`. There is no radian form.
- **Z is up.** \`extrude\` sweeps along +Z. \`revolve\` spins a profile written in the XY plane
  about the Y axis, mapping the profile's Y to the result's Z — so a profile drawn upwards
  from \`[0, 0]\` produces a solid standing on the XY plane.
- **3D rotations apply X, then Y, then Z**, matching OpenSCAD.
- **Transforms act about the origin.** Centre a shape (\`center = true\`) before rotating it,
  or it swings away.`,

  syntax: `## Syntax

**Comments** — \`// line\`, \`# line\`, \`/* block */\`. Block comments do not nest.

**Numbers** — \`12\` \`0.5\` \`.5\` \`1e3\` \`2.5e-3\`. No hex, no separators, no unit suffix.

**Strings** — double quotes only, no literal newline. Exactly six escapes: \`\\n\` \`\\t\` \`\\r\`
\`\\"\` \`\\\\\` \`\\$\`. \`\${ expr }\` splices any expression in.

**Identifiers** start with a letter or \`_\` and continue with letters, digits, \`_\` **or \`-\`**.

> **Hyphens are part of a name.** \`a-b\` is one identifier, not a subtraction. Write
> \`a - b\` with spaces. This is the single most common surprise: \`local gap = outer-inner\`
> fails with \`unknown name "outer-inner"\`.

**Keywords**, which cannot be used as a block type:
\`param local component model for if else in true false null\`.

**Blocks and attributes.** A body holds attributes and nested blocks in any mix. An attribute
is \`name = expression\`; anything else that is followed by a brace is a nested block. Setting
the same attribute twice is an error.

**The newline rule.** Outside brackets, **a line break ends an expression** — that is what
lets attributes be written one per line with no separators. Inside \`(...)\`, \`[...]\` or an
argument list the rule is suspended, so break there to continue across lines:

\`\`\`hcl
local total = (
  var.wall * 2
  + var.gap
)

local b = base
          + extra      // NOT a continuation — this is a parse error
\`\`\`

Trailing commas are allowed in lists, objects and argument lists.`,

  expressions: `## Expressions

| Type | Literals |
| --- | --- |
| number | \`12\` \`0.5\` \`1e3\` |
| string | \`"text"\` \`"a \${b} c"\` |
| bool | \`true\` \`false\` |
| list | \`[1, 2, 3]\` \`[[0,0], [1,0]]\` |
| object | \`{ w = 3, h = 4 }\` or \`{ w: 3 }\`, read with \`.key\` |
| null | \`null\` |

There is no vector type: **a vector is a list of numbers**, and a block says how many
components it wants. Where a block wants a vector, **a single number stands for every
component** — \`scale { factor = 2 }\` is \`scale { factor = [2, 2, 2] }\`.

**Operators**, loosest first: \`?:\` · \`||\` · \`&&\` · \`== !=\` · \`< <= > >=\` · \`+ -\` ·
\`* / %\` · prefix \`-x !x\` · postfix \`a.b a[i] f(x)\`.

\`\`\`hcl
[10, 20] + [1, 2]      // [11, 22]   componentwise
[10, 20] * 2           // [20, 40]   scalar broadcast, either order
[10, 20] / 2           // [5, 10]    scalar only
"part_" + 3            // "part_3"   + concatenates when either side is a string
\`\`\`

\`+\` and \`-\` on two lists are componentwise and reject a bare number; \`/\` accepts a scalar
only. Two lists of different lengths cannot be combined. **Division and modulo by zero are
errors**, not \`Infinity\`.

\`<\` \`<=\` \`>\` \`>=\` need both sides to be the same type. \`==\` compares structurally.

**Truthy / falsy** — falsy is \`false\`, \`0\`, \`""\`, \`[]\`, \`null\`. Everything else is truthy,
including \`{}\`.

**Members** — \`.x\` \`.y\` \`.z\` read index 0, 1, 2 off a list, so \`size.z\` works on a
3-vector. \`a[i]\` indexes. \`var.NAME\` reads a param.`,

  scope: `## Scope and names

- **\`var\` holds params only** — never locals. A local with the same name shadows the bare
  name but \`var.NAME\` still means the param.
- **Component params are read by their bare name.** There is no \`var.\` for them.
- **A component body cannot see the call site.** It is evaluated in a fresh scope rooted at
  the document, so a \`local\` where it is called does not leak in. Document params and other
  components are in scope.
- **A param default may use earlier params by their bare name**, but never \`var\` — \`var\` is
  assembled only after every param has resolved.
- **Top-level locals are ordered**; locals inside a body are not, so a block may use a local
  written below it.
- **Loop variables** are bound per iteration in a fresh child scope.`,

  control: `## Control flow

Both appear where a block appears, and produce geometry rather than a value.

\`\`\`hcl
for i in range(0, 6) { ... }          // one name: the value
for i, item in list { ... }           // two names: the index, then the value

if cond { ... } else if other { ... } else { ... }
\`\`\`

- The sequence must be a **list**. \`range(a, b)\` excludes \`b\` and is empty when it runs
  backwards, so a loop can never spin forever.
- There is no \`break\`, no \`continue\` and no accumulator. Filter the list instead.
- A loop over an empty list produces nothing, which is an error where something was
  required — guard it with \`if\`.
- For a *value* that depends on a condition, use \`cond ? a : b\`, not \`if\`.

The radial-array idiom, which is most of what loops are for:

\`\`\`hcl
for i in range(0, var.bolts) {
  rotate {
    z = i * 360 / var.bolts
    translate { offset = [var.circle_r, 0, -1]  cylinder { radius = 3  height = 12 } }
  }
}
\`\`\``,

  parts: `## Parts and scenes

A \`part\` is a separately coloured piece of the finished scene. It is **not an operand**: it
contributes no geometry to the block around it.

\`\`\`hcl
model "assembly" {
  part "frame" { color = "#6f7d8c"  box { size = [40, 40, 4] } }
  part "pin"   { color = "#c8842f"  opacity = 0.4
                 translate { offset = [0, 0, 4]  cylinder { radius = 3  height = 10 } } }
}
\`\`\`

- Declare parts **directly in a model**, or inside a \`for\`/\`if\` in one. A part nested inside
  a transform or a boolean is **silently dropped** — no error, it is just gone.
- A part cannot contain another part, cannot be empty, and cannot come out of a component.
- Geometry written outside any part becomes one default part named after the model.
- The label is an expression: \`part "leg_\${i}"\`.
- To make a part optional, put the \`if\` **around** it, never inside it.`,

  pitfalls: `## The mistakes that cost the most time

1. **Hyphens bind into names.** \`outer-inner\` is one identifier. Write \`outer - inner\`.
2. **A misspelled attribute is an error, not a silent no-op** — \`box: unknown attribute
   "colour"\`. The one exception is a \`param\` block, which passes anything through.
3. **A part inside a transform disappears** with no warning. Put the transform inside the
   part.
4. **Transforms are about the origin.** \`rotate\` a shape built in the positive quadrant and
   it swings away from where you expected. Use \`center = true\`, or \`align\`.
5. **A cutter must overshoot.** A \`difference\` whose cutter ends exactly on the body's face
   leaves a zero-thickness skin. Start it below and run it past.
6. **\`revolve\` needs a profile at X ≥ 0.** Crossing the axis puts a spike through the middle.
7. **2D cannot be rendered.** A part holding a \`circle\` fails; extrude it.
8. **\`param s\` alone is a syntax error.** Write \`param s { }\` for a required param.
9. **\`min\`/\`max\`/\`step\`/\`options\` on a param are advisory** and never enforced. Clamp in
   the model if the bound matters: \`local n = max(3, min(16, var.bolts))\`.
10. **Empty geometry is silent.** \`extrude { height = 0 }\`, a \`difference\` that removes
    everything and a backwards \`range\` all produce nothing rather than an error — and then
    fail further out with \`model "m" produced no geometry\`.
11. **A line break ends an expression** outside brackets. Continue inside \`(...)\` or end the
    line on an operator.
12. **\`rotate\` spells its 2D and 3D attributes differently** — \`angle\` in 2D, \`x\`/\`y\`/\`z\`
    or \`angles\` in 3D.`,

  workflow: `## How to write one of these

1. **Name the inputs first.** Anything a person would want to change is a \`param\` with a
   \`default\`, a \`min\` and a \`max\`. Anything derived from those is a \`local\`.
2. **Write the profile, then give it thickness.** Most real parts are a 2D outline extruded
   or revolved. Modelling in 2D and converting once is shorter and more robust than
   composing solids.
3. **Name repeated features as components** — including the *negative* of a feature. A
   \`component "counterbore"\` subtracted in a loop reads far better than four inlined unions.
4. **One \`part\` per physical piece**, each with a colour. It is what makes a render legible
   and what lets a single piece be exported.
5. **Check it.** Call \`forma_check\` with \`solve: true\` and read the bounding box and the
   volume back: they are how you know the thing is the size you meant and is not empty.
   Iterate until it renders, then write it with \`forma_write\`.

Keep every dimension that matters expressed in terms of params, so the document answers
"what if it were 20 mm taller" without being rewritten.`,
};

/** The order sections are served in when everything is asked for. */
const ORDER = [
  'shape', 'nesting', 'dimensionality', 'units', 'syntax', 'expressions',
  'scope', 'control', 'parts', 'pitfalls', 'workflow',
];

/** The names a caller may ask for. */
export const GUIDE_SECTIONS = ORDER;

/**
 * The guide, whole or in part.
 *
 * @param {string} [section] One of {@link GUIDE_SECTIONS}, or nothing for all of it.
 * @returns {string} Markdown.
 * @throws {Error} If the section is not one the guide has.
 */
export function guide(section) {
  if (!section) {
    return ['# The forma language, in brief', '', ...ORDER.map((name) => SECTIONS[name])].join('\n\n');
  }
  if (!SECTIONS[section]) {
    throw new Error(`no guide section "${section}" — it is one of ${ORDER.join(', ')}`);
  }
  return SECTIONS[section];
}

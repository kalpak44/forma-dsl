# Command line

[`forma-dsl-cli`](https://www.npmjs.com/package/forma-dsl-cli) solves a document and writes a
binary STL, with no browser and no build step. It is what puts a `.forma` file in a Makefile,
a CI job or a release pipeline.

```bash
npm install -g forma-dsl-cli
forma render riser.forma -p height=32 -o build/riser.stl
```

Or, without installing it, `npx forma-dsl-cli render riser.forma -o riser.stl`.

It knows nothing about the language itself. Every answer comes from `forma-dsl` - the same
package the editor and the MCP server import - so a block added to the language is one it
renders without being told, and an error it reports is the evaluator's own, with the
evaluator's own position.

---

## Commands

| Command | What it does |
| --- | --- |
| `forma render <file>` | solve a document and write a binary STL |
| `forma params <file>` | list the parameters the document declares |
| `forma models <file>` | list the models the document declares |

A `<file>` of `-` reads the document from stdin. `params` and `models` take `--json`.

A document, and an `-o`/`--out` that names one, must resolve inside the directory the command
is run in: a path that leaves it - by `..`, an absolute path, or a symlink pointing out of the
tree - is refused with exit code 2.

### `render`

| Option | Default | What it does |
| --- | --- | --- |
| `-o, --out <file>` | `<file>.stl` | where to write. `-` is stdout |
| `-m, --model <name>` | the first declared | which [model](reference/model.md) to build |
| `--part <name>` | see below | one [part](reference/part.md) by name |
| `-p, --param <name=val>` | each param's own default | a value for one declared [param](reference/param.md). Repeatable |
| `--segments <n>` | the kernel's own | a fixed segment count for every curve |
| `--min-angle <deg>` | the kernel's own | smallest angle between adjacent segments of a curve |
| `--min-edge <n>` | the kernel's own | smallest length a curve segment may be shortened to |
| `--max-nodes <n>` | no limit | refuse a document that would build more blocks than this |
| `-q, --quiet` | off | do not print the summary |

The three resolution options are [`setQuality`](api/kernel.md) under another name, and are
global to the kernel exactly as they are there. `--max-nodes` is
[`render`](api/render.md)'s own budget.

Without `--part`, a model with one part exports that part, and a model with several exports
them **unioned**. STL has no notion of a part, and a slicer reading two overlapping shells
makes a mess of them.

---

## Parameter values

A value is JSON where it parses as JSON, and the string as written otherwise. That is what
makes all four of these arrive as the type the document expects, with no second layer of
quoting:

```bash
forma render part.forma -p count=6 -p center=true -p size=[10,20] -p label=M6
```

---

## In a pipeline

Only what was asked for goes to stdout - the STL under `-o -`, and the listings. The summary
and every diagnostic go to stderr, so a pipe stays clean:

```bash
forma render riser.forma --segments 64 -o - > riser.stl
```

Exit codes are the three a script needs to tell apart:

| Code | What happened |
| --- | --- |
| `0` | it worked |
| `1` | the document did not build - a syntax error, an unknown name, a degenerate solid |
| `2` | the invocation was wrong - an unknown flag, a missing file, a part that does not exist |

The summary names the cache hits, because that is the number explaining why the second render
of the same document in a loop is faster, and it is otherwise invisible:

```
build/riser.stl - 252 triangles · model "riser", part "body" · 6 nodes, 6 solved, 0 cached · 9 ms
```

---

## Failures

A failure is reported where an editor and a CI annotation can both find it: the position as a
`file:line:column:` prefix, then the lines around it with a caret under the column.

```
riser.forma:7:23: size must be positive
 5 |   part "body" {
 6 |     extrude {
 7 |       rect { size = [-40, 20] }
   |                     ^
 8 |     }
 9 |   }
```

The position comes from the error itself - see [Errors](errors.md) for what each stage raises
and what it means.

---

## Building a matrix

`params --json` is the document describing itself, which is what lets a script build every
variant without being told what the variants are:

```bash
forma params riser.forma --json
```

```json
[
  {
    "name": "height",
    "type": "number",
    "default": 20,
    "required": false,
    "min": 8,
    "max": 40
  }
]
```

```bash
for h in 8 20 40; do
  forma render riser.forma -p "height=$h" -o "build/riser-$h.stl"
done
```

---

## Units

Lengths are unitless in forma, and STL has no unit either. Every consumer treats them as
millimetres.

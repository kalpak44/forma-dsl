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
| `--params <file>` | - | a JSON object of values by name. `-p` wins over it |
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

## Passing parameters

Three ways, and they compose.

**One at a time, on the command line.** A value is JSON where it parses as JSON, and the
string as written otherwise - so there is no second layer of quoting to get wrong:

```bash
forma render part.forma -p count=6 -p center=true -p size=[10,20] -p label=M6
```

| Written | Arrives as |
| --- | --- |
| `-p count=6` | the number `6` |
| `-p center=true` | the boolean `true` |
| `-p size=[10,20]` | the list `[10, 20]` |
| `-p label=M6` | the string `"M6"` |

**From a file.** `--params` takes a JSON object of values by name - the thing you commit and
diff, rather than assemble in a shell loop:

```json
{
  "height": 36,
  "label": "M6",
  "center": true
}
```

```bash
forma render riser.forma --params params.json -o riser.stl
```

It has to be a JSON **object**. An array or a bare number parses but names nothing, and is
refused with exit code 2 rather than quietly contributing nothing. Like every other path, it
must resolve inside the directory the command runs in.

**Both.** `-p` wins over `--params`, which is what a build matrix wants: the values every
variant shares live in the file, and the one that varies goes on the line.

```bash
for h in 8 20 40; do
  forma render riser.forma --params shared.json -p "height=$h" -o "build/riser-$h.stl"
done
```

And the document will tell you what it takes, so the first `params.json` need not be written
by hand:

```bash
forma params riser.forma --json | jq 'map({(.name): .default}) | add' > params.json
```

```json
{
  "height": 20,
  "label": "A",
  "center": false
}
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
riser.forma:7:7: rounded_rect: unknown attribute "corner_radius" - rounded_rect reads "center", "radius", "segments", "size"
5 |     extrude {
6 |       height = var.height
7 |       rounded_rect { size = [40, 20]  corner_radius = 4 }
  |       ^
8 |     }
9 |   }
```

The position comes from the error itself - see [Errors](errors.md) for what each stage raises
and what it means.

---

## What a document declares

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

`required` is true for a param declared with no default, which is one that has to be supplied
before the document will build at all.

---

## Units

Lengths are unitless in forma, and STL has no unit either. Every consumer treats them as
millimetres.

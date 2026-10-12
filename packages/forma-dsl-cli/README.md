# forma-dsl-cli

[![forma-dsl-cli on npm](https://img.shields.io/npm/v/forma-dsl-cli.svg?label=forma-dsl-cli)](https://www.npmjs.com/package/forma-dsl-cli)

The `forma` command: solve a [forma](https://kalpak44.github.io/forma-dsl/) document and write
a binary STL, without a browser and without a build step.

```bash
npm install -g forma-dsl-cli
forma render riser.forma -p height=32 -o build/riser.stl
```

Or without installing it:

```bash
npx forma-dsl-cli render riser.forma -o riser.stl
```

## What it does

```
forma render <file> [options]     solve a document and write a binary STL
forma params <file> [--json]      list the parameters the document declares
forma models <file> [--json]      list the models the document declares
```

A `<file>` of `-` reads the document from stdin.

A document, and an `--out` that names one, must resolve inside the directory the command is
run in: a path that leaves it - by `..`, an absolute path, or a symlink pointing out of the
tree - is refused with exit code 2.

| Option | What it does |
| --- | --- |
| `-o, --out <file>` | where to write; `-` is stdout. Defaults to `<file>.stl` |
| `-m, --model <name>` | which model to build. Defaults to the first declared |
| `--part <name>` | one part by name. Defaults to the only part, or every part unioned |
| `-p, --param <name=val>` | a value for one declared param. Repeatable |
| `--params <file>` | a JSON object of values by name. `-p` wins over it |
| `--segments <n>` | a fixed segment count for every curve |
| `--min-angle <deg>` | smallest angle between adjacent segments of a curve |
| `--min-edge <n>` | smallest length a curve segment may be shortened to |
| `--max-nodes <n>` | refuse a document that would build more blocks than this |
| `-q, --quiet` | do not print the summary |

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

## In a pipeline

Only what was asked for goes to stdout — the STL under `-o -`, and the listings. The summary
and every diagnostic go to stderr, so a pipe stays clean:

```bash
forma render riser.forma --segments 64 -o - > riser.stl
```

Exit codes are the three a script needs to tell apart: `0` for success, `1` for a document
that does not build, and `2` for a mistake in the invocation itself.

A failure is reported where an editor and a CI annotation can both find it:

```
riser.forma:7:7: rounded_rect: unknown attribute "corner_radius" - rounded_rect reads "center", "radius", "segments", "size"
5 |     extrude {
6 |       height = var.height
7 |       rounded_rect { size = [40, 20]  corner_radius = 4 }
  |       ^
8 |     }
9 |   }
```

Build a matrix of variants from what the document itself declares:

```bash
for h in $(forma params riser.forma --json | jq -r '.[] | select(.name=="height") | .min, .max'); do
  forma render riser.forma -p "height=$h" -o "build/riser-$h.stl"
done
```

## What it is not

It does not know the language. Every answer — the blocks it accepts, the errors it reports,
the geometry it solves — comes from [`forma-dsl`](https://www.npmjs.com/package/forma-dsl),
the same package the browser editor and the MCP server import. A block added to the language
is one this renders without being told.

Lengths are unitless in forma, and STL has no unit either; every consumer treats them as
millimetres.

## Related

| Package | What it is |
| --- | --- |
| [`forma-dsl`](https://www.npmjs.com/package/forma-dsl) | the language, its evaluator and the geometry kernel binding |
| [`forma-dsl-mcp`](https://www.npmjs.com/package/forma-dsl-mcp) | an MCP server: it knows the language, solves what it writes, and produces `.forma` files |

**[The site](https://kalpak44.github.io/forma-dsl/)** ·
**[Try the editor](https://kalpak44.github.io/forma-dsl/editor/)** ·
**[Read the reference](https://kalpak44.github.io/forma-dsl/docs/)**

The reference manual documents the language, and the editor runs the same kernel in a browser.

## License

MIT — see [LICENSE](LICENSE).

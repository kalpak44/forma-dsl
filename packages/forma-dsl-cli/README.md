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

| Option | What it does |
| --- | --- |
| `-o, --out <file>` | where to write; `-` is stdout. Defaults to `<file>.stl` |
| `-m, --model <name>` | which model to build. Defaults to the first declared |
| `--part <name>` | one part by name. Defaults to the only part, or every part unioned |
| `-p, --param <name=val>` | a value for one declared param. Repeatable |
| `--segments <n>` | a fixed segment count for every curve |
| `--min-angle <deg>` | smallest angle between adjacent segments of a curve |
| `--min-edge <n>` | smallest length a curve segment may be shortened to |
| `--max-nodes <n>` | refuse a document that would build more blocks than this |
| `-q, --quiet` | do not print the summary |

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
riser.forma:7:23: size must be positive
 5 |   part "body" {
 6 |     extrude {
 7 |       rect { size = [-40, 20] }
   |                     ^
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

The [reference manual](https://kalpak44.github.io/forma-dsl/docs/) documents the language, and
the [editor](https://kalpak44.github.io/forma-dsl/editor/) runs the same kernel in a browser.

## License

MIT — see [LICENSE](LICENSE).

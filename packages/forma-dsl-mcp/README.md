# forma-dsl-mcp

[![Release](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml/badge.svg)](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/forma-dsl-mcp.svg)](https://www.npmjs.com/package/forma-dsl-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io) server that knows
[forma](https://www.npmjs.com/package/forma-dsl) — the declarative DSL for 3D solids — and
builds it with the real geometry kernel, so a `.forma` document is measured before anyone is
told it works.

It carries the language with it: the guide, the block reference, the worked examples and the
full manual are bundled, so a model learns the syntax from the server rather than guessing at
it.

It speaks over stdio, and there is nothing to configure.

## Installing it

**Claude Code**

```bash
claude mcp add forma -- npx -y forma-dsl-mcp
```

**Codex**

```bash
codex mcp add forma -- npx -y forma-dsl-mcp
```

or, in `~/.codex/config.toml`:

```toml
[mcp_servers.forma]
command = "npx"
args = ["-y", "forma-dsl-mcp"]
```

**Claude Desktop, and anything else that takes a JSON block**

```json
{
  "mcpServers": {
    "forma": {
      "command": "npx",
      "args": ["-y", "forma-dsl-mcp"]
    }
  }
}
```

## Where the files go

The server does not choose. It asks the client over MCP's
[roots](https://modelcontextprotocol.io/specification/basic/roots) capability, and reads and
writes only inside the directories the client hands over. A relative path is taken against
the first of them, and every write reports the directory it landed in.

**Every path is confined to those directories** — an absolute path outside them, a `..` that
climbs out, or a symlink pointing out of the tree is refused rather than followed. When the
client says its roots have changed, the server re-reads them before the next call.

A client that does not implement roots gets the working directory it launched the server in,
which is the one location it did choose. Codex can set that explicitly:

```toml
[mcp_servers.forma]
command = "npx"
args = ["-y", "forma-dsl-mcp"]
cwd = "/absolute/path/to/your/models"
```

## Why it is not just a prompt

A model that has read the language's documentation still writes forma that does not build.
The difference this server makes is that it **runs the geometry kernel**. Every tool compiles
the document, solves it with [Manifold](https://github.com/elalish/manifold) and reports back
the bounding box, the volume, the triangle count and the genus of every part — so the
question "is this the size that was asked for, and is it actually a solid?" is answered
before the work is handed over. A part that silently solved to nothing is called out by name,
and an error comes back with the line, the column and an excerpt with a caret on it.

`forma_write` **refuses to write a document that does not render**.

Refusals carry the vocabulary too: an unknown block comes back with every block there is, and
an unknown attribute with the ones that block reads. That is the backstop, not the teacher —
it is enough to correct a misspelling and not enough to learn a language, since it gives the
name of a block and nothing about what that block means or what it takes. `forma_guide`,
`forma_blocks` and `forma_reference` are what answer that, and they are bundled so they
answer offline.

Everything the server says about the language is answerable to the language. The block and
function catalogue is merged with the library's own registries at load time, and the tests
assert the two agree: a block added, renamed or given a new dimensionality in `forma-dsl`
fails this package's build rather than becoming a confident wrong answer. Every worked example
is rendered by the test suite.

## Tools

**Learning the language**

| Tool | What it does |
| --- | --- |
| `forma_guide` | The language in one page: structure, nesting, dimensionality, units, syntax, the mistakes that cost the most time |
| `forma_blocks` | Every block with its attributes, defaults, dimensionality and caveats |
| `forma_functions` | Every builtin function and constant, with arity |
| `forma_examples` | Complete documents that render, each showing one way of building a real part |
| `forma_reference` | The full reference manual, searchable and readable page by page |

**Building with it**

| Tool | What it does |
| --- | --- |
| `forma_write` | Check, then write a `.forma` file |
| `forma_read` | Read a document back, checked |
| `forma_export_stl` | Render and write a binary STL |

## Resources

The same knowledge in the form a person can attach to a conversation by hand:

- `forma://guide` — the language in brief
- `forma://catalogue` — every block and function, as JSON
- `forma://reference/{path}` — one page of the manual
- `forma://example/{name}` — one worked document

## Asking for a part

Install it in Codex as above, `cd` to wherever you keep your models, and ask:

> **you** — build me a forma file with a tree in it

> **codex** — Where should I put it?

> **you** — the current folder

Codex reads the language before it writes any: `forma_guide` for the shape of a document,
`forma_blocks` for the attributes of the blocks it is about to use — here `cone`, `translate`
and `for` — and `forma_examples` for a document of a similar shape. Then it writes, and
`forma_write` builds what it wrote with the real kernel before anything reaches the disk.

Where the vocabulary runs out, the refusals carry it. A guess at a block that does not exist
comes back with every block that does, and a guess at an attribute with the ones that block
reads:

```
unknown block "frustum" — the blocks are "align", "for", "if", "part", "box", "circle",
  "cone", "cylinder", "difference", … "union"

cone: unknown attribute "bottom_radius" — cone reads "center", "height", "radius",
  "segments", "top_radius"
```

Then it lands, and the tool answers with the part rather than with a claim about it:

```
Wrote `tree.forma` under `/home/you/models` — 537 bytes.

| Part     | Colour  | Opacity | Size (X × Y × Z) | Volume    | Triangles | Genus |
| `trunk`  | #6b4423 |       1 | 8 × 8 × 30       | 1004.682  |       108 |     0 |
| `canopy` | #2f7d32 |       1 | 28 × 28 × 30     | 5193.4555 |       358 |     0 |

Overall bounding box: 28 × 28 × 51 (min -14, -14, 0, max 14, 14, 51)
Triangles: 466
```

`tree.forma`:

```hcl
param trunk_height { type = number  default = 30  min = 10  max = 60 }
param canopy_layers { type = number  default = 3  min = 1  max = 6 }

local canopy_base = trunk_height * 0.7

model "tree" {
  part "trunk" {
    color = "#6b4423"
    cone { radius = 4  top_radius = 2.5  height = var.trunk_height }
  }

  part "canopy" {
    color = "#2f7d32"
    for i in range(var.canopy_layers) {
      translate {
        offset = [0, 0, canopy_base + i * 8]
        cone { radius = 14 - i * 3  top_radius = 0  height = 14 }
      }
    }
  }
}
```

The document above is a test in this repo rather than an illustration: `test/server.test.js`
builds it, checks both parts came out solid, drives `trunk_height` to the top of its declared
range, and exports it. The wrong guesses are asserted to name their own corrections.

## More to ask for

> Model a wall bracket that carries a 35 mm pipe 60 mm off the wall. Two M5 screw holes in
> the backplate, 50 mm apart. Make the pipe diameter and the standoff params, and write it
> to `bracket.forma`.

> Write `enclosure.forma`: a 90 × 60 × 25 mm box with 2 mm walls, open at the top, with a lid
> that drops in on a 0.3 mm clearance lip. Wall thickness and clearance are params. Give the
> body and the lid separate parts so I can see them apart.

> Read `bracket.forma` and re-check it at both ends of every param's declared range. Anything
> that solves to nothing or changes the bounding box in a way the document did not intend,
> tell me about before you change it.

> Take `enclosure.forma`, set the wall thickness to 3 mm, and export just the lid to
> `lid.stl`.

Two things are worth asking for by name, because they are what the kernel is there to answer:
the **bounding box**, to confirm the part is the size you meant, and the **genus**, to confirm
a part that should be a plain solid has not ended up with a hole through it.

## The bundled manual

`src/reference/` is a copy of [`apps/docs/content`](../../apps/docs/content/README.md), which
is a private workspace and cannot be depended on from something that ships to npm. The copy is
what lets the server answer offline. It is made by `npm run sync:reference -w forma-dsl-mcp`
and compared byte for byte against the original by the tests, so it cannot drift: edit the
manual, re-run the sync, and the test passes again.

## Running it from source

```bash
npm install
npm test -w forma-dsl-mcp                  # including the protocol end to end
node packages/forma-dsl-mcp/src/bin.js     # the server, on stdio
```

Point a client at `node /absolute/path/to/packages/forma-dsl-mcp/src/bin.js` to use the
working tree rather than the published package.

## License

MIT — see [LICENSE](LICENSE).

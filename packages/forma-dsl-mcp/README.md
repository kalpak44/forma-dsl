# forma-dsl-mcp

[![Release](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml/badge.svg)](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/forma-dsl-mcp.svg)](https://www.npmjs.com/package/forma-dsl-mcp)

A [Model Context Protocol](https://modelcontextprotocol.io) server that knows
[forma](https://www.npmjs.com/package/forma-dsl) — the declarative DSL for 3D solids — and
writes `.forma` documents that render.

It speaks over stdio, so any MCP client can launch it:

```json
{
  "mcpServers": {
    "forma": {
      "command": "npx",
      "args": ["-y", "forma-dsl-mcp"],
      "env": { "FORMA_MCP_ROOT": "/absolute/path/to/your/models" }
    }
  }
}
```

`FORMA_MCP_ROOT` is the only configuration. It defaults to the working directory the client
launches the server in, and **every path the file tools accept is confined to it** — an
absolute path, a `..` that climbs out, or a symlink pointing out of the tree is refused
rather than followed.

## Why it is not just a prompt

A model that has read the language's documentation still writes forma that does not build.
The difference this server makes is that it **runs the geometry kernel**. `forma_check`
compiles the document, solves it with [Manifold](https://github.com/elalish/manifold) and
reports back the bounding box, the volume, the triangle count and the genus of every part —
so the question "is this the size that was asked for, and is it actually a solid?" is
answered before anyone is told the work is done. A part that silently solved to nothing is
called out by name.

`forma_write` runs that same check and **refuses to write a document that does not render**.

Everything the server says about the language is answerable to the language. The block and
function catalogue is merged with the library's own registries at load time, and the tests
assert that the two agree: a block added, renamed or given a new dimensionality in
`forma-dsl` fails this package's build rather than becoming a confident wrong answer. Every
worked example is rendered by the test suite, at both ends of every parameter's declared
range.

## Tools

| Tool | What it does |
| --- | --- |
| `forma_guide` | The language in one page: structure, nesting, dimensionality, units, syntax, the mistakes that cost the most time |
| `forma_blocks` | Every block with its attributes, defaults, dimensionality and caveats |
| `forma_functions` | Every builtin function and constant, with arity |
| `forma_reference` | The full reference manual, searchable and readable page by page |
| `forma_examples` | Complete documents that render, each showing one way of building a real part |
| `forma_check` | Parse, build and **measure** — errors with a line, a column and an excerpt with a caret; parts with their boxes, volumes and triangle counts |
| `forma_write` | Check, then write a `.forma` file into the workspace |
| `forma_read` | Read a document back, checked |
| `forma_list` | Every `.forma` file under the root |
| `forma_export_stl` | Render and write a binary STL |

## Resources and prompts

Resources carry the same knowledge in a form a person can attach by hand:

- `forma://guide` — the language in brief
- `forma://catalogue` — every block and function, as JSON
- `forma://reference/{path}` — one page of the manual
- `forma://example/{name}` — one worked document

Two prompts name the workflows worth having a name for: `model_a_part`, which walks from a
description of a physical object to a checked document, and `review_a_document`, which reads
an existing one and looks for the failures that are silent.

## Running it from source

```bash
npm install
npm test -w forma-dsl-mcp                  # 140+ tests, including the protocol end to end
node packages/forma-dsl-mcp/src/bin.js     # the server, on stdio
```

Point a client at `node /absolute/path/to/packages/forma-dsl-mcp/src/bin.js` to use the
working tree rather than the published package.

## The bundled manual

`src/reference/` is a copy of [`apps/docs/content`](../../apps/docs/content/README.md), which
is a private workspace and cannot be depended on from something that ships to npm. The copy
is what lets the server answer offline. It is made by `npm run sync:reference -w
forma-dsl-mcp` and compared byte for byte against the original by the tests, so it cannot
drift: edit the manual, re-run the sync, and the test passes again.

## License

MIT — see [LICENSE](LICENSE).

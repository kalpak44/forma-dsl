# Privacy

This covers the two published packages, [`forma-dsl`](packages/forma-dsl) and
[`forma-dsl-mcp`](packages/forma-dsl-mcp). The website — the landing page, the reference
manual and the browser editor — has its own policy at
[kalpak44.github.io/forma-dsl/privacy.html](https://kalpak44.github.io/forma-dsl/privacy.html).

**The short version: neither package makes a network request, collects anything, or reports
anything to anyone. Both run entirely on your own machine.**

## What is collected

Nothing. There is no telemetry, no analytics, no crash or error reporting, no update check, no
licence check and no account. Neither package has a server to talk to, because none exists.

This is a property of the code rather than a promise about it. Neither package imports `http`,
`https`, `net`, `dns` or `tls`, and neither calls `fetch`, `XMLHttpRequest` or `WebSocket` —
there is no code path by which anything could leave your machine. The geometry kernel is a
WebAssembly module loaded from the installed `manifold-3d` package on disk, and the reference
manual the MCP server serves is bundled in its own tarball, so both work with no network at
all.

Runtime dependencies are deliberately few, and are listed in each package's manifest:
`forma-dsl` has one (`manifold-3d`); `forma-dsl-mcp` has three
(`@modelcontextprotocol/sdk`, `forma-dsl`, `zod`).

## What the MCP server touches on disk

`forma-dsl-mcp` reads and writes `.forma` and `.stl` files. Where it may do so is **not its
decision**: the directories come from the MCP client as
[roots](https://modelcontextprotocol.io/docs/concepts/roots), and every path is checked against
them twice — once lexically, to refuse `..` and absolute paths, and again against the nearest
existing ancestor with symlinks resolved, to refuse a directory inside a root that links out of
it. The path that reaches the filesystem is rebuilt from the root out of segments that passed
an allowlist, rather than being the string the caller supplied.

It will not replace an existing file unless explicitly told to, and it writes nowhere else — no
cache directory, no config file, no log file, no temporary files outside the roots you granted.

If your client declares no roots, the server falls back to the directory it was launched in,
which is the one location that client did choose.

## What your MCP client does is not covered here

This matters more than anything above. `forma-dsl-mcp` speaks over stdio to a client you chose
— Claude Desktop, Claude Code, Codex or another — and **that client is a separate program with
its own privacy policy.**

When you ask a model to write a `.forma` document, the conversation and the documents in it go
wherever your client sends them, which is normally a model provider's API. This server neither
controls nor sees that. Read your client's policy for what happens to that data; what is
written here applies only to the packages in this repository.

## Children

Neither package is directed at children and neither collects personal information from anyone,
of any age.

## Changes

Material changes will be recorded in [CHANGELOG.md](CHANGELOG.md). This file is versioned with
the code, so the policy that applied to any release is the one in that release's tag.

## Contact

Questions: [open an issue](https://github.com/kalpak44/forma-dsl/issues). For anything
security-sensitive, see [SECURITY.md](SECURITY.md) instead — please not a public issue.

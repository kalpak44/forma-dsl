# Changelog

Both published packages — [`forma-dsl`](packages/forma-dsl) and
[`forma-dsl-mcp`](packages/forma-dsl-mcp) — are versioned together and released from this
one file. The apps in `apps/` are not published and are not tracked here.

This project follows [semantic versioning](https://semver.org). While the version is below
1.0.0 a minor bump may break a published API; those are marked **Breaking** below, and the
[stability policy](CONTRIBUTING.md#stability) says what to expect.

Dates are the day the tag was cut.

## Unreleased

Nothing yet.

## forma-dsl 0.3.0 · forma-dsl-mcp 0.3.0 — 2026-09-30

### Added

- `render` takes a `maxNodes` budget and an `AbortSignal`. Nesting limits and `range` each
  bound a single loop; only the budget bounds two of them nested, which is the shape that asks
  for more geometry than a process can build. Both are opt-in and default to off, so nothing
  that rendered before renders differently.
- The MCP server applies a node budget to every document it builds. It exists to build text a
  model wrote, and had no way to refuse one that would not finish — on a pipe, with no request
  timeout of its own, that was a server that never answered again.

### Fixed

- **The editor showed stale errors against edited text.** A diagnostic is a pair of absolute
  offsets into the document it was computed against, and the linter kept re-serving the last
  render's diagnostics on every keystroke — so after an edit the marker was drawn wherever
  those offsets now landed, underlining a line that was never the problem, and staying there
  until the next render finished. Diagnostics are now dropped the moment the document changes,
  so the editor shows nothing rather than something wrong.
- The editor aborts a render a later keystroke has superseded, instead of letting it run to
  completion with the newer render queued behind its kernel calls.
- The editor refuses a document that would build more geometry than a tab can hold, rather
  than freezing on it.

### Changed

- Every source file opens with a comment saying what the file is for, and `max-len` is
  enforced, so a line that runs long fails the lint rather than being left to the next reader.
- `registerTools` is one function per tool rather than one function of 265 lines.
- The editor's diagnostics moved to `diagnostics.js` as a DOM-free module, which is what let
  the staleness rule above be stated and tested rather than left implicit in an event handler.
- The AST is declared in `src/lang/ast.d.ts` rather than as JSDoc typedefs in a `.js` file
  with one line of runtime code in it. Same types, stated as types: a discriminant is now
  `kind: 'unary'` instead of a `@property` whose description the lint obliged someone to
  invent, which it did seventeen times.

## forma-dsl 0.2.2 · forma-dsl-mcp 0.2.2 — 2026-09-30

### Changed

- The README leads with the rendered demo, and npm points at the MCP server. Documentation
  only; no code changed.

## forma-dsl 0.2.1 — 2026-09-30

### Changed

- The manual's subdirectories are walked concurrently.

## forma-dsl 0.2.0 — 2026-09-30

### Breaking

- The MCP server takes the directories it may read and write from the client's MCP roots,
  rather than from its own configuration. A client that declares no roots gets the directory
  the server was launched in.

### Changed

- A refusal names the alternatives it knows about, so a misspelled block can be corrected
  from the error alone.

## forma-dsl 0.1.6 — 2026-09-30

### Changed

- The editor is served from `/editor/` rather than `/app/`.
- Independent manual pages are read concurrently.

## forma-dsl 0.1.5 — 2026-09-30

### Changed

- Each package releases on its own `<name>@<version>` tag and gets its own entry on the
  releases page.

## 0.1.4 — 2026-09-30

### Changed

- Maintainability findings cleared in the MCP server.

## 0.1.3 — 2026-09-30

### Added

- `forma-dsl-mcp`: a stdio MCP server that knows the language, solves what it writes and
  produces `.forma` files.
- The landing page, with a live WebGL hero and a demo that types the language and solves it.

### Fixed

- A block's attributes are looked up by the construct itself rather than by a map index.

### Changed

- Node 20 is past end of life and is no longer in the published `engines` floor. The floor is
  Node 22.13.

## 0.1.2 — 2026-09-29

### Changed

- Only the published package carries a version; the workspace root does not.

## 0.1.1 — 2026-09-29

### Added

- The reference manual, published alongside the editor.
- The workspace split: library, editor, docs.

## 0.1.0 — 2026-09-28

### Added

- The forma language, its evaluator, the Manifold geometry kernel binding and the browser
  editor.

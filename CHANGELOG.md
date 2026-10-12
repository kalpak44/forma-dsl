# Changelog

All three published packages - [`forma-dsl`](packages/forma-dsl),
[`forma-dsl-cli`](packages/forma-dsl-cli) and [`forma-dsl-mcp`](packages/forma-dsl-mcp) - are
versioned together and released from this one file. The apps in `apps/` are not published and
are not tracked here.

This project follows [semantic versioning](https://semver.org). While the version is below
1.0.0 a minor bump may break a published API; those are marked **Breaking** below, and the
[stability policy](CONTRIBUTING.md#stability) says what to expect.

Dates are the day the tag was cut.

## Unreleased

### Added

- **`forma render --params <file>`** takes a JSON object of parameter values by name. A build
  matrix wants the values a variant needs to be a thing it can generate, commit and diff, and
  a shell loop assembling forty `-p` flags is a worse version of that file. `-p` still wins
  where both name the same param, so the values every variant shares live in the file and the
  one that varies goes on the line. The file must be a JSON object: an array or a bare number
  parses but names nothing, and is refused rather than contributing silently. It is held to
  the same working-directory confinement as the document and the output.

### Fixed

- The CLI's documented error example was one the language does not raise. A negative `rect`
  size renders an empty solid rather than failing, so `size must be positive` was a message
  invented to illustrate the format. Replaced with a real one, which is a better example
  anyway: an unknown attribute, answered with every attribute that block does read.

### Breaking

- **The `forma` command only reads a document, and writes its STL, inside the directory it is
  run in.** A `<file>` or `--out` that resolves outside that directory - by `..`, an absolute
  path, or a symlink pointing out of the tree - is refused with exit code 2. The command takes
  its arguments from whatever invoked it, which in an agentic workflow may be a model rather
  than a person, so the working directory is treated as the boundary it may not leave.

### Added

- **`forma-dsl-cli`, a new package: the `forma` command.** `forma render part.forma -o
  part.stl` solves a document and writes a binary STL with no browser and no build step,
  which is what was missing to put a `.forma` file in a Makefile or a CI job. Also
  `forma params` and `forma models`, both with `--json`, so a script can build every variant
  a document declares without being told what they are. Only what was asked for goes to
  stdout - the STL under `-o -`, and the listings - so a pipe stays clean, and the three exit
  codes separate "it worked" from "the document is broken" from "you called it wrong". A
  failure prints as `file:line:column:` with the source and a caret under the column, which
  an editor and a CI annotation can both find.

  It is its own package rather than a `bin` on the library because everything under the
  library's `src/` has to run unchanged in a browser, and the lint enforces that by giving it
  neither Node's globals nor a console. Like the MCP server, it depends on the published
  entry point and knows nothing about the language itself.

- **Completion in the editor.** Blocks, functions, constants, param types and keywords, each
  with what it takes and produces (`extrude` says `2D to 3D`; `pow` says `2 arguments`), plus
  the components, params and locals the open document declares - and `var.` offers the params
  and nothing else, because that is all `var` holds. Built from the library's registries, so a
  block added to the language is offered without anyone updating a list, and a test asserts
  that nothing in a registry is missing from it. At the top of a document only the four
  top-level blocks are offered.

- `excerpt` is exported from `forma-dsl`. It renders the lines around a position with a caret
  under its column, which is what the CLI prints beside a failure. The MCP server had its own
  copy and now reads this one; two of them would have been two things to keep agreeing about
  what a column means.

- `TYPE_NAMES` is exported from `forma-dsl`, so the editor's highlighting and its completion
  read the param types from the language rather than from a list transcribed into each.

- `PRIVACY.md`, covering the two published packages. Neither makes a network request - no
  HTTP, socket or DNS module is imported and `fetch` is never called, so there is no code path
  by which anything could leave your machine - and the MCP server writes only inside the
  directories your client declares. The website's existing policy explicitly did not cover the
  packages, and Claude's and OpenAI's directories require one.

### Fixed

- **Six of the eight MCP tools understated what they do.** The behaviour hints are not as
  optional as their schema suggests: `destructiveHint` defaults to **true** and
  `idempotentHint` to **false**, so a tool declaring only `readOnlyHint` advertises itself as
  destructive and unrepeatable. `forma_guide`, which hands back a page of bundled text, was
  one of them. All eight now state all four, and two tests hold them to it.

## forma-dsl 0.3.1 · forma-dsl-mcp 0.3.1 - 2026-10-02

There is no 0.3.0 on the registry. The manifests carried that number briefly, but the release
that went out bumped to 0.3.1 to take a dev-dependency update in the same cut, so 0.3.1 is the
first version containing everything below.

### Added

- `render` takes a `maxNodes` budget and an `AbortSignal`. Nesting limits and `range` each
  bound a single loop; only the budget bounds two of them nested, which is the shape that asks
  for more geometry than a process can build. Both are opt-in and default to off, so nothing
  that rendered before renders differently.
- The MCP server applies a node budget to every document it builds. It exists to build text a
  model wrote, and had no way to refuse one that would not finish - on a pipe, with no request
  timeout of its own, that was a server that never answered again.

### Fixed

- **The editor showed stale errors against edited text.** A diagnostic is a pair of absolute
  offsets into the document it was computed against, and the linter kept re-serving the last
  render's diagnostics on every keystroke - so after an edit the marker was drawn wherever
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

## forma-dsl 0.2.2 · forma-dsl-mcp 0.2.2 - 2026-09-30

### Changed

- The README leads with the rendered demo, and npm points at the MCP server. Documentation
  only; no code changed.

## forma-dsl 0.2.1 - 2026-09-30

### Changed

- The manual's subdirectories are walked concurrently.

## forma-dsl 0.2.0 - 2026-09-30

### Breaking

- The MCP server takes the directories it may read and write from the client's MCP roots,
  rather than from its own configuration. A client that declares no roots gets the directory
  the server was launched in.

### Changed

- A refusal names the alternatives it knows about, so a misspelled block can be corrected
  from the error alone.

## forma-dsl 0.1.6 - 2026-09-30

### Changed

- The editor is served from `/editor/` rather than `/app/`.
- Independent manual pages are read concurrently.

## forma-dsl 0.1.5 - 2026-09-30

### Changed

- Each package releases on its own `<name>@<version>` tag and gets its own entry on the
  releases page.

## 0.1.4 - 2026-09-30

### Changed

- Maintainability findings cleared in the MCP server.

## 0.1.3 - 2026-09-30

### Added

- `forma-dsl-mcp`: a stdio MCP server that knows the language, solves what it writes and
  produces `.forma` files.
- The landing page, with a live WebGL hero and a demo that types the language and solves it.

### Fixed

- A block's attributes are looked up by the construct itself rather than by a map index.

### Changed

- Node 20 is past end of life and is no longer in the published `engines` floor. The floor is
  Node 22.13.

## 0.1.2 - 2026-09-29

### Changed

- Only the published package carries a version; the workspace root does not.

## 0.1.1 - 2026-09-29

### Added

- The reference manual, published alongside the editor.
- The workspace split: library, editor, docs.

## 0.1.0 - 2026-09-28

### Added

- The forma language, its evaluator, the Manifold geometry kernel binding and the browser
  editor.

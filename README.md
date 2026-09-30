# forma-dsl

[![Release](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml/badge.svg)](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml)
[![forma-dsl on npm](https://img.shields.io/npm/v/forma-dsl.svg?label=forma-dsl)](https://www.npmjs.com/package/forma-dsl)
[![forma-dsl-mcp on npm](https://img.shields.io/npm/v/forma-dsl-mcp.svg?label=forma-dsl-mcp)](https://www.npmjs.com/package/forma-dsl-mcp)

A declarative DSL for 3D modeling and scene composition, reusable components, and live
previews. This is the monorepo: the library, the editor that consumes it, and the reference
manual.

**[Try the editor](https://kalpak44.github.io/forma-dsl/editor/)** ·
**[Read the reference](https://kalpak44.github.io/forma-dsl/docs/)**

```hcl
param height { type = number  default = 20  min = 8  max = 40 }

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
```

## Workspaces

| Package | Published | What it is |
| --- | --- | --- |
| [`packages/forma-dsl`](packages/forma-dsl) | [`forma-dsl`](https://www.npmjs.com/package/forma-dsl) | The language, its evaluator and the geometry kernel binding. One runtime dependency |
| [`packages/forma-dsl-mcp`](packages/forma-dsl-mcp) | [`forma-dsl-mcp`](https://www.npmjs.com/package/forma-dsl-mcp) | An MCP server over stdio: it knows the language, solves what it writes, and produces `.forma` files |
| [`apps/landing`](apps/landing) | no | The landing page: a live WebGL hero, a demo that types the language and solves it, and the privacy and terms sheets |
| [`apps/editor`](apps/editor) | no | The browser editor: CodeMirror, three.js, Vite |
| [`apps/docs`](apps/docs) | no | The reference manual, and the builder that renders it |

Every workspace here **depends on the published entry point**, not on the library's sources.
An export the editor needs and does not have is a failure here rather than a user's problem,
and both the docs' syntax highlighting and the landing page's read the real block and
function registries — so a new block cannot be added without the code samples learning about
it. The landing page's demo goes one further and renders its examples in the browser, so a
document it shows being typed is one the library can still solve. The MCP server holds the
same line twice over: its block catalogue is reconciled with the registries at load time and
the reconciliation is asserted to be empty, and every worked document it hands a model is
rendered by its tests at both ends of every parameter's range.

## Running it

```bash
npm install
npm run dev        # landing page at http://localhost:5174
npm run dev:editor # editor at http://localhost:5173
npm run build      # the whole site in dist/ — landing at the root, editor under /editor/, docs under /docs/
npm run mcp        # the MCP server, on stdio
npm run check    # everything CI runs: lint, types, tests, build, package contents
```

Individually:

| Script | What it does |
| --- | --- |
| `npm test` | Every workspace's tests |
| `npm run test:coverage` | The same, with coverage floors and an lcov report for Sonar |
| `npm run lint` | ESLint over every workspace |
| `npm run typecheck` | Checks the published declarations against a usage file |
| `npm run build:docs` | Renders the manual into `dist/docs/`, checking every cross-reference |
| `npm run check:package` | Asserts each publishable tarball holds what it should and nothing else |
| `npm run sync:reference` | Re-copies the manual into the MCP server, which bundles it |

To work in one workspace, use npm's `-w`:

```bash
npm test -w forma-dsl
npm run build -w @forma-dsl/editor
```

## Releasing

The two packages are the only versioned things here. The editor, the landing page and the
docs carry no `version` at all: they are `private`, never published, and a number nothing
reads is a number that can only go stale.

**Each package is published from its own tag, `<name>@<version>`**, and each gets its own
entry on the [releases page](https://github.com/kalpak44/forma-dsl/releases).
[`release.yml`](.github/workflows/release.yml) resolves the package from the tag, checks it
against that package's manifest, runs the full check, and publishes through
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers) — npm recognises this
repository and this workflow by name, so no token is involved, and the tarball gets a
[provenance](https://docs.npmjs.com/generating-provenance-statements) attestation from the
same identity.

```bash
git tag -a forma-dsl@0.2.0     -m forma-dsl@0.2.0
git tag -a forma-dsl-mcp@0.2.0 -m forma-dsl-mcp@0.2.0
git push --follow-tags
```

The two versions are kept aligned even when only one of them changed, because
`forma-dsl-mcp` depends on `forma-dsl`: a release writes the number into both manifests and
re-points that dependency, so the published server never resolves an older copy of its own
repository. They can still go out at different versions — a tag publishes one package and
nothing else, and a version already on the registry is not republished.

npm attaches a trusted publisher only to a package that already exists, so the first version
of each one is published by hand and everything after it goes through the workflow. A tag
naming a package npm has never seen fails before anything is built.

Nothing publishes on a push to `main`; only a package tag does.

The [maintenance agent](.github/workflows/ai-maintenance-agent.yml) cuts those tags itself at
the end of a dependency sweep, so a batch of merges produces one release per package rather
than one per merge. `.github/` is generated — every workflow here, and `dependabot.yml`, are
written from outside this repository and an edit made to them here is overwritten.

## The site

The build is static — no server, no backend. Everything, including the geometry kernel, runs
in the browser. Set `VITE_BASE` when it will be served from a subdirectory:
`VITE_BASE=/forma-dsl/ npm run build`. The [Pages workflow](.github/workflows/pages.yml) does
this on every push to `main`.

A fork has to turn Pages on once, under **Settings → Pages → Source: GitHub Actions**. The
workflow cannot do it: creating a Pages site needs `administration: write`, which a workflow
token cannot be granted. Until then the build fails at `configure-pages` with
`Get Pages site failed`.

## Documentation

[`apps/docs/content`](apps/docs/content/README.md) is the reference manual — every
declaration, block, function and error, with usage and troubleshooting for each. It reads as
Markdown here and is published at [/docs/](https://kalpak44.github.io/forma-dsl/docs/).

For the language itself, start with
[Document structure](apps/docs/content/language/overview.md).

## License

MIT — see [LICENSE](LICENSE).

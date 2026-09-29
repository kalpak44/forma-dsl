# forma-dsl

[![Release](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml/badge.svg)](https://github.com/kalpak44/forma-dsl/actions/workflows/release.yml)
[![npm](https://img.shields.io/npm/v/forma-dsl.svg)](https://www.npmjs.com/package/forma-dsl)

A declarative DSL for 3D modeling and scene composition, reusable components, and live
previews. This is the monorepo: the library, the editor that consumes it, and the reference
manual.

**[Try the editor](https://kalpak44.github.io/forma-dsl/)** ·
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
| [`apps/editor`](apps/editor) | no | The browser editor: CodeMirror, three.js, Vite |
| [`apps/docs`](apps/docs) | no | The reference manual, and the builder that renders it |

The editor and the docs **depend on the published entry point**, not on the library's
sources. An export the editor needs and does not have is a failure here rather than a user's
problem, and the docs' syntax highlighting reads the real block and function registries — so
a new block cannot be added without the code samples learning about it.

## Running it

```bash
npm install
npm run dev      # editor at http://localhost:5173
npm run build    # the whole site in dist/ — editor at the root, docs under /docs/
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
| `npm run check:package` | Asserts the npm tarball holds the library and nothing else |

To work in one workspace, use npm's `-w`:

```bash
npm test -w forma-dsl
npm run build -w @forma-dsl/editor
```

## Releasing

The library is published from a tag. [`release.yml`](.github/workflows/release.yml) verifies
that the tag matches `packages/forma-dsl/package.json`, runs the full check, and publishes
with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) so the tarball
is attested to this repository and this workflow run.

```bash
npm version minor -w forma-dsl     # bump, and commit the bump
git push && git push --tags
```

Nothing publishes on a push to `main`; only a `v*` tag does.

The maintenance agent cuts a tag itself at the end of a dependency sweep, so a batch of
merges produces one release rather than one per merge. `.github/` is generated — every
workflow here, and `dependabot.yml`, are written from outside this repository and an edit
made to them here is overwritten.

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

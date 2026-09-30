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

![The riser above, solved and rendered: a rounded 40 x 20 block with a 10 mm bore through the top](apps/docs/assets/example.png)

## Workspaces

| Package | Published | What it is |
| --- | --- | --- |
| [`packages/forma-dsl`](packages/forma-dsl) | [`forma-dsl`](https://www.npmjs.com/package/forma-dsl) | The language, its evaluator and the geometry kernel binding. One runtime dependency |
| [`packages/forma-dsl-mcp`](packages/forma-dsl-mcp) | [`forma-dsl-mcp`](https://www.npmjs.com/package/forma-dsl-mcp) | An MCP server over stdio: it knows the language, solves what it writes, and produces `.forma` files |
| [`apps/landing`](apps/landing) | no | The landing page: a live WebGL hero, a demo that types the language and solves it, and the privacy and terms sheets |
| [`apps/editor`](apps/editor) | no | The browser editor: CodeMirror, three.js, Vite |
| [`apps/docs`](apps/docs) | no | The reference manual, and the builder that renders it |

Every workspace here **depends on the published entry point**, not on the library's sources.
An export the editor needs and does not have therefore fails in this repository rather than
in someone's install.

The same rule governs what each one is allowed to claim about the language:

- The docs' syntax highlighting and the landing page's both read the real block and function
  registries, so a new block cannot be added without the code samples learning about it.
- The landing page renders its own examples in the browser, so a document it shows being
  typed is one the library can still solve.
- The MCP server reconciles its block catalogue against those registries at load time and
  asserts the difference is empty, and its tests render every worked document it hands a
  model at both ends of every parameter's range.

## License

MIT — see [LICENSE](LICENSE).

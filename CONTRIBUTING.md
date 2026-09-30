# Contributing

## Before anything else

This repository is maintained largely by an automated agent: Dependabot proposes dependency
updates and the agent in `.github/workflows/ai-maintenance-agent.yml` reviews, repairs and
merges them without a human in the loop. That is why the checks below are blocking rather than
advisory — they are what stands in for review.

The workflows in `.github/workflows/` and `.github/dependabot.yml` are generated elsewhere and
are overwritten on the next sync. Their headers say so. Edit them in `homelab-infra`, not here.

## Getting set up

Node 22.13 or newer, which is what the published `engines` declare.

```bash
npm ci
npm run check
```

`npm run check` is the whole gate, and it is what CI runs:

| Step | What it holds |
| --- | --- |
| `npm run lint` | ESLint, SonarJS and the JSDoc rules — including `max-len` |
| `npm run typecheck` | the published `.d.ts` against the sources, both tsconfigs |
| `npm test` | every workspace's tests |
| `npm run build` | the site, including the docs link checker |
| `npm run check:package` | the publishable tarballs carry what they should and nothing else |

`npm run test:coverage` additionally enforces 90% lines, 80% branches and 75% functions. The
thresholds live in the script, so no CI step can quietly lower them.

Useful while working:

```bash
npm run dev          # the landing page
npm run dev:editor   # the editor
npm run mcp          # the MCP server, on stdio
```

## House style

The lint enforces the mechanical half. The rest is convention, and it is worth keeping because
it is most of why this code is readable.

**Comments say why, not what.** A comment restating the line above it is noise; a comment
explaining why the obvious approach was not taken is the reason the file is maintainable. If
you are documenting a workaround, name what it works around.

**Every file opens with prose about the file**, before the `@import` pragmas, saying what it is
for and what is non-obvious about it. Where a module has one export whose own doc already
carries that, do not write the same thing twice.

**JSDoc is checked against the code.** `@param` names, types and `@throws` are all lint errors
when they drift. That is deliberate: documentation that is allowed to go stale is worse than
none, because it gets believed.

**Tests are named as sentences about behaviour** — `a box has the volume it claims`, not
`test volume`. A failing test should read as a statement of what broke.

**Everything depends on the published entry point.** The editor, the landing page and the MCP
server all import `forma-dsl`, never its sources. An export one of them needs and the package
does not have must fail here rather than in someone's install.

## Stability

Below 1.0.0, a minor bump may break a published API. Breaking changes are marked **Breaking**
in [CHANGELOG.md](CHANGELOG.md) and carry a `!` in the commit subject. Pin exactly if that
matters to you.

The public API is what [`packages/forma-dsl/src/index.js`](packages/forma-dsl/src/index.js)
exports and what [`index.d.ts`](packages/forma-dsl/src/index.d.ts) declares. Anything reached
by a deeper path is internal and may move in a patch.

For the MCP server, the tool names, their input schemas and the resource URIs are the surface.
The wording of a tool's description and of its Markdown results is not — those are tuned for
whichever model is reading them.

## Commits and releases

Commit subjects follow [conventional commits](https://www.conventionalcommits.org): `feat:`,
`fix:`, `docs:`, `chore:`, `refactor:`, `test:`, with an optional scope (`feat(mcp):`) and a
`!` for a breaking change.

Releases are cut by tagging `<package>@<version>`; the tag must match the version in that
package's manifest, and the release workflow refuses it if it does not. Publishing uses npm
trusted publishing over OIDC — there is no token to rotate, and renaming the release workflow
breaks it until the trusted publisher is recreated.

Add an entry to [CHANGELOG.md](CHANGELOG.md) under `## Unreleased` for anything a consumer
would notice.

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md). Please do not open a public issue for something exploitable.

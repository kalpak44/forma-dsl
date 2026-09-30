# Security

## Reporting a vulnerability

Report privately through GitHub's
[security advisories](https://github.com/kalpak44/forma-dsl/security/advisories/new) for this
repository. Please do not open a public issue for something exploitable.

Include what you need to reproduce it: the `.forma` document or the tool call, the package and
version, and the client if it involves the MCP server.

Expect an acknowledgement within a week. This is a small project maintained in the open, so
that is a realistic figure rather than a guaranteed one.

## What is in scope

Only the two published packages:

| Package | Supported |
| --- | --- |
| [`forma-dsl`](https://www.npmjs.com/package/forma-dsl) | the latest release |
| [`forma-dsl-mcp`](https://www.npmjs.com/package/forma-dsl-mcp) | the latest release |

While the version is below 1.0.0, fixes land on the next release rather than being backported.

The apps under `apps/` are a static site with no server and no accounts. A finding there is an
ordinary bug — please open an issue.

## What the threat model is

Both packages execute documents that someone else may have written, so that is the boundary
worth describing.

**The library runs untrusted documents by design.** A `.forma` document is data, not a script:
it cannot reach the filesystem, the network, or any host object, and the evaluator has no
escape into JavaScript. It is bounded against runaway evaluation — `range` produces at most
100,000 values, nesting stops at 64 blocks deep, and `render` takes an optional `maxNodes`
budget and an `AbortSignal`. Those bounds are the security-relevant part: without a budget, a
document nesting two large loops can ask for more geometry than the process can build, and
that is a denial of service against whatever embeds it. A host that renders documents it did
not write should pass a budget.

**The MCP server writes files, and that is the sharper edge.** It will only touch directories
the client declared as MCP roots. Every path is checked twice — once lexically, to refuse `..`
and absolute paths, and again against the nearest existing ancestor with symlinks resolved, to
refuse a directory inside a root that links out of it — and the path that reaches the
filesystem is rebuilt from the root out of segments that passed an allowlist, rather than
being the string the caller supplied. Writes must carry the expected extension and will not
replace an existing file unless told to. The server applies a node budget to every document it
builds, so a document that would not finish is refused rather than hanging the process.

If you find a way around any of that, it is a vulnerability and we would like to hear about it.

## What is not a vulnerability

- A document that renders slowly, or a large model that uses a lot of memory, within the
  budgets above.
- The library having no budget by default. That is the documented default for an embedder that
  controls its own input; pass `maxNodes` if you do not.
- A client granting the MCP server a root it should not have. Which directories the server may
  touch is the client's decision, and it is the client's to get right.

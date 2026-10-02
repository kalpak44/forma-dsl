/**
 * The server driven the way a client drives it.
 *
 * These go through a real MCP client over a linked in-memory transport rather than calling
 * the handlers directly, so the schemas, the result shapes and the roots handshake are
 * exercised as well as the logic behind them. A tool that registers but cannot be called is
 * exactly the failure a direct test would miss.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { Workspace } from '../src/workspace.js';
import { VERSION, createServer } from '../src/server.js';
import { disposeSharedContext } from '../src/document.js';

const MANIFEST = createRequire(import.meta.url)('../package.json');

test.after(() => disposeSharedContext());

/**
 * A client that declares throwaway directories as its roots, connected to a server that was
 * given no workspace of its own — so the directories come over the wire, as they do in life.
 *
 * @param {import('node:test').TestContext} t The test, used to register the cleanup.
 * @param {number} [count] How many roots the client declares.
 * @returns {Promise<{ client: Client, roots: string[], setRoots: (next: string[]) => Promise<void> }>}
 *   The client, the directories it declared, and a way to change them.
 */
async function connect(t, count = 1) {
  const roots = await Promise.all(Array.from(
    { length: count },
    () => mkdtemp(join(tmpdir(), 'forma-mcp-server-')),
  ));

  let declared = roots;
  const client = new Client(
    { name: 'test', version: '0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: declared.map((root) => ({ uri: pathToFileURL(root).href, name: root })),
  }));

  await link(t, client, createServer());
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

  /**
   * @param {string[]} next What the client should declare from now on.
   * @returns {Promise<void>} Once the server has been told.
   */
  const setRoots = async (next) => {
    declared = next;
    await client.sendRootsListChanged();
    await client.ping(); // Flushes the notification, which is one-way and otherwise unordered.
  };

  return { client, roots, setRoots };
}

/**
 * Joins a client to a server over a linked pair, and closes both when the test ends.
 *
 * @param {import('node:test').TestContext} t The test.
 * @param {Client} client The client.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server The server.
 * @returns {Promise<void>} Once both ends are connected.
 */
async function link(t, client, server) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  t.after(async () => {
    await client.close();
    await server.close();
  });
}

/**
 * The text of a tool result.
 *
 * @param {object} result What `callTool` returned.
 * @returns {string} Every text block, joined.
 */
const text = (result) => result.content.map((block) => block.text).join('\n');

const BRACKET = `param height { type = number  default = 20  min = 10  max = 40 }

model "bracket" {
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
`;

test('the handshake says to build before claiming, and whose decision the destination is', async (t) => {
  const { client } = await connect(t);

  assert.match(client.getInstructions(), /forma_guide/);
  assert.match(client.getInstructions(), /forma_write/);
  assert.match(client.getInstructions(), /MCP roots/);
  assert.equal(client.getServerVersion().name, 'forma-dsl');
  // The two were written out separately once and drifted five releases apart, so the
  // handshake is held to the manifest rather than to a number typed beside it.
  assert.equal(client.getServerVersion().version, MANIFEST.version);
  assert.equal(VERSION, MANIFEST.version);
});

test('every tool is listed with a description and a schema', async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'forma_blocks', 'forma_examples', 'forma_export_stl', 'forma_functions',
    'forma_guide', 'forma_read', 'forma_reference', 'forma_write',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description?.length > 40, `${tool.name} needs a description worth reading`);
    assert.equal(tool.inputSchema.type, 'object');
  }

  // Prompts went with forma_check, which the workflows they narrated were built around.
  await assert.rejects(() => client.listPrompts());
});

test('writing reports the measured size of what the document builds', async (t) => {
  const { client, roots } = await connect(t);

  const written = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'parts/bracket.forma', source: BRACKET },
  });

  assert.notEqual(written.isError, true);
  const report = text(written);
  assert.match(report, /Wrote `parts\/bracket\.forma` under/);
  assert.ok(report.includes(roots[0]), 'the destination is named, since the client chose it');
  assert.match(report, /# Document is valid/);
  assert.match(report, /\| `height` \| number \| 20 \| no \| 10 … 40 \|/);
  assert.match(report, /40 × 20 × 20/);
});

test('params are applied to the build, not just reported', async (t) => {
  const { client } = await connect(t);

  const taller = text(await client.callTool({
    name: 'forma_write',
    arguments: { path: 'tall.forma', source: BRACKET, params: { height: 40 } },
  }));

  assert.match(taller, /40 × 20 × 40/);
});

test('a broken document comes back with the line, the column and an excerpt, and is not written', async (t) => {
  const { client } = await connect(t);

  const refused = await client.callTool({
    name: 'forma_write',
    arguments: {
      path: 'bad.forma',
      source: 'model "m" { part "p" { box { size = [1, 1, 1]  colour = "red" } } }',
    },
  });

  assert.equal(refused.isError, true);
  assert.match(text(refused), /# Document has a problem/);
  assert.match(text(refused), /unknown attribute "colour"/);
  assert.match(text(refused), /\^/);
  assert.match(text(refused), /Nothing was written/);

  const missing = await client.callTool({ name: 'forma_read', arguments: { path: 'bad.forma' } });
  assert.equal(missing.isError, true);
});

test('a part that solved to nothing is called out rather than passed off', async (t) => {
  const { client } = await connect(t);

  const report = text(await client.callTool({
    name: 'forma_write',
    arguments: {
      path: 'empty.forma',
      source: 'model "m" { part "p" { extrude { height = 0  rect { size = [4, 4] } } } }',
    },
  }));

  assert.match(report, /solved to nothing/);
});

test('force writes a document that does not render', async (t) => {
  const { client } = await connect(t);
  const source = 'model "m" { part "p" { circle { radius = 2 } } }';

  const refused = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'flat.forma', source },
  });
  assert.equal(refused.isError, true);

  const forced = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'flat.forma', source, force: true },
  });
  assert.notEqual(forced.isError, true);
  assert.match(text(forced), /Wrote `flat\.forma`/);
});

test('a written document can be read back, checked, and refused a second write', async (t) => {
  const { client } = await connect(t);
  await client.callTool({ name: 'forma_write', arguments: { path: 'a.forma', source: BRACKET } });

  const read = text(await client.callTool({ name: 'forma_read', arguments: { path: 'a.forma' } }));
  assert.match(read, /param height/);
  assert.match(read, /# Document is valid/);

  const again = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'a.forma', source: BRACKET },
  });
  assert.equal(again.isError, true);
  assert.match(text(again), /already exists/);

  const forced = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'a.forma', source: BRACKET, overwrite: true },
  });
  assert.match(text(forced), /replacing what was there/);
});

test('reading a document that is not there is reported, not thrown', async (t) => {
  const { client } = await connect(t);

  const missing = await client.callTool({ name: 'forma_read', arguments: { path: 'gone.forma' } });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /no file at "gone\.forma"/);
});

test('a path outside the client\'s root is refused, not followed', async (t) => {
  const { client } = await connect(t);

  const escaped = await client.callTool({
    name: 'forma_write',
    arguments: { path: '../escaped.forma', source: BRACKET },
  });

  assert.equal(escaped.isError, true);
  assert.match(text(escaped), /outside the workspace root/);
});

test('a relative path lands in the first root, and a later one is reached by naming it', async (t) => {
  const { client, roots } = await connect(t, 2);

  const first = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'here.forma', source: BRACKET },
  });
  assert.ok(text(first).includes(roots[0]));

  const second = await client.callTool({
    name: 'forma_write',
    arguments: { path: join(roots[1], 'there.forma'), source: BRACKET },
  });
  assert.notEqual(second.isError, true);
  assert.ok(text(second).includes(roots[1]));

  const read = await client.callTool({
    name: 'forma_read',
    arguments: { path: join(roots[1], 'there.forma') },
  });
  assert.match(text(read), /param height/);
});

test('the roots are re-read when the client says they changed', async (t) => {
  const { client, roots, setRoots } = await connect(t, 2);

  const before = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'moved.forma', source: BRACKET },
  });
  assert.ok(text(before).includes(roots[0]));

  await setRoots([roots[1]]);

  const after = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'moved.forma', source: BRACKET },
  });
  assert.ok(text(after).includes(roots[1]), 'the second write follows the client to its new root');

  const gone = await client.callTool({
    name: 'forma_write',
    arguments: { path: join(roots[0], 'stale.forma'), source: BRACKET },
  });
  assert.equal(gone.isError, true);
  assert.match(text(gone), /outside the workspace root/);
});

test('a checked document exports as STL', async (t) => {
  const { client } = await connect(t);

  const exported = await client.callTool({
    name: 'forma_export_stl',
    arguments: { source: BRACKET, out: 'out/bracket.stl' },
  });

  assert.notEqual(exported.isError, true);
  assert.match(text(exported), /Wrote `out\/bracket\.stl`.*triangles/s);

  const wrongExtension = await client.callTool({
    name: 'forma_export_stl',
    arguments: { source: BRACKET, out: 'out/bracket.obj' },
  });
  assert.equal(wrongExtension.isError, true);
  assert.match(text(wrongExtension), /must end in \.stl/);
});

test('exporting reads the document back off disk when given a path', async (t) => {
  const { client } = await connect(t);
  await client.callTool({ name: 'forma_write', arguments: { path: 'b.forma', source: BRACKET } });

  const exported = await client.callTool({
    name: 'forma_export_stl',
    arguments: { path: 'b.forma', out: 'b.stl' },
  });

  assert.notEqual(exported.isError, true);
  assert.match(text(exported), /from model `bracket`, part `body`/);
});

test('exporting insists on exactly one of source and path', async (t) => {
  const { client } = await connect(t);

  const neither = await client.callTool({ name: 'forma_export_stl', arguments: { out: 'a.stl' } });
  assert.equal(neither.isError, true);
  assert.match(text(neither), /give either "source".*or "path"/s);

  const both = await client.callTool({
    name: 'forma_export_stl',
    arguments: { source: BRACKET, path: 'a.forma', out: 'a.stl' },
  });
  assert.equal(both.isError, true);
  assert.match(text(both), /not both/);
});

test('exporting a part that does not exist names the ones that do', async (t) => {
  const { client } = await connect(t);

  const wrong = await client.callTool({
    name: 'forma_export_stl',
    arguments: { source: BRACKET, out: 'a.stl', part: 'lid' },
  });

  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /no part named "lid".*"body"/s);
});

// The document a model converges on when asked for "a tree" with no documentation in front
// of it — three corrections, each one dictated by the error the previous attempt returned.
// Kept here so the walkthrough in the README stays true rather than aspirational.
const TREE = `param trunk_height { type = number  default = 30  min = 10  max = 60 }
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
}`;

test('the wrong guesses on the way to a tree each name their own correction', async (t) => {
  const { client } = await connect(t);

  /**
   * @param {string} source What to try.
   * @returns {Promise<string>} What came back.
   */
  const attempt = async (source) => text(await client.callTool({
    name: 'forma_write',
    arguments: { path: 'tree.forma', source, overwrite: true },
  }));

  // A block that does not exist comes back with every block that does.
  const guessedBlock = await attempt('model "t" { part "p" { frustum { radius = 4 } } }');
  assert.match(guessedBlock, /unknown block "frustum"/);
  assert.match(guessedBlock, /"cone"/);

  // An attribute that does not exist comes back with the ones the block reads.
  const guessedAttribute = await attempt(
    'model "t" { part "p" { cone { bottom_radius = 4  height = 9 } } }',
  );
  assert.match(guessedAttribute, /cone reads .*"top_radius"/);
});

test('the tree a model arrives at builds, measures and exports', async (t) => {
  const { client } = await connect(t);

  const written = text(await client.callTool({
    name: 'forma_write',
    arguments: { path: 'tree.forma', source: TREE },
  }));

  assert.match(written, /# Document is valid/);
  assert.match(written, /28 × 28 × 51/);
  // Both parts are plain solids: a canopy that came out with a hole through it is the
  // failure a picture would hide and the genus will not.
  assert.doesNotMatch(written, /solved to nothing/);
  assert.match(written, /\| `trunk` \| #6b4423 \|.*\| 0 \|/);
  assert.match(written, /\| `canopy` \| #2f7d32 \|.*\| 0 \|/);

  // A param drives the shape rather than decorating it.
  const taller = text(await client.callTool({
    name: 'forma_write',
    arguments: { path: 'tall.forma', source: TREE, params: { trunk_height: 60 } },
  }));
  assert.match(taller, /28 × 28 × 72/);

  const exported = text(await client.callTool({
    name: 'forma_export_stl',
    arguments: { path: 'tree.forma', out: 'tree.stl' },
  }));
  assert.match(exported, /Wrote `tree\.stl`.*triangles/s);
});

test('the guide comes back whole, or one section at a time', async (t) => {
  const { client } = await connect(t);

  const whole = text(await client.callTool({ name: 'forma_guide', arguments: {} }));
  assert.match(whole, /## The shape of a document/);
  assert.match(whole, /Hyphens are part of a name/);

  const one = text(await client.callTool({ name: 'forma_guide', arguments: { section: 'pitfalls' } }));
  assert.match(one, /## The mistakes that cost the most time/);
  assert.doesNotMatch(one, /## The shape of a document/);
});

test('blocks are listed, then described by name', async (t) => {
  const { client } = await connect(t);

  const listing = text(await client.callTool({ name: 'forma_blocks', arguments: {} }));
  assert.match(listing, /## 2D shapes/);
  assert.match(listing, /\| `extrude` \| 3D \| 2D \|/);

  const detail = text(await client.callTool({
    name: 'forma_blocks',
    arguments: { names: ['torus', 'revolve'] },
  }));
  assert.match(detail, /`tube_radius`/);
  assert.match(detail, /every point at X ≥ 0/);

  const wrong = await client.callTool({ name: 'forma_blocks', arguments: { names: ['cuboid'] } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /No such block: "cuboid"/);
});

test('the manual can be listed, searched and read', async (t) => {
  const { client } = await connect(t);

  const listing = text(await client.callTool({ name: 'forma_reference', arguments: {} }));
  assert.match(listing, /`reference\/conversions\.md`/);

  const found = text(await client.callTool({
    name: 'forma_reference',
    arguments: { query: 'revolve profile' },
  }));
  assert.match(found, /conversions\.md|shapes-2d\.md/);

  const page = text(await client.callTool({
    name: 'forma_reference',
    arguments: { page: 'reference/align.md' },
  }));
  assert.match(page, /# `align`/);

  const missing = await client.callTool({ name: 'forma_reference', arguments: { page: 'nope.md' } });
  assert.equal(missing.isError, true);
});

test('blocks can be asked for one group at a time', async (t) => {
  const { client } = await connect(t);

  const group = text(await client.callTool({
    name: 'forma_blocks',
    arguments: { group: 'Transforms' },
  }));
  assert.match(group, /## `translate`/);
  assert.match(group, /## `mirror`/);
  assert.doesNotMatch(group, /## `sphere`/);

  const wrong = await client.callTool({ name: 'forma_blocks', arguments: { group: 'Fillets' } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /The groups are/);
});

test('functions come back with the arity the library gives them', async (t) => {
  const { client } = await connect(t);

  const listing = text(await client.callTool({ name: 'forma_functions', arguments: {} }));
  assert.match(listing, /\| `range` \| variadic \|/);
  assert.match(listing, /\| `pow` \| 2 \|/);
  assert.match(listing, /\| `pi` \| 3\.14159/);
});

test('examples list, read and refuse a name that is not one', async (t) => {
  const { client } = await connect(t);

  const listing = text(await client.callTool({ name: 'forma_examples', arguments: {} }));
  assert.match(listing, /`revolved-profile`/);

  const one = text(await client.callTool({
    name: 'forma_examples',
    arguments: { name: 'components' },
  }));
  assert.match(one, /component "tray"/);

  const wrong = await client.callTool({ name: 'forma_examples', arguments: { name: 'nope' } });
  assert.equal(wrong.isError, true);
  assert.match(text(wrong), /No example "nope"/);
});

test('a search that matches nothing says so rather than returning an empty page', async (t) => {
  const { client } = await connect(t);

  const nothing = text(await client.callTool({
    name: 'forma_reference',
    arguments: { query: 'quaternion' },
  }));
  assert.match(nothing, /Nothing in the manual matches/);
});

test('resources list and read, including the templated ones', async (t) => {
  const { client } = await connect(t);

  const { resources } = await client.listResources();
  const uris = resources.map((resource) => resource.uri);
  assert.ok(uris.includes('forma://guide'));
  assert.ok(uris.includes('forma://reference/errors.md'));
  assert.ok(uris.includes('forma://example/parametric-plate'));

  const guide = await client.readResource({ uri: 'forma://guide' });
  assert.match(guide.contents[0].text, /Z is up/);

  const catalogue = await client.readResource({ uri: 'forma://catalogue' });
  const parsed = JSON.parse(catalogue.contents[0].text);
  assert.ok(parsed.blocks.some((block) => block.name === 'extrude'));
  assert.ok(parsed.functions.some((fn) => fn.name === 'range'));

  const page = await client.readResource({ uri: 'forma://reference/reference/param.md' });
  assert.match(page.contents[0].text, /# `param`/);
});

test('an example resource that does not exist fails rather than returning nothing', async (t) => {
  const { client } = await connect(t);

  const example = await client.readResource({ uri: 'forma://example/minimal' });
  assert.match(example.contents[0].text, /model "block"/);

  await assert.rejects(() => client.readResource({ uri: 'forma://example/nope' }));
});

test('the templated resources complete their arguments', async (t) => {
  const { client } = await connect(t);

  const page = await client.complete({
    ref: { type: 'ref/resource', uri: 'forma://reference/{+path}' },
    argument: { name: 'path', value: 'reference/' },
  });
  assert.ok(page.completion.values.includes('reference/param.md'));
  assert.ok(page.completion.values.every((value) => value.startsWith('reference/')));

  const example = await client.complete({
    ref: { type: 'ref/resource', uri: 'forma://example/{name}' },
    argument: { name: 'name', value: 'para' },
  });
  assert.deepEqual(example.completion.values, ['parametric-plate']);
});

test('a workspace can be supplied instead of asking the client for one', async (t) => {
  // The embedding path: something that already knows where the files live and has no client
  // to ask. It must not consult the roots at all.
  const directory = await mkdtemp(join(tmpdir(), 'forma-mcp-given-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const client = new Client({ name: 'test', version: '0' });
  await link(t, client, createServer(await Workspace.open(directory)));

  const written = text(await client.callTool({
    name: 'forma_write',
    arguments: { path: 'given.forma', source: BRACKET },
  }));
  assert.ok(written.includes(directory));
});

// The four hints are not optional in the way their schema suggests. `destructiveHint`
// defaults to true and `idempotentHint` to false, so a tool that states only `readOnlyHint`
// is advertising itself as destructive and unrepeatable. Six of these tools did exactly that
// until it was measured from outside, which is why the assertion is on every tool rather than
// on the ones that happened to be wrong.
test('every tool states all four behaviour hints rather than inheriting a default', async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  assert.equal(tools.length, 8, 'the server offers eight tools');

  for (const tool of tools) {
    const hints = tool.annotations ?? {};
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(
        typeof hints[hint],
        'boolean',
        `${tool.name} must state ${hint} rather than inherit its default`,
      );
    }
  }
});

test('nothing here reaches an open world, and only the two writers modify anything', async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  const writers = tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name);
  assert.deepEqual(writers.sort(), ['forma_export_stl', 'forma_write']);

  // Every answer is bundled with the package, so the domain is closed even offline.
  assert.ok(tools.every((tool) => tool.annotations.openWorldHint === false));

  // A read cannot destroy anything, and asking twice must be safe.
  for (const tool of tools.filter((each) => each.annotations.readOnlyHint)) {
    assert.equal(tool.annotations.destructiveHint, false, `${tool.name} destroys nothing`);
    assert.equal(tool.annotations.idempotentHint, true, `${tool.name} is safe to repeat`);
  }
});

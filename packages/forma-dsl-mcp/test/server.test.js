/**
 * The server driven the way a client drives it.
 *
 * These go through a real MCP client over a linked in-memory transport rather than calling
 * the handlers directly, so the schemas, the result shapes and the resource templates are
 * exercised as well as the logic behind them. A tool that registers but cannot be called is
 * exactly the failure a direct test would miss.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { Workspace } from '../src/workspace.js';
import { createServer } from '../src/server.js';
import { disposeSharedContext } from '../src/document.js';

test.after(() => disposeSharedContext());

/**
 * A client connected to a server rooted at a throwaway directory.
 *
 * @param {import('node:test').TestContext} t The test, used to register the cleanup.
 * @returns {Promise<{ client: Client, root: string }>} The pair.
 */
async function connect(t) {
  const root = await mkdtemp(join(tmpdir(), 'forma-mcp-server-'));
  const workspace = await Workspace.open(root);
  const server = createServer(workspace);
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  t.after(async () => {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  return { client, root };
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

test('the handshake carries instructions that say to check before claiming', async (t) => {
  const { client } = await connect(t);

  assert.match(client.getInstructions(), /forma_check/);
  assert.equal(client.getServerVersion().name, 'forma-dsl');
});

test('every tool is listed with a description and a schema', async (t) => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();

  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'forma_blocks', 'forma_check', 'forma_examples', 'forma_export_stl',
    'forma_functions', 'forma_guide', 'forma_list', 'forma_read',
    'forma_reference', 'forma_write',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description?.length > 40, `${tool.name} needs a description worth reading`);
    assert.equal(tool.inputSchema.type, 'object');
  }
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

test('checking reports the measured size of what a document builds', async (t) => {
  const { client } = await connect(t);

  const report = text(await client.callTool({
    name: 'forma_check',
    arguments: { source: BRACKET },
  }));

  assert.match(report, /# Document is valid/);
  assert.match(report, /\| `height` \| number \| 20 \| no \| 10 … 40 \|/);
  assert.match(report, /40 × 20 × 20/);

  const taller = text(await client.callTool({
    name: 'forma_check',
    arguments: { source: BRACKET, params: { height: 40 } },
  }));
  assert.match(taller, /40 × 20 × 40/);
});

test('a broken document comes back with the line, the column and an excerpt', async (t) => {
  const { client } = await connect(t);

  const report = text(await client.callTool({
    name: 'forma_check',
    arguments: { source: 'model "m" { part "p" { box { size = [1, 1, 1]  colour = "red" } } }' },
  }));

  assert.match(report, /# Document has a problem/);
  assert.match(report, /unknown attribute "colour"/);
  assert.match(report, /\^/);
});

test('a part that solved to nothing is called out rather than passed off', async (t) => {
  const { client } = await connect(t);

  const report = text(await client.callTool({
    name: 'forma_check',
    arguments: { source: 'model "m" { part "p" { extrude { height = 0  rect { size = [4, 4] } } } }' },
  }));

  assert.match(report, /solved to nothing/);
});

test('writing checks first, and refuses a document that does not render', async (t) => {
  const { client } = await connect(t);

  const refused = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'bad.forma', source: 'model "m" { part "p" { circle { radius = 2 } } }' },
  });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /Nothing was written/);

  const empty = await client.callTool({ name: 'forma_list', arguments: {} });
  assert.match(text(empty), /No \.forma files/);

  const written = await client.callTool({
    name: 'forma_write',
    arguments: { path: 'parts/bracket.forma', source: BRACKET },
  });
  assert.notEqual(written.isError, true);
  assert.match(text(written), /Wrote `parts\/bracket\.forma`/);

  const listed = text(await client.callTool({ name: 'forma_list', arguments: {} }));
  assert.match(listed, /parts\/bracket\.forma/);
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

test('a path outside the root is refused, not followed', async (t) => {
  const { client } = await connect(t);

  const escaped = await client.callTool({
    name: 'forma_write',
    arguments: { path: '../escaped.forma', source: BRACKET },
  });

  assert.equal(escaped.isError, true);
  assert.match(text(escaped), /outside the workspace root/);
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

test('a tool that takes a document insists on exactly one of source and path', async (t) => {
  const { client } = await connect(t);

  const neither = await client.callTool({ name: 'forma_check', arguments: {} });
  assert.equal(neither.isError, true);
  assert.match(text(neither), /give either "source".*or "path"/s);

  const both = await client.callTool({
    name: 'forma_check',
    arguments: { source: BRACKET, path: 'a.forma' },
  });
  assert.equal(both.isError, true);
  assert.match(text(both), /not both/);
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

test('the prompts describe a workflow that ends in a check', async (t) => {
  const { client } = await connect(t);

  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((prompt) => prompt.name).sort(), ['model_a_part', 'review_a_document']);

  const prompt = await client.getPrompt({
    name: 'model_a_part',
    arguments: { part: 'a wall bracket', constraints: 'fits a 35 mm pipe', path: 'bracket.forma' },
  });
  const body = prompt.messages[0].content.text;
  assert.match(body, /a wall bracket/);
  assert.match(body, /fits a 35 mm pipe/);
  assert.match(body, /forma_check/);
  assert.match(body, /bracket\.forma/);
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

test('an example resource that does not exist fails rather than returning nothing', async (t) => {
  const { client } = await connect(t);

  const example = await client.readResource({ uri: 'forma://example/minimal' });
  assert.match(example.contents[0].text, /model "block"/);

  await assert.rejects(() => client.readResource({ uri: 'forma://example/nope' }));
});

test('the review prompt names the failures that are silent', async (t) => {
  const { client } = await connect(t);

  const prompt = await client.getPrompt({
    name: 'review_a_document',
    arguments: { path: 'bracket.forma' },
  });
  const body = prompt.messages[0].content.text;

  assert.match(body, /bracket\.forma/);
  assert.match(body, /silently dropped/);
  assert.match(body, /ends of their declared ranges/);
});

test('reading a document that is not there is reported, not thrown', async (t) => {
  const { client } = await connect(t);

  const missing = await client.callTool({ name: 'forma_read', arguments: { path: 'gone.forma' } });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /no file at "gone\.forma"/);
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

/**
 * The server itself: what it exposes, and over what.
 *
 * Tools are the part a model calls; resources are the part a client can attach to a
 * conversation by hand, and carry the same knowledge in a form a person can browse. Both
 * read from the same modules, so there is one description of the language here, not two.
 *
 * The knowledge is bundled rather than left to the error messages. A refusal names the
 * alternatives, which is enough to correct a misspelling and not enough to learn a language:
 * it teaches the name of a block and nothing about what that block means, what it takes, or
 * which of its attributes interact. A caller with no manual can find `cone` from `frustum`
 * that way; it cannot find `revolve` at all.
 */
/** @import { Workspace } from './workspace.js' */

import { createRequire } from 'node:module';

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CONSTRUCTS, LANGUAGE_CONSTANTS, LANGUAGE_FUNCTIONS } from './catalogue.js';
import { EXAMPLES, EXAMPLES_BY_NAME } from './examples.js';
import { PAGES, readPage } from './reference.js';
import { clientWorkspace } from './roots.js';
import { guide } from './guide.js';
import { registerTools } from './tools.js';

/**
 * The package's own version, reported in the handshake.
 *
 * Read from the manifest rather than written out here, because the two drifted the moment
 * they were allowed to: a client was told 0.1.0 by a server published as 0.1.5, and nothing
 * in the release could notice. `files` ships `src/` and npm always ships the manifest, so
 * this resolves in the published package as well as in the tree.
 */
export const VERSION = createRequire(import.meta.url)('../package.json').version;

/**
 * What the server tells a client it is for, offered as instructions during initialisation.
 *
 * Clients put this in front of the model before it has called anything, so it is the one
 * place to say the thing that changes behaviour most: check before you claim it works.
 */
const INSTRUCTIONS = `This server knows forma, a declarative DSL for 3D solids, builds it with
the real geometry kernel, and writes the documents it builds.

Start with \`forma_guide\` — it is the language in one page. Use \`forma_blocks\` for the
attributes of the blocks you are about to write, \`forma_examples\` for a working document of
a similar shape, and \`forma_reference\` when you need the manual.

Never hand a .forma document to anyone without writing it through \`forma_write\`. It compiles
the document, solves it and reports the bounding box, the volume and the triangle count of
every part, which is the only way to know that the model is the size that was asked for and
has not silently solved to nothing. A document that does not build is refused rather than
written. Read one back with \`forma_read\`, and export a solid with \`forma_export_stl\`.

Where those files go is the client's decision, not the server's: the tools read and write
inside the directories the client declares as MCP roots, and a path is taken relative to the
first of them. Every write reports the directory it landed in.`;

/**
 * Builds the server, with every tool and resource registered.
 *
 * The workspace is optional, and left out is the normal case: the server then takes its
 * directories from whatever the connected client declares as its roots, which is the point —
 * the client knows where the user's files belong and the server does not.
 *
 * @param {Workspace} [workspace] The patch of filesystem the tools may touch. Omitted, the
 *   client's roots are used.
 * @returns {McpServer} The server, not yet connected to a transport.
 */
export function createServer(workspace) {
  const server = new McpServer(
    { name: 'forma-dsl', version: VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );

  registerTools(server, workspace ?? clientWorkspace(server.server));
  registerResources(server);

  return server;
}

/**
 * Registers the browsable copies of what the tools serve.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerResources(server) {
  server.registerResource('guide', 'forma://guide', {
    title: 'The forma language in brief',
    description: 'Everything needed to write a document: structure, nesting, dimensionality, syntax, pitfalls.',
    mimeType: 'text/markdown',
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guide() }],
  }));

  server.registerResource('catalogue', 'forma://catalogue', {
    title: 'Block and function catalogue',
    description: 'Every block with its attributes, and every builtin function, as JSON.',
    mimeType: 'application/json',
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify({
        blocks: [...CONSTRUCTS.values()],
        functions: LANGUAGE_FUNCTIONS,
        constants: LANGUAGE_CONSTANTS,
      }, null, 2),
    }],
  }));

  server.registerResource(
    'reference',
    new ResourceTemplate('forma://reference/{+path}', {
      list: async () => ({
        resources: PAGES.map((page) => ({
          uri: `forma://reference/${page.path}`,
          name: page.title,
          description: page.about,
          mimeType: 'text/markdown',
        })),
      }),
      complete: {
        path: (value) => PAGES.map((page) => page.path).filter((path) => path.startsWith(value)),
      },
    }),
    { title: 'Reference manual', description: 'One page of the manual.', mimeType: 'text/markdown' },
    async (uri, { path }) => {
      const page = await readPage(Array.isArray(path) ? path[0] : path);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: page.markdown }] };
    },
  );

  server.registerResource(
    'example',
    new ResourceTemplate('forma://example/{name}', {
      list: async () => ({
        resources: EXAMPLES.map((example) => ({
          uri: `forma://example/${example.name}`,
          name: example.name,
          description: example.summary,
          mimeType: 'text/plain',
        })),
      }),
      complete: {
        name: (value) => EXAMPLES.map((example) => example.name)
          .filter((name) => name.startsWith(value)),
      },
    }),
    { title: 'Worked example', description: 'A complete document that renders.', mimeType: 'text/plain' },
    async (uri, { name }) => {
      const key = Array.isArray(name) ? name[0] : name;
      const example = EXAMPLES_BY_NAME.get(key);
      if (!example) throw new Error(`no example "${key}"`);
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: example.source }] };
    },
  );
}


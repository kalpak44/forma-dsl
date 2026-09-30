/**
 * The server itself: what it exposes, and over what.
 *
 * Tools are the part a model calls; resources are the part a client can attach to a
 * conversation by hand, and carry the same knowledge in a form a person can browse. Both
 * read from the same modules, so there is one description of the language here, not two.
 */
/** @import { Workspace } from './workspace.js' */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CONSTRUCTS, LANGUAGE_CONSTANTS, LANGUAGE_FUNCTIONS } from './catalogue.js';
import { EXAMPLES, EXAMPLES_BY_NAME } from './examples.js';
import { PAGES, readPage } from './reference.js';
import { guide } from './guide.js';
import { registerTools } from './tools.js';

/** The package's own version, reported in the handshake. */
export const VERSION = '0.1.0';

/**
 * What the server tells a client it is for, offered as instructions during initialisation.
 *
 * Clients put this in front of the model before it has called anything, so it is the one
 * place to say the thing that changes behaviour most: check before you claim it works.
 */
const INSTRUCTIONS = `This server knows forma, a declarative DSL for 3D solids, and can write
and solve .forma documents.

Start with \`forma_guide\` — it is the language in one page. Use \`forma_blocks\` for the
attributes of the blocks you are about to write, \`forma_examples\` for a working document of
a similar shape, and \`forma_reference\` when you need the manual.

Never hand a .forma document to anyone without running \`forma_check\` on it first. The check
builds the geometry with the real kernel and reports the bounding box, the volume and the
triangle count of every part, which is the only way to know that the model is the size that
was asked for and has not silently solved to nothing. Write files with \`forma_write\`, which
runs the same check and refuses a document that does not render.`;

/**
 * Builds the server, with every tool, resource and prompt registered.
 *
 * @param {Workspace} workspace The patch of filesystem the file tools may touch.
 * @returns {McpServer} The server, not yet connected to a transport.
 */
export function createServer(workspace) {
  const server = new McpServer(
    { name: 'forma-dsl', version: VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );

  registerTools(server, workspace);
  registerResources(server);
  registerPrompts(server);

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

/**
 * Registers the prompts, which are the workflows worth having a name for.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerPrompts(server) {
  server.registerPrompt('model_a_part', {
    title: 'Model a part in forma',
    description: 'Walks from a description of a physical object to a checked .forma document.',
    argsSchema: {
      part: z.string().describe('What to model, e.g. "a wall bracket for a 35 mm pipe".'),
      constraints: z.string().optional()
        .describe('Dimensions, tolerances, print constraints — anything the result has to satisfy.'),
      path: z.string().optional().describe('Where to write the finished document.'),
    },
  }, ({ part, constraints, path }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Model this in forma: ${part}.`,
          constraints ? `\nIt has to satisfy: ${constraints}` : '',
          '',
          'Work in this order:',
          '1. Call `forma_guide` if you have not already read it this session.',
          '2. Call `forma_examples` and read the one closest to what this is.',
          '3. Decide what is a `param` (anything a person would reasonably change, with a '
          + 'default, a min and a max) and what is a `local` (anything derived from those).',
          '4. Write the document. Prefer a 2D profile given thickness by `extrude` or '
          + '`revolve` over composing solids. Name any repeated feature — including the '
          + 'negative of one — as a `component`. Give each physical piece its own `part` with '
          + 'a colour.',
          '5. Call `forma_check` with `solve: true`. Read the bounding box and the volume back '
          + 'and confirm they are what was asked for. A part with zero volume means the model '
          + 'silently produced nothing — fix it, do not report it as done.',
          '6. Iterate until it renders and measures correctly.',
          path
            ? `7. Write it to \`${path}\` with \`forma_write\`.`
            : '7. Offer to write it with `forma_write` once it checks out.',
          '',
          'Report the finished document along with its measured size, and say which params '
          + 'drive which dimension.',
        ].filter(Boolean).join('\n'),
      },
    }],
  }));

  server.registerPrompt('review_a_document', {
    title: 'Review a .forma document',
    description: 'Checks an existing document and reports what is wrong or fragile about it.',
    argsSchema: { path: z.string().describe('The document to review.') },
  }, ({ path }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `Review the forma document at \`${path}\`.`,
          '',
          'Call `forma_read` on it, then look for:',
          '- parts that solved to nothing, or a bounding box that is not what the document '
          + 'seems to intend;',
          '- a `part` nested inside a transform or a boolean, which is silently dropped;',
          '- a `difference` whose cutter ends exactly on a face, leaving a zero-thickness skin;',
          '- dimensions written as bare numbers where a `param` or a `local` would say what '
          + 'they mean;',
          '- a `param` whose `min`/`max` the model does not actually clamp, since those bounds '
          + 'are advisory and never enforced;',
          '- geometry that would not print: unsupported overhangs, walls thinner than a nozzle, '
          + 'a non-zero genus where a solid was meant.',
          '',
          'Re-check with different param values at the ends of their declared ranges — a model '
          + 'that only works at its defaults is the common failure. Report what you found, and '
          + 'propose the smallest edit that fixes each one.',
        ].join('\n'),
      },
    }],
  }));
}

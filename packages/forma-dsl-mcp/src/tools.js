/**
 * The three tools the server offers, and how their results are worded.
 *
 * Results are Markdown rather than JSON on purpose. Everything here is read by a language
 * model deciding what to write next, and a bounding box in a table is acted on where the
 * same numbers inside a JSON blob are skimmed. The one exception is a parameter list, which
 * is data a client may want to build controls from, and is given as both.
 */
/** @import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js' */
/** @import { Workspace } from './workspace.js' */

import { z } from 'zod';

import { CONSTRUCTS, LANGUAGE_CONSTANTS, LANGUAGE_FUNCTIONS, formatConstruct } from './catalogue.js';
import { EXAMPLES, EXAMPLES_BY_NAME } from './examples.js';
import { GUIDE_SECTIONS, guide } from './guide.js';
import { PAGES, readPage, searchReference } from './reference.js';
import { checkDocument, exportStl } from './document.js';

/**
 * What a tool that only reads what this package already carries is.
 *
 * All four hints are stated rather than just `readOnlyHint`, because the omitted ones are not
 * absent: the specification gives `destructiveHint` a default of **true** and `idempotentHint`
 * a default of **false**. A tool declaring neither is therefore advertising itself as
 * destructive and unrepeatable — which, for a call that hands back a page of the manual, is
 * simply untrue, and a cautious client is entitled to act on it.
 *
 * `openWorldHint` is false because every answer is bundled with the package. Nothing here
 * reaches the network, so the domain is closed and stays closed offline.
 */
const READS_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

/**
 * Wraps text as a tool result.
 *
 * @param {string} text What to say.
 * @param {boolean} [isError] Whether the call failed.
 * @returns {{ content: Array<{ type: 'text', text: string }>, isError?: boolean }} The result.
 */
const say = (text, isError = false) => ({
  content: [{ type: /** @type {'text'} */ ('text'), text }],
  ...(isError ? { isError: true } : {}),
});

/**
 * Runs a handler, turning anything it throws into a result the caller can read.
 *
 * A thrown error becomes a protocol-level failure, which most clients surface as "the tool
 * broke" rather than as something the model can correct. A refusal it can read — a path
 * outside the roots, a part that does not exist — belongs in the result instead.
 *
 * @param {() => Promise<object>} handler What to run.
 * @returns {Promise<object>} Its result, or the failure as text.
 */
async function attempt(handler) {
  try {
    return await handler();
  } catch (error) {
    return say(`Failed: ${/** @type {Error} */ (error)?.message ?? String(error)}`, true);
  }
}

/**
 * Renders a Markdown table.
 *
 * @param {string[]} headers The column headings.
 * @param {Array<Array<string | number>>} rows The rows.
 * @returns {string} The table, or a dash when there are no rows.
 */
function table(headers, rows) {
  if (!rows.length) return '_none_';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/**
 * The error, if there is one, with the excerpt that points at it.
 *
 * @param {object} report What {@link checkDocument} returned.
 * @returns {string[]} The lines, or none when the document is fine.
 */
function problemLines(report) {
  /** @type {string[]} */
  const lines = [];
  if (report.error) {
    const { stage, message, line, column, excerpt } = report.error;
    lines.push(`**${stage}**: ${message}`, '');
    if (line) lines.push(`At line ${line}, column ${column}:`, '', '```', excerpt, '```', '');
  }
  if (report.parameterError) lines.push(`**parameters**: ${report.parameterError.message}`, '');
  return lines;
}

/**
 * The declared params, as the table a front end would build controls from.
 *
 * @param {Array<object>} parameters The descriptors.
 * @returns {string[]} The lines, or none when the document declares no params.
 */
function parameterLines(parameters) {
  if (!parameters?.length) return [];
  return ['## Parameters', '', table(
    ['Name', 'Type', 'Default', 'Required', 'Range'],
    parameters.map((parameter) => {
      const bounded = parameter.min !== undefined || parameter.max !== undefined;
      return [
        `\`${parameter.name}\``,
        parameter.type,
        parameter.default === undefined ? '—' : JSON.stringify(parameter.default),
        parameter.required ? 'yes' : 'no',
        bounded ? `${parameter.min ?? '−∞'} … ${parameter.max ?? '∞'}` : '—',
      ];
    }),
  ), ''];
}

/**
 * The solved scene, measured.
 *
 * A part that solved to nothing is called out rather than left in the table, because that is
 * the failure a caller is most likely to report as a success.
 *
 * @param {object} scene What the render produced.
 * @param {object} [stats] The render's own counters.
 * @returns {string[]} The lines.
 */
function sceneLines(scene, stats) {
  const { model, parts, boundingBox, triangles } = scene;
  const lines = [`## Scene \`${model}\``, '', table(
    ['Part', 'Colour', 'Opacity', 'Size (X × Y × Z)', 'Volume', 'Triangles', 'Genus'],
    parts.map((part) => [
      `\`${part.name}\``,
      part.color,
      part.opacity,
      part.boundingBox.size.join(' × '),
      part.volume,
      part.triangles,
      part.genus,
    ]),
  ), ''];

  const min = boundingBox.min.join(', ');
  const max = boundingBox.max.join(', ');
  lines.push(
    `**Overall bounding box**: ${boundingBox.size.join(' × ')} (min ${min}, max ${max})`,
    `**Triangles**: ${triangles}`,
    '',
  );

  const empty = parts.filter((part) => part.empty || part.volume === 0);
  if (empty.length) {
    const named = empty.map((part) => `\`${part.name}\``).join(', ');
    lines.push(
      `> ⚠️ ${named} solved to nothing. A zero-height extrude, a difference that removed `
      + 'everything, or a loop that ran zero times will do this silently.',
      '',
    );
  }

  if (stats) {
    lines.push(
      `_${stats.nodes} nodes, ${stats.evaluated} evaluated, ${stats.cacheHits} cache hits, `
      + `${stats.milliseconds} ms._`,
    );
  }
  return lines;
}

/**
 * How a block's children are described in the listing.
 *
 * @param {object} entry The catalogue entry.
 * @returns {string} What it takes.
 */
function takesOf(entry) {
  if (entry.leaf) return 'nothing';
  if (entry.takes === 'same') return '2D or 3D';
  return entry.takes ? `${entry.takes}D` : '—';
}

/**
 * Turns a check report into the page a caller reads.
 *
 * @param {object} report What {@link checkDocument} returned.
 * @returns {string} Markdown.
 */
export function formatReport(report) {
  const lines = [report.ok ? '# Document is valid' : '# Document has a problem', ''];
  lines.push(...problemLines(report));

  if (report.models) {
    lines.push(
      `**Models**: ${report.models.length ? report.models.join(', ') : '_none_'}`,
      `**Components**: ${report.components.length ? report.components.join(', ') : '_none_'}`,
      '',
    );
  }

  lines.push(...parameterLines(report.parameters));

  if (report.scene) lines.push(...sceneLines(report.scene, report.stats));

  return lines.join('\n');
}

/**
 * Resolves the `source`-or-`path` pair the export tool accepts.
 *
 * @param {Workspace} workspace Where a path is resolved.
 * @param {{ source?: string, path?: string }} args What the caller gave.
 * @returns {Promise<string>} The document.
 * @throws {Error} If neither or both were given.
 */
async function documentFrom(workspace, { source, path }) {
  if (source && path) throw new Error('give either "source" or "path", not both');
  if (source) return source;
  if (path) return workspace.read(path);
  throw new Error('give either "source" — the document itself — or "path" to one already written');
}

/**
 * The language in one page, or one section of it.
 *
 * Registered first because it is what the server's instructions tell a model to read first.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerGuide(server) {
  server.registerTool('forma_guide', {
    title: 'The forma language in brief',
    description:
      'The language compressed to what someone writing a document has to hold in their head: '
      + 'the four top-level blocks, how nesting composes geometry, dimensionality, units, the '
      + 'syntax rules that are not guessable, and the mistakes that cost the most time. Read '
      + 'this before writing any forma. Call with no section for all of it.',
    inputSchema: {
      section: z.enum(/** @type {[string, ...string[]]} */ (GUIDE_SECTIONS)).optional()
        .describe('One section, instead of the whole guide.'),
    },
    annotations: READS_ONLY,
  }, async ({ section }) => attempt(async () => say(guide(section))));
}

/**
 * What every block takes, read from the library's own registry.
 *
 * Names are answered in full rather than as a list, because a caller that has to guess at
 * an attribute spends a build finding out it guessed wrong.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerBlocks(server) {
  server.registerTool('forma_blocks', {
    title: 'Block and declaration reference',
    description:
      'Every block the language has, with its attributes, defaults, dimensionality and the '
      + 'things that surprise people about it. Call with no arguments for the full list of '
      + 'names and one-line summaries; name the ones you are about to use to get their '
      + 'attribute tables. Covers the declarations (param, local, component, model) and the '
      + 'control-flow constructs too.',
    inputSchema: {
      names: z.array(z.string()).optional()
        .describe('The blocks to describe in full, e.g. ["extrude", "difference"].'),
      group: z.string().optional()
        .describe('One group, e.g. "2D shapes", "Transforms", "Refinement", "Declarations".'),
    },
    annotations: READS_ONLY,
  }, async ({ names, group }) => attempt(async () => {
    const all = [...CONSTRUCTS.values()];

    if (names?.length) {
      const unknown = names.filter((name) => !CONSTRUCTS.has(name));
      if (unknown.length) {
        const quoted = unknown.map((name) => '"' + name + '"').join(', ');
        return say(
          `No such block: ${quoted}. The names are ${all.map((entry) => entry.name).join(', ')}.`,
          true,
        );
      }
      return say(names.map((name) => formatConstruct(CONSTRUCTS.get(name))).join('\n---\n\n'));
    }

    const wanted = group ? all.filter((entry) => entry.group === group) : all;
    if (!wanted.length) {
      const groups = [...new Set(all.map((entry) => entry.group))];
      return say(`No group "${group}". The groups are ${groups.join(', ')}.`, true);
    }
    if (group) return say(wanted.map((entry) => formatConstruct(entry)).join('\n---\n\n'));

    const lines = ['# Every construct in the language', ''];
    for (const name of new Set(all.map((entry) => entry.group))) {
      lines.push(`## ${name}`, '', table(
        ['Block', 'Dim', 'Takes', 'Summary'],
        all.filter((entry) => entry.group === name).map((entry) => [
          `\`${entry.name}\``,
          entry.dim ? `${entry.dim}D` : '—',
          takesOf(entry),
          entry.summary,
        ]),
      ), '');
    }
    lines.push('_Call again with `names` for the attribute tables._');
    return say(lines.join('\n'));
  }));
}

/**
 * Every function an expression may call, and the two named constants.
 *
 * There are no user-defined functions in forma, so this answer is complete rather than a
 * sample — which is worth saying, because it is what stops a caller inventing one.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerFunctions(server) {
  server.registerTool('forma_functions', {
    title: 'Builtin functions and constants',
    description:
      'Every function an expression may call, with its arity, and the two named constants. '
      + 'There are no user-defined functions in forma, so this is the complete set.',
    inputSchema: {},
    annotations: READS_ONLY,
  }, async () => attempt(async () => say([
    '# Functions',
    '',
    'Trigonometry takes and returns **degrees**. Functions take positional arguments only.',
    '',
    table(
      ['Function', 'Arity', 'Description'],
      LANGUAGE_FUNCTIONS.map((fn) => [`\`${fn.name}\``, fn.arity, fn.description]),
    ),
    '',
    '# Constants',
    '',
    table(['Name', 'Value'], LANGUAGE_CONSTANTS.map((c) => [`\`${c.name}\``, c.value])),
  ].join('\n'))));
}

/**
 * The bundled manual: search it, read a page, or list what there is.
 *
 * The manual ships with the package rather than being fetched, so the answers stay true to
 * the version installed and work with no network at all.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerReference(server) {
  server.registerTool('forma_reference', {
    title: 'The reference manual',
    description:
      'The language\'s full reference manual, bundled with this server. Pass `query` to '
      + 'search it, or `page` to read one page whole. Reach for this when forma_blocks is not '
      + 'enough — the manual has the worked examples, the caveats and the troubleshooting for '
      + 'every error message the language raises. Call with no arguments to list the pages.',
    inputSchema: {
      query: z.string().optional().describe('Words to search for, e.g. "revolve profile axis".'),
      page: z.string().optional().describe('One page to read, e.g. "reference/conversions.md".'),
    },
    annotations: READS_ONLY,
  }, async ({ query, page }) => attempt(async () => {
    if (page) {
      const found = await readPage(page);
      return say(`# ${found.title}\n_${found.path}_\n\n${found.markdown}`);
    }
    if (query) {
      const hits = await searchReference(query);
      if (!hits.length) return say(`Nothing in the manual matches "${query}".`);
      const plural = hits.length > 1 ? 's' : '';
      return say([
        `# ${hits.length} page${plural} matching "${query}"`,
        '',
        ...hits.map((hit) => [
          `## ${hit.title} — \`${hit.path}\``,
          hit.heading ? `_under "${hit.heading}"_` : '',
          '',
          '> ' + hit.snippet.replaceAll('\n', '\n> '),
          '',
        ].join('\n')),
        '_Read one whole with `page`._',
      ].join('\n'));
    }
    return say([
      '# The reference manual',
      '',
      table(['Page', 'Title', 'About'], PAGES.map((each) => [`\`${each.path}\``, each.title, each.about])),
    ].join('\n'));
  }));
}

/**
 * Complete documents that render, to read before writing something new.
 *
 * Every one is rendered by this package's tests at both ends of every parameter's range, so
 * an example cannot teach a mistake without the build failing.
 *
 * @param {McpServer} server The server.
 * @returns {void}
 */
function registerExamples(server) {
  server.registerTool('forma_examples', {
    title: 'Worked documents',
    description:
      'Complete .forma documents that render, each showing one way of building a real part. '
      + 'Every one is rendered by this package\'s tests, so none of them teaches a mistake. '
      + 'Read the nearest one before writing something new.',
    inputSchema: {
      name: z.string().optional().describe('One example to read in full.'),
    },
    annotations: READS_ONLY,
  }, async ({ name }) => attempt(async () => {
    if (name) {
      const example = EXAMPLES_BY_NAME.get(name);
      if (!example) {
        return say(
          `No example "${name}". They are ${EXAMPLES.map((each) => each.name).join(', ')}.`,
          true,
        );
      }
      return say([
        `# ${example.name}`, '', example.summary, '',
        `**Shows**: ${example.shows.join(', ')}`, '',
        '```hcl', example.source.trimEnd(), '```',
      ].join('\n'));
    }
    return say([
      '# Worked examples', '',
      table(
        ['Name', 'Summary', 'Shows'],
        EXAMPLES.map((each) => [`\`${each.name}\``, each.summary, each.shows.join(', ')]),
      ),
      '', '_Read one with `name`._',
    ].join('\n'));
  }));

  // --- writing and building ----------------------------------------------------------------
}

/**
 * Build a document, and write it only if it built.
 *
 * The measurement is the point, not the file: a caller that is told the bounding box, the
 * volume and the triangle count knows whether the model is the size that was asked for and
 * has not silently solved to nothing. A refusal leaves nothing on disk.
 *
 * @param {McpServer} server The server.
 * @param {Workspace} workspace The patch of filesystem the tool may touch.
 * @returns {void}
 */
function registerWrite(server, workspace) {
  server.registerTool('forma_write', {
    title: 'Check, then write a .forma file',
    description:
      'Builds a .forma document with the real geometry kernel and, if it renders, writes it. '
      + 'The result is the measurement: a table of every part with its bounding box, volume, '
      + 'triangle count and genus, or the error with the line, the column and an excerpt with '
      + 'a caret on it. This is how you find out whether what you wrote is the size you meant, '
      + 'is watertight, and is not silently empty. A document that does not render is refused '
      + 'and nothing is written — pass `force: true` to write it anyway. Refuses to replace an '
      + 'existing file unless `overwrite` is set.',
    inputSchema: {
      path: z.string()
        .describe('Where to write, relative to the first directory the client declared as a root. Must end in .forma.'),
      source: z.string().describe('The document.'),
      model: z.string().optional().describe('Which model to build. Defaults to the first one declared.'),
      params: z.record(z.string(), z.any()).optional()
        .describe('Values for the document\'s params, by name. Anything not given uses its default.'),
      overwrite: z.boolean().optional().describe('Replace the file if it already exists. Default false.'),
      force: z.boolean().optional().describe('Write even if the document does not render. Default false.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ path, source, model, params, overwrite, force }) => attempt(async () => {
    const report = await checkDocument(source, { model: model ?? null, params: params ?? {} });

    if (!report.ok && !force) {
      return say(
        `${formatReport(report)}\n\n**Nothing was written.** Fix it and call again, `
        + 'or pass `force: true` to write it as it stands.',
        true,
      );
    }

    const written = await workspace.write(path, source, { overwrite, extension: '.forma' });
    return say([
      `Wrote \`${written.relative}\` under \`${written.root}\` — ${written.bytes} bytes`
      + `${written.replaced ? ', replacing what was there' : ''}.`,
      '',
      formatReport(report),
    ].join('\n'));
  }));
}

/**
 * Read a document back, with its current measurements.
 *
 * Source and measurements together, because editing something last touched in another
 * session means needing both.
 *
 * @param {McpServer} server The server.
 * @param {Workspace} workspace The patch of filesystem the tool may touch.
 * @returns {void}
 */
function registerRead(server, workspace) {
  server.registerTool('forma_read', {
    title: 'Read a document back',
    description:
      'Reads a .forma file the client has given access to and builds it, so you see the source '
      + 'and its current measurements together. Use it before editing something you did not '
      + 'write in this session.',
    inputSchema: {
      path: z.string().describe('The file, relative to the first directory the client declared as a root.'),
      solve: z.boolean().optional()
        .describe('Run the geometry kernel. Default true; false parses only, which is faster.'),
    },
    annotations: READS_ONLY,
  }, async ({ path, solve }) => attempt(async () => {
    const source = await workspace.read(path);
    const report = await checkDocument(source, { solve: solve ?? true });
    return say(['```hcl', source.trimEnd(), '```', '', formatReport(report)].join('\n'));
  }));
}

/**
 * Render a document and write one part, or every part unioned, as binary STL.
 *
 * Takes a document either as source or as a path already on disk, so a caller that has just
 * written one does not have to hold it a second time.
 *
 * @param {McpServer} server The server.
 * @param {Workspace} workspace The patch of filesystem the tool may touch.
 * @returns {void}
 */
function registerExportStl(server, workspace) {
  server.registerTool('forma_export_stl', {
    title: 'Render and write a binary STL',
    description:
      'Renders a document and writes one part — or every part unioned — as a binary STL. '
      + 'Lengths are unitless in forma and STL has no unit either; every consumer treats them '
      + 'as millimetres.',
    inputSchema: {
      source: z.string().optional().describe('The .forma document itself.'),
      path: z.string().optional()
        .describe('A .forma file the client has given access to, instead of `source`.'),
      model: z.string().optional().describe('Which model to build. Defaults to the first one declared.'),
      params: z.record(z.string(), z.any()).optional()
        .describe('Values for the document\'s params, by name. Anything not given uses its default.'),
      out: z.string()
        .describe('Where to write, relative to the first directory the client declared as a root. Must end in .stl.'),
      part: z.string().optional()
        .describe('One part by name. Omitted, a single-part model exports that part and a multi-part model exports them unioned.'),
      overwrite: z.boolean().optional().describe('Replace the file if it already exists. Default false.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => attempt(async () => {
    const source = await documentFrom(workspace, args);
    const result = await exportStl(source, {
      model: args.model ?? null,
      params: args.params ?? {},
      part: args.part ?? null,
    });
    const written = await workspace.write(args.out, result.bytes, {
      overwrite: args.overwrite,
      extension: '.stl',
    });
    return say(
      `Wrote \`${written.relative}\` under \`${written.root}\` — ${written.bytes} bytes, `
      + `${result.triangles} triangles, from model \`${result.model}\`, part \`${result.part}\`.`,
    );
  }));
}

/**
 * Registers every tool on a server.
 *
 * One function per tool, so this reads as the list of what the server offers and each tool's
 * schema, description and handler stay together where they are edited.
 *
 * @param {McpServer} server The server.
 * @param {Workspace} workspace The patch of filesystem the file tools may touch.
 * @returns {void}
 */
export function registerTools(server, workspace) {
  // Knowing the language.
  registerGuide(server);
  registerBlocks(server);
  registerFunctions(server);
  registerReference(server);
  registerExamples(server);

  // Writing and building.
  registerWrite(server, workspace);
  registerRead(server, workspace);
  registerExportStl(server, workspace);
}

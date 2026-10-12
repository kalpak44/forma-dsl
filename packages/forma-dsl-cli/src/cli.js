/**
 * The command line: what `forma` does with the arguments it is given.
 *
 * Kept apart from `bin.js` so that everything except the process itself can be tested in
 * one - `run` takes its arguments and its two output streams, and answers with an exit code
 * rather than calling `process.exit`. The entry point supplies the real ones.
 *
 * Nothing here knows the language. Every answer comes from the package's own entry point,
 * the same one the editor and the MCP server import, so a block added to the language is
 * something this can render without being told.
 *
 * Only `render` writes to stdout, and only when asked with `-o -`; the summary and every
 * diagnostic go to stderr, so `forma render part.forma -o - | ...` is a clean pipe.
 */
/** @import { ParameterValue, RenderResult, Solid } from 'forma-dsl' */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';

import {
  EvaluationContext, GeometryNode, Program, describeParameters, excerpt, render, setQuality,
  toBinarySTL,
} from 'forma-dsl';

const VERSION = createRequire(import.meta.url)('../package.json').version;

const USAGE = `forma ${VERSION} - render forma documents from the command line

Usage
  forma render <file> [options]     solve a document and write a binary STL
  forma params <file> [--json]      list the parameters the document declares
  forma models <file> [--json]      list the models the document declares

A <file> of "-" reads the document from stdin.

Render options
  -o, --out <file>        where to write; "-" is stdout. Defaults to <file>.stl
  -m, --model <name>      which model to build. Defaults to the first declared
      --part <name>       one part by name. Defaults to the only part, or every part union
  -p, --param <name=val>  a value for one declared param. Repeatable
      --segments <n>      a fixed segment count for every curve
      --min-angle <deg>   smallest angle between adjacent segments of a curve
      --min-edge <n>      smallest length a curve segment may be shortened to
      --max-nodes <n>     refuse a document that would build more blocks than this
  -q, --quiet             do not print the summary

  -h, --help              this text
  -v, --version           the version

Examples
  forma render riser.forma -p height=32 -o build/riser.stl
  forma render riser.forma --segments 64 -o - | 3mf-tool convert
  forma params riser.forma --json
`;

/** The option table, shared by every command so that `--help` works after any of them. */
const OPTIONS = {
  out: { type: 'string', short: 'o' },
  model: { type: 'string', short: 'm' },
  part: { type: 'string' },
  param: { type: 'string', short: 'p', multiple: true },
  segments: { type: 'string' },
  'min-angle': { type: 'string' },
  'min-edge': { type: 'string' },
  'max-nodes': { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

/**
 * A mistake in how the command was invoked, as opposed to a mistake in the document.
 *
 * The two exit differently - 2 for this, 1 for a document that does not build - because a
 * script driving `forma` wants to tell "I called it wrong" from "the model is broken".
 */
export class UsageError extends Error {
  /**
   * @param {string} message What was wrong with the invocation.
   */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Reads one `--param name=value`.
 *
 * Values are JSON where they parse as JSON, so `-p count=6`, `-p center=true` and
 * `-p size=[10,20]` all arrive as the type the document expects. Anything else is the
 * string as written, which is what makes `-p label=M6` work without quoting it twice.
 *
 * @param {string} entry The argument as given.
 * @returns {[string, ParameterValue]} The name and its value.
 * @throws {UsageError} If there is no `=`, or nothing before it.
 */
function parameter(entry) {
  const split = entry.indexOf('=');
  if (split < 1) throw new UsageError(`--param wants name=value, got "${entry}"`);

  const name = entry.slice(0, split);
  const raw = entry.slice(split + 1);
  try {
    return [name, JSON.parse(raw)];
  } catch {
    return [name, raw];
  }
}

/**
 * Reads a numeric option, rejecting the spellings that would otherwise become NaN.
 *
 * @param {string | undefined} raw The value as given.
 * @param {string} flag The flag it came from, for the message.
 * @returns {number | undefined} The number, or undefined when the flag was not given.
 * @throws {UsageError} If it is not a finite number.
 */
function numeric(raw, flag) {
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) throw new UsageError(`${flag} wants a number, got "${raw}"`);
  return value;
}

/**
 * Reads the document named on the command line.
 *
 * @param {string} file The path, or `-` for stdin.
 * @returns {Promise<string>} The source.
 * @throws {UsageError} If the file cannot be read.
 */
async function readSource(file) {
  try {
    if (file === '-') {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      return Buffer.concat(chunks).toString('utf8');
    }
    return await readFile(file, 'utf8');
  } catch (error) {
    throw new UsageError(`cannot read ${file === '-' ? 'stdin' : file}: ${error.message}`);
  }
}

/**
 * Where an STL goes when `--out` was not given: beside the document, named after it.
 *
 * @param {string} file The document's path.
 * @returns {string} The output path.
 * @throws {UsageError} If the document came from stdin, which gives nothing to name it after.
 */
function defaultOut(file) {
  if (file === '-') throw new UsageError('reading from stdin needs an explicit --out');
  return file.slice(0, file.length - extname(file).length) + '.stl';
}

/**
 * Picks the solid to write, and says what it was called.
 *
 * @param {RenderResult} result The rendered model.
 * @param {string | null} wanted The `--part` name, or null.
 * @param {EvaluationContext} context The context that owns the parts.
 * @returns {Promise<{ solid: Solid, part: string }>} The solid and the name to report.
 * @throws {UsageError} If `--part` names a part the model does not have.
 */
async function chosenPart(result, wanted, context) {
  if (wanted) {
    const part = result.parts.find((candidate) => candidate.name === wanted);
    if (!part) {
      const names = result.parts.map((candidate) => `"${candidate.name}"`).join(', ');
      throw new UsageError(`no part named "${wanted}" in model "${result.name}" - it has ${names}`);
    }
    return { solid: part.concrete, part: part.name };
  }

  if (result.parts.length === 1) return { solid: result.parts[0].concrete, part: result.parts[0].name };

  // STL has no notion of a part, so several of them are union rather than concatenated:
  // a slicer reading two overlapping shells makes a mess of them.
  const union = GeometryNode.union(result.parts.map((each) => each.node));
  return { solid: /** @type {Solid} */ (await context.evaluate(union)), part: 'all' };
}

/**
 * Writes the STL where it was asked to go.
 *
 * @param {Uint8Array} bytes The binary STL.
 * @param {string} out The path, or `-` for stdout.
 * @param {string} file The document's path, which the output must not be.
 * @param {{ write: (chunk: string | Uint8Array) => unknown }} stdout Where `-` goes.
 * @returns {Promise<void>} Resolves once it is written.
 * @throws {UsageError} If the output would overwrite the document, or cannot be written.
 */
async function writeOut(bytes, out, file, stdout) {
  if (out === '-') {
    stdout.write(bytes);
    return;
  }
  if (file !== '-' && resolve(out) === resolve(file)) {
    throw new UsageError(`--out would overwrite the document itself (${out})`);
  }
  try {
    await writeFile(out, bytes);
  } catch (error) {
    throw new UsageError(`cannot write ${out}: ${error.message}`);
  }
}

/**
 * `forma render` - solve a document and write a binary STL.
 *
 * @param {string} file The document's path, or `-`, which the default output is named after.
 * @param {string} source The document.
 * @param {Record<string, any>} flags The parsed options.
 * @param {{ out: { write: Function }, err: { write: Function } }} io Where output goes.
 * @returns {Promise<void>} Resolves once the STL is written and the summary printed.
 * @throws {UsageError} On a bad invocation, an unreadable document or an unwritable output.
 */
async function renderCommand(file, source, flags, io) {
  const out = flags.out ?? defaultOut(file);

  const quality = {
    segments: numeric(flags.segments, '--segments'),
    minAngle: numeric(flags['min-angle'], '--min-angle'),
    minEdgeLength: numeric(flags['min-edge'], '--min-edge'),
  };
  if (Object.values(quality).some((value) => value !== undefined)) await setQuality(quality);

  const context = await EvaluationContext.create();
  try {
    const result = await render(source, {
      model: flags.model ?? null,
      params: Object.fromEntries((flags.param ?? []).map(parameter)),
      maxNodes: numeric(flags['max-nodes'], '--max-nodes') ?? null,
      context,
    });

    const { solid, part } = await chosenPart(result, flags.part ?? null, context);
    const name = file === '-' ? 'stdin' : basename(file);
    await writeOut(toBinarySTL(solid, `forma ${name} ${result.name} ${part}`), out, file, io.out);

    if (!flags.quiet) io.err.write(`${summary(out, result, part, solid.numTri())}\n`);
  } finally {
    context.dispose();
  }
}

/**
 * The line printed after a successful render.
 *
 * It names the cache hits because that is the number that explains why the second render of
 * the same document in a loop is faster, and it is otherwise invisible.
 *
 * @param {string} out Where the STL went.
 * @param {RenderResult} result The rendered model.
 * @param {string} part Which part was written.
 * @param {number} triangles How many triangles it has.
 * @returns {string} One line, for stderr.
 */
function summary(out, result, part, triangles) {
  const { nodes, evaluated, cacheHits, milliseconds } = result.stats;
  const count = (value) => value.toLocaleString('en-US');
  return `${out === '-' ? 'stdout' : out} - ${count(triangles)} triangles · `
    + `model "${result.name}", part "${part}" · `
    + `${count(nodes)} nodes, ${count(evaluated)} solved, ${count(cacheHits)} cached · ${milliseconds} ms`;
}

/**
 * `forma params` - list what the document declares, for a script building a matrix of them.
 *
 * @param {string} _file The document's path, which this command does not need.
 * @param {string} source The document.
 * @param {Record<string, any>} flags The parsed options.
 * @param {{ out: { write: Function } }} io Where output goes.
 * @returns {Promise<void>} Resolves once the listing is printed.
 */
async function paramsCommand(_file, source, flags, io) {
  const descriptors = describeParameters(source);

  if (flags.json) {
    io.out.write(`${JSON.stringify(descriptors, null, 2)}\n`);
    return;
  }
  if (!descriptors.length) {
    io.out.write('no params declared\n');
    return;
  }
  for (const d of descriptors) {
    const value = d.required ? 'required' : JSON.stringify(d.default);
    const bounded = d.min !== undefined && d.max !== undefined;
    const range = bounded ? `  [${d.min}..${d.max}]` : '';
    const description = d.description ? `  - ${d.description}` : '';
    io.out.write(`${d.name}  ${d.type}  ${value}${range}${description}\n`);
  }
}

/**
 * `forma models` - list the models, so `--model` can be given a name that exists.
 *
 * Answered from the parse alone, with no kernel: naming the models is not worth solving them.
 *
 * @param {string} _file The document's path, which this command does not need.
 * @param {string} source The document.
 * @param {Record<string, any>} flags The parsed options.
 * @param {{ out: { write: Function } }} io Where output goes.
 * @returns {Promise<void>} Resolves once the listing is printed.
 */
async function modelsCommand(_file, source, flags, io) {
  const program = Program.parse(source);
  const names = [...program.models.keys()];

  if (flags.json) {
    io.out.write(`${JSON.stringify(names, null, 2)}\n`);
    return;
  }
  io.out.write(names.length ? `${names.join('\n')}\n` : 'no models declared\n');
}

/** What each command is, and what it is called. */
const COMMANDS = { render: renderCommand, params: paramsCommand, models: modelsCommand };

/**
 * Resolves the positional arguments to the command they name and the file it acts on.
 *
 * Separate from `run` so that the invocation checks throw somewhere other than into the
 * `catch` that turns them into an exit code - a throw caught in the same function it was
 * raised in is a conditional wearing a disguise.
 *
 * @param {string[]} positionals Everything that was not a flag.
 * @returns {{ handler: Function, file: string }} The command, and what to run it on.
 * @throws {UsageError} If the command is unknown, or the file is missing or doubled.
 */
function dispatch(positionals) {
  const [name, file, ...extra] = positionals;

  const handler = COMMANDS[name];
  if (!handler) throw new UsageError(`unknown command "${name}" - try render, params or models`);
  if (!file) throw new UsageError(`${name} wants a file - "-" reads stdin`);
  if (extra.length) throw new UsageError(`${name} takes one file, got ${extra.length + 1}`);

  return { handler, file };
}

/**
 * What `FormaError` appends to its own message, which a `file:line:column:` prefix repeats.
 *
 * Anchored to exactly the suffix the lexer builds. Printing the position as a prefix is what
 * makes a failure clickable in an editor and parseable as a CI annotation, and saying it twice
 * on one line is just noise - so the suffix comes off when the prefix goes on.
 */
const APPENDED_POSITION = / \(line \d+, column \d+\)$/;

/**
 * Reports a failure, with the source excerpt when the error carries a position.
 *
 * @param {unknown} error What was thrown.
 * @param {string | undefined} source The document, when one was read.
 * @param {string | undefined} file Where the document came from, for the position prefix.
 * @param {{ write: (chunk: string) => unknown }} err Where it goes.
 * @returns {void}
 */
function report(error, source, file, err) {
  const thrown = /** @type {Error & { loc?: { line: number, column: number } }} */ (error);
  const message = thrown?.message ?? 'a failure with no message';

  if (thrown?.loc && file) {
    const named = file === '-' ? '<stdin>' : file;
    const position = `${named}:${thrown.loc.line}:${thrown.loc.column}`;
    err.write(`${position}: ${message.replace(APPENDED_POSITION, '')}\n`);
  } else {
    err.write(`forma: ${message}\n`);
  }

  const shown = source === undefined ? undefined : excerpt(source, thrown?.loc);
  if (shown) err.write(`${shown}\n`);
}

/**
 * Runs one invocation.
 *
 * @param {string[]} argv The arguments, without the executable and the script.
 * @param {{ out: { write: Function }, err: { write: Function } }} io Where output goes.
 * @returns {Promise<number>} The exit code: 0 for success, 1 for a document that does not
 *   build, 2 for a mistake in the invocation itself.
 */
export async function run(argv, io) {
  /** @type {string | undefined} Kept so a failure can be reported against its own source. */
  let source;
  /** @type {string | undefined} The same, for the `file:line:column:` prefix. */
  let file;

  try {
    const { values: flags, positionals } = parseArgs({
      args: argv, options: OPTIONS, allowPositionals: true,
    });

    if (flags.version) {
      io.out.write(`${VERSION}\n`);
      return 0;
    }
    // Explicit `--help` is what was asked for; an empty invocation is a mistake the usage
    // happens to be the best answer to, so it prints the same text and exits 2.
    if (flags.help || !positionals.length) {
      io.out.write(USAGE);
      return flags.help ? 0 : 2;
    }

    const { handler, file: named } = dispatch(positionals);
    file = named;

    // Read once, here: stdin can only be consumed once, and holding the source is also what
    // lets a failure below be shown against the lines it was raised against.
    source = await readSource(file);
    await handler(file, source, flags, io);
    return 0;
  } catch (error) {
    report(error, source, file, io.err);
    return error instanceof UsageError || error?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? 2 : 1;
  }
}

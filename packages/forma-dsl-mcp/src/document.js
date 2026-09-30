/**
 * Checking a document, and measuring what it builds.
 *
 * This is the part of the server that makes the difference between a model that has written
 * plausible-looking forma and a model that has written forma which renders. Nothing here
 * re-implements the language: every answer comes from the published package, so a block that
 * changes its attributes changes this server's answers with it.
 */
/** @import { ParameterValue, RenderResult, Solid } from 'forma-dsl' */

import {
  EvaluationContext,
  GeometryNode,
  Program,
  describeParameters,
  render,
  toBinarySTL,
} from 'forma-dsl';

/** How many lines of source to show either side of an error. */
const CONTEXT_LINES = 2;

/**
 * How much geometry one document may build before the server refuses it.
 *
 * This server exists to build text a model wrote, which is the case the library leaves a
 * budget off for. Nesting limits and `range` each bound one loop; only this bounds two of
 * them nested, and that shape asks for more geometry than the process can finish — on a pipe,
 * with no request timeout of its own, that is a server that never answers again.
 *
 * Set far above any honest document: the worked examples build tens of blocks. A model that
 * reaches this has written a loop it did not mean to.
 */
const MAX_NODES = 50_000;

/**
 * The context reused across calls, so an edit-and-recheck loop pays only for the subtrees
 * that changed.
 *
 * Kept at module scope rather than per-request because that is the whole point of the digest
 * cache — a context that lives for one call caches nothing.
 *
 * @type {EvaluationContext | null}
 */
let shared = null;

/**
 * Drops the shared context, freeing every WASM object it holds.
 *
 * Only tests need this; a server process keeps its context for as long as it runs.
 *
 * @returns {void}
 */
export function disposeSharedContext() {
  shared?.dispose();
  shared = null;
}

/**
 * Renders a source excerpt with a caret under the column an error points at.
 *
 * An error message with a line number still makes a model count lines. An excerpt does not.
 *
 * @param {string} source The document.
 * @param {{ line: number, column: number } | null | undefined} loc Where the error was raised.
 * @returns {string | undefined} The excerpt, or undefined when there is no position.
 */
export function excerpt(source, loc) {
  if (!loc || !Number.isInteger(loc.line)) return undefined;

  const lines = source.split('\n');
  const first = Math.max(1, loc.line - CONTEXT_LINES);
  const last = Math.min(lines.length, loc.line + CONTEXT_LINES);
  const width = String(last).length;

  /** @type {string[]} */
  const out = [];
  for (let n = first; n <= last; n++) {
    out.push(`${String(n).padStart(width)} | ${lines[n - 1]}`);
    if (n === loc.line) {
      out.push(`${' '.repeat(width)} | ${' '.repeat(Math.max(0, loc.column - 1))}^`);
    }
  }
  return out.join('\n');
}

/**
 * Turns a thrown error into the shape a tool result reports.
 *
 * @param {string} stage Which pass raised it — the stage is what tells a caller whether the
 *   mistake was a typo, a misunderstanding of meaning, or a degenerate solid.
 * @param {unknown} error What was thrown.
 * @param {string} source The document, for the excerpt.
 * @returns {{ stage: string, message: string, line?: number, column?: number, excerpt?: string }}
 *   The diagnostic.
 */
function diagnose(stage, error, source) {
  const thrown = /** @type {Error & { loc?: { line: number, column: number } }} */ (error);
  const loc = thrown?.loc ?? null;
  return {
    stage,
    message: thrown?.message ?? 'a failure with no message',
    ...(loc ? { line: loc.line, column: loc.column, excerpt: excerpt(source, loc) } : {}),
  };
}

/**
 * Rounds a number to a fixed number of places, dropping the trailing zeros.
 *
 * Measurements go to a language model, and `19.999999999999996` reads as a bug in the model
 * rather than as floating point.
 *
 * @param {number} value The number.
 * @returns {number} The rounded value.
 */
const tidy = (value) => Number.parseFloat(value.toFixed(4));

/**
 * What a solved part is, measured.
 *
 * The bounding box and the volume are what let a caller check a model against a requirement
 * it was given — "it has to fit in 100 x 60" is answerable from here without a viewer.
 *
 * @param {Solid} solid The solved part.
 * @returns {object} Its measurements.
 */
function measure(solid) {
  const box = solid.boundingBox();
  const size = box.max.map((max, i) => tidy(max - box.min[i]));
  return {
    boundingBox: { min: box.min.map(tidy), max: box.max.map(tidy), size },
    volume: tidy(solid.volume()),
    surfaceArea: tidy(solid.surfaceArea()),
    genus: solid.genus(),
    triangles: solid.numTri(),
    vertices: solid.numVert(),
    empty: solid.isEmpty(),
  };
}

/**
 * The declarations a document makes, without building anything.
 *
 * @param {Program} program The parsed document.
 * @param {string} source The document, so a param default that will not evaluate can still
 *   be reported against its position.
 * @returns {object} The outline, and any parameter failure.
 */
function outline(program, source) {
  /** @type {object} */
  const result = {
    models: [...program.models.keys()],
    components: [...program.components.keys()],
  };
  try {
    result.parameters = describeParameters(source);
  } catch (error) {
    result.parameterError = diagnose('parameters', error, source);
  }
  return result;
}

/**
 * Parses a document, and optionally solves one of its models.
 *
 * Returns rather than throws: every failure here is a fact about the document that the
 * caller asked for, not an error in the call.
 *
 * @param {string} source The document.
 * @param {object} [options] What to build.
 * @param {string | null} [options.model] Which model, or the first one.
 * @param {Record<string, ParameterValue>} [options.params] Values for the document's params.
 * @param {boolean} [options.solve] Whether to run the geometry kernel. Off answers only what
 *   parsing can answer, which is enough while a document is still being drafted.
 * @returns {Promise<object>} The report.
 */
export async function checkDocument(source, options = {}) {
  const { model = null, params = {}, solve = true } = options;

  /** @type {Program} */
  let program;
  try {
    program = Program.parse(source);
  } catch (error) {
    return { ok: false, stage: 'parse', error: diagnose('parse', error, source) };
  }

  const declared = outline(program, source);

  if (!solve) {
    return { ok: !declared.parameterError, stage: 'parsed', ...declared };
  }

  if (!declared.models.length) {
    return {
      ok: false,
      stage: 'parsed',
      ...declared,
      error: {
        stage: 'render',
        message: 'the document declares no model — add a `model "name" { ... }` block',
      },
    };
  }

  shared ??= await EvaluationContext.create();

  /** @type {RenderResult} */
  let result;
  try {
    result = await render(source, { model, params, context: shared, maxNodes: MAX_NODES });
  } catch (error) {
    return { ok: false, stage: 'render', ...declared, error: diagnose('render', error, source) };
  }

  const parts = result.parts.map((part) => ({
    name: part.name,
    color: part.color,
    opacity: part.opacity,
    ...measure(part.concrete),
  }));

  // Bounds what a long-lived context holds: without it, every intermediate solid from every
  // document ever checked stays resident for the life of the process.
  shared.collect(result.parts.map((part) => part.node));

  return {
    ok: true,
    stage: 'rendered',
    ...declared,
    scene: {
      model: result.name,
      parts,
      boundingBox: unionOf(parts.map((part) => part.boundingBox)),
      triangles: parts.reduce((total, part) => total + part.triangles, 0),
    },
    stats: result.stats,
  };
}

/**
 * The box that contains every part's box.
 *
 * @param {Array<{ min: number[], max: number[] }>} boxes One box per part.
 * @returns {{ min: number[], max: number[], size: number[] } | null} The union, or null when
 *   there are no parts.
 */
function unionOf(boxes) {
  if (!boxes.length) return null;
  const min = boxes[0].min.map((_, i) => Math.min(...boxes.map((box) => box.min[i])));
  const max = boxes[0].max.map((_, i) => Math.max(...boxes.map((box) => box.max[i])));
  return { min: min.map(tidy), max: max.map(tidy), size: max.map((v, i) => tidy(v - min[i])) };
}

/**
 * Renders a document and writes one part, or every part unioned, as binary STL.
 *
 * @param {string} source The document.
 * @param {object} [options] What to export.
 * @param {string | null} [options.model] Which model, or the first one.
 * @param {Record<string, ParameterValue>} [options.params] Values for the document's params.
 * @param {string | null} [options.part] Which part, or every part together.
 * @returns {Promise<{ bytes: Uint8Array, model: string, part: string, triangles: number }>}
 *   The file, and what is in it.
 * @throws {Error} If the document does not render, or names no such part.
 */
export async function exportStl(source, options = {}) {
  const { model = null, params = {}, part = null } = options;

  shared ??= await EvaluationContext.create();
  const result = await render(source, { model, params, context: shared, maxNodes: MAX_NODES });

  let solid;
  let name;
  if (part) {
    const wanted = result.parts.find((candidate) => candidate.name === part);
    if (!wanted) {
      const names = result.parts.map((candidate) => `"${candidate.name}"`).join(', ');
      throw new Error(`no part named "${part}" in model "${result.name}" — it has ${names}`);
    }
    solid = wanted.concrete;
    name = wanted.name;
  } else if (result.parts.length === 1) {
    solid = result.parts[0].concrete;
    name = result.parts[0].name;
  } else {
    // Several parts in one file: STL has no notion of a part, so they are unioned rather
    // than concatenated — a slicer reading two overlapping shells makes a mess of them.
    solid = await shared.evaluate(GeometryNode.union(result.parts.map((each) => each.node)));
    name = 'all';
  }

  const bytes = toBinarySTL(/** @type {Solid} */ (solid), `forma ${result.name} ${name}`);
  const triangles = /** @type {Solid} */ (solid).numTri();

  shared.collect(result.parts.map((each) => each.node));
  return { bytes, model: result.name, part: name, triangles };
}

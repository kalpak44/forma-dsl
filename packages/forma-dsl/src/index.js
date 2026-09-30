/**
 * The package's public surface: what a consumer may import, and the two calls that do the
 * work.
 *
 * Everything under `src/` is reachable only through this file, and that is what the rest of
 * the repository is held to: the editor, the landing page and the MCP server all import
 * `forma-dsl` rather than its sources. An export one of them needs and this file does not
 * name therefore fails here, rather than in someone's install.
 */

/** @import { ParameterDescriptor, RenderOptions, RenderResult, RenderedPart, Solid } from './index.js' */

export { Program, Evaluator } from './lang/evaluate.js';
export { parse } from './lang/parser.js';
export { tokenize, FormaError } from './lang/lexer.js';
export { BLOCKS, FUNCTIONS, CONSTANTS } from './lang/builtins.js';
export { GeometryNode } from './core/node.js';
export { EvaluationContext } from './core/context.js';
export { loadKernel, setQuality, resetQuality } from './core/kernel.js';
export { toRenderMesh } from './export/mesh.js';
export { toBinarySTL } from './export/stl.js';
export { Vector } from './values/vector.js';
export { Angle } from './values/angle.js';
export { Transform } from './values/transform.js';

import { Program, Evaluator } from './lang/evaluate.js';
import { EvaluationContext } from './core/context.js';
import { toRenderMesh } from './export/mesh.js';

/**
 * Compiles source and evaluates one model into renderable parts.
 *
 * The caller owns the returned `context` and must dispose it: it holds the WASM objects for
 * every node in the tree, and those are not garbage-collected. Passing the same context back
 * on the next call is the intended use — that is what lets the digest cache skip the subtrees
 * an edit did not change. Call `context.collect(parts.map(p => p.node))` afterwards to bound
 * how much a reused context holds.
 *
 * @param {string} source The document.
 * @param {RenderOptions} [options] Which model, what parameters, a context to reuse, and the
 *   budget and signal that bound the build.
 * @returns {Promise<RenderResult>} The parts, with both kernel objects and meshes.
 * @throws {Error} On any syntax, evaluation or geometry failure, on a document that exceeds
 *   `maxNodes`, or with the signal's reason if the caller aborted. A context created here is
 *   disposed before the error propagates; one the caller supplied is left alone, since the
 *   caller may still want it.
 */
export async function render(source, options = {}) {
  const { model = null, params = {}, context = null, maxNodes = null, signal = null } = options;

  const started = Date.now();
  const program = Program.parse(source);
  const owned = context ?? await EvaluationContext.create();
  const evaluator = new Evaluator(program, { params, context: owned, maxNodes, signal });

  try {
    const scene = await evaluator.model(model);

    /** @type {RenderedPart[]} */
    const parts = [];
    for (const part of scene.parts) {
      // Between parts as well as inside the evaluator: solving is where the time actually
      // goes, so a caller that gave up during the first part should not pay for the rest.
      signal?.throwIfAborted();

      // Checked before solving rather than after: a 2D part is going to be refused either
      // way, and there is no reason to spend the kernel call first.
      if (part.node.dim !== 3) {
        throw new Error(`part "${part.name}" is 2D — extrude or revolve it before rendering`);
      }
      // The check above is what makes this a solid rather than a cross-section.
      const concrete = /** @type {Solid} */ (await owned.evaluate(part.node));
      parts.push({ ...part, concrete, mesh: toRenderMesh(concrete) });
    }

    return {
      name: scene.name,
      parts,
      program,
      context: owned,
      stats: {
        nodes: scene.node.subtreeSize,
        evaluated: owned.stats.evaluated,
        cacheHits: owned.stats.hits,
        milliseconds: Date.now() - started,
      },
    };
  } catch (error) {
    if (!context) owned.dispose();
    throw error;
  }
}

/**
 * The parameters a document declares, with their metadata, for building editor controls.
 *
 * Params are read leniently: a document that declares a param with no default has to be
 * describable before anyone could have supplied one, or there is no way to build the control
 * that would supply it.
 *
 * @param {string} source The document.
 * @returns {ParameterDescriptor[]} One descriptor per declared param, in source order.
 * @throws {Error} If the document does not parse, or a param default cannot be evaluated.
 */
export function describeParameters(source) {
  const program = Program.parse(source);
  const evaluator = new Evaluator(program, { requireParams: false });

  return program.parameterDescriptors((expression) => {
    try {
      return evaluator.expression(expression, evaluator.root);
    } catch {
      // One unreadable attribute — a min that refers to a param with no value yet — must
      // not cost the caller every other descriptor in the document.
      return undefined;
    }
  });
}

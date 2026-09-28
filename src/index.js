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

/// Compiles source and evaluates one model into renderable parts.
///
/// The caller owns the returned `context` and must dispose it: it holds the WASM objects
/// for every node in the tree, and those are not garbage-collected.
export async function render(source, { model = null, params = {}, context = null } = {}) {
  const started = Date.now();
  const program = Program.parse(source);
  const owned = context ?? await EvaluationContext.create();
  const evaluator = new Evaluator(program, { params, context: owned });

  try {
    const scene = await evaluator.model(model);
    const parts = [];
    for (const part of scene.parts) {
      const concrete = await owned.evaluate(part.node);
      if (part.node.dim !== 3) {
        throw new Error(`part "${part.name}" is 2D — extrude or revolve it before rendering`);
      }
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

/// The parameters a document declares, with their metadata, for building editor controls.
export function describeParameters(source) {
  const program = Program.parse(source);
  const evaluator = new Evaluator(program, {});
  return program.parameterDescriptors((expression) => evaluator.expression(expression, evaluator.root));
}

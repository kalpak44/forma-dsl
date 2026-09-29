/**
 * Compile-time exercise of the published declarations.
 *
 * Declarations that are never used compile fine and still describe the wrong API, so this
 * calls every exported entry point the way a consumer would and pins the result types.
 * `npm run typecheck` fails if src/index.d.ts and the real surface drift apart.
 *
 * Nothing here runs: it is checked by tsc and skipped by the test runner, which only picks
 * up JavaScript.
 */

import {
  BLOCKS,
  CONSTANTS,
  EvaluationContext,
  Evaluator,
  FormaError,
  FUNCTIONS,
  GeometryNode,
  Program,
  Angle,
  Transform,
  Vector,
  describeParameters,
  loadKernel,
  parse,
  render,
  resetQuality,
  setQuality,
  toBinarySTL,
  toRenderMesh,
  tokenize,
  type ParameterDescriptor,
  type RenderResult,
  type Scene,
  type Solid,
} from '../src/index.js';

const SOURCE = 'param h = 10\nmodel "m" { box { size = [1, 2, var.h] } }';

async function renders(): Promise<void> {
  const context: EvaluationContext = await EvaluationContext.create();
  const result: RenderResult = await render(SOURCE, {
    model: 'm',
    params: { h: 12, label: 'top', flag: true, size: [1, 2, 3] },
    context,
  });

  const names: string[] = result.parts.map((part) => part.name);
  const triangles: number = result.parts.reduce((n, part) => n + part.mesh.triangleCount, 0);
  const elapsed: number = result.stats.milliseconds + result.stats.cacheHits;
  const solid: Solid = result.parts[0].concrete;
  const stl: Uint8Array = toBinarySTL(solid, 'forma-dsl');
  const positions: Float32Array = toRenderMesh(solid).positions;
  const box = solid.boundingBox();
  const reach: number = box.max[0] - box.min[0];

  const freed: number = context.collect(result.parts.map((part) => part.node), { keep: 64 });
  const held: number = context.size;
  const done: boolean = context.disposed;
  context.dispose();

  void [names, triangles, elapsed, stl, positions, reach, freed, held, done];
}

function inspects(): void {
  const descriptors: ParameterDescriptor[] = describeParameters(SOURCE);
  const required: boolean = descriptors[0].required;
  const kind: string = descriptors[0].type;

  const program: Program = Program.parse(SOURCE);
  const evaluator: Evaluator = new Evaluator(program, { requireParams: false });
  const known: boolean = evaluator.root.has('h');
  const models: number = program.models.size + program.components.size + program.locals.length;

  const document = parse(SOURCE);
  const tokens = tokenize(SOURCE);
  const line: number = tokens[0].loc.line;
  const first: string = document.kind;

  void [required, kind, known, models, line, first];
}

async function scenes(program: Program): Promise<Scene> {
  return new Evaluator(program, { params: { h: 3 } }).model('m');
}

function buildsNodes(): GeometryNode {
  const box = GeometryNode.shape(3, 'box', { size: [1, 1, 1], center: true });
  const moved = GeometryNode.transformed(box, Transform.translation([0, 0, 5], 3));
  const spun = GeometryNode.transformed(moved, Transform.rotation3D(Vector.of([0, 0, 90], 3)));
  const cut = GeometryNode.difference([spun, GeometryNode.empty(3)]);
  const digest: string = cut.digest;
  const size: number = cut.subtreeSize;
  void [digest, size];
  return cut;
}

function usesValues(): number {
  const turn = Angle.degrees(90).radians + Angle.of(45).cos + CONSTANTS.pi;
  const length = Vector.of([3, 4], 2).magnitude;
  const cell = Transform.identity(2).concat(Transform.scaling(2, 2)).at(0, 0);
  const blocks: number = Object.keys(BLOCKS).length + Object.keys(FUNCTIONS).length;
  return turn + length + cell + blocks;
}

async function kernel(): Promise<void> {
  await loadKernel({ locateFile: () => '/manifold.wasm' });
  await setQuality({ minAngle: 5, segments: 64 });
  await resetQuality();
}

function reportsErrors(error: unknown): string {
  if (error instanceof FormaError && error.loc) {
    return `${error.message} at ${error.loc.line}:${error.loc.column}`;
  }
  return String(error);
}

void [renders, inspects, scenes, buildsNodes, usesValues, kernel, reportsErrors];

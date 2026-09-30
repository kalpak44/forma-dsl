/**
 * Type declarations for forma-dsl.
 *
 * Handwritten rather than generated: the runtime is plain JavaScript, and the shapes worth
 * publishing are the ones a caller actually touches. Internals that are exported only
 * because a test or the editor reaches for them are typed loosely on purpose.
 */

// --- source positions and errors --------------------------------------------------------

export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

/** Every error the language raises, carrying the position it was raised at when there is one. */
export declare class FormaError extends Error {
  constructor(message: string, loc?: SourceLocation | null);
  readonly name: 'FormaError';
  readonly loc: SourceLocation | null;
}

// --- lexer and parser -------------------------------------------------------------------

export type TokenType = 'ident' | 'number' | 'string' | 'punct' | 'eof';

export interface Token {
  type: TokenType;
  /**
   * The payload, which differs by `type`: a string for `ident` and `punct`, a number for
   * `number`, the parsed runs and splices for `string`, and null for `eof`.
   */
  value: any;
  loc: SourceLocation;
  /** Whether a line break preceded this token; the parser uses it to end an attribute. */
  nlBefore: boolean;
}

export declare function tokenize(source: string): Token[];

/** The untyped AST. Its shape is an implementation detail of the evaluator. */
export interface FormaDocument {
  kind: 'document';
  declarations: unknown[];
}

export declare function parse(source: string): FormaDocument;

// --- the kernel -------------------------------------------------------------------------

// Re-exported from the dependency rather than restated here. A hand-written approximation
// of these drifts the moment manifold-3d changes, and it costs consumers the real
// signatures of everything hanging off `part.concrete`.
import type {
  CrossSection,
  Manifold,
  ManifoldToplevel,
  Mesh,
} from 'manifold-3d';

/** The manifold-3d module, as returned by `loadKernel`. */
export type Kernel = ManifoldToplevel;

/**
 * A live 3D solid owned by an EvaluationContext.
 *
 * WebAssembly objects are not garbage-collected. Anything obtained from a context belongs
 * to that context — do not call `delete()` on it yourself.
 */
export type Solid = Manifold;

/** A live 2D cross-section owned by an EvaluationContext, with the same ownership rule. */
export type Shape = CrossSection;

/** The kernel's indexed triangle mesh, as `Solid.getMesh()` returns it. */
export type IndexedMesh = Mesh;

export declare function loadKernel(options?: { locateFile: () => string }): Promise<Kernel>;

export interface QualityOptions {
  /** Smallest angle, in degrees, between adjacent segments of a curve. */
  minAngle?: number;
  /** Smallest length a curve segment may be shortened to. */
  minEdgeLength?: number;
  /** A fixed segment count, overriding the two limits above. */
  segments?: number;
}

export declare function setQuality(options?: QualityOptions): Promise<void>;
export declare function resetQuality(): Promise<void>;

export declare class Vector {
  constructor(components: readonly number[]);
  static of(value: Vector | number | readonly number[] | Record<string, number>, dimensions: number): Vector;
  static zero(dimensions: number): Vector;
  readonly components: readonly number[];
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly magnitude: number;
  plus(other: Vector | number | readonly number[]): Vector;
  minus(other: Vector | number | readonly number[]): Vector;
  times(other: Vector | number | readonly number[]): Vector;
  dividedBy(other: Vector | number | readonly number[]): Vector;
  negated(): Vector;
  dot(other: Vector | number | readonly number[]): number;
  normalized(): Vector;
  cross(other: Vector | readonly number[]): Vector;
  toArray(): number[];
  toString(): string;
}

/** An angle. Stored in radians; every angle the language reads or writes is in degrees. */
export declare class Angle {
  constructor(radians: number);
  static degrees(value: number): Angle;
  static radians(value: number): Angle;
  static turns(value: number): Angle;
  static of(value: Angle | number): Angle;
  readonly radians: number;
  readonly degrees: number;
  readonly sin: number;
  readonly cos: number;
  readonly tan: number;
  plus(other: Angle | number): Angle;
  minus(other: Angle | number): Angle;
  times(factor: number): Angle;
  toString(): string;
}

export type Dimensionality = 2 | 3;

/** An affine transform, column-major, sized for the kernel: 3x3 in 2D and 4x4 in 3D. */
export declare class Transform {
  constructor(dim: Dimensionality, m: readonly number[]);
  static identity(dim: Dimensionality): Transform;
  static translation(offset: Vector | number | readonly number[], dim: Dimensionality): Transform;
  static scaling(factor: Vector | number | readonly number[], dim: Dimensionality): Transform;
  static rotation2D(angle: Angle | number): Transform;
  static rotation3D(angles: Vector | readonly number[]): Transform;
  static rotation(angles: Vector | number | readonly number[], dim: Dimensionality): Transform;
  static mirroring(normal: Vector | readonly number[], dim: Dimensionality): Transform;
  readonly dim: Dimensionality;
  readonly m: readonly number[];
  readonly order: number;
  at(row: number, col: number): number;
  /** `this ∘ other` — `other` runs first. */
  concat(other: Transform): Transform;
  toArray(): number[];
}

export type BooleanOp = 'union' | 'difference' | 'intersection';

/**
 * An immutable node in the geometry tree, identified by the digest of its content.
 *
 * Two structurally identical subtrees are the same node, which is what lets a component used
 * many times be evaluated once.
 */
export declare class GeometryNode {
  constructor(
    dim: Dimensionality,
    kind: string,
    props?: Record<string, unknown>,
    children?: readonly GeometryNode[],
  );
  static empty(dim: Dimensionality): GeometryNode;
  static boolean(op: BooleanOp, children: readonly GeometryNode[]): GeometryNode;
  static union(children: readonly GeometryNode[]): GeometryNode;
  static difference(children: readonly GeometryNode[]): GeometryNode;
  static intersection(children: readonly GeometryNode[]): GeometryNode;
  static transformed(child: GeometryNode, transform: Transform): GeometryNode;
  static unary(
    kind: string,
    child: GeometryNode,
    props?: Record<string, unknown>,
    dim?: Dimensionality,
  ): GeometryNode;
  static shape(dim: Dimensionality, shape: string, params: Record<string, unknown>): GeometryNode;
  readonly dim: Dimensionality;
  readonly kind: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly GeometryNode[];
  /** 128-bit content digest, as 32 lowercase hex characters. */
  readonly digest: string;
  readonly subtreeSize: number;
  readonly isEmpty: boolean;
  toString(): string;
}

export interface CollectOptions {
  /** How many unreachable entries to keep as an LRU tail. Defaults to 512. */
  keep?: number;
}

export interface ContextStats {
  evaluated: number;
  hits: number;
  freed: number;
}

/**
 * Evaluates a geometry tree against the Manifold kernel, memoized by node digest.
 *
 * A context is meant to outlive a single render — reusing one is what makes a re-render
 * after an edit skip the subtrees that did not change. It owns every WASM object it holds,
 * so it must eventually be `dispose()`d, and `collect()` bounds what it holds meanwhile.
 */
export declare class EvaluationContext {
  static create(): Promise<EvaluationContext>;
  readonly wasm: Kernel;
  /** Number of cached objects currently held. */
  readonly size: number;
  readonly disposed: boolean;
  stats: ContextStats;
  evaluate(node: GeometryNode): Promise<Solid | Shape>;
  /** Frees cached objects the given roots can no longer reach. Returns how many were freed. */
  collect(roots: readonly GeometryNode[], options?: CollectOptions): number;
  dispose(): void;
}

export type ParameterValue = number | string | boolean | ParameterValue[];

export type ParameterType = 'number' | 'string' | 'bool' | 'vector' | 'list' | 'angle';

export interface ParameterDescriptor {
  name: string;
  /** The declared `type`, or one inferred from the default. Falls back to `number`. */
  type: ParameterType | string;
  default: ParameterValue | undefined;
  /** True when the param declares no default, so a value must be supplied to render. */
  required: boolean;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  options?: ParameterValue[];
}

/** A parsed document, indexed by what each declaration is for. */
export declare class Program {
  constructor(document: FormaDocument);
  static parse(source: string): Program;
  readonly params: Map<string, unknown>;
  readonly locals: unknown[];
  readonly components: Map<string, unknown>;
  readonly models: Map<string, unknown>;
  parameterDescriptors(
    evaluator?: ((expression: unknown) => unknown) | null,
  ): ParameterDescriptor[];
}

export interface Scope {
  lookup(name: string): unknown;
  has(name: string): boolean;
  define(name: string, value: unknown): Scope;
  child(values?: Record<string, unknown>): Scope;
}

export interface ScenePart {
  name: string;
  color: string;
  opacity: number;
  node: GeometryNode;
}

export interface Scene {
  name: string;
  parts: ScenePart[];
  /** Every part unioned together. */
  node: GeometryNode;
}

export interface EvaluatorOptions {
  params?: Record<string, ParameterValue>;
  /** Needed only by blocks that measure their child, such as `align`. */
  context?: EvaluationContext | null;
  /** Off lets a document declaring a param with no default still be inspected. */
  requireParams?: boolean;
  /**
   * How many blocks may be built before evaluation gives up. Omitted, there is no limit.
   *
   * Nesting limits and `range` bound one loop each; only this bounds their product. Pass one
   * when building a document you did not write.
   */
  maxNodes?: number | null;
  /** Checked at every block, so a build can be abandoned before it finishes. */
  signal?: AbortSignal | null;
}

export declare class Evaluator {
  constructor(program: Program, options?: EvaluatorOptions);
  readonly program: Program;
  readonly context: EvaluationContext | null;
  readonly root: Scope;
  expression(node: unknown, scope: Scope): unknown;
  model(name?: string | null): Promise<Scene>;
}

/**
 * What a block's `build` receives: the evaluated attributes, read with the type each one is
 * meant to be.
 *
 * Described structurally rather than as the `Args` class, because `Args` is an
 * implementation detail of the block registry and not part of the package's exports.
 */
export interface AttributeReader {
  /** The block's name, used in every error message. */
  readonly type: string;
  /** Where the block was written. */
  readonly loc: SourceLocation;
  /** Tests for an attribute without marking it used. */
  has(name: string): boolean;
  /** Reads an attribute without checking its type. */
  raw(name: string, fallback?: unknown): unknown;
  /** Rejects an attribute, naming what it should have been. */
  fail(name: string, expected: string): never;
  number(name: string, fallback?: number): number;
  optionalNumber(name: string): number | undefined;
  int(name: string, fallback?: number): number;
  bool(name: string, fallback?: boolean): boolean;
  string(name: string, fallback?: string): string;
  enum(name: string, allowed: readonly string[], fallback?: string): string;
  /** A single number is accepted as shorthand for every component. */
  vector(name: string, dim: Dimensionality, fallback?: number | readonly number[]): number[];
  angle(name: string, fallback?: Angle | number): Angle;
  /** Rejects any attribute the block did not read. */
  checkUnused(): void;
}

export interface BlockDefinition {
  /** Output dimensionality, where it is fixed regardless of the children. */
  dim?: Dimensionality;
  /** True for a shape, which takes no children. */
  leaf?: boolean;
  /** What the children must be; `'same'` passes their dimensionality through. */
  takes?: Dimensionality | 'same';
  /** `'list'` receives every child; anything else receives them unioned. */
  combine?: 'list';
  build(args: AttributeReader, children?: any): GeometryNode;
}

export declare const BLOCKS: Record<string, BlockDefinition>;

export interface FunctionDefinition {
  /** `null` for a variadic function. */
  arity: number | null;
  /**
   * Arguments arrive as whatever the model evaluated them to. The language is dynamically
   * typed, so each function checks what it needs and throws otherwise.
   */
  call(args: any[]): unknown;
}

export declare const FUNCTIONS: Record<string, FunctionDefinition>;
export declare const CONSTANTS: Record<string, number>;

export interface RenderMesh {
  /** Three vertices per triangle, expanded so hard edges stay hard. */
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
  /** Vertices before expansion, as the kernel counted them. */
  vertexCount: number;
}

export declare function toRenderMesh(manifold: Solid): RenderMesh;
export declare function toBinarySTL(manifold: Solid, header?: string): Uint8Array;

export interface RenderOptions {
  /** Which model to render. Defaults to the first the document declares. */
  model?: string | null;
  params?: Record<string, ParameterValue>;
  /** Reuse a context to keep its cache across renders. The caller still owns it. */
  context?: EvaluationContext | null;
  /**
   * How many blocks may be built before evaluation gives up. Omitted, there is no limit.
   *
   * Nesting limits and `range` bound one loop each; only this bounds their product, which is
   * what a document nesting two large loops exceeds. Pass one when rendering a document you
   * did not write.
   */
  maxNodes?: number | null;
  /**
   * Abandons the render when it fires, throwing the signal's reason.
   *
   * Checked at every block and between parts, so a superseded render stops before spending
   * kernel time rather than after.
   */
  signal?: AbortSignal | null;
}

export interface RenderedPart extends ScenePart {
  concrete: Solid;
  mesh: RenderMesh;
}

export interface RenderStats {
  nodes: number;
  evaluated: number;
  cacheHits: number;
  milliseconds: number;
}

export interface RenderResult {
  name: string;
  parts: RenderedPart[];
  program: Program;
  /** The context that owns every solid in `parts`. Dispose it when done. */
  context: EvaluationContext;
  stats: RenderStats;
}

/**
 * Compiles source and evaluates one model into renderable parts.
 *
 * The caller owns `result.context` and must dispose it.
 */
export declare function render(source: string, options?: RenderOptions): Promise<RenderResult>;

/** The parameters a document declares, with their metadata, for building editor controls. */
export declare function describeParameters(source: string): ParameterDescriptor[];

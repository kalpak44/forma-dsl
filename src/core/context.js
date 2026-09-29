/** @import { CollectOptions, ContextStats, Kernel, Shape, Solid } from '../index.js' */
/** @import { GeometryNode } from './node.js' */

import { loadKernel } from './kernel.js';

/**
 * How many unreachable entries `collect` keeps.
 *
 * Editing a model churns the tree — a keystroke changes one subtree and leaves its siblings
 * untouched — so the entries that just fell out of the tree are the ones most likely to come
 * straight back, on an undo or on the next character of a number being typed.
 */
const DEFAULT_RETAINED = 512;

/**
 * How each single-child node is solved, once its child has been evaluated.
 *
 * A table rather than eight near-identical switch arms, so adding an operation is one line
 * and the shape of the dispatch cannot drift between them.
 *
 * @type {Record<string, (child: any, props: any, wasm: Kernel) => Solid | Shape>}
 */
const UNARY = {
  transform: (child, p) => child.transform(p.transform.toArray()),
  hull: (child) => child.hull(),
  refine: (child, p) => child.refineToLength(p.edgeLength),
  simplify: (child, p) => child.simplify(p.tolerance),
  smooth: (child, p) => child.smoothOut(p.minSharpAngle, p.minSmoothness),
  trim: (child, p) => child.trimByPlane(p.normal, p.offset),
  offset: (child, p) => child.offset(p.amount, p.joinType, p.miterLimit, p.segments),
  projection: (child, p) => (p.type === 'slice' ? child.slice(p.z) : child.project()),

  // A degenerate extrusion or revolution is an empty solid rather than an error: it falls
  // out of a parameter reaching the end of its range, which a model should survive.
  extrude: (child, p, { Manifold }) => (p.height <= 0
    ? Manifold.cube([0, 0, 0])
    : child.extrude(p.height, p.divisions, p.twist, p.scaleTop, p.center)),
  revolve: (child, p, { Manifold }) => (p.degrees <= 0
    ? Manifold.cube([0, 0, 0])
    : child.revolve(p.segments, p.degrees)),
};

/**
 * Evaluates a geometry tree against the Manifold kernel, memoized by node digest.
 *
 * The cache owns every WASM object it holds. Nothing is freed as evaluation proceeds,
 * because an intermediate result is also a cache entry and a later node may still need it.
 * WASM objects are not garbage-collected, so the two ways out are {@link EvaluationContext#collect}, which
 * frees everything the current tree can no longer reach, and {@link EvaluationContext#dispose}, which frees
 * the lot.
 *
 * A context is meant to outlive a single render. Reusing one across renders is what makes
 * the digest cache worth having: a re-render after an edit re-evaluates only the subtrees
 * whose content actually changed.
 */
export class EvaluationContext {
  /** @type {Map<string, { value: Solid | Shape, used: number }>} Digest to cached object. */
  #cache = new Map();

  /** @type {Map<string, Promise<Solid | Shape>>} Evaluations started but not yet settled. */
  #inFlight = new Map();

  /** @type {Kernel | null} The loaded module; null until `create` resolves. */
  #wasm = null;

  /** @type {number} Monotonic counter standing in for time, to order cache entries by use. */
  #clock = 0;

  /** @type {boolean} Whether `dispose` has run. */
  #disposed = false;

  /** @type {ContextStats} Running totals, for the editor's status line and for tests. */
  stats = { evaluated: 0, hits: 0, freed: 0 };

  /**
   * The only way to build a context, because the kernel loads asynchronously.
   *
   * @returns {Promise<EvaluationContext>} A context with the kernel ready.
   */
  static async create() {
    const context = new EvaluationContext();
    context.#wasm = await loadKernel();
    return context;
  }

  /**
   * @returns {Kernel} The loaded module.
   * @throws {Error} If the context was built without waiting for {@link EvaluationContext.create}.
   */
  get wasm() {
    if (!this.#wasm) throw new Error('EvaluationContext used before create() resolved');
    return this.#wasm;
  }

  /** @returns {number} How many objects the cache currently holds. */
  get size() { return this.#cache.size; }

  /** @returns {boolean} Whether this context has been disposed. */
  get disposed() { return this.#disposed; }

  /**
   * Resolves to the kernel object for a node.
   *
   * Concurrent requests for the same node share one evaluation — without the in-flight map,
   * a shape used twice in a tree that is walked concurrently would be built twice and one
   * copy leaked.
   *
   * @param {GeometryNode} node The node to solve.
   * @returns {Promise<Solid | Shape>} The kernel object, owned by this context.
   * @throws {Error} If the context has been disposed.
   */
  async evaluate(node) {
    if (this.#disposed) throw new Error('EvaluationContext has been disposed');

    const cached = this.#cache.get(node.digest);
    if (cached) {
      this.stats.hits++;
      cached.used = ++this.#clock;
      return cached.value;
    }
    const pending = this.#inFlight.get(node.digest);
    if (pending) {
      this.stats.hits++;
      return pending;
    }

    const promise = this.#evaluateUncached(node).then((result) => {
      this.#inFlight.delete(node.digest);
      // Disposal can land while this was in flight. The result is a live WASM object that
      // nothing will ever look at again, so free it here rather than putting it into a
      // cache that has already been emptied.
      if (this.#disposed) {
        free(result);
        return result;
      }
      this.#cache.set(node.digest, { value: result, used: ++this.#clock });
      this.stats.evaluated++;
      return result;
    }, (error) => {
      this.#inFlight.delete(node.digest);
      throw error;
    });

    this.#inFlight.set(node.digest, promise);
    return promise;
  }

  /**
   * Frees every cached object the given roots can no longer reach, keeping the most
   * recently used `keep` of them as a tail.
   *
   * Called after a render rather than during one: an unreachable entry is only safe to free
   * once nothing holds the object, and mid-render the caller still might.
   *
   * @param {ReadonlyArray<GeometryNode>} roots The trees still in use.
   * @param {CollectOptions} [options] How much of the unreachable tail to keep.
   * @returns {number} How many objects were freed.
   */
  collect(roots, options = {}) {
    const { keep = DEFAULT_RETAINED } = options;
    if (this.#disposed) return 0;

    const reachable = this.#reachableDigests(roots);

    /** @type {Array<[string, number]>} */
    const evictable = [];
    for (const [digest, entry] of this.#cache) {
      // An in-flight digest has no cache entry yet, so nothing here can race one.
      if (!reachable.has(digest)) evictable.push([digest, entry.used]);
    }
    if (evictable.length <= keep) return 0;

    // Most recently used first, so the tail that survives is the tail worth surviving.
    evictable.sort((a, b) => b[1] - a[1]);
    let freed = 0;
    for (const [digest] of evictable.slice(keep)) {
      free(this.#cache.get(digest).value);
      this.#cache.delete(digest);
      freed++;
    }
    this.stats.freed += freed;
    return freed;
  }

  /**
   * Walks the given trees iteratively, so a deeply nested model cannot overflow the stack,
   * and stops at digests already seen, so a shared subtree is visited once.
   *
   * @param {ReadonlyArray<GeometryNode>} roots The trees to walk.
   * @returns {Set<string>} Every digest reachable from the roots.
   */
  #reachableDigests(roots) {
    const reachable = new Set();
    const stack = [...roots];
    while (stack.length) {
      const node = stack.pop();
      if (!node || reachable.has(node.digest)) continue;
      reachable.add(node.digest);
      for (const child of node.children) stack.push(child);
    }
    return reachable;
  }

  /**
   * @param {GeometryNode} node The node whose children to solve.
   * @returns {Promise<Array<Solid | Shape>>} The children, in order, solved concurrently.
   */
  async #children(node) {
    return Promise.all(node.children.map((child) => this.evaluate(child)));
  }

  /**
   * Solves one node, assuming its result is not already cached.
   *
   * @param {GeometryNode} node The node to solve.
   * @returns {Promise<Solid | Shape>} The kernel object.
   * @throws {Error} If the node's kind or boolean operation is not one this can solve.
   */
  async #evaluateUncached(node) {
    const { Manifold, CrossSection } = this.wasm;
    const props = node.props;

    switch (node.kind) {
      case 'empty':
        return node.dim === 2 ? CrossSection.square([0, 0]) : Manifold.cube([0, 0, 0]);

      case 'boolean': {
        const parts = await this.#children(node);
        // Both classes carry the same three statics; the union of two constructors is not
        // callable as one, so the choice is made here rather than duplicating the switch.
        const Concrete = /** @type {any} */ (node.dim === 2 ? CrossSection : Manifold);
        switch (props.op) {
          case 'union': return Concrete.union(parts);
          case 'difference': return Concrete.difference(parts);
          case 'intersection': return Concrete.intersection(parts);
          default: throw new Error(`unknown boolean operation ${props.op}`);
        }
      }

      case 'shape2d':
        return this.#shape2D(props);

      case 'shape3d':
        return this.#shape3D(props);

      default: {
        const solve = UNARY[node.kind];
        if (!solve) throw new Error(`cannot evaluate node kind ${node.kind}`);
        const [child] = await this.#children(node);
        return solve(child, props, this.wasm);
      }
    }
  }

  /**
   * @param {Record<string, any>} props The shape's parameters, including its `shape` name.
   * @returns {Shape} The cross-section.
   * @throws {Error} If the shape name is not one the kernel builds directly.
   */
  #shape2D(props) {
    const { CrossSection } = this.wasm;
    switch (props.shape) {
      case 'rect':
        return CrossSection.square(props.size, props.center);
      case 'circle':
        return CrossSection.circle(props.radius, props.segments);
      case 'polygon':
        return CrossSection.ofPolygons(props.contours, props.fillRule);
      default:
        throw new Error(`unknown 2D shape ${props.shape}`);
    }
  }

  /**
   * @param {Record<string, any>} props The shape's parameters, including its `shape` name.
   * @returns {Solid} The solid.
   * @throws {Error} If the shape name is not one the kernel builds directly.
   */
  #shape3D(props) {
    const { Manifold } = this.wasm;
    switch (props.shape) {
      case 'box':
        return Manifold.cube(props.size, props.center);
      case 'sphere':
        return Manifold.sphere(props.radius, props.segments);
      case 'cylinder':
        return Manifold.cylinder(
          props.height, props.bottomRadius, props.topRadius, props.segments, props.center,
        );
      case 'hull':
        return Manifold.hull(props.points);
      case 'mesh':
        return Manifold.ofMesh(new this.wasm.Mesh(props.mesh));
      default:
        throw new Error(`unknown 3D shape ${props.shape}`);
    }
  }

  /**
   * Frees every WASM object this context has produced.
   *
   * The context cannot be used again; evaluations still in flight free their own results as
   * they land. Disposing twice is harmless.
   *
   * @returns {void}
   */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#cache.values()) free(entry.value);
    this.#cache.clear();
    this.#inFlight.clear();
  }
}

/**
 * Releases a kernel object, tolerating one the kernel has already taken back.
 *
 * @param {{ delete?: () => void } | null | undefined} value The object to free.
 * @returns {void}
 */
function free(value) {
  try {
    value?.delete();
  } catch {
    // Already freed by the kernel, or never owned one — either way there is nothing to do.
  }
}

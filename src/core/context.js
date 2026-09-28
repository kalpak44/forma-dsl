import { loadKernel } from './kernel.js';

/// Evaluates a geometry tree against the Manifold kernel, memoized by node digest.
///
/// The cache owns every WASM object it holds. Nothing is freed as evaluation proceeds,
/// because an intermediate result is also a cache entry and a later node may still need
/// it; `dispose()` frees the lot. WASM objects are not garbage-collected, so a long-lived
/// context that is never disposed is a leak, not just cache growth.
export class EvaluationContext {
  #cache = new Map();
  #inFlight = new Map();
  #wasm = null;

  stats = { evaluated: 0, hits: 0 };

  static async create() {
    const context = new EvaluationContext();
    context.#wasm = await loadKernel();
    return context;
  }

  get wasm() {
    if (!this.#wasm) throw new Error('EvaluationContext used before create() resolved');
    return this.#wasm;
  }

  /// Resolves to the kernel object for a node. Concurrent requests for the same node share
  /// one evaluation — without the in-flight map, a shape used twice in a tree that is
  /// walked concurrently would be built twice and one copy leaked.
  async evaluate(node) {
    const cached = this.#cache.get(node.digest);
    if (cached) {
      this.stats.hits++;
      return cached;
    }
    const pending = this.#inFlight.get(node.digest);
    if (pending) {
      this.stats.hits++;
      return pending;
    }

    const promise = this.#evaluateUncached(node).then((result) => {
      this.#cache.set(node.digest, result);
      this.#inFlight.delete(node.digest);
      this.stats.evaluated++;
      return result;
    }, (error) => {
      this.#inFlight.delete(node.digest);
      throw error;
    });

    this.#inFlight.set(node.digest, promise);
    return promise;
  }

  async #children(node) {
    return Promise.all(node.children.map((child) => this.evaluate(child)));
  }

  async #evaluateUncached(node) {
    const { Manifold, CrossSection } = this.wasm;
    const Concrete = node.dim === 2 ? CrossSection : Manifold;
    const p = node.props;

    switch (node.kind) {
      case 'empty':
        return node.dim === 2 ? CrossSection.square([0, 0]) : Manifold.cube([0, 0, 0]);

      case 'boolean': {
        const parts = await this.#children(node);
        switch (p.op) {
          case 'union': return Concrete.union(parts);
          case 'difference': return Concrete.difference(parts);
          case 'intersection': return Concrete.intersection(parts);
          default: throw new Error(`unknown boolean operation ${p.op}`);
        }
      }

      case 'transform': {
        const [child] = await this.#children(node);
        return child.transform(p.transform.toArray());
      }

      case 'hull': {
        const [child] = await this.#children(node);
        return child.hull();
      }

      case 'refine': {
        const [child] = await this.#children(node);
        return child.refineToLength(p.edgeLength);
      }

      case 'simplify': {
        const [child] = await this.#children(node);
        return child.simplify(p.tolerance);
      }

      case 'smooth': {
        const [child] = await this.#children(node);
        return child.smoothOut(p.minSharpAngle, p.minSmoothness);
      }

      case 'trim': {
        const [child] = await this.#children(node);
        return child.trimByPlane(p.normal, p.offset);
      }

      case 'offset': {
        const [child] = await this.#children(node);
        return child.offset(p.amount, p.joinType, p.miterLimit, p.segments);
      }

      case 'projection': {
        const [child] = await this.#children(node);
        return p.type === 'slice' ? child.slice(p.z) : child.project();
      }

      case 'extrude': {
        const [child] = await this.#children(node);
        if (p.height <= 0) return Manifold.cube([0, 0, 0]);
        return child.extrude(p.height, p.divisions, p.twist, p.scaleTop, p.center);
      }

      case 'revolve': {
        const [child] = await this.#children(node);
        if (p.degrees <= 0) return Manifold.cube([0, 0, 0]);
        return child.revolve(p.segments, p.degrees);
      }

      case 'shape2d':
        return this.#shape2D(p);

      case 'shape3d':
        return this.#shape3D(p);

      default:
        throw new Error(`cannot evaluate node kind ${node.kind}`);
    }
  }

  #shape2D(p) {
    const { CrossSection } = this.wasm;
    switch (p.shape) {
      case 'rect':
        return CrossSection.square(p.size, p.center);
      case 'circle':
        return CrossSection.circle(p.radius, p.segments);
      case 'polygon':
        return CrossSection.ofPolygons(p.contours, p.fillRule);
      default:
        throw new Error(`unknown 2D shape ${p.shape}`);
    }
  }

  #shape3D(p) {
    const { Manifold } = this.wasm;
    switch (p.shape) {
      case 'box':
        return Manifold.cube(p.size, p.center);
      case 'sphere':
        return Manifold.sphere(p.radius, p.segments);
      case 'cylinder':
        return Manifold.cylinder(p.height, p.bottomRadius, p.topRadius, p.segments, p.center);
      case 'hull':
        return Manifold.hull(p.points);
      case 'mesh':
        return Manifold.ofMesh(new this.wasm.Mesh(p.mesh));
      default:
        throw new Error(`unknown 3D shape ${p.shape}`);
    }
  }

  /// Frees every WASM object this context has produced.
  dispose() {
    for (const value of this.#cache.values()) {
      try { value.delete(); } catch { /* already freed by the kernel */ }
    }
    this.#cache.clear();
    this.#inFlight.clear();
  }
}

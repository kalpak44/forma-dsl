/** @import { BooleanOp, Dimensionality } from '../index.js' */

import { DigestWriter } from './digest.js';
import { Transform } from '../values/transform.js';

/**
 * Orders strings by UTF-16 code unit, which is what a bare `sort()` does.
 *
 * Written out rather than left implicit — and deliberately *not* `localeCompare`, which is
 * what a linter will suggest. Collation is locale-dependent, and this ordering feeds the
 * digest: two machines with different locales would have to agree, or the cache would miss
 * across them and a model would re-solve from scratch on someone else's laptop.
 *
 * @param {string} a The left string.
 * @param {string} b The right string.
 * @returns {number} Negative, zero or positive, as `sort` wants.
 */
function byCodeUnit(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Canonically encodes an attribute value into the digest.
 *
 * Object keys are sorted, so two nodes built from the same attributes in a different source
 * order share a digest and therefore a cache entry. Each branch writes a distinct tag byte
 * first, so a string `"1"` and a number `1` cannot encode alike.
 *
 * @param {DigestWriter} writer The writer to append to.
 * @param {unknown} value The value to encode.
 * @returns {void}
 */
function writeValue(writer, value) {
  if (value === null || value === undefined) {
    writer.string('nil');
  } else if (typeof value === 'number') {
    writer.string('n').number(value);
  } else if (typeof value === 'boolean') {
    writer.string('b').bool(value);
  } else if (typeof value === 'string') {
    writer.string('s').string(value);
  } else if (Array.isArray(value)) {
    writer.string('a').int(value.length);
    for (const item of value) writeValue(writer, item);
  } else if (value instanceof Transform) {
    writer.string('t').numbers(value.toArray());
  } else {
    const keys = Object.keys(value).sort(byCodeUnit);
    writer.string('o').int(keys.length);
    for (const key of keys) {
      writer.string(key);
      writeValue(writer, value[key]);
    }
  }
}

/**
 * An immutable node in the geometry tree, identified by its content.
 *
 * Identity is digest identity: two structurally identical subtrees are the same node, so a
 * model that uses one component twenty times evaluates it once. The digest is computed in
 * the constructor from the children's digests, never from a live walk of the subtree.
 */
export class GeometryNode {
  /**
   * Prefer the factories below, which apply the algebraic simplifications; this is the raw
   * constructor they all end at.
   *
   * @param {Dimensionality} dim Whether this node is 2D or 3D.
   * @param {string} kind What the node does, such as `boolean` or `extrude`.
   * @param {Record<string, unknown>} [props] The node's own parameters.
   * @param {ReadonlyArray<GeometryNode>} [children] The operands.
   * @throws {TypeError} If `dim` is neither 2 nor 3.
   */
  constructor(dim, kind, props = {}, children = []) {
    if (dim !== 2 && dim !== 3) throw new TypeError(`bad dimensionality ${dim}`);

    /** @type {Dimensionality} Whether this node is 2D or 3D. */
    this.dim = dim;
    /** @type {string} What the node does. */
    this.kind = kind;
    /** @type {Record<string, unknown>} The node's own parameters. */
    this.props = props;
    /** @type {ReadonlyArray<GeometryNode>} The operands. */
    this.children = children;

    const writer = new DigestWriter().int(dim).string(kind);
    writeValue(writer, props);
    writer.int(children.length);
    for (const child of children) writer.digest(child.digest).int(child.dim);

    /** @type {string} The 128-bit content digest, as 32 lowercase hex characters. */
    this.digest = writer.finish();

    /** @type {number} How many nodes this subtree contains, counting itself. */
    this.subtreeSize = 1 + children.reduce((n, c) => n + c.subtreeSize, 0);

    Object.freeze(this);
  }

  /** @returns {boolean} Whether this node stands for no geometry at all. */
  get isEmpty() { return this.kind === 'empty'; }

  /**
   * @param {Dimensionality} dim Whether the empty node is 2D or 3D.
   * @returns {GeometryNode} A node standing for no geometry.
   */
  static empty(dim) { return new GeometryNode(dim, 'empty'); }

  /**
   * Combines children with a boolean operation, dropping empties and collapsing the
   * one-child case to that child.
   *
   * Union members are ordered by subtree size so that two unions written in a different
   * order still share a digest. Difference is not reordered: its first child is the one
   * everything else is cut from.
   *
   * @param {BooleanOp} op Which operation to apply.
   * @param {ReadonlyArray<GeometryNode>} children The operands.
   * @returns {GeometryNode} The combined node.
   * @throws {TypeError} If the surviving children are not all the same dimensionality.
   */
  static boolean(op, children) {
    const live = children.filter((c) => !c.isEmpty);
    if (live.length === 0) return GeometryNode.empty(children[0]?.dim ?? 3);
    if (live.length === 1) return live[0];
    const dim = live[0].dim;
    if (live.some((c) => c.dim !== dim)) {
      throw new TypeError(`cannot combine 2D and 3D geometry in a ${op}`);
    }
    const ordered = op === 'union'
      ? [...live].sort((a, b) => a.subtreeSize - b.subtreeSize || byCodeUnit(a.digest, b.digest))
      : live;
    return new GeometryNode(dim, 'boolean', { op }, ordered);
  }

  /**
   * @param {ReadonlyArray<GeometryNode>} children The operands.
   * @returns {GeometryNode} Everything added together.
   */
  static union(children) { return GeometryNode.boolean('union', children); }

  /**
   * @param {ReadonlyArray<GeometryNode>} children The first operand, then what to cut from it.
   * @returns {GeometryNode} The first child with the rest removed.
   */
  static difference(children) { return GeometryNode.boolean('difference', children); }

  /**
   * @param {ReadonlyArray<GeometryNode>} children The operands.
   * @returns {GeometryNode} Only what every child shares.
   */
  static intersection(children) { return GeometryNode.boolean('intersection', children); }

  /**
   * Applies a transform, collapsing a transform applied to a transform into a single matrix.
   *
   * A deep chain of translate blocks would otherwise be one kernel call and one cache entry
   * per level.
   *
   * @param {GeometryNode} child What to transform.
   * @param {Transform} transform The transform to apply.
   * @returns {GeometryNode} The transformed node.
   */
  static transformed(child, transform) {
    if (child.isEmpty) return child;
    if (child.kind === 'transform') {
      return new GeometryNode(child.dim, 'transform',
        { transform: transform.concat(/** @type {Transform} */ (child.props.transform)) }, child.children);
    }
    return new GeometryNode(child.dim, 'transform', { transform }, [child]);
  }

  /**
   * Wraps a single child, short-circuiting on empty geometry.
   *
   * @param {string} kind What the node does.
   * @param {GeometryNode} child The operand.
   * @param {Record<string, unknown>} [props] The operation's parameters.
   * @param {Dimensionality} [dim] The result's dimensionality; defaults to the child's,
   *   which is wrong only for the operations that change it, such as `extrude`.
   * @returns {GeometryNode} The wrapped node.
   */
  static unary(kind, child, props = {}, dim = child.dim) {
    if (child.isEmpty) return GeometryNode.empty(dim);
    return new GeometryNode(dim, kind, props, [child]);
  }

  /**
   * @param {Dimensionality} dim Whether the shape is 2D or 3D.
   * @param {string} shape Which primitive, such as `box` or `circle`.
   * @param {Record<string, unknown>} params The primitive's parameters.
   * @returns {GeometryNode} A leaf node.
   */
  static shape(dim, shape, params) {
    return new GeometryNode(dim, dim === 2 ? 'shape2d' : 'shape3d', { shape, ...params });
  }

  /** @returns {string} A short identification, for diagnostics. */
  toString() {
    return `${this.kind}<${this.dim}D>#${this.digest.slice(0, 8)}`;
  }
}

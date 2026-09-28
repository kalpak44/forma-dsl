import { DigestWriter } from './digest.js';
import { Transform } from '../values/transform.js';

/// Canonically encodes an attribute value into the digest.
///
/// Object keys are sorted, so two nodes built from the same attributes in a different
/// source order share a digest and therefore a cache entry.
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
    const keys = Object.keys(value).sort();
    writer.string('o').int(keys.length);
    for (const key of keys) {
      writer.string(key);
      writeValue(writer, value[key]);
    }
  }
}

/// An immutable node in the geometry tree, identified by its content.
///
/// Identity is digest identity: two structurally identical subtrees are the same node, so
/// a model that uses one component twenty times evaluates it once. The digest is computed
/// in the constructor from the children's digests, never from a live walk of the subtree.
export class GeometryNode {
  constructor(dim, kind, props = {}, children = []) {
    if (dim !== 2 && dim !== 3) throw new TypeError(`bad dimensionality ${dim}`);
    this.dim = dim;
    this.kind = kind;
    this.props = props;
    this.children = children;

    const writer = new DigestWriter().int(dim).string(kind);
    writeValue(writer, props);
    writer.int(children.length);
    for (const child of children) writer.digest(child.digest).int(child.dim);
    this.digest = writer.finish();

    this.subtreeSize = 1 + children.reduce((n, c) => n + c.subtreeSize, 0);
    Object.freeze(this);
  }

  get isEmpty() { return this.kind === 'empty'; }

  static empty(dim) { return new GeometryNode(dim, 'empty'); }

  /// Union members are ordered by subtree size so that two unions written in a different
  /// order still share a digest. Difference is not reordered: its first child is the one
  /// everything else is cut from.
  static boolean(op, children) {
    const live = children.filter((c) => !c.isEmpty);
    if (live.length === 0) return GeometryNode.empty(children[0]?.dim ?? 3);
    if (live.length === 1) return live[0];
    const dim = live[0].dim;
    if (live.some((c) => c.dim !== dim)) {
      throw new TypeError(`cannot combine 2D and 3D geometry in a ${op}`);
    }
    const ordered = op === 'union'
      ? [...live].sort((a, b) => a.subtreeSize - b.subtreeSize || a.digest.localeCompare(b.digest))
      : live;
    return new GeometryNode(dim, 'boolean', { op }, ordered);
  }

  static union(children) { return GeometryNode.boolean('union', children); }
  static difference(children) { return GeometryNode.boolean('difference', children); }
  static intersection(children) { return GeometryNode.boolean('intersection', children); }

  /// Collapses a transform applied to a transform into a single matrix. A deep chain of
  /// translate blocks would otherwise be one kernel call and one cache entry per level.
  static transformed(child, transform) {
    if (child.isEmpty) return child;
    if (child.kind === 'transform') {
      return new GeometryNode(child.dim, 'transform',
        { transform: transform.concat(child.props.transform) }, child.children);
    }
    return new GeometryNode(child.dim, 'transform', { transform }, [child]);
  }

  static unary(kind, child, props = {}, dim = child.dim) {
    if (child.isEmpty) return GeometryNode.empty(dim);
    return new GeometryNode(dim, kind, props, [child]);
  }

  static shape(dim, shape, params) {
    return new GeometryNode(dim, dim === 2 ? 'shape2d' : 'shape3d', { shape, ...params });
  }

  toString() {
    return `${this.kind}<${this.dim}D>#${this.digest.slice(0, 8)}`;
  }
}

import { parse } from './parser.js';
import { FormaError } from './lexer.js';
import { BLOCKS, FUNCTIONS, CONSTANTS, TYPE_NAMES, Args } from './builtins.js';
import { GeometryNode } from '../core/node.js';
import { Transform } from '../values/transform.js';

class Scope {
  constructor(parent = null, values = {}) {
    this.parent = parent;
    this.values = new Map(Object.entries(values));
  }

  lookup(name) {
    for (let s = this; s; s = s.parent) {
      if (s.values.has(name)) return s.values.get(name);
    }
    return undefined;
  }

  has(name) {
    for (let s = this; s; s = s.parent) if (s.values.has(name)) return true;
    return false;
  }

  define(name, value) { this.values.set(name, value); return this; }
  child(values = {}) { return new Scope(this, values); }
}

/// A parsed document, indexed by what each declaration is for.
export class Program {
  constructor(document) {
    this.params = new Map();
    this.locals = [];
    this.components = new Map();
    this.models = new Map();

    for (const declaration of document.declarations) {
      switch (declaration.kind) {
        case 'param': {
          if (this.params.has(declaration.name)) {
            throw new FormaError(`param "${declaration.name}" is declared twice`, declaration.loc);
          }
          this.params.set(declaration.name, declaration);
          break;
        }
        case 'local': this.locals.push(declaration); break;
        case 'component': {
          if (this.components.has(declaration.name)) {
            throw new FormaError(`component "${declaration.name}" is declared twice`, declaration.loc);
          }
          if (BLOCKS[declaration.name]) {
            throw new FormaError(`component "${declaration.name}" shadows a builtin block`, declaration.loc);
          }
          this.components.set(declaration.name, declaration);
          break;
        }
        case 'model': {
          if (this.models.has(declaration.name)) {
            throw new FormaError(`model "${declaration.name}" is declared twice`, declaration.loc);
          }
          this.models.set(declaration.name, declaration);
          break;
        }
        default: throw new FormaError(`unexpected declaration ${declaration.kind}`, declaration.loc);
      }
    }
  }

  static parse(source) { return new Program(parse(source)); }

  /// The declared parameters, in source order, as the editor needs them to build controls.
  parameterDescriptors(evaluator = null) {
    return [...this.params.values()].map((declaration) => {
      const meta = {};
      for (const attribute of declaration.attributes) {
        meta[attribute.name] = evaluator ? evaluator(attribute.value) : undefined;
      }
      return {
        name: declaration.name,
        type: meta.type ?? (typeof meta.default === 'number' ? 'number' : typeof meta.default),
        default: meta.default,
        min: meta.min, max: meta.max, step: meta.step,
        description: meta.description,
        options: meta.options,
      };
    });
  }
}

const MAX_DEPTH = 64;

export class Evaluator {
  /// `context` is an EvaluationContext. It is needed only by blocks that measure their
  /// child — `align` has to know where the geometry actually is — so a program without one
  /// can still be built into a node tree without loading the kernel.
  constructor(program, { params = {}, context = null } = {}) {
    this.program = program;
    this.context = context;
    this.depth = 0;

    const root = new Scope();
    // Constants and type names are in scope before any param default is read, so a default
    // can use `pi` and a `type = number` attribute resolves.
    for (const [name, value] of Object.entries(CONSTANTS)) root.define(name, value);
    for (const name of TYPE_NAMES) root.define(name, name);

    const variables = {};
    for (const [name, declaration] of program.params) {
      const supplied = params[name];
      const fallback = declaration.attributes.find((a) => a.name === 'default');
      const value = supplied !== undefined
        ? supplied
        : fallback
          ? this.expression(fallback.value, root)
          : undefined;
      if (value === undefined) {
        throw new FormaError(`param "${name}" has no default and no value was supplied`, declaration.loc);
      }
      variables[name] = value;
      root.define(name, value);
    }
    root.define('var', variables);
    for (const local of program.locals) root.define(local.name, this.expression(local.value, root));
    this.root = root;
  }

  // --- expressions ----------------------------------------------------------------

  expression(node, scope) {
    switch (node.kind) {
      case 'literal': return node.value;

      case 'template':
        return node.parts
          .map((part) => (part.kind === 'text' ? part.value : formatValue(this.expression(part.expression, scope))))
          .join('');

      case 'array': return node.items.map((item) => this.expression(item, scope));

      case 'object': {
        const out = {};
        for (const entry of node.entries) out[entry.key] = this.expression(entry.value, scope);
        return out;
      }

      case 'identifier': {
        if (!scope.has(node.name)) {
          throw new FormaError(`unknown name "${node.name}"`, node.loc);
        }
        return scope.lookup(node.name);
      }

      case 'member': {
        const object = this.expression(node.object, scope);
        if (object === null || object === undefined) {
          throw new FormaError(`cannot read "${node.property}" of nothing`, node.loc);
        }
        // Vectors are plain arrays, so .x/.y/.z is sugar over an index rather than a type.
        const axis = { x: 0, y: 1, z: 2 }[node.property];
        if (Array.isArray(object) && axis !== undefined) return object[axis];
        if (!(node.property in object)) {
          throw new FormaError(`no attribute "${node.property}"`, node.loc);
        }
        return object[node.property];
      }

      case 'index': {
        const object = this.expression(node.object, scope);
        const index = this.expression(node.index, scope);
        if (!Array.isArray(object) && typeof object !== 'string' && typeof object !== 'object') {
          throw new FormaError('cannot index this value', node.loc);
        }
        return object[index];
      }

      case 'unary': {
        const value = this.expression(node.operand, scope);
        if (node.op === '-') {
          if (typeof value !== 'number') throw new FormaError('cannot negate a non-number', node.loc);
          return -value;
        }
        return !truthy(value);
      }

      case 'binary': return this.binary(node, scope);

      case 'conditional':
        return truthy(this.expression(node.condition, scope))
          ? this.expression(node.then, scope)
          : this.expression(node.otherwise, scope);

      case 'call': {
        if (node.callee.kind !== 'identifier') {
          throw new FormaError('only named functions can be called', node.loc);
        }
        const fn = FUNCTIONS[node.callee.name];
        if (!fn) throw new FormaError(`unknown function "${node.callee.name}"`, node.loc);
        if (node.args.some((a) => a.name)) {
          throw new FormaError(`${node.callee.name}: functions take positional arguments`, node.loc);
        }
        const args = node.args.map((a) => this.expression(a.value, scope));
        if (fn.arity !== null && args.length !== fn.arity) {
          throw new FormaError(`${node.callee.name} takes ${fn.arity} argument(s), got ${args.length}`, node.loc);
        }
        try {
          return fn.call(args);
        } catch (error) {
          throw error instanceof FormaError ? error : new FormaError(`${node.callee.name}: ${error.message}`, node.loc);
        }
      }

      default:
        throw new FormaError(`cannot evaluate ${node.kind}`, node.loc);
    }
  }

  binary(node, scope) {
    const { op } = node;
    // Short-circuit before evaluating the right side, so `count > 0 && list[0] > 1` is safe.
    if (op === '&&') {
      return truthy(this.expression(node.left, scope)) ? truthy(this.expression(node.right, scope)) : false;
    }
    if (op === '||') {
      return truthy(this.expression(node.left, scope)) ? true : truthy(this.expression(node.right, scope));
    }

    const left = this.expression(node.left, scope);
    const right = this.expression(node.right, scope);

    switch (op) {
      case '==': return deepEqual(left, right);
      case '!=': return !deepEqual(left, right);
      case '+':
        if (typeof left === 'string' || typeof right === 'string') return formatValue(left) + formatValue(right);
        if (Array.isArray(left) && Array.isArray(right)) return zip(left, right, (a, b) => a + b, node.loc);
        return arithmetic(op, left, right, node.loc);
      case '-':
        if (Array.isArray(left) && Array.isArray(right)) return zip(left, right, (a, b) => a - b, node.loc);
        return arithmetic(op, left, right, node.loc);
      case '*':
        // A vector times a scalar is the common case in a model; both orders read naturally.
        if (Array.isArray(left) && typeof right === 'number') return left.map((v) => v * right);
        if (typeof left === 'number' && Array.isArray(right)) return right.map((v) => v * left);
        if (Array.isArray(left) && Array.isArray(right)) return zip(left, right, (a, b) => a * b, node.loc);
        return arithmetic(op, left, right, node.loc);
      case '/':
        if (Array.isArray(left) && typeof right === 'number') return left.map((v) => v / right);
        return arithmetic(op, left, right, node.loc);
      case '%': return arithmetic(op, left, right, node.loc);
      case '<': case '<=': case '>': case '>=': return compare(op, left, right, node.loc);
      default: throw new FormaError(`unknown operator ${op}`, node.loc);
    }
  }

  // --- geometry -------------------------------------------------------------------

  /// Builds a body into a list of geometry nodes and any scene parts it declared.
  async body(body, scope) {
    const inner = scope.child();
    for (const local of body.locals) inner.define(local.name, this.expression(local.value, inner));

    const nodes = [];
    const parts = [];

    for (const block of body.blocks) {
      const produced = await this.block(block, inner);
      nodes.push(...produced.nodes);
      parts.push(...produced.parts);
    }

    return { nodes, parts };
  }

  async block(block, scope) {
    if (this.depth > MAX_DEPTH) {
      throw new FormaError(`nesting deeper than ${MAX_DEPTH} blocks — is a component using itself?`, block.loc);
    }

    if (block.kind === 'for') return this.forBlock(block, scope);
    if (block.kind === 'if') {
      const taken = truthy(this.expression(block.condition, scope)) ? block.then : block.otherwise;
      return taken ? this.body(taken, scope) : { nodes: [], parts: [] };
    }

    if (block.type === 'part') return this.partBlock(block, scope);
    if (block.type === 'align') return { nodes: [await this.alignBlock(block, scope)], parts: [] };

    if (this.program.components.has(block.type)) {
      return { nodes: [await this.component(block, scope)], parts: [] };
    }

    const definition = BLOCKS[block.type];
    if (!definition) {
      throw new FormaError(`unknown block "${block.type}"`, block.loc);
    }
    if (block.labels.length) {
      throw new FormaError(`"${block.type}" does not take a label`, block.loc);
    }

    const args = new Args(block.type, this.attributes(block.body, scope), block.loc);
    const { nodes: children } = await this.body(block.body, scope.child());

    if (definition.leaf) {
      if (children.length) throw new FormaError(`"${block.type}" is a shape and cannot contain other blocks`, block.loc);
      const node = definition.build(args);
      args.checkUnused();
      return { nodes: [node], parts: [] };
    }

    if (!children.length) {
      throw new FormaError(`"${block.type}" needs at least one shape inside it`, block.loc);
    }
    this.checkDimensions(block, definition, children);

    // Every operation but a boolean takes a single child; several blocks inside one are
    // implicitly unioned first, so `translate { a  b }` moves both together.
    const node = definition.combine === 'list'
      ? definition.build(args, children)
      : definition.build(args, GeometryNode.union(children));
    args.checkUnused();
    return { nodes: [node], parts: [] };
  }

  checkDimensions(block, definition, children) {
    const dims = new Set(children.map((c) => c.dim));
    if (dims.size > 1) {
      throw new FormaError(`"${block.type}" cannot mix 2D and 3D shapes`, block.loc);
    }
    const [dim] = dims;
    if (typeof definition.takes === 'number' && definition.takes !== dim) {
      throw new FormaError(`"${block.type}" takes ${definition.takes}D geometry, got ${dim}D`, block.loc);
    }
  }

  attributes(body, scope) {
    const values = {};
    for (const attribute of body.attributes) {
      if (attribute.name in values) {
        throw new FormaError(`attribute "${attribute.name}" is set twice`, attribute.loc);
      }
      values[attribute.name] = this.expression(attribute.value, scope);
    }
    return values;
  }

  async forBlock(block, scope) {
    const sequence = this.expression(block.sequence, scope);
    if (!Array.isArray(sequence)) {
      throw new FormaError('for: expected a list to iterate', block.loc);
    }
    const nodes = [];
    const parts = [];
    for (const [index, item] of sequence.entries()) {
      const iteration = scope.child();
      iteration.define(block.names[0], block.names.length > 1 ? index : item);
      if (block.names.length > 1) iteration.define(block.names[1], item);
      const produced = await this.body(block.body, iteration);
      nodes.push(...produced.nodes);
      parts.push(...produced.parts);
    }
    return { nodes, parts };
  }

  async partBlock(block, scope) {
    const args = new Args('part', this.attributes(block.body, scope), block.loc);
    const { nodes, parts } = await this.body(block.body, scope.child());
    if (parts.length) throw new FormaError('a part cannot contain another part', block.loc);
    if (!nodes.length) throw new FormaError('a part needs at least one shape inside it', block.loc);
    const part = {
      name: block.labels.length
        ? String(this.expression(block.labels[0], scope))
        : `part_${block.loc.line}`,
      color: args.string('color', '#b8c4d0'),
      opacity: args.number('opacity', 1),
      node: GeometryNode.union(nodes),
    };
    args.checkUnused();
    return { nodes: [], parts: [part] };
  }

  /// Moves geometry so a chosen feature of its bounding box lands on a chosen coordinate.
  ///
  /// This is the one block that has to evaluate its child before it can build its own node,
  /// because where the geometry is cannot be read off the tree.
  async alignBlock(block, scope) {
    if (!this.context) {
      throw new FormaError('align needs a kernel context — render the model rather than building it', block.loc);
    }
    const args = new Args('align', this.attributes(block.body, scope), block.loc);
    const { nodes: children } = await this.body(block.body, scope.child());
    if (!children.length) throw new FormaError('align needs at least one shape inside it', block.loc);

    const child = GeometryNode.union(children);
    const bounds = await this.bounds(child);
    const axes = child.dim === 2 ? ['x', 'y'] : ['x', 'y', 'z'];
    const offset = axes.map((axis, i) => {
      if (!args.has(axis)) return 0;
      const target = args.raw(axis);
      const [min, max] = [bounds.min[i], bounds.max[i]];
      if (typeof target === 'number') return target - min;
      switch (target) {
        case 'min': return -min;
        case 'center': return -(min + max) / 2;
        case 'max': return -max;
        default: throw new FormaError(`align: "${axis}" must be "min", "center", "max" or a number`, block.loc);
      }
    });
    args.checkUnused();
    return GeometryNode.transformed(child, Transform.translation(offset, child.dim));
  }

  async bounds(node) {
    const concrete = await this.context.evaluate(node);
    if (node.dim === 2) {
      const rect = concrete.bounds();
      return { min: rect.min, max: rect.max };
    }
    const box = concrete.boundingBox();
    return { min: box.min, max: box.max };
  }

  async component(block, scope) {
    const declaration = this.program.components.get(block.type);
    const supplied = this.attributes(block.body, scope);

    // A component gets a fresh scope rooted at the document, not at the call site: a name
    // that happens to exist where it is used must not leak into its body.
    const inner = this.root.child();
    const declared = new Set();
    for (const param of declaration.body.params) {
      declared.add(param.name);
      const fallback = param.attributes.find((a) => a.name === 'default');
      const value = supplied[param.name] !== undefined
        ? supplied[param.name]
        : fallback
          ? this.expression(fallback.value, inner)
          : undefined;
      if (value === undefined) {
        throw new FormaError(`${block.type}: "${param.name}" has no default and was not given`, block.loc);
      }
      inner.define(param.name, value);
    }

    const unknown = Object.keys(supplied).filter((k) => !declared.has(k));
    if (unknown.length) {
      throw new FormaError(`${block.type}: unknown param${unknown.length > 1 ? 's' : ''} ${unknown.map((u) => `"${u}"`).join(', ')}`, block.loc);
    }

    this.depth++;
    try {
      const { nodes, parts } = await this.body(declaration.body, inner);
      if (parts.length) throw new FormaError('a component cannot declare parts', block.loc);
      if (!nodes.length) throw new FormaError(`component "${block.type}" produced no geometry`, block.loc);
      return GeometryNode.union(nodes);
    } finally {
      this.depth--;
    }
  }

  /// Builds one model into a scene: its parts, and the union of everything as `node`.
  async model(name) {
    const declaration = name
      ? this.program.models.get(name)
      : this.program.models.values().next().value;
    if (!declaration) {
      throw new FormaError(name ? `no model named "${name}"` : 'the document declares no model');
    }

    const scope = this.root.child();
    for (const param of declaration.body.params) {
      const fallback = param.attributes.find((a) => a.name === 'default');
      if (!fallback) throw new FormaError(`model "${declaration.name}": param "${param.name}" needs a default`, param.loc);
      scope.define(param.name, this.expression(fallback.value, scope));
    }

    const { nodes, parts } = await this.body(declaration.body, scope);
    const all = [...parts.map((p) => p.node), ...nodes];
    if (!all.length) throw new FormaError(`model "${declaration.name}" produced no geometry`, declaration.loc);

    const loose = nodes.length
      ? [{ name: declaration.name, color: '#b8c4d0', opacity: 1, node: GeometryNode.union(nodes) }]
      : [];

    return {
      name: declaration.name,
      parts: [...parts, ...loose],
      node: GeometryNode.union(all),
    };
  }
}

// --- value helpers ---------------------------------------------------------------------

function truthy(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function formatValue(value) {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (value === null || value === undefined) return '';
  return String(value);
}

function deepEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return a === b;
}

function zip(a, b, f, loc) {
  if (a.length !== b.length) throw new FormaError(`cannot combine vectors of length ${a.length} and ${b.length}`, loc);
  return a.map((v, i) => f(v, b[i]));
}

function arithmetic(op, left, right, loc) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new FormaError(`cannot apply ${op} to ${typeName(left)} and ${typeName(right)}`, loc);
  }
  switch (op) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/':
      if (right === 0) throw new FormaError('division by zero', loc);
      return left / right;
    case '%':
      if (right === 0) throw new FormaError('modulo by zero', loc);
      return left % right;
    default: throw new FormaError(`unknown operator ${op}`, loc);
  }
}

function compare(op, left, right, loc) {
  if (typeof left !== typeof right) {
    throw new FormaError(`cannot compare ${typeName(left)} with ${typeName(right)}`, loc);
  }
  switch (op) {
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    default: throw new FormaError(`unknown operator ${op}`, loc);
  }
}

function typeName(value) {
  if (Array.isArray(value)) return 'a list';
  if (value === null) return 'null';
  return `a ${typeof value}`;
}

export { Scope, FormaError };

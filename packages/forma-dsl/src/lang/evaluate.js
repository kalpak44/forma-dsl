/** @import { EvaluationContext, EvaluatorOptions, ParameterDescriptor, ParameterValue, Scene, ScenePart } from '../index.js' */
/** @import { BinaryExpression, Block, Body, CallExpression, Document, Expression, ForBlock, IfBlock, MemberExpression, NamedDeclaration } from './ast.js' */

import { parse } from './parser.js';
import { FormaError } from './lexer.js';
import { BLOCKS, FUNCTIONS, CONSTANTS, TYPE_NAMES, Args, quoteAll } from './builtins.js';
import { GeometryNode } from '../core/node.js';
import { Transform } from '../values/transform.js';

/**
 * The blocks handled before the registry is consulted, so they are missing from `BLOCKS` and
 * would otherwise be absent from the list an unknown block is measured against.
 */
const SPECIAL_FORMS = ['align', 'for', 'if', 'part'];

/**
 * What a body produces: geometry to hand upwards, and any scene parts declared inside it.
 *
 * Parts travel separately from nodes because a part is not an operand — it is a coloured
 * piece of the finished scene, and an enclosing `translate` must not absorb it.
 *
 * @typedef {object} Produced
 * @property {GeometryNode[]} nodes The geometry.
 * @property {ScenePart[]} parts The scene parts declared below here.
 */

/** Which index `.x`, `.y` and `.z` stand for when read off a list. */
const AXES = { x: 0, y: 1, z: 2 };

/** A lexical scope, chained to its parent. */
class Scope {
  /**
   * @param {Scope | null} [parent] The enclosing scope.
   * @param {Record<string, unknown>} [values] Names bound in this scope.
   */
  constructor(parent = null, values = {}) {
    /** @type {Scope | null} The enclosing scope. */
    this.parent = parent;
    /** @type {Map<string, unknown>} Names bound here. */
    this.values = new Map(Object.entries(values));
  }

  /**
   * @param {string} name The name to resolve.
   * @returns {unknown} Its value, or undefined if nothing binds it.
   */
  lookup(name) {
    if (this.values.has(name)) return this.values.get(name);
    return this.parent ? this.parent.lookup(name) : undefined;
  }

  /**
   * Distinct from a `lookup` that returns undefined, since a name may be bound to undefined.
   *
   * @param {string} name The name to look for.
   * @returns {boolean} Whether anything binds it.
   */
  has(name) {
    if (this.values.has(name)) return true;
    return this.parent ? this.parent.has(name) : false;
  }

  /**
   * @param {string} name The name to bind.
   * @param {unknown} value What to bind it to.
   * @returns {Scope} This scope.
   */
  define(name, value) { this.values.set(name, value); return this; }

  /**
   * @param {Record<string, unknown>} [values] Names to bind in the new scope.
   * @returns {Scope} A scope nested inside this one.
   */
  child(values = {}) { return new Scope(this, values); }
}

/** A parsed document, indexed by what each declaration is for. */
export class Program {
  /**
   * @param {Document} document The parsed document.
   * @throws {FormaError} On a duplicate name, or a component that shadows a builtin.
   */
  constructor(document) {
    /** @type {Map<string, any>} Declared params, in source order. */
    this.params = new Map();
    /** @type {any[]} Declared locals, in source order. */
    this.locals = [];
    /** @type {Map<string, NamedDeclaration>} Declared components. */
    this.components = new Map();
    /** @type {Map<string, NamedDeclaration>} Declared models. */
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
        default: {
          // Unreachable per the AST types; kept as a guard against a hand-built document.
          const other = /** @type {any} */ (declaration);
          throw new FormaError(`unexpected declaration ${other.kind}`, other.loc);
        }
      }
    }
  }

  /**
   * @param {string} source The document.
   * @returns {Program} The indexed program.
   * @throws {FormaError} On a syntax error or a duplicate declaration.
   */
  static parse(source) { return new Program(parse(source)); }

  /**
   * The declared parameters, in source order, as the editor needs them to build controls.
   *
   * A param may legitimately have no default — the document then requires a value from the
   * caller — so the descriptor has to stand on its own. `type` is taken from the declaration
   * when it is given and inferred from the default otherwise, and falls back to `number`,
   * which is what a param without either almost always is.
   *
   * @param {((expression: Expression) => unknown) | null} [evaluator] Used to evaluate each
   *   metadata attribute. Without one, every field but the name comes back undefined.
   * @returns {ParameterDescriptor[]} One descriptor per declared param.
   */
  parameterDescriptors(evaluator = null) {
    return [...this.params.values()].map((declaration) => {
      const meta = {};
      for (const attribute of declaration.attributes) {
        meta[attribute.name] = evaluator ? evaluator(attribute.value) : undefined;
      }
      const declared = declaration.attributes.some((a) => a.name === 'default');
      return {
        name: declaration.name,
        type: meta.type ?? inferType(meta.default),
        default: meta.default,
        required: !declared,
        min: meta.min, max: meta.max, step: meta.step,
        description: meta.description,
        options: meta.options,
      };
    });
  }
}

/**
 * How deep blocks may nest before the evaluator gives up.
 *
 * A component that calls itself has no base case to reach, so the depth limit is what turns
 * an infinite recursion into a message naming the likely cause.
 */
const MAX_DEPTH = 64;

/** Turns a program into geometry nodes. */
export class Evaluator {
  /**
   * Resolving the params and locals is part of construction, so every error about a missing
   * or unreadable input surfaces before any geometry is built.
   *
   * @param {Program} program The program to evaluate.
   * @param {EvaluatorOptions} [options] Params, an optional kernel context, and whether
   *   params must all resolve.
   * @throws {FormaError} If a param has no default and no supplied value, unless
   *   `requireParams` is off.
   */
  constructor(program, options = {}) {
    const { params = {}, context = null, requireParams = true } = options;

    /** @type {Program} The program being evaluated. */
    this.program = program;
    /**
     * @type {EvaluationContext | null} Needed only by blocks that measure their child —
     * `align` has to know where the geometry actually is — so a program without one can
     * still be built into a node tree without loading the kernel.
     */
    this.context = context;
    /** @type {number} How deep into component calls evaluation currently is. */
    this.depth = 0;

    const root = new Scope();
    // Constants and type names are in scope before any param default is read, so a default
    // can use `pi` and a `type = number` attribute resolves.
    for (const [name, value] of Object.entries(CONSTANTS)) root.define(name, value);
    for (const name of TYPE_NAMES) root.define(name, name);

    const variables = {};
    for (const [name, declaration] of program.params) {
      const fallback = declaration.attributes.find((a) => a.name === 'default');
      const value = this.paramValue(params[name], fallback, root);
      if (value === undefined) {
        if (requireParams) {
          throw new FormaError(`param "${name}" has no default and no value was supplied`, declaration.loc);
        }
        continue;
      }
      variables[name] = value;
      root.define(name, value);
    }
    // Params are reachable both bare and under `var.`, which is how a model distinguishes
    // an input from a local when both are in scope.
    root.define('var', variables);
    for (const local of program.locals) root.define(local.name, this.expression(local.value, root));

    /** @type {Scope} The document-level scope: constants, type names, params and locals. */
    this.root = root;
  }

  /**
   * Settles one declared param: what the caller gave, or what the declaration defaults to,
   * or nothing at all — which is the caller's problem to report, since a document param and
   * a component param say different things about it.
   *
   * @param {unknown} supplied What was passed in, or undefined.
   * @param {{ value: Expression } | undefined} fallback The `default` attribute, if declared.
   * @param {Scope} scope Where to evaluate that default.
   * @returns {unknown} The value, or undefined when there is none.
   */
  paramValue(supplied, fallback, scope) {
    if (supplied !== undefined) return supplied;
    return fallback ? this.expression(fallback.value, scope) : undefined;
  }

  // --- expressions ----------------------------------------------------------------

  /**
   * Evaluates one expression.
   *
   * @param {Expression} node The expression.
   * @param {Scope} scope Where to resolve names.
   * @returns {unknown} Its value.
   * @throws {FormaError} On an unknown name, a bad operand, or a failing builtin.
   */
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

      case 'member': return this.member(node, scope);

      case 'index': {
        const object = this.expression(node.object, scope);
        const index = this.expression(node.index, scope);
        if (!Array.isArray(object) && typeof object !== 'string' && typeof object !== 'object') {
          throw new FormaError('cannot index this value', node.loc);
        }
        // The language is dynamically typed: a list takes a number and an object a string,
        // and anything else is the model's error to discover at runtime.
        return /** @type {any} */ (object)[/** @type {any} */ (index)];
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
          ? this.expression(node.consequent, scope)
          : this.expression(node.alternate, scope);

      case 'call': return this.call(node, scope);

      default: {
        // Unreachable per the AST types; kept as a guard against a hand-built tree.
        const unknownNode = /** @type {any} */ (node);
        throw new FormaError(`cannot evaluate ${unknownNode.kind}`, unknownNode.loc);
      }
    }
  }

  /**
   * Reads a property, with `.x`/`.y`/`.z` on a list as sugar over an index rather than a type.
   *
   * @param {MemberExpression} node A member expression.
   * @param {Scope} scope Where to resolve names.
   * @returns {unknown} The property's value.
   * @throws {FormaError} If there is nothing to read from, or no such property.
   */
  member(node, scope) {
    const object = /** @type {any} */ (this.expression(node.object, scope));
    if (object === null || object === undefined) {
      throw new FormaError(`cannot read "${node.property}" of nothing`, node.loc);
    }
    if (Array.isArray(object) && node.property in AXES) return object[AXES[node.property]];
    if (!(node.property in object)) {
      throw new FormaError(`no attribute "${node.property}"`, node.loc);
    }
    return object[node.property];
  }

  /**
   * Calls one of the builtin functions. There are no user-defined functions; a component is
   * the way to name a piece of geometry.
   *
   * @param {CallExpression} node A call expression.
   * @param {Scope} scope Where to resolve names.
   * @returns {unknown} The result.
   * @throws {FormaError} On an unknown function, named arguments, the wrong count, or a
   *   failure inside the function.
   */
  call(node, scope) {
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
      // A builtin throwing a plain Error has no position; give it the call's.
      throw error instanceof FormaError ? error : new FormaError(`${node.callee.name}: ${error.message}`, node.loc);
    }
  }

  /**
   * Applies an infix operator.
   *
   * @param {BinaryExpression} node A binary expression.
   * @param {Scope} scope Where to resolve names.
   * @returns {unknown} The result.
   * @throws {FormaError} On operands the operator does not accept.
   */
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
      case '+': return add(left, right, node.loc);
      case '-': return subtract(left, right, node.loc);
      case '*': return multiply(left, right, node.loc);
      case '/': return divide(left, right, node.loc);
      case '%': return arithmetic(op, left, right, node.loc);
      case '<': case '<=': case '>': case '>=': return compare(op, left, right, node.loc);
      default: throw new FormaError(`unknown operator ${op}`, node.loc);
    }
  }

  // --- geometry -------------------------------------------------------------------

  /**
   * Builds a body into geometry nodes and any scene parts it declared.
   *
   * @param {Body} body The body.
   * @param {Scope} scope The enclosing scope.
   * @returns {Promise<Produced>} What it produced.
   */
  async body(body, scope) {
    const inner = scope.child();
    for (const local of body.locals) inner.define(local.name, this.expression(local.value, inner));

    /** @type {Produced} */
    const produced = { nodes: [], parts: [] };

    for (const block of body.blocks) {
      const result = await this.block(block, inner);
      produced.nodes.push(...result.nodes);
      produced.parts.push(...result.parts);
    }

    return produced;
  }

  /**
   * Builds one block, dispatching to whichever of the five things it can be.
   *
   * @param {Block | ForBlock | IfBlock} block The block.
   * @param {Scope} scope The enclosing scope.
   * @returns {Promise<Produced>} What it produced.
   * @throws {FormaError} On unknown blocks, misplaced labels, or nesting past {@link MAX_DEPTH}.
   */
  async block(block, scope) {
    if (this.depth > MAX_DEPTH) {
      throw new FormaError(`nesting deeper than ${MAX_DEPTH} blocks — is a component using itself?`, block.loc);
    }

    if (block.kind === 'for') return this.forBlock(block, scope);
    if (block.kind === 'if') {
      const taken = truthy(this.expression(block.condition, scope)) ? block.consequent : block.alternate;
      return taken ? this.body(taken, scope) : { nodes: [], parts: [] };
    }

    if (block.type === 'part') return this.partBlock(block, scope);
    if (block.type === 'align') return { nodes: [await this.alignBlock(block, scope)], parts: [] };

    if (this.program.components.has(block.type)) {
      return { nodes: [await this.component(block, scope)], parts: [] };
    }

    const definition = BLOCKS[block.type];
    if (!definition) {
      // The whole vocabulary, because the reader is often a program with no copy of the
      // manual: a misspelling it cannot correct from the error costs a round trip it has no
      // way to end. Declared components come first — they are the names this document itself
      // introduced, and the likeliest thing a near miss was reaching for.
      const known = [
        ...[...this.program.components.keys()].sort((a, z) => a.localeCompare(z)),
        ...SPECIAL_FORMS,
        ...Object.keys(BLOCKS).sort((a, z) => a.localeCompare(z)),
      ];
      throw new FormaError(
        `unknown block "${block.type}" — the blocks are ${quoteAll(known)}`,
        block.loc,
      );
    }
    if (block.labels.length) {
      throw new FormaError(`"${block.type}" does not take a label`, block.loc);
    }
    return { nodes: [await this.builtinBlock(block, definition, scope)], parts: [] };
  }

  /**
   * Builds one of the blocks in the registry.
   *
   * @param {Block} block The block.
   * @param {import('../index.js').BlockDefinition} definition Its entry in the registry.
   * @param {Scope} scope The enclosing scope.
   * @returns {Promise<GeometryNode>} The node it produced.
   * @throws {FormaError} If a shape was given children, an operation was given none, the
   *   children's dimensionality is wrong, or an attribute went unread.
   */
  async builtinBlock(block, definition, scope) {
    const args = new Args(block.type, this.attributes(block.body, scope), block.loc);
    const { nodes: children } = await this.body(block.body, scope.child());

    if (definition.leaf) {
      if (children.length) throw new FormaError(`"${block.type}" is a shape and cannot contain other blocks`, block.loc);
      const node = definition.build(args);
      args.checkUnused();
      return node;
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
    return node;
  }

  /**
   * @param {Block} block The block, for its name and position.
   * @param {import('../index.js').BlockDefinition} definition Its entry in the registry.
   * @param {ReadonlyArray<GeometryNode>} children The evaluated children.
   * @returns {void}
   * @throws {FormaError} If the children mix dimensionalities, or are not what the block takes.
   */
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

  /**
   * @param {Body} body The body whose attributes to evaluate.
   * @param {Scope} scope Where to resolve names.
   * @returns {Record<string, unknown>} The evaluated attributes.
   * @throws {FormaError} If an attribute is set twice.
   */
  attributes(body, scope) {
    /** @type {Record<string, unknown>} */
    const values = {};
    for (const attribute of body.attributes) {
      if (attribute.name in values) {
        throw new FormaError(`attribute "${attribute.name}" is set twice`, attribute.loc);
      }
      values[attribute.name] = this.expression(attribute.value, scope);
    }
    return values;
  }

  /**
   * Repeats a body once per item, each iteration in its own scope.
   *
   * @param {ForBlock} block The loop.
   * @param {Scope} scope The enclosing scope.
   * @returns {Promise<Produced>} Everything every iteration produced.
   * @throws {FormaError} If the sequence is not a list.
   */
  async forBlock(block, scope) {
    const sequence = this.expression(block.sequence, scope);
    if (!Array.isArray(sequence)) {
      throw new FormaError('for: expected a list to iterate', block.loc);
    }

    /** @type {Produced} */
    const produced = { nodes: [], parts: [] };

    for (const [index, item] of sequence.entries()) {
      const iteration = scope.child();
      // One name binds the value; two bind the index and then the value.
      iteration.define(block.names[0], block.names.length > 1 ? index : item);
      if (block.names.length > 1) iteration.define(block.names[1], item);
      const result = await this.body(block.body, iteration);
      produced.nodes.push(...result.nodes);
      produced.parts.push(...result.parts);
    }
    return produced;
  }

  /**
   * Builds a `part`, which is a separately coloured piece of the scene rather than an operand.
   *
   * @param {Block} block The part block.
   * @param {Scope} scope The enclosing scope.
   * @returns {Promise<Produced>} The part, and no nodes: a part is not an operand.
   * @throws {FormaError} If it nests another part, is empty, or has an unread attribute.
   */
  async partBlock(block, scope) {
    const args = new Args('part', this.attributes(block.body, scope), block.loc);
    const { nodes, parts } = await this.body(block.body, scope.child());
    if (parts.length) throw new FormaError('a part cannot contain another part', block.loc);
    if (!nodes.length) throw new FormaError('a part needs at least one shape inside it', block.loc);

    const part = {
      // An unlabelled part still needs a name to show in the viewer; its line is the one
      // thing guaranteed to differ between two of them.
      name: block.labels.length
        ? formatValue(this.expression(block.labels[0], scope))
        : `part_${block.loc.line}`,
      color: args.string('color', '#b8c4d0'),
      opacity: args.number('opacity', 1),
      node: GeometryNode.union(nodes),
    };
    args.checkUnused();
    return { nodes: [], parts: [part] };
  }

  /**
   * Moves geometry so a chosen feature of its bounding box lands on a chosen coordinate.
   *
   * This is the one block that has to evaluate its child before it can build its own node,
   * because where the geometry is cannot be read off the tree.
   *
   * @param {Block} block The align block.
   * @param {Scope} scope The enclosing scope.
   * @returns {Promise<GeometryNode>} The moved geometry.
   * @throws {FormaError} Without a kernel context, with no children, or on an axis value
   *   that is neither a keyword nor a number.
   */
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
      // A number places the near face there; a keyword places the named feature at zero.
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

  /**
   * Measures a node, which means solving it.
   *
   * @param {GeometryNode} node The node to measure.
   * @returns {Promise<{ min: number[], max: number[] }>} Its bounding box.
   */
  async bounds(node) {
    // A 2D node yields a cross-section and a 3D one a solid; each spells its extent
    // differently, and the node's own dimensionality is what says which to ask for.
    const concrete = /** @type {any} */ (await this.context.evaluate(node));
    const box = node.dim === 2 ? concrete.bounds() : concrete.boundingBox();
    return { min: box.min, max: box.max };
  }

  /**
   * Calls a component, binding its params from the attributes at the call site.
   *
   * @param {Block} block The call.
   * @param {Scope} scope The scope at the call site, used only to evaluate the arguments.
   * @returns {Promise<GeometryNode>} The geometry it produced.
   * @throws {FormaError} On a missing or unknown param, a declared part, or no geometry.
   */
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
      const value = this.paramValue(supplied[param.name], fallback, inner);
      if (value === undefined) {
        throw new FormaError(`${block.type}: "${param.name}" has no default and was not given`, block.loc);
      }
      inner.define(param.name, value);
    }

    const unknown = Object.keys(supplied).filter((k) => !declared.has(k));
    if (unknown.length) {
      const plural = unknown.length > 1 ? 's' : '';
      throw new FormaError(`${block.type}: unknown param${plural} ${quoteAll(unknown)}`, block.loc);
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

  /**
   * Builds one model into a scene.
   *
   * @param {string | null} [name] Which model; defaults to the first the document declares.
   * @returns {Promise<Scene>} Its parts, and the union of everything as `node`.
   * @throws {FormaError} If there is no such model, a model param lacks a default, or the
   *   model produces nothing.
   */
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

    // Geometry written straight into the model, outside any part, becomes one default part
    // so that everything the viewer draws is a part.
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

/**
 * Whether a value counts as true in a condition.
 *
 * Empty strings and empty lists are false, which is what makes `if var.label { ... }` read
 * the way someone writing it expects.
 *
 * @param {unknown} value The value.
 * @returns {boolean} Whether it is truthy.
 */
function truthy(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Renders a value for string interpolation and concatenation.
 *
 * @param {unknown} value The value.
 * @returns {string} Its text, with null and undefined as the empty string.
 */
function formatValue(value) {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (value === null || value === undefined) return '';
  // An object reaching here is almost always a mistake in the model, so it is shown the way
  // it was written rather than as JavaScript's `[object Object]`, which says nothing about
  // which object went wrong.
  if (typeof value === 'object') return `{${Object.entries(value).map(formatEntry).join(', ')}}`;
  if (typeof value === 'string') return value;
  // A forma expression yields a number, a string, a bool, null, a list or an object, so by
  // here it is a number or a bool. Spelling that out keeps the coercion off `unknown`, where
  // it could silently produce "[object Object]" for something this does not handle.
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Renders one object entry. Separate from {@link formatValue} only so the template literals
 * do not nest.
 *
 * @param {[string, unknown]} entry The key and its value.
 * @returns {string} `key: value`.
 */
function formatEntry([key, value]) {
  return `${key}: ${formatValue(value)}`;
}

/**
 * Structural equality, so two lists with the same numbers compare equal.
 *
 * @param {unknown} a The left value.
 * @param {unknown} b The right value.
 * @returns {boolean} Whether they are equal.
 */
function deepEqual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  return a === b;
}

/**
 * Combines two lists componentwise.
 *
 * @param {ReadonlyArray<any>} a The left list.
 * @param {ReadonlyArray<any>} b The right list.
 * @param {(x: any, y: any) => any} f Applied to each pair.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {any[]} The combined list.
 * @throws {FormaError} If the lists are different lengths.
 */
function zip(a, b, f, loc) {
  if (a.length !== b.length) throw new FormaError(`cannot combine vectors of length ${a.length} and ${b.length}`, loc);
  return a.map((v, i) => f(v, b[i]));
}

/**
 * `+`: string concatenation when either side is text, componentwise on two lists, and
 * ordinary addition otherwise.
 *
 * @param {unknown} left The left operand.
 * @param {unknown} right The right operand.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {unknown} The result.
 * @throws {FormaError} On operands it does not accept.
 */
function add(left, right, loc) {
  if (typeof left === 'string' || typeof right === 'string') return formatValue(left) + formatValue(right);
  if (Array.isArray(left) && Array.isArray(right)) return zip(left, right, (a, b) => a + b, loc);
  return arithmetic('+', left, right, loc);
}

/**
 * `-`: componentwise on two lists, ordinary subtraction otherwise.
 *
 * @param {unknown} left The left operand.
 * @param {unknown} right The right operand.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {unknown} The result.
 * @throws {FormaError} On operands it does not accept.
 */
function subtract(left, right, loc) {
  if (Array.isArray(left) && Array.isArray(right)) return zip(left, right, (a, b) => a - b, loc);
  return arithmetic('-', left, right, loc);
}

/**
 * `*`: a vector times a scalar in either order — the common case in a model — componentwise
 * on two lists, and ordinary multiplication otherwise.
 *
 * @param {unknown} left The left operand.
 * @param {unknown} right The right operand.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {unknown} The result.
 * @throws {FormaError} On operands it does not accept.
 */
function multiply(left, right, loc) {
  if (Array.isArray(left) && typeof right === 'number') return left.map((v) => v * right);
  if (typeof left === 'number' && Array.isArray(right)) return right.map((v) => v * left);
  if (Array.isArray(left) && Array.isArray(right)) return zip(left, right, (a, b) => a * b, loc);
  return arithmetic('*', left, right, loc);
}

/**
 * `/`: a vector by a scalar, or ordinary division. Unlike `*` there is no scalar-over-vector
 * case, because dividing a number by a vector is not a thing a model means.
 *
 * @param {unknown} left The left operand.
 * @param {unknown} right The right operand.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {unknown} The result.
 * @throws {FormaError} On operands it does not accept, or division by zero.
 */
function divide(left, right, loc) {
  if (Array.isArray(left) && typeof right === 'number') return left.map((v) => v / right);
  return arithmetic('/', left, right, loc);
}

/**
 * Applies an operator to two numbers.
 *
 * Division and modulo by zero are errors rather than Infinity or NaN, which would otherwise
 * travel all the way into the kernel as a degenerate vertex.
 *
 * @param {string} op The operator.
 * @param {unknown} left The left operand.
 * @param {unknown} right The right operand.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {number} The result.
 * @throws {FormaError} On non-numeric operands, division by zero, or an unknown operator.
 */
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

/**
 * Orders two values of the same type.
 *
 * @param {string} op The operator.
 * @param {any} left The left operand.
 * @param {any} right The right operand.
 * @param {import('../index.js').SourceLocation} loc Where the operator was.
 * @returns {boolean} The result.
 * @throws {FormaError} If the operands are different types, or the operator is unknown.
 */
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

/**
 * Names a value's type for an error message, phrased to follow "cannot apply + to".
 *
 * @param {unknown} value The value.
 * @returns {string} Its type, as a noun phrase.
 */
function typeName(value) {
  if (Array.isArray(value)) return 'a list';
  if (value === null) return 'null';
  return `a ${typeof value}`;
}

/**
 * Maps a default value onto the name of the control the editor should build for it.
 *
 * @param {ParameterValue | undefined} value The param's default, if it has one.
 * @returns {string} The type name.
 */
function inferType(value) {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'vector';
  return 'number';
}

export { Scope, FormaError };

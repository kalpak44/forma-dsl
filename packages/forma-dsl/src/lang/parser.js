/**
 * The parser: tokens in, a syntax tree out.
 *
 * Recursive descent with a precedence table for the infix operators. The grammar is small
 * enough that a generator would cost more than it saved, and writing it by hand is what lets
 * every node carry the source position that produced it — which is the whole of how errors
 * point at something later on.
 *
 * It checks shape and nothing else. Whether `cylinder` is a real block, and whether its
 * attributes mean anything, is the evaluator's question; a document that parses is only
 * a document spelled like forma.
 */

/** @import { SourceLocation, Token, TokenType } from '../index.js' */
/** @import { Attribute, Block, Body, Declaration, Document, Expression, ForBlock, IfBlock, LocalDeclaration, ParamDeclaration } from './ast.js' */

import { tokenize, FormaError } from './lexer.js';

/** Names that introduce a construct, and so cannot also name a block. */
const KEYWORDS = new Set(['param', 'local', 'component', 'model', 'for', 'if', 'else', 'in', 'true', 'false', 'null']);

/** Binding power per infix operator; higher binds tighter. */
const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

/**
 * A recursive-descent parser over the token stream.
 *
 * The one unusual rule is that a line break ends an attribute, but only outside brackets.
 * {@link Parser#breaksLine} is where that is decided, and `depth` is what makes it apply
 * only at the top level of an expression.
 */
class Parser {
  /**
   * @param {string} source The document, or one spliced expression from inside a string.
   */
  constructor(source) {
    /** @type {Token[]} The token stream. */
    this.tokens = tokenize(source);
    /** @type {number} Index of the next token. */
    this.pos = 0;
    /**
     * @type {number} Depth of enclosing brackets. The newline rule that ends an attribute
     * applies only at depth 0, so an array or a call can still span lines.
     */
    this.depth = 0;
  }

  /** @returns {Token} The token about to be read. */
  get current() { return this.tokens[this.pos]; }

  /**
   * @param {number} [n] How far ahead to look.
   * @returns {Token} The token there.
   */
  peek(n = 1) { return this.tokens[this.pos + n]; }

  /**
   * @param {TokenType} type The kind to match.
   * @param {unknown} [value] The exact value to match, when it matters.
   * @returns {boolean} Whether the current token matches.
   */
  is(type, value) {
    const t = this.current;
    return t.type === type && (value === undefined || t.value === value);
  }

  /**
   * @param {string} value The punctuation to match.
   * @returns {boolean} Whether the current token is that punctuation.
   */
  isPunct(value) { return this.is('punct', value); }

  /**
   * @param {string} value The name to match.
   * @returns {boolean} Whether the current token is that name.
   */
  isIdent(value) { return this.is('ident', value); }

  /** @returns {Token} The current token, having moved past it. */
  next() { return this.tokens[this.pos++]; }

  /**
   * @param {TokenType} type The kind required.
   * @param {string} [value] The exact value required, when it matters. Always a keyword or a
   *   piece of punctuation, which is why it can go straight into the message.
   * @returns {Token} The consumed token.
   * @throws {FormaError} If the current token is not what was required.
   */
  expect(type, value) {
    if (!this.is(type, value)) {
      const got = this.current.type === 'eof' ? 'end of file' : JSON.stringify(this.current.value);
      throw new FormaError(`expected ${value ?? type}, found ${got}`, this.current.loc);
    }
    return this.next();
  }

  // --- document -------------------------------------------------------------------

  /**
   * @returns {Document} The whole document.
   * @throws {FormaError} On anything that is not a top-level block.
   */
  parseDocument() {
    const declarations = [];
    while (!this.is('eof')) declarations.push(this.parseDeclaration());
    return { kind: 'document', declarations };
  }

  /**
   * @returns {Declaration} One top-level block.
   * @throws {FormaError} If the block type is not one of the four that may appear here.
   */
  parseDeclaration() {
    const t = this.current;
    if (t.type !== 'ident') {
      throw new FormaError(`expected a block, found ${JSON.stringify(t.value)}`, t.loc);
    }
    switch (t.value) {
      case 'param': return this.parseParam();
      case 'local': return this.parseLocal();
      case 'component':
      case 'model': {
        this.next();
        const name = this.parseLabel();
        const body = this.parseBracedBody();
        return { kind: t.value, name, body, loc: t.loc };
      }
      default:
        throw new FormaError(`unknown top-level block "${t.value}"`, t.loc);
    }
  }

  /**
   * Reads a static name, quoted or bare.
   *
   * @returns {string} The name.
   * @throws {FormaError} If the label is interpolated, which a declaration name cannot be:
   *   a name that depended on a value could not be resolved before evaluating it.
   */
  parseLabel() {
    if (this.is('string')) {
      const token = this.next();
      const parts = token.value;
      if (parts.length !== 1 || parts[0].kind !== 'text') {
        throw new FormaError('a label cannot contain ${ }', token.loc);
      }
      return parts[0].value;
    }
    return this.expect('ident').value;
  }

  /**
   * Reads a param declaration.
   *
   * `param name = expr` and `param name { ... }` are the same declaration; the braced form
   * carries the metadata the editor needs to render a control.
   *
   * @returns {ParamDeclaration} The declaration.
   * @throws {FormaError} If the braced form contains nested blocks.
   */
  parseParam() {
    const loc = this.expect('ident', 'param').loc;
    const name = this.parseLabel();
    if (this.isPunct('=')) {
      this.next();
      return { kind: 'param', name, attributes: [{ name: 'default', value: this.parseExpression() }], loc };
    }
    const body = this.parseBracedBody();
    if (body.blocks.length) {
      throw new FormaError('a param block holds attributes, not nested blocks', loc);
    }
    return { kind: 'param', name, attributes: body.attributes, loc };
  }

  /**
   * @returns {LocalDeclaration} The declaration.
   */
  parseLocal() {
    const loc = this.expect('ident', 'local').loc;
    const name = this.parseLabel();
    this.expect('punct', '=');
    return { kind: 'local', name, value: this.parseExpression(), loc };
  }

  // --- bodies ---------------------------------------------------------------------

  /**
   * @returns {Body} The contents of a `{ ... }`.
   */
  parseBracedBody() {
    this.expect('punct', '{');
    const body = this.parseBody();
    this.expect('punct', '}');
    return body;
  }

  /**
   * Reads entries until the closing brace, sorting each into attributes, nested blocks,
   * params or locals.
   *
   * @returns {Body} The contents.
   * @throws {FormaError} On an entry that does not begin with a name.
   */
  parseBody() {
    /** @type {Body} */
    const body = { attributes: [], blocks: [], params: [], locals: [] };

    while (!this.isPunct('}') && !this.is('eof')) {
      const t = this.current;

      if (t.type !== 'ident') {
        throw new FormaError(`expected an attribute or block, found ${JSON.stringify(t.value)}`, t.loc);
      }

      if (t.value === 'param') { body.params.push(this.parseParam()); continue; }
      if (t.value === 'local') { body.locals.push(this.parseLocal()); continue; }
      if (t.value === 'for') { body.blocks.push(this.parseFor()); continue; }
      if (t.value === 'if') { body.blocks.push(this.parseIf()); continue; }

      // `name = expr` is an attribute; anything else that starts with an identifier is a
      // nested block, which is how the CSG tree is written.
      if (this.peek().type === 'punct' && this.peek().value === '=') {
        const name = this.next().value;
        this.next();
        /** @type {Attribute} */
        const attribute = { name, value: this.parseExpression(), loc: t.loc };
        body.attributes.push(attribute);
        continue;
      }

      body.blocks.push(this.parseBlock());
    }

    return body;
  }

  /**
   * Reads a nested block and its labels.
   *
   * A block label is an expression, not a fixed string, so a part built inside a loop can
   * name itself from the loop variable.
   *
   * @returns {Block} The block.
   * @throws {FormaError} If the block type is a keyword.
   */
  parseBlock() {
    const token = this.expect('ident');
    if (KEYWORDS.has(token.value)) {
      throw new FormaError(`"${token.value}" cannot be used as a block type`, token.loc);
    }
    const labels = [];
    while (this.is('string') || this.is('ident')) {
      labels.push(this.parsePrimary());
    }
    const body = this.parseBracedBody();
    return { kind: 'block', type: token.value, labels, body, loc: token.loc };
  }

  /**
   * @returns {ForBlock} The loop.
   */
  parseFor() {
    const loc = this.expect('ident', 'for').loc;
    const names = [this.expect('ident').value];
    if (this.isPunct(',')) { this.next(); names.push(this.expect('ident').value); }
    this.expect('ident', 'in');
    const sequence = this.parseExpression();
    const body = this.parseBracedBody();
    return { kind: 'for', names, sequence, body, loc };
  }

  /**
   * Reads a conditional block. `else if` is nested rather than flattened, so the chain is
   * one shape all the way down.
   *
   * @returns {IfBlock} The conditional.
   */
  parseIf() {
    const loc = this.expect('ident', 'if').loc;
    const condition = this.parseExpression();
    const consequent = this.parseBracedBody();
    let alternate = null;
    if (this.isIdent('else')) {
      this.next();
      if (this.isIdent('if')) {
        alternate = { attributes: [], params: [], locals: [], blocks: [this.parseIf()] };
      } else {
        alternate = this.parseBracedBody();
      }
    }
    return { kind: 'if', condition, consequent, alternate, loc };
  }

  // --- expressions ----------------------------------------------------------------

  /**
   * @returns {Expression} One expression.
   */
  parseExpression() { return this.parseConditional(); }

  /**
   * @returns {Expression} A `? :` expression, or whatever was there instead.
   */
  parseConditional() {
    const condition = this.parseBinary(0);
    if (this.isPunct('?') && !this.breaksLine()) {
      this.next();
      const consequent = this.parseExpression();
      this.expect('punct', ':');
      const alternate = this.parseExpression();
      return { kind: 'conditional', condition, consequent, alternate };
    }
    return condition;
  }

  /**
   * @returns {boolean} Whether the current token starts a new line outside any bracket —
   *   the signal that the expression is finished and the next attribute has begun.
   */
  breaksLine() {
    return this.depth === 0 && this.current.nlBefore;
  }

  /**
   * Precedence climbing over the infix operators.
   *
   * @param {number} minPrecedence The lowest binding power this call will accept.
   * @returns {Expression} The expression.
   */
  parseBinary(minPrecedence) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.current;
      if (t.type !== 'punct') break;
      const precedence = BINARY_PRECEDENCE[t.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      if (this.breaksLine()) break;
      this.next();
      const right = this.parseBinary(precedence + 1);
      left = { kind: 'binary', op: t.value, left, right, loc: t.loc };
    }
    return left;
  }

  /**
   * @returns {Expression} A prefixed expression, or whatever was there instead.
   */
  parseUnary() {
    if (this.isPunct('-') || this.isPunct('!')) {
      const t = this.next();
      return { kind: 'unary', op: t.value, operand: this.parseUnary(), loc: t.loc };
    }
    return this.parsePostfix();
  }

  /**
   * Reads the suffixes — member access, indexing and calls — that bind tightest.
   *
   * @returns {Expression} The expression.
   */
  parsePostfix() {
    let target = this.parsePrimary();
    for (;;) {
      if (this.isPunct('.') && !this.breaksLine()) {
        this.next();
        const property = this.expect('ident').value;
        target = { kind: 'member', object: target, property };
      } else if (this.isPunct('[') && !this.breaksLine()) {
        this.next();
        this.depth++;
        const index = this.parseExpression();
        this.depth--;
        this.expect('punct', ']');
        target = { kind: 'index', object: target, index };
      } else if (this.isPunct('(') && !this.breaksLine()) {
        target = { kind: 'call', callee: target, args: this.parseArguments(), loc: this.current.loc };
      } else {
        return target;
      }
    }
  }

  /**
   * @returns {Array<{ name: string | null, value: Expression }>} The argument list.
   */
  parseArguments() {
    this.expect('punct', '(');
    this.depth++;
    const args = [];
    while (!this.isPunct(')')) {
      if (this.is('ident') && this.peek().type === 'punct' && this.peek().value === '=') {
        const name = this.next().value;
        this.next();
        args.push({ name, value: this.parseExpression() });
      } else {
        args.push({ name: null, value: this.parseExpression() });
      }
      if (this.isPunct(',')) this.next(); else break;
    }
    this.depth--;
    this.expect('punct', ')');
    return args;
  }

  /**
   * Reads a literal, a name, or a bracketed expression.
   *
   * @returns {Expression} The expression.
   * @throws {FormaError} If the token cannot begin one.
   */
  parsePrimary() {
    const t = this.current;

    if (t.type === 'number') { this.next(); return { kind: 'literal', value: t.value }; }
    if (t.type === 'string') { this.next(); return stringExpression(t); }

    if (t.type === 'ident') {
      this.next();
      if (t.value === 'true') return { kind: 'literal', value: true };
      if (t.value === 'false') return { kind: 'literal', value: false };
      if (t.value === 'null') return { kind: 'literal', value: null };
      return { kind: 'identifier', name: t.value, loc: t.loc };
    }

    if (this.isPunct('(')) {
      this.next();
      this.depth++;
      const inner = this.parseExpression();
      this.depth--;
      this.expect('punct', ')');
      return inner;
    }

    if (this.isPunct('[')) return this.parseArrayLiteral(t.loc);
    if (this.isPunct('{')) return this.parseObjectLiteral(t.loc);

    throw new FormaError(`unexpected ${JSON.stringify(t.value ?? 'end of file')}`, t.loc);
  }

  /**
   * @param {SourceLocation} loc Where the bracket was.
   * @returns {Expression} The list.
   */
  parseArrayLiteral(loc) {
    this.next();
    this.depth++;
    const items = [];
    while (!this.isPunct(']')) {
      items.push(this.parseExpression());
      if (this.isPunct(',')) this.next(); else break;
    }
    this.depth--;
    this.expect('punct', ']');
    return { kind: 'array', items, loc };
  }

  /**
   * @param {SourceLocation} loc Where the brace was.
   * @returns {Expression} The object.
   * @throws {FormaError} If an entry has no `=` or `:` between key and value.
   */
  parseObjectLiteral(loc) {
    this.next();
    this.depth++;
    const entries = [];
    while (!this.isPunct('}')) {
      const key = this.is('string') ? this.parseLabel() : this.expect('ident').value;
      if (this.isPunct('=') || this.isPunct(':')) this.next();
      else throw new FormaError('expected = or : in an object', this.current.loc);
      entries.push({ key, value: this.parseExpression() });
      if (this.isPunct(',')) this.next();
    }
    this.depth--;
    this.expect('punct', '}');
    return { kind: 'object', entries, loc };
  }
}

/**
 * Turns a string token into an expression, collapsing the common case of a string with no
 * splices in it down to a plain literal.
 *
 * @param {Token} token A `string` token.
 * @returns {Expression} The literal or template.
 */
function stringExpression(token) {
  const parts = token.value.map((part) => (part.kind === 'text'
    ? { kind: 'text', value: part.value }
    : { kind: 'expr', expression: parseExpressionSource(part.source, part.loc) }));

  if (parts.length === 1 && parts[0].kind === 'text') {
    return { kind: 'literal', value: parts[0].value };
  }
  return { kind: 'template', parts, loc: token.loc };
}

/**
 * Parses one `${...}` splice, which the lexer kept as raw source.
 *
 * @param {string} source The spliced expression.
 * @param {SourceLocation} loc Where the enclosing string began.
 * @returns {Expression} The expression.
 * @throws {FormaError} If the splice is not exactly one expression. Errors raised inside it
 *   are given the string's position, since the splice has no line of its own.
 */
function parseExpressionSource(source, loc) {
  try {
    const parser = new Parser(source);
    const expression = parser.parseExpression();
    if (!parser.is('eof')) throw new FormaError('trailing input in ${ }', loc);
    return expression;
  } catch (error) {
    if (error instanceof FormaError && !error.loc) error.loc = loc;
    throw error;
  }
}

/**
 * Parses a document into an AST.
 *
 * @param {string} source The document.
 * @returns {Document} The parsed document.
 * @throws {FormaError} On any syntax error, carrying the position.
 */
export function parse(source) {
  return new Parser(source).parseDocument();
}

export { FormaError };

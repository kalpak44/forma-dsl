import { tokenize, FormaError } from './lexer.js';

const KEYWORDS = new Set(['param', 'local', 'component', 'model', 'for', 'if', 'else', 'in', 'true', 'false', 'null']);

const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

class Parser {
  constructor(source) {
    this.tokens = tokenize(source);
    this.pos = 0;
    // Depth of enclosing brackets. The newline rule that ends an attribute applies only at
    // depth 0, so an array or a call can still span lines.
    this.depth = 0;
  }

  get current() { return this.tokens[this.pos]; }
  peek(n = 1) { return this.tokens[this.pos + n]; }

  is(type, value) {
    const t = this.current;
    return t.type === type && (value === undefined || t.value === value);
  }

  isPunct(value) { return this.is('punct', value); }
  isIdent(value) { return this.is('ident', value); }

  next() { return this.tokens[this.pos++]; }

  expect(type, value) {
    if (!this.is(type, value)) {
      const got = this.current.type === 'eof' ? 'end of file' : JSON.stringify(this.current.value);
      throw new FormaError(`expected ${value ?? type}, found ${got}`, this.current.loc);
    }
    return this.next();
  }

  // --- document -------------------------------------------------------------------

  parseDocument() {
    const declarations = [];
    while (!this.is('eof')) declarations.push(this.parseDeclaration());
    return { kind: 'document', declarations };
  }

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

  /// `param name = expr` and `param name { ... }` are the same declaration; the braced form
  /// carries the metadata the editor needs to render a control.
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

  parseLocal() {
    const loc = this.expect('ident', 'local').loc;
    const name = this.parseLabel();
    this.expect('punct', '=');
    return { kind: 'local', name, value: this.parseExpression(), loc };
  }

  // --- bodies ---------------------------------------------------------------------

  parseBracedBody() {
    this.expect('punct', '{');
    const body = this.parseBody();
    this.expect('punct', '}');
    return body;
  }

  parseBody() {
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
        body.attributes.push({ name, value: this.parseExpression(), loc: t.loc });
        continue;
      }

      body.blocks.push(this.parseBlock());
    }

    return body;
  }

  parseBlock() {
    const token = this.expect('ident');
    if (KEYWORDS.has(token.value) && token.value !== 'union') {
      throw new FormaError(`"${token.value}" cannot be used as a block type`, token.loc);
    }
    // A block label is an expression, not a fixed string, so a part built inside a loop can
    // name itself from the loop variable. Declaration names stay static — a component whose
    // name depended on a value could not be resolved before evaluating it.
    const labels = [];
    while (this.is('string') || (this.is('ident') && !this.isPunct('{'))) {
      if (this.isPunct('{')) break;
      labels.push(this.parsePrimary());
    }
    const body = this.parseBracedBody();
    return { kind: 'block', type: token.value, labels, body, loc: token.loc };
  }

  parseFor() {
    const loc = this.expect('ident', 'for').loc;
    const names = [this.expect('ident').value];
    if (this.isPunct(',')) { this.next(); names.push(this.expect('ident').value); }
    this.expect('ident', 'in');
    const sequence = this.parseExpression();
    const body = this.parseBracedBody();
    return { kind: 'for', names, sequence, body, loc };
  }

  parseIf() {
    const loc = this.expect('ident', 'if').loc;
    const condition = this.parseExpression();
    const then = this.parseBracedBody();
    let otherwise = null;
    if (this.isIdent('else')) {
      this.next();
      if (this.isIdent('if')) {
        otherwise = { attributes: [], params: [], locals: [], blocks: [this.parseIf()] };
      } else {
        otherwise = this.parseBracedBody();
      }
    }
    return { kind: 'if', condition, then, otherwise, loc };
  }

  // --- expressions ----------------------------------------------------------------

  parseExpression() { return this.parseConditional(); }

  parseConditional() {
    const condition = this.parseBinary(0);
    if (this.isPunct('?') && !this.#breaksLine()) {
      this.next();
      const then = this.parseExpression();
      this.expect('punct', ':');
      const otherwise = this.parseExpression();
      return { kind: 'conditional', condition, then, otherwise };
    }
    return condition;
  }

  /// True when the current token starts a new line outside any bracket — the signal that
  /// the expression is finished and the next attribute has begun.
  #breaksLine() {
    return this.depth === 0 && this.current.nlBefore;
  }

  parseBinary(minPrecedence) {
    let left = this.parseUnary();
    for (;;) {
      const t = this.current;
      if (t.type !== 'punct') break;
      const precedence = BINARY_PRECEDENCE[t.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      if (this.#breaksLine()) break;
      this.next();
      const right = this.parseBinary(precedence + 1);
      left = { kind: 'binary', op: t.value, left, right, loc: t.loc };
    }
    return left;
  }

  parseUnary() {
    if (this.isPunct('-') || this.isPunct('!')) {
      const t = this.next();
      return { kind: 'unary', op: t.value, operand: this.parseUnary(), loc: t.loc };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let target = this.parsePrimary();
    for (;;) {
      if (this.isPunct('.') && !this.#breaksLine()) {
        this.next();
        const property = this.expect('ident').value;
        target = { kind: 'member', object: target, property };
      } else if (this.isPunct('[') && !this.#breaksLine()) {
        this.next();
        this.depth++;
        const index = this.parseExpression();
        this.depth--;
        this.expect('punct', ']');
        target = { kind: 'index', object: target, index };
      } else if (this.isPunct('(') && !this.#breaksLine()) {
        target = { kind: 'call', callee: target, args: this.parseArguments(), loc: this.current.loc };
      } else {
        return target;
      }
    }
  }

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

  parsePrimary() {
    const t = this.current;

    if (t.type === 'number') { this.next(); return { kind: 'literal', value: t.value }; }

    if (t.type === 'string') {
      this.next();
      const parts = t.value.map((part) => part.kind === 'text'
        ? { kind: 'text', value: part.value }
        : { kind: 'expr', expression: parseExpressionSource(part.source, part.loc) });
      if (parts.length === 1 && parts[0].kind === 'text') {
        return { kind: 'literal', value: parts[0].value };
      }
      return { kind: 'template', parts, loc: t.loc };
    }

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

    if (this.isPunct('[')) {
      this.next();
      this.depth++;
      const items = [];
      while (!this.isPunct(']')) {
        items.push(this.parseExpression());
        if (this.isPunct(',')) this.next(); else break;
      }
      this.depth--;
      this.expect('punct', ']');
      return { kind: 'array', items, loc: t.loc };
    }

    if (this.isPunct('{')) {
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
      return { kind: 'object', entries, loc: t.loc };
    }

    throw new FormaError(`unexpected ${JSON.stringify(t.value ?? 'end of file')}`, t.loc);
  }
}

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

export function parse(source) {
  return new Parser(source).parseDocument();
}

export { FormaError };

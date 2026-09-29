/** @import { SourceLocation, Token, TokenType } from '../index.js' */

/**
 * Every error the language raises, carrying the position it was raised at when there is one.
 *
 * The position is appended to the message as well as kept on the error, so a caller that
 * only prints `error.message` still tells the reader where to look.
 */
export class FormaError extends Error {
  /**
   * @param {string} message What went wrong.
   * @param {SourceLocation | null} [loc] Where it went wrong.
   */
  constructor(message, loc) {
    super(loc ? `${message} (line ${loc.line}, column ${loc.column})` : message);
    this.name = 'FormaError';
    /** @type {SourceLocation | null} Where the error was raised, if known. */
    this.loc = loc ?? null;
  }
}

/**
 * Punctuation, longest first.
 *
 * The order is load-bearing: matching is first-wins, so `==` has to be tried before `=`, or
 * every comparison would lex as two assignments.
 */
const PUNCTUATION = [
  '==', '!=', '<=', '>=', '&&', '||', '=>', '...',
  '{', '}', '[', ']', '(', ')', ',', '.', '=', '<', '>',
  '+', '-', '*', '/', '%', '!', '?', ':',
];

/** Escapes recognised inside a string. `\$` is here so a literal `${` can be written. */
const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', $: '$' };

/**
 * @param {string} c A single character.
 * @returns {boolean} Whether a name may begin with it.
 */
const isIdentStart = (c) => /[A-Za-z_]/.test(c);

/**
 * @param {string} c A single character.
 * @returns {boolean} Whether a name may continue with it. Hyphens are allowed, so
 *   `min-width` is one name rather than a subtraction.
 */
const isIdentPart = (c) => /[A-Za-z0-9_-]/.test(c);

/**
 * @param {string} c A single character.
 * @returns {boolean} Whether it is a decimal digit.
 */
const isDigit = (c) => c >= '0' && c <= '9';

/**
 * Walks the source once, keeping the cursor and the accumulated tokens together.
 *
 * A class rather than one long function because the four scanners below — comments,
 * strings, numbers, names — all need the same mutable cursor, and threading it through
 * arguments made each of them harder to read than the grammar it implements.
 */
class Lexer {
  /**
   * @param {string} source The document.
   */
  constructor(source) {
    /** @type {string} The document being scanned. */
    this.source = source;
    /** @type {Token[]} Tokens produced so far. */
    this.tokens = [];
    /** @type {number} Offset of the next character. */
    this.i = 0;
    /** @type {number} Line of the next character, counting from 1. */
    this.line = 1;
    /** @type {number} Column of the next character, counting from 1. */
    this.column = 1;
    /** @type {boolean} Whether a line break has been passed since the last token. */
    this.sawNewline = false;
  }

  /** @returns {SourceLocation} Where the cursor is. */
  here() {
    return { line: this.line, column: this.column, offset: this.i };
  }

  /**
   * @param {number} [n] How many characters to consume.
   * @returns {void}
   */
  advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (this.source[this.i] === '\n') { this.line++; this.column = 1; } else { this.column++; }
      this.i++;
    }
  }

  /**
   * @param {number} [offset] How far ahead to look.
   * @returns {string | undefined} The character there, or undefined past the end.
   */
  peek(offset = 0) {
    return this.source[this.i + offset];
  }

  /** @returns {boolean} Whether the whole document has been consumed. */
  get done() {
    return this.i >= this.source.length;
  }

  /**
   * Records a token and clears the pending line break, which belongs to this token only.
   *
   * @param {TokenType} type What kind of token.
   * @param {unknown} value Its payload.
   * @param {SourceLocation} loc Where it started.
   * @returns {void}
   */
  push(type, value, loc) {
    this.tokens.push({ type, value, loc, nlBefore: this.sawNewline });
    this.sawNewline = false;
  }

  /**
   * Turns the whole document into tokens.
   *
   * @returns {Token[]} The tokens, ending with an `eof`.
   * @throws {FormaError} On any character that cannot begin a token.
   */
  run() {
    while (!this.done) {
      const c = this.peek();

      if (c === '\n') { this.sawNewline = true; this.advance(); continue; }
      if (c === ' ' || c === '\t' || c === '\r') { this.advance(); continue; }

      if (c === '#' || (c === '/' && this.peek(1) === '/')) { this.skipLineComment(); continue; }
      if (c === '/' && this.peek(1) === '*') { this.skipBlockComment(); continue; }

      if (c === '"') { this.readString(); continue; }
      if (isDigit(c) || (c === '.' && isDigit(this.peek(1)))) { this.readNumber(); continue; }
      if (isIdentStart(c)) { this.readIdentifier(); continue; }
      if (this.readPunctuation()) continue;

      throw new FormaError(`unexpected character ${JSON.stringify(c)}`, this.here());
    }

    this.tokens.push({ type: 'eof', value: null, loc: this.here(), nlBefore: this.sawNewline });
    return this.tokens;
  }

  /** @returns {void} */
  skipLineComment() {
    while (!this.done && this.peek() !== '\n') this.advance();
  }

  /**
   * @returns {void}
   * @throws {FormaError} If the comment is never closed.
   */
  skipBlockComment() {
    const start = this.here();
    this.advance(2);
    while (!this.done && !(this.peek() === '*' && this.peek(1) === '/')) this.advance();
    if (this.done) throw new FormaError('unterminated block comment', start);
    this.advance(2);
  }

  /**
   * Reads a `"..."` string into its literal runs and its `${...}` splices.
   *
   * The spliced expressions are kept as raw source; the parser re-enters itself on them,
   * rather than this having to know the expression grammar.
   *
   * @returns {void}
   * @throws {FormaError} On an unknown escape, a newline inside the string, or no closing quote.
   */
  readString() {
    const loc = this.here();
    this.advance();

    /** @type {Array<{ kind: 'text', value: string } | { kind: 'expr', source: string, loc: SourceLocation }>} */
    const parts = [];
    let text = '';

    while (!this.done && this.peek() !== '"') {
      if (this.peek() === '\\') {
        const next = this.peek(1);
        if (!(next in ESCAPES)) throw new FormaError(`unknown escape \\${next}`, this.here());
        text += ESCAPES[next];
        this.advance(2);
        continue;
      }

      if (this.peek() === '$' && this.peek(1) === '{') {
        if (text) { parts.push({ kind: 'text', value: text }); text = ''; }
        parts.push(this.readSplice(loc));
        continue;
      }

      if (this.peek() === '\n') throw new FormaError('unterminated string', loc);
      text += this.peek();
      this.advance();
    }

    if (this.done) throw new FormaError('unterminated string', loc);
    this.advance();

    // An empty string still needs one part, or it would carry no value at all.
    if (text || parts.length === 0) parts.push({ kind: 'text', value: text });
    this.push('string', parts, loc);
  }

  /**
   * Reads one `${...}`, counting braces so a nested object literal does not end it early.
   *
   * @param {SourceLocation} loc Where the enclosing string began, for the error.
   * @returns {{ kind: 'expr', source: string, loc: SourceLocation }} The spliced source.
   * @throws {FormaError} If the splice is never closed.
   */
  readSplice(loc) {
    this.advance(2);
    const start = this.i;
    let depth = 1;
    while (!this.done && depth > 0) {
      if (this.peek() === '{') depth++;
      else if (this.peek() === '}') depth--;
      if (depth > 0) this.advance();
    }
    if (depth !== 0) throw new FormaError('unterminated ${ } in string', loc);
    const source = this.source.slice(start, this.i);
    this.advance();
    return { kind: 'expr', source, loc: { ...loc } };
  }

  /**
   * Reads a decimal number, with an optional fraction and exponent.
   *
   * @returns {void}
   */
  readNumber() {
    const loc = this.here();
    const start = this.i;

    while (!this.done && isDigit(this.peek())) this.advance();
    if (this.peek() === '.' && isDigit(this.peek(1))) {
      this.advance();
      while (!this.done && isDigit(this.peek())) this.advance();
    }

    if (this.peek() === 'e' || this.peek() === 'E') {
      // `2e` and `2emm` are not numbers with exponents; back out so the `e` can start a name.
      const save = this.i;
      this.advance();
      if (this.peek() === '+' || this.peek() === '-') this.advance();
      if (isDigit(this.peek())) {
        while (!this.done && isDigit(this.peek())) this.advance();
      } else {
        this.i = save;
      }
    }

    this.push('number', Number(this.source.slice(start, this.i)), loc);
  }

  /** @returns {void} */
  readIdentifier() {
    const loc = this.here();
    const start = this.i;
    while (!this.done && isIdentPart(this.peek())) this.advance();
    this.push('ident', this.source.slice(start, this.i), loc);
  }

  /** @returns {boolean} Whether punctuation was found and consumed. */
  readPunctuation() {
    const punct = PUNCTUATION.find((p) => this.source.startsWith(p, this.i));
    if (!punct) return false;
    const loc = this.here();
    this.advance(punct.length);
    this.push('punct', punct, loc);
    return true;
  }
}

/**
 * Turns source into tokens.
 *
 * Each token records whether a line break preceded it. The parser needs that to know an
 * attribute has ended: `size = [1,2]` on one line and `radius = 3` on the next are two
 * attributes, but `radius = 3 +\n 4` is one expression, and nothing else distinguishes the
 * leading `-` of a new attribute value from a subtraction.
 *
 * @param {string} source The document.
 * @returns {Token[]} The tokens, ending with an `eof`.
 * @throws {FormaError} On anything that cannot be tokenised.
 */
export function tokenize(source) {
  return new Lexer(source).run();
}

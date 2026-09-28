export class FormaError extends Error {
  constructor(message, loc) {
    super(loc ? `${message} (line ${loc.line}, column ${loc.column})` : message);
    this.name = 'FormaError';
    this.loc = loc ?? null;
  }
}

const PUNCTUATION = [
  '==', '!=', '<=', '>=', '&&', '||', '=>', '...',
  '{', '}', '[', ']', '(', ')', ',', '.', '=', '<', '>',
  '+', '-', '*', '/', '%', '!', '?', ':',
];

const isIdentStart = (c) => /[A-Za-z_]/.test(c);
const isIdentPart = (c) => /[A-Za-z0-9_-]/.test(c);
const isDigit = (c) => c >= '0' && c <= '9';

/// Turns source into tokens.
///
/// Each token records whether a line break preceded it. The parser needs that to know an
/// attribute has ended: `size = [1,2]` on one line and `radius = 3` on the next are two
/// attributes, but `radius = 3 +\n 4` is one expression, and nothing else distinguishes
/// the leading `-` of a new attribute value from a subtraction.
export function tokenize(source) {
  const tokens = [];
  let i = 0, line = 1, column = 1, sawNewline = false;

  const here = () => ({ line, column, offset: i });

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === '\n') { line++; column = 1; } else { column++; }
      i++;
    }
  };

  const push = (type, value, loc) => {
    tokens.push({ type, value, loc, nlBefore: sawNewline });
    sawNewline = false;
  };

  while (i < source.length) {
    const c = source[i];

    if (c === '\n') { sawNewline = true; advance(); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { advance(); continue; }

    if (c === '#' || (c === '/' && source[i + 1] === '/')) {
      while (i < source.length && source[i] !== '\n') advance();
      continue;
    }

    if (c === '/' && source[i + 1] === '*') {
      const start = here();
      advance(2);
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) advance();
      if (i >= source.length) throw new FormaError('unterminated block comment', start);
      advance(2);
      continue;
    }

    if (c === '"') {
      const loc = here();
      advance();
      const parts = [];
      let text = '';
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') {
          const next = source[i + 1];
          const escapes = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '$': '$' };
          if (!(next in escapes)) throw new FormaError(`unknown escape \\${next}`, here());
          text += escapes[next];
          advance(2);
          continue;
        }
        // "${...}" splices an expression into the string, as in Terraform. The parser is
        // handed the raw source and re-enters itself on it.
        if (source[i] === '$' && source[i + 1] === '{') {
          if (text) { parts.push({ kind: 'text', value: text }); text = ''; }
          advance(2);
          const exprStart = i;
          let depth = 1;
          while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            if (depth > 0) advance();
          }
          if (depth !== 0) throw new FormaError('unterminated ${ } in string', loc);
          parts.push({ kind: 'expr', source: source.slice(exprStart, i), loc: { ...loc } });
          advance();
          continue;
        }
        if (source[i] === '\n') throw new FormaError('unterminated string', loc);
        text += source[i];
        advance();
      }
      if (i >= source.length) throw new FormaError('unterminated string', loc);
      advance();
      if (text || parts.length === 0) parts.push({ kind: 'text', value: text });
      push('string', parts, loc);
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1]))) {
      const loc = here();
      const start = i;
      while (i < source.length && isDigit(source[i])) advance();
      if (source[i] === '.' && isDigit(source[i + 1])) {
        advance();
        while (i < source.length && isDigit(source[i])) advance();
      }
      if (source[i] === 'e' || source[i] === 'E') {
        const save = i;
        advance();
        if (source[i] === '+' || source[i] === '-') advance();
        if (isDigit(source[i])) { while (i < source.length && isDigit(source[i])) advance(); }
        else { i = save; }
      }
      push('number', Number(source.slice(start, i)), loc);
      continue;
    }

    if (isIdentStart(c)) {
      const loc = here();
      const start = i;
      while (i < source.length && isIdentPart(source[i])) advance();
      push('ident', source.slice(start, i), loc);
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct) {
      const loc = here();
      advance(punct.length);
      push('punct', punct, loc);
      continue;
    }

    throw new FormaError(`unexpected character ${JSON.stringify(c)}`, here());
  }

  tokens.push({ type: 'eof', value: null, loc: here(), nlBefore: sawNewline });
  return tokens;
}

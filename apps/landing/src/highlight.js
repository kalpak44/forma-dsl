/**
 * Syntax highlighting for the typed demo.
 *
 * The same classification the reference manual uses, but returning segments rather than
 * HTML: the demo types a character at a time, so it needs to know where each span starts
 * and stops rather than being handed a finished string.
 */

import { BLOCKS, FUNCTIONS, CONSTANTS } from 'forma-dsl';

/** Names that introduce a construct. Mirrors the parser's own list. */
const KEYWORDS = new Set(['param', 'local', 'component', 'model', 'for', 'if', 'else', 'in', 'true', 'false', 'null']);

/** Block names, from the registry, plus the two the evaluator handles itself. */
const BLOCK_NAMES = new Set([...Object.keys(BLOCKS), 'part', 'align']);

/** Function names, from the registry. */
const FUNCTION_NAMES = new Set(Object.keys(FUNCTIONS));

/** Fixed values, plus the type names a `param` block writes bare. */
const CONSTANT_NAMES = new Set([
  ...Object.keys(CONSTANTS), 'var',
  'number', 'string', 'bool', 'vector', 'list', 'angle',
]);

/** A `//` or `#` line comment, or a `/* *\/` block one. */
const COMMENT = String.raw`\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/`;

/** A double-quoted string, in which a backslash escapes the next character. */
const STRING = String.raw`"(?:\\.|[^"\\])*"`;

/** A decimal number, with an optional fraction and exponent. */
const NUMBER = String.raw`\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`;

/** A name. Hyphens are part of one, which is why `a-b` is not a subtraction. */
const IDENT = '[A-Za-z_][A-Za-z0-9_-]*';

/** One pass over a snippet, longest match first: comments and strings before anything else. */
const TOKEN = new RegExp(`(${COMMENT})|(${STRING})|(${NUMBER})|(${IDENT})`, 'g');

/**
 * @typedef {object} Segment
 * @property {string} text The source this segment covers.
 * @property {string} cls The CSS class to draw it in, or the empty string for none.
 */

/**
 * Classifies one identifier by what follows it and which registry holds it.
 *
 * @param {string} word The identifier.
 * @param {string} rest The source after it.
 * @returns {string} A token class, or the empty string to leave it unstyled.
 */
function classifyIdentifier(word, rest) {
  if (KEYWORDS.has(word)) return 'tok-k';
  // `size =` is an attribute; `size ==` is a comparison against a name.
  if (/^\s*=(?!=)/.test(rest)) return 'tok-a';
  if (/^\s*\(/.test(rest) && FUNCTION_NAMES.has(word)) return 'tok-f';
  if (BLOCK_NAMES.has(word)) return 'tok-b';
  if (CONSTANT_NAMES.has(word)) return 'tok-c';
  return '';
}

/**
 * Splits a snippet into coloured segments, in source order and covering it completely.
 *
 * Deliberately regex-based rather than a real parse: the demo highlights a half-typed
 * document, which a parser would reject outright.
 *
 * @param {string} code The snippet.
 * @returns {Segment[]} The segments, whose texts concatenate back to `code`.
 */
export function segments(code) {
  /** @type {Segment[]} */
  const out = [];
  let last = 0;

  /**
   * @param {string} text The text to add.
   * @param {string} cls Its class.
   * @returns {void}
   */
  const push = (text, cls) => { if (text) out.push({ text, cls }); };

  for (const match of code.matchAll(TOKEN)) {
    const [text, comment, string, number, identifier] = match;
    push(code.slice(last, match.index), '');
    last = match.index + text.length;

    if (comment) push(text, 'tok-m');
    else if (string) push(text, 'tok-s');
    else if (number) push(text, 'tok-n');
    else push(text, classifyIdentifier(identifier, code.slice(last)));
  }

  push(code.slice(last), '');
  return out;
}

/**
 * Renders the first `count` characters of a highlighted snippet into an element.
 *
 * The segments are computed once for the whole document and then sliced, so a character
 * never changes colour as the rest of its line arrives — which is what makes typing read
 * as writing rather than as a lint pass.
 *
 * @param {Element} target Where to put the nodes. Its contents are replaced.
 * @param {ReadonlyArray<Segment>} parts The whole snippet, already classified.
 * @param {number} count How many characters to show.
 * @param {boolean} [caret] Whether to draw a caret after the last one.
 * @returns {void}
 */
export function paint(target, parts, count, caret = false) {
  const fragment = document.createDocumentFragment();
  let left = count;

  for (const part of parts) {
    if (left <= 0) break;
    const text = part.text.length <= left ? part.text : part.text.slice(0, left);
    left -= text.length;

    if (!part.cls) {
      fragment.append(text);
      continue;
    }
    const span = document.createElement('span');
    span.className = part.cls;
    span.textContent = text;
    fragment.append(span);
  }

  if (caret) {
    const cursor = document.createElement('i');
    cursor.className = 'caret';
    fragment.append(cursor);
  }

  target.replaceChildren(fragment);
}

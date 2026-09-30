/**
 * Syntax highlighting for the editor, as a CodeMirror stream tokenizer.
 *
 * Deliberately not a second parser. The real one already reports errors with positions, and
 * all this needs to do is colour text and match brackets — a full grammar here would be a
 * second place the definition of the language had to be kept true.
 *
 * What it must not do is guess at the vocabulary: the block and function names come from the
 * library's own registries, so a block added to the language is highlighted without anyone
 * remembering to add it here.
 */

import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { BLOCKS, FUNCTIONS } from 'forma-dsl';

const DECLARATIONS = new Set(['param', 'local', 'component', 'model', 'part']);
const CONTROL = new Set(['for', 'in', 'if', 'else']);
const ATOMS = new Set(['true', 'false', 'null']);
const TYPES = new Set(['number', 'string', 'bool', 'vector', 'list', 'angle']);

// Taken from the registries rather than restated, so a block or function added to the
// language is highlighted without anyone remembering to update a list here.
const SHAPES = new Set(Object.keys(BLOCKS));
const CALLS = new Set(Object.keys(FUNCTIONS));

/** A name followed by an optional label and then `{` is being used as a block. */
const BLOCK_AHEAD = /^\s*("[^"]*"\s*)*\{/;

/** A name followed by `(` is being called. */
const CALL_AHEAD = /^\s*\(/;

/** A name followed by a single `=` is an attribute, not a comparison. */
const ATTRIBUTE_AHEAD = /^\s*=[^=]/;

/**
 * Classifies one name, given what follows it on the line.
 *
 * @param {string} word The name.
 * @param {string} rest The remainder of the line after it.
 * @returns {string} A CodeMirror token type.
 */
function classifyWord(word, rest) {
  if (DECLARATIONS.has(word)) return 'keyword';
  if (CONTROL.has(word)) return 'controlKeyword';
  if (ATOMS.has(word)) return 'atom';
  if (TYPES.has(word)) return 'typeName';
  // A name followed by `{` is being used as a block, which is how a component call looks;
  // highlighting it like a builtin is the point, not an accident.
  if (SHAPES.has(word) || BLOCK_AHEAD.test(rest)) return 'tagName';
  if (CALLS.has(word) && CALL_AHEAD.test(rest)) return 'function';
  if (ATTRIBUTE_AHEAD.test(rest)) return 'attributeName';
  return 'variableName';
}

/**
 * A stream tokenizer rather than a Lezer grammar.
 *
 * The editor only needs colour and bracket matching; the real parser already reports errors
 * with positions, so a second full grammar here would be a second place to keep the language
 * definition correct.
 */
const forma = StreamLanguage.define({
  name: 'forma',

  /**
   * @param {import('@codemirror/language').StringStream} stream The line being scanned.
   * @returns {string | null} A token type, or null for whitespace and punctuation.
   */
  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match('//') || stream.match('#')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) {
      // Block comments are not tracked across lines: highlighting the rest of this line is
      // close enough, and the alternative is carrying state the tokenizer does not need.
      while (!stream.eol()) {
        if (stream.match('*/')) break;
        stream.next();
      }
      return 'comment';
    }

    // The trailing `"?` matches a string that is still being typed and has no closing quote.
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_-]*/)) {
      return classifyWord(stream.current(), stream.string.slice(stream.pos));
    }

    if (stream.match(/^(==|!=|<=|>=|&&|\|\||[-+*/%<>!?:=])/)) return 'operator';
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
    indentOnInput: /^\s*\}$/,
  },
});

/** The colours the editor paints each token type. */
export const formaHighlight = HighlightStyle.define([
  { tag: tags.comment, color: '#5d6b7a', fontStyle: 'italic' },
  { tag: tags.keyword, color: '#c792ea', fontWeight: '600' },
  { tag: tags.controlKeyword, color: '#f78c6c', fontWeight: '600' },
  { tag: tags.tagName, color: '#82aaff', fontWeight: '600' },
  { tag: tags.attributeName, color: '#7fdbca' },
  { tag: tags.typeName, color: '#ffcb6b' },
  { tag: tags.function(tags.variableName), color: '#c3e88d' },
  { tag: tags.string, color: '#ecc48d' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.atom, color: '#ff5874' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.variableName, color: '#d6deeb' },
]);

/**
 * @returns {LanguageSupport} The forma language, ready to hand to CodeMirror.
 */
export function formaLanguage() {
  return new LanguageSupport(forma, [syntaxHighlighting(formaHighlight)]);
}

import { StreamLanguage, LanguageSupport, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { BLOCKS, FUNCTIONS } from '../src/lang/builtins.js';

const DECLARATIONS = new Set(['param', 'local', 'component', 'model', 'part']);
const CONTROL = new Set(['for', 'in', 'if', 'else']);
const ATOMS = new Set(['true', 'false', 'null']);
const TYPES = new Set(['number', 'string', 'bool', 'vector', 'list', 'angle']);
const SHAPES = new Set(Object.keys(BLOCKS));
const CALLS = new Set(Object.keys(FUNCTIONS));

/// A stream tokenizer rather than a Lezer grammar.
///
/// The editor only needs colour and bracket matching; the real parser already reports
/// errors with positions, so a second full grammar here would be a second place to keep
/// the language definition correct.
const forma = StreamLanguage.define({
  name: 'forma',

  token(stream) {
    if (stream.eatSpace()) return null;

    if (stream.match('//') || stream.match('#')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) {
      while (!stream.eol()) {
        if (stream.match('*/')) break;
        stream.next();
      }
      return 'comment';
    }

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_-]*/)) {
      const word = stream.current();
      if (DECLARATIONS.has(word)) return 'keyword';
      if (CONTROL.has(word)) return 'controlKeyword';
      if (ATOMS.has(word)) return 'atom';
      if (TYPES.has(word)) return 'typeName';
      // A name followed by `{` is being used as a block, which is how a component call
      // looks; highlighting it like a builtin is the point, not an accident.
      const rest = stream.string.slice(stream.pos);
      if (SHAPES.has(word) || /^\s*("[^"]*"\s*)*\{/.test(rest)) return 'tagName';
      if (CALLS.has(word) && /^\s*\(/.test(rest)) return 'function';
      if (/^\s*=[^=]/.test(rest)) return 'attributeName';
      return 'variableName';
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

export function formaLanguage() {
  return new LanguageSupport(forma, [syntaxHighlighting(formaHighlight)]);
}

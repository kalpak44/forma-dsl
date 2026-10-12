/**
 * Completion for the editor: what can be written where the cursor is.
 *
 * Two sources of truth, and neither of them is a list kept here. The vocabulary comes from
 * the library's own registries, so a block added to the language is offered without anyone
 * remembering to add it; and the names a particular document declares come from parsing that
 * document, so a component is offered the moment it has been written.
 *
 * What it deliberately does not offer is a block's attributes. The registries carry each
 * block's dimensionality but not its attribute names - those are read inside `build` - and
 * transcribing them here would be a second place to keep the language's definition true,
 * which is exactly what this file exists to avoid. The reference manual is one click away.
 *
 * Position is decided by what precedes the cursor rather than by a parse: the document is
 * usually mid-edit and does not parse, and a tokenizer good enough to tell "inside a body"
 * from "after `var.`" is a few regexes rather than a second grammar.
 */
/** @import { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete' */

import { snippetCompletion } from '@codemirror/autocomplete';
import { BLOCKS, CONSTANTS, FUNCTIONS, Program, TYPE_NAMES } from 'forma-dsl';

/** The blocks that may open a document, which is the only place they are legal. */
const TOP_LEVEL = ['param', 'local', 'component', 'model'];

/** What may be written inside a `model` or a `component` body, beyond the blocks themselves. */
const BODY_KEYWORDS = ['part', 'for', 'if', 'else'];

/** Values that are their own spelling. */
const ATOMS = ['true', 'false'];

/**
 * The keywords that are worth completing as a shape rather than as a word.
 *
 * A `model` is never written without a label and a body, so offering the three together is
 * the difference between a completion that saves a keystroke and one that saves the reader
 * looking up where the quotes go. Everything not named here completes as itself.
 */
const KEYWORD_SNIPPETS = {
  model: 'model "${name}" {\n  ${}\n}',
  component: 'component "${name}" {\n  ${}\n}',
  part: 'part "${name}" {\n  ${}\n}',
  param: 'param ${name} = ${}',
  local: 'local ${name} = ${}',
  for: 'for ${i} in ${range(4)} {\n  ${}\n}',
  if: 'if ${condition} {\n  ${}\n}',
};

/**
 * A block with a body, which is how every block and every component call is written.
 *
 * @param {string} name What the block is called.
 * @returns {string} The snippet template, with the cursor left inside the braces.
 */
const BODY = (name) => `${name} {\n  \${}\n}`;

/**
 * Says what a block produces and consumes, which is the fact that decides whether it belongs
 * where the cursor is - a 2D shape under an `extrude`, a 3D one not.
 *
 * @param {string} name The block's name.
 * @returns {string} One short phrase, for the completion's detail column.
 */
function blockDetail(name) {
  const { dim, leaf, takes } = BLOCKS[name];

  if (leaf) return `${dim}D shape`;
  if (takes === 'same') return '2D or 3D';
  if (takes && dim && takes !== dim) return `${takes}D to ${dim}D`;
  return takes ? `${takes}D` : 'operation';
}

/**
 * Says how many arguments a function takes, from the registry rather than from a list here.
 *
 * @param {string} name The function's name.
 * @returns {string} The arity, for the completion's detail column.
 */
function functionDetail(name) {
  const { arity } = FUNCTIONS[name];
  if (arity === null) return 'variadic';
  return arity === 1 ? '1 argument' : `${arity} arguments`;
}

/**
 * The completions that never depend on the document: the language's own vocabulary.
 *
 * Built once, at module load. The registries do not change at runtime, and rebuilding forty
 * objects on every keystroke to get the same forty back is work the editor does not need.
 *
 * @returns {Completion[]} Every block, function, constant, type name and keyword.
 */
function vocabulary() {
  return [
    ...Object.keys(BLOCKS).map((name) => snippetCompletion(BODY(name), {
      label: name,
      type: BLOCKS[name].leaf ? 'class' : 'function',
      detail: blockDetail(name),
    })),
    ...Object.keys(FUNCTIONS).map((name) => snippetCompletion(`${name}(\${})`, {
      label: name, type: 'function', detail: functionDetail(name),
    })),
    ...Object.keys(CONSTANTS).map((name) => ({ label: name, type: 'constant', detail: 'constant' })),
    ...TYPE_NAMES.map((name) => ({ label: name, type: 'type', detail: 'param type' })),
    ...ATOMS.map((label) => ({ label, type: 'atom' })),
    ...[...TOP_LEVEL, ...BODY_KEYWORDS].map((name) => (KEYWORD_SNIPPETS[name]
      ? snippetCompletion(KEYWORD_SNIPPETS[name], { label: name, type: 'keyword' })
      : { label: name, type: 'keyword' })),
  ];
}

/** The language's own names, which cost nothing to keep. */
const VOCABULARY = vocabulary();

/** The subset legal at the top of a document, where only four blocks may appear. */
const TOP_LEVEL_ONLY = VOCABULARY.filter((option) => TOP_LEVEL.includes(option.label));

/**
 * The names the document itself declares, as completions.
 *
 * A document mid-edit usually does not parse, and the last good parse is the better answer
 * than none: a component stays on offer while the line below it is being typed.
 *
 * @param {string} source The document.
 * @returns {Completion[]} Its components, params and locals.
 */
function declared(source) {
  const program = Program.parse(source);

  return [
    ...[...program.components.keys()].map((name) => snippetCompletion(BODY(name), {
      label: name, type: 'class', detail: 'component',
    })),
    ...[...program.params.keys()].map((name) => ({ label: name, type: 'variable', detail: 'param' })),
    ...program.locals.map((local) => ({ label: local.name, type: 'variable', detail: 'local' })),
  ];
}

/**
 * The last parse that succeeded, so a keystroke that breaks the document does not empty the
 * list of everything it declares.
 *
 * @type {{ source: string, options: Completion[] }}
 */
let lastGood = { source: '', options: [] };

/**
 * What the document declares, from this parse or from the last one that worked.
 *
 * @param {string} source The document.
 * @returns {Completion[]} Its declarations.
 */
function declarations(source) {
  if (source === lastGood.source) return lastGood.options;

  try {
    lastGood = { source, options: declared(source) };
  } catch {
    // Mid-edit, which is most keystrokes. The previous answer is stale by one edit and is
    // still a far better list than nothing.
  }
  return lastGood.options;
}

/** `var.` reaches params and only params, so that prefix answers with exactly those. */
const VAR_PREFIX = /var\.\w*$/;

/**
 * Nothing but indentation between the start of the line and the cursor.
 *
 * The whitespace class is `[ \t]` rather than `\s` on purpose: `\s` matches the newline the
 * alternation has already consumed, and a pattern that can match the same character two ways
 * is one that backtracks over the whole document.
 */
const AT_TOP_LEVEL = /(?:^|\n)[ \t]*\w*$/;

/**
 * Whether the cursor sits at the top level of the document rather than inside a body.
 *
 * Counted rather than parsed: braces that balance to zero before the cursor mean every block
 * opened so far has closed, which is the question being asked. Braces inside strings and
 * comments would spoil the count, and are rare enough in a document being typed that the
 * occasional wrong answer costs one irrelevant suggestion.
 *
 * @param {string} before Everything up to the cursor.
 * @returns {boolean} True at the top level.
 */
function atTopLevel(before) {
  let depth = 0;
  for (const character of before) {
    if (character === '{') depth++;
    else if (character === '}') depth--;
  }
  return depth <= 0 && AT_TOP_LEVEL.test(before);
}

/**
 * Completes forma, from the language's registries and from the document itself.
 *
 * @param {CompletionContext} context Where the cursor is, and what is around it.
 * @returns {CompletionResult | null} What may be written there, or null to offer nothing.
 */
export function completeForma(context) {
  const before = context.state.sliceDoc(0, context.pos);
  const source = context.state.doc.toString();

  if (VAR_PREFIX.test(before)) {
    const word = context.matchBefore(/\w*/);
    const params = declarations(source).filter((option) => option.detail === 'param');
    return { from: word.from, options: params, validFor: /^\w*$/ };
  }

  const word = context.matchBefore(/[\w-]*/);
  if (!word) return null;
  // An empty position is worth completing only when the reader asked for it, or there would
  // be a list in the way of every newline.
  if (word.from === word.to && !context.explicit) return null;

  const options = atTopLevel(before)
    ? TOP_LEVEL_ONLY
    : [...VOCABULARY, ...declarations(source)];

  return { from: word.from, options, validFor: /^[\w-]*$/ };
}

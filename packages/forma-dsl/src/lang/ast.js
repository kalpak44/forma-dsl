/** @import { SourceLocation } from '../index.js' */

/**
 * The shapes the parser produces, as types only.
 *
 * This module has no runtime content. It exists because the AST was previously implicit:
 * the set of `kind` values, and what each one carries, could only be recovered by reading
 * the parser and the evaluator side by side and hoping they agreed.
 *
 * @module
 */

export {};

/**
 * A number, string, boolean or null written directly in the source.
 *
 * @typedef {object} LiteralExpression
 * @property {'literal'} kind Discriminant.
 * @property {number | string | boolean | null} value The value.
 * @property {SourceLocation} [loc] Where it was written.
 */

/**
 * A `"..."` string with at least one `${...}` splice in it.
 *
 * @typedef {object} TemplateExpression
 * @property {'template'} kind Discriminant.
 * @property {Array<{ kind: 'text', value: string } | { kind: 'expr', expression: Expression }>} parts
 *   The literal runs and the spliced expressions, in source order.
 * @property {SourceLocation} loc Where the string began.
 */

/**
 * A `[a, b, c]` list.
 *
 * @typedef {object} ArrayExpression
 * @property {'array'} kind Discriminant.
 * @property {Expression[]} items The elements.
 * @property {SourceLocation} loc Where the bracket was.
 */

/**
 * A `{ key = value }` object.
 *
 * @typedef {object} ObjectExpression
 * @property {'object'} kind Discriminant.
 * @property {Array<{ key: string, value: Expression }>} entries The entries, in source order.
 * @property {SourceLocation} loc Where the brace was.
 */

/**
 * A bare name, resolved against the enclosing scopes.
 *
 * @typedef {object} IdentifierExpression
 * @property {'identifier'} kind Discriminant.
 * @property {string} name The name.
 * @property {SourceLocation} loc Where the name was.
 */

/**
 * A `target.property` access. Also covers `.x`/`.y`/`.z` on a list.
 *
 * @typedef {object} MemberExpression
 * @property {'member'} kind Discriminant.
 * @property {Expression} object What is being read from.
 * @property {string} property The property name.
 * @property {SourceLocation} [loc] Where the dot was.
 */

/**
 * A `target[index]` access.
 *
 * @typedef {object} IndexExpression
 * @property {'index'} kind Discriminant.
 * @property {Expression} object What is being indexed.
 * @property {Expression} index The index.
 * @property {SourceLocation} [loc] Where the bracket was.
 */

/**
 * A prefix `-` or `!`.
 *
 * @typedef {object} UnaryExpression
 * @property {'unary'} kind Discriminant.
 * @property {'-' | '!'} op The operator.
 * @property {Expression} operand What it applies to.
 * @property {SourceLocation} loc Where the operator was.
 */

/**
 * An infix operator. `&&` and `||` short-circuit; the rest evaluate both sides.
 *
 * @typedef {object} BinaryExpression
 * @property {'binary'} kind Discriminant.
 * @property {string} op The operator.
 * @property {Expression} left The left operand.
 * @property {Expression} right The right operand.
 * @property {SourceLocation} loc Where the operator was.
 */

/**
 * A `condition ? consequent : alternate`.
 *
 * @typedef {object} ConditionalExpression
 * @property {'conditional'} kind Discriminant.
 * @property {Expression} condition What decides.
 * @property {Expression} consequent The value when truthy.
 * @property {Expression} alternate The value when not.
 * @property {SourceLocation} [loc] Where it was written.
 */

/**
 * A call to one of the builtin functions. There are no user-defined functions.
 *
 * @typedef {object} CallExpression
 * @property {'call'} kind Discriminant.
 * @property {Expression} callee Must resolve to an identifier naming a builtin.
 * @property {Array<{ name: string | null, value: Expression }>} args The arguments.
 * @property {SourceLocation} loc Where the parenthesis was.
 */

/**
 * Anything that evaluates to a value.
 *
 * @typedef {LiteralExpression | TemplateExpression | ArrayExpression | ObjectExpression
 *   | IdentifierExpression | MemberExpression | IndexExpression | UnaryExpression
 *   | BinaryExpression | ConditionalExpression | CallExpression} Expression
 */

/**
 * A `name = expression` inside a block body.
 *
 * @typedef {object} Attribute
 * @property {string} name The attribute name.
 * @property {Expression} value The value.
 * @property {SourceLocation} [loc] Where the name was.
 */

/**
 * The contents of a `{ ... }`, sorted by what each entry is.
 *
 * @typedef {object} Body
 * @property {Attribute[]} attributes The `name = value` entries.
 * @property {Array<Block | ForBlock | IfBlock>} blocks The nested blocks, in source order.
 * @property {ParamDeclaration[]} params Params declared in this body.
 * @property {LocalDeclaration[]} locals Locals declared in this body.
 */

/**
 * A nested block: a shape, an operation, a part, or a call to a component.
 *
 * @typedef {object} Block
 * @property {'block'} kind Discriminant.
 * @property {string} type Which block, such as `box` or `translate`.
 * @property {Expression[]} labels The labels before the brace, as expressions, so a part
 *   built in a loop can name itself from the loop variable.
 * @property {Body} body Its attributes and children.
 * @property {SourceLocation} loc Where the block began.
 */

/**
 * A `for name in sequence { ... }`, optionally with an index variable.
 *
 * @typedef {object} ForBlock
 * @property {'for'} kind Discriminant.
 * @property {string[]} names One name binds the value; two bind the index and the value.
 * @property {Expression} sequence What to iterate.
 * @property {Body} body What to emit per iteration.
 * @property {SourceLocation} loc Where the `for` was.
 */

/**
 * An `if condition { ... } else { ... }`.
 *
 * @typedef {object} IfBlock
 * @property {'if'} kind Discriminant.
 * @property {Expression} condition What decides.
 * @property {Body} consequent The branch taken when truthy.
 * @property {Body | null} alternate The branch taken otherwise, if there is one.
 * @property {SourceLocation} loc Where the `if` was.
 */

/**
 * A `param name { ... }` or `param name = expression`.
 *
 * @typedef {object} ParamDeclaration
 * @property {'param'} kind Discriminant.
 * @property {string} name The param name.
 * @property {Attribute[]} attributes Its metadata; only `default` affects geometry.
 * @property {SourceLocation} loc Where the declaration began.
 */

/**
 * A `local name = expression`.
 *
 * @typedef {object} LocalDeclaration
 * @property {'local'} kind Discriminant.
 * @property {string} name The local's name.
 * @property {Expression} value Its value, computed once.
 * @property {SourceLocation} loc Where the declaration began.
 */

/**
 * A `component "name" { ... }` or `model "name" { ... }`.
 *
 * @typedef {object} NamedDeclaration
 * @property {'component' | 'model'} kind Which of the two.
 * @property {string} name The declared name, always static.
 * @property {Body} body Its contents.
 * @property {SourceLocation} loc Where the declaration began.
 */

/**
 * Anything that can appear at the top level of a document.
 *
 * @typedef {ParamDeclaration | LocalDeclaration | NamedDeclaration} Declaration
 */

/**
 * A whole parsed document.
 *
 * @typedef {object} Document
 * @property {'document'} kind Discriminant.
 * @property {Declaration[]} declarations The top-level blocks, in source order.
 */

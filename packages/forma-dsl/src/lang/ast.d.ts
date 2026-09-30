/**
 * The shapes the parser produces.
 *
 * It exists because the AST was previously implicit: the set of `kind` values, and what each
 * one carries, could only be recovered by reading the parser and the evaluator side by side
 * and hoping they agreed.
 *
 * Declarations rather than JSDoc typedefs, which is what this always was — there is no
 * runtime content here, so there is nothing for a `.js` file to carry and nothing to build.
 * Written as types, a discriminant is `kind: 'unary'` rather than a `@property` whose
 * description the lint obliged someone to invent.
 */

import type { SourceLocation } from '../index.js';

/** A number, string, boolean or null written directly in the source. */
export interface LiteralExpression {
  kind: 'literal';
  value: number | string | boolean | null;
  loc?: SourceLocation;
}

/** A `"..."` string with at least one `${...}` splice in it. */
export interface TemplateExpression {
  kind: 'template';
  /** The literal runs and the spliced expressions, in source order. */
  parts: Array<{ kind: 'text'; value: string } | { kind: 'expr'; expression: Expression }>;
  loc: SourceLocation;
}

/** A `[a, b, c]` list. */
export interface ArrayExpression {
  kind: 'array';
  items: Expression[];
  loc: SourceLocation;
}

/** A `{ key = value }` object. */
export interface ObjectExpression {
  kind: 'object';
  entries: Array<{ key: string; value: Expression }>;
  loc: SourceLocation;
}

/** A bare name, resolved against the enclosing scopes. */
export interface IdentifierExpression {
  kind: 'identifier';
  name: string;
  loc: SourceLocation;
}

/** A `target.property` access. Also covers `.x`/`.y`/`.z` on a list. */
export interface MemberExpression {
  kind: 'member';
  object: Expression;
  property: string;
  loc?: SourceLocation;
}

/** A `target[index]` access. */
export interface IndexExpression {
  kind: 'index';
  object: Expression;
  index: Expression;
  loc?: SourceLocation;
}

/** A prefix `-` or `!`. */
export interface UnaryExpression {
  kind: 'unary';
  op: '-' | '!';
  operand: Expression;
  loc: SourceLocation;
}

/** An infix operator. `&&` and `||` short-circuit; the rest evaluate both sides. */
export interface BinaryExpression {
  kind: 'binary';
  op: string;
  left: Expression;
  right: Expression;
  loc: SourceLocation;
}

/** A `condition ? consequent : alternate`. */
export interface ConditionalExpression {
  kind: 'conditional';
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
  loc?: SourceLocation;
}

/** A call to one of the builtin functions. There are no user-defined functions. */
export interface CallExpression {
  kind: 'call';
  /** Must resolve to an identifier naming a builtin. */
  callee: Expression;
  args: Array<{ name: string | null; value: Expression }>;
  loc: SourceLocation;
}

/** Anything that evaluates to a value. */
export type Expression =
  | LiteralExpression | TemplateExpression | ArrayExpression | ObjectExpression
  | IdentifierExpression | MemberExpression | IndexExpression | UnaryExpression
  | BinaryExpression | ConditionalExpression | CallExpression;

/** A `name = expression` inside a block body. */
export interface Attribute {
  name: string;
  value: Expression;
  loc?: SourceLocation;
}

/** The contents of a `{ ... }`, sorted by what each entry is. */
export interface Body {
  attributes: Attribute[];
  blocks: Array<Block | ForBlock | IfBlock>;
  params: ParamDeclaration[];
  locals: LocalDeclaration[];
}

/** A nested block: a shape, an operation, a part, or a call to a component. */
export interface Block {
  kind: 'block';
  /** Which block, such as `box` or `translate`. */
  type: string;
  /**
   * The labels before the brace, as expressions, so a part built in a loop can name itself
   * from the loop variable.
   */
  labels: Expression[];
  body: Body;
  loc: SourceLocation;
}

/** A `for name in sequence { ... }`, optionally with an index variable. */
export interface ForBlock {
  kind: 'for';
  /** One name binds the value; two bind the index and the value. */
  names: string[];
  sequence: Expression;
  body: Body;
  loc: SourceLocation;
}

/** An `if condition { ... } else { ... }`. */
export interface IfBlock {
  kind: 'if';
  condition: Expression;
  consequent: Body;
  /** The branch taken otherwise, if there is one. */
  alternate: Body | null;
  loc: SourceLocation;
}

/** A `param name { ... }` or `param name = expression`. */
export interface ParamDeclaration {
  kind: 'param';
  name: string;
  /** Its metadata; only `default` affects geometry. */
  attributes: Attribute[];
  loc: SourceLocation;
}

/** A `local name = expression`. */
export interface LocalDeclaration {
  kind: 'local';
  name: string;
  /** Its value, computed once. */
  value: Expression;
  loc: SourceLocation;
}

/** A `component "name" { ... }` or `model "name" { ... }`. */
export interface NamedDeclaration {
  kind: 'component' | 'model';
  /** The declared name, always static. */
  name: string;
  body: Body;
  loc: SourceLocation;
}

/** Anything that can appear at the top level of a document. */
export type Declaration = ParamDeclaration | LocalDeclaration | NamedDeclaration;

/** A whole parsed document. */
export interface Document {
  kind: 'document';
  declarations: Declaration[];
}

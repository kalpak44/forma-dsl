/**
 * Turning a failure into something the editor can underline, and knowing when it has stopped
 * being true.
 *
 * A diagnostic is a pair of absolute offsets into the document it was computed against. That
 * makes it wrong, rather than merely out of date, the moment the document is edited: the
 * offsets still resolve, but to whatever text has since moved into them. The editor showing
 * an error under a line that was never the problem is what this file exists to prevent, and
 * why {@link Diagnostics} has an `invalidate` at all.
 *
 * Kept apart from `main.js` and free of the DOM so the rule can be tested without a browser —
 * the bug it fixes lived in an event handler precisely because the invariant was implicit.
 */

import { FormaError } from 'forma-dsl';

/**
 * @typedef {object} Diagnostic
 * @property {number} from Where the underline starts.
 * @property {number} to Where it ends.
 * @property {string} severity CodeMirror's severity.
 * @property {string} message What to say.
 */

/**
 * The part of CodeMirror's document this needs, named so a test can pass a plain object.
 *
 * @typedef {object} Doc
 * @property {number} lines How many lines it has.
 * @property {(n: number) => { from: number, to: number }} line One line, 1-based.
 */

/**
 * Maps a failure's line and column onto document offsets so the editor can underline it.
 *
 * The line is clamped to the document: an error can outlive the text it was raised against by
 * a few milliseconds, and underlining the last line is better than throwing while reporting.
 *
 * @param {Error} error The failure.
 * @param {Doc} doc The document it was raised against.
 * @returns {Diagnostic} A CodeMirror diagnostic. An error with no position is attached to the
 *   start of the document, which is at least somewhere the reader can see it.
 */
export function diagnosticFor(error, doc) {
  if (!(error instanceof FormaError) || !error.loc) {
    return { from: 0, to: 0, severity: 'error', message: error.message };
  }
  const line = doc.line(Math.min(Math.max(error.loc.line, 1), doc.lines));
  const from = Math.min(line.from + Math.max(error.loc.column - 1, 0), line.to);
  return { from, to: line.to, severity: 'error', message: error.message };
}

/**
 * What the editor is currently underlining.
 *
 * The linter reads this on every document change, which is more often than a render finishes.
 * Holding the rule here rather than in the update listener is what makes it statable: what is
 * shown was computed against the document as it is now, or nothing is shown.
 */
export class Diagnostics {
  /** @type {Diagnostic[]} What the last finished render produced, if it is still true. */
  #current = [];

  /**
   * What the linter should draw.
   *
   * @returns {Diagnostic[]} The diagnostics in force, which is the empty list unless a render
   *   has finished since the last edit.
   */
  read() {
    return this.#current;
  }

  /**
   * A render finished and reported a failure.
   *
   * @param {Error} error What it failed with.
   * @param {Doc} doc The document it was rendering, which is the one the offsets are for.
   * @returns {void}
   */
  fail(error, doc) {
    this.#current = [diagnosticFor(error, doc)];
  }

  /**
   * A render finished and there was nothing wrong.
   *
   * @returns {void}
   */
  pass() {
    this.#current = [];
  }

  /**
   * The document changed, so anything held is no longer true of it.
   *
   * Showing nothing until the next render has actually checked the text beats showing an
   * error whose offsets now point somewhere else.
   *
   * @returns {void}
   */
  invalidate() {
    this.#current = [];
  }
}

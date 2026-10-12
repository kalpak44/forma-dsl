/**
 * Rendering the lines around an error, with a caret under the column it points at.
 *
 * Every error the language raises carries a position, and a position on its own still makes
 * the reader count lines. This turns one into something that can be printed next to the
 * message - which is what the CLI writes to stderr and what the MCP server hands back to a
 * model that has just written a document that does not parse.
 *
 * It lives in the library rather than in either consumer because both want the same answer,
 * and two copies of it would be two things to keep agreeing about what a column means.
 */
/** @import { SourceLocation } from '../index.js' */

/** How many lines of source to show either side of the one in question. */
const CONTEXT_LINES = 2;

/**
 * Renders a source excerpt with a caret under the column an error points at.
 *
 * @param {string} source The document.
 * @param {Pick<SourceLocation, 'line' | 'column'> | null} [loc] Where the error was raised.
 * @returns {string | undefined} The excerpt, or undefined when there is no position to show.
 */
export function excerpt(source, loc = null) {
  if (!loc || !Number.isInteger(loc.line)) return undefined;

  const lines = source.split('\n');
  const first = Math.max(1, loc.line - CONTEXT_LINES);
  const last = Math.min(lines.length, loc.line + CONTEXT_LINES);
  const width = String(last).length;

  /** @type {string[]} */
  const out = [];
  for (let n = first; n <= last; n++) {
    out.push(`${String(n).padStart(width)} | ${lines[n - 1]}`);
    if (n === loc.line) {
      out.push(`${' '.repeat(width)} | ${' '.repeat(Math.max(0, loc.column - 1))}^`);
    }
  }
  return out.join('\n');
}

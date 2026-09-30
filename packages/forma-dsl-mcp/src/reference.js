/**
 * The reference manual, bundled and searchable.
 *
 * The manual is the language's own documentation, copied into the package by
 * `scripts/sync-reference.mjs` rather than paraphrased, so an answer from here is the same
 * answer a person reading the published docs would get. Search is deliberately simple —
 * substring matching over headings and body text, ranked — because the corpus is 28 pages
 * and anything cleverer would be a dependency and a source of surprise.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the copied manual lives inside the package. */
const ROOT = fileURLToPath(new URL('./reference/', import.meta.url));

/** How many characters of context a search hit carries. */
const SNIPPET = 320;

/**
 * The manual's pages, in reading order rather than directory order.
 *
 * Written out because a listing would put `align` before `param`, which is not the order
 * anyone learns this in. A page on disk that is missing from here is a failure the tests
 * catch, so the list cannot silently fall behind the manual.
 *
 * @type {Array<{ path: string, title: string, about: string }>}
 */
export const PAGES = [
  { path: 'README.md', title: 'Reference index', about: 'Every construct, listed and linked' },
  { path: 'language/overview.md', title: 'Document structure', about: 'The four top-level blocks, the pipeline, nesting, dimensionality' },
  { path: 'language/syntax.md', title: 'Syntax', about: 'Comments, numbers, strings, identifiers, labels, the newline rule, the grammar' },
  { path: 'language/expressions.md', title: 'Expressions', about: 'Values, operators, truthiness, interpolation, member access' },
  { path: 'language/scope.md', title: 'Scope and names', about: 'What is in scope where, var., shadowing, component isolation' },
  { path: 'language/control-flow.md', title: 'Control flow', about: 'for and if / else if / else' },
  { path: 'reference/param.md', title: 'param', about: 'Inputs, their metadata, and what is advisory' },
  { path: 'reference/local.md', title: 'local', about: 'Named values, ordering, and how they differ from params' },
  { path: 'reference/component.md', title: 'component', about: 'Reusable parameterised geometry' },
  { path: 'reference/model.md', title: 'model', about: 'Renderable scenes, model params, several models in one document' },
  { path: 'reference/shapes-2d.md', title: '2D shapes', about: 'rect, rounded_rect, circle, ellipse, regular_polygon, stadium, polygon' },
  { path: 'reference/shapes-3d.md', title: '3D shapes', about: 'box, sphere, cylinder, cone, torus' },
  { path: 'reference/booleans.md', title: 'Booleans', about: 'union, difference, intersection' },
  { path: 'reference/transforms.md', title: 'Transforms', about: 'translate, rotate, scale, mirror' },
  { path: 'reference/conversions.md', title: '2D to 3D and back', about: 'extrude, revolve, project, slice' },
  { path: 'reference/refinement.md', title: 'Refinement', about: 'offset, hull, refine, simplify, smooth, trim' },
  { path: 'reference/align.md', title: 'align', about: 'Placing geometry by measuring its bounding box' },
  { path: 'reference/part.md', title: 'part', about: 'Coloured pieces of the rendered scene' },
  { path: 'reference/functions.md', title: 'Functions', about: 'Every builtin function and constant' },
  { path: 'errors.md', title: 'Errors', about: 'Every error message, what raises it, and what to change' },
  { path: 'api/render.md', title: 'render', about: 'JavaScript API: compile a document and evaluate a model' },
  { path: 'api/describe-parameters.md', title: 'describeParameters', about: 'JavaScript API: read a document’s params without rendering' },
  { path: 'api/evaluation-context.md', title: 'EvaluationContext', about: 'JavaScript API: the digest cache and WASM ownership' },
  { path: 'api/geometry-node.md', title: 'GeometryNode', about: 'JavaScript API: the content-addressed geometry IR' },
  { path: 'api/kernel.md', title: 'Kernel', about: 'JavaScript API: loadKernel, setQuality, resetQuality' },
  { path: 'api/export.md', title: 'Export', about: 'JavaScript API: toRenderMesh and toBinarySTL' },
  { path: 'api/values.md', title: 'Values', about: 'JavaScript API: Vector, Angle, Transform' },
  { path: 'api/low-level.md', title: 'Low-level API', about: 'JavaScript API: Program, Evaluator, parse, tokenize, the registries' },
];

/** The pages, by path, so a lookup does not scan the list. */
const BY_PATH = new Map(PAGES.map((page) => [page.path, page]));

/**
 * Every page on disk, whether or not {@link PAGES} names it.
 *
 * Used by the tests to prove the two agree; nothing at runtime reads it.
 *
 * @returns {Promise<string[]>} Paths relative to the manual's root, sorted.
 */
export async function discoverPages() {
  /** @type {string[]} */
  const found = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name.endsWith('.md')) found.push(relative(ROOT, child));
    }
  };
  await walk(ROOT);
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Reads one page.
 *
 * @param {string} path The page, as {@link PAGES} spells it.
 * @returns {Promise<{ path: string, title: string, markdown: string }>} The page.
 * @throws {Error} If no such page exists.
 */
export async function readPage(path) {
  const normalised = path.replace(/^\.?\//, '');
  const page = BY_PATH.get(normalised);
  if (!page) {
    throw new Error(
      `no reference page "${path}" — the pages are ${PAGES.map((each) => each.path).join(', ')}`,
    );
  }
  return { path: page.path, title: page.title, markdown: await readFile(join(ROOT, page.path), 'utf8') };
}

/**
 * The heading a character offset falls under, so a hit can say where in the page it is.
 *
 * @param {string} markdown The page.
 * @param {number} offset Where the match was found.
 * @returns {string} The nearest heading above it, or the page's title.
 */
function headingAt(markdown, offset) {
  const before = markdown.slice(0, offset);
  const headings = before.match(/^#{1,4} .*$/gm);
  return headings?.length ? headings[headings.length - 1].replace(/^#+ /, '') : '';
}

/**
 * Searches the manual.
 *
 * Every term must appear somewhere in the page; pages are ranked by how often the terms
 * occur, with a heading match worth more than a body one.
 *
 * @param {string} query What to look for.
 * @param {number} [limit] How many hits to return.
 * @returns {Promise<Array<{ path: string, title: string, heading: string, snippet: string }>>}
 *   The hits, best first.
 */
export async function searchReference(query, limit = 6) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  /** @type {Array<{ score: number, path: string, title: string, heading: string, snippet: string }>} */
  const hits = [];

  for (const page of PAGES) {
    const markdown = await readFile(join(ROOT, page.path), 'utf8');
    const lower = markdown.toLowerCase();
    if (!terms.every((term) => lower.includes(term))) continue;

    const headings = (lower.match(/^#{1,4} .*$/gm) ?? []);
    const score = terms.reduce((total, term) => {
      const body = lower.split(term).length - 1;
      const named = headings.filter((heading) => heading.includes(term)).length;
      return total + body + named * 8;
    }, 0);

    const at = lower.indexOf(terms[0]);
    const from = Math.max(0, at - SNIPPET / 4);
    hits.push({
      score,
      path: page.path,
      title: page.title,
      heading: headingAt(markdown, at),
      snippet: markdown.slice(from, from + SNIPPET).trim(),
    });
  }

  return hits
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);
}

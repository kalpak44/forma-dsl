/**
 * Renders content/ into a static site under the repository's dist/docs/.
 *
 * The docs are written as Markdown so they read well in the repository and on GitHub; this
 * turns the same files into the published site without a second copy of the content.
 *
 * It is also a checker. Cross-references between reference pages are the part of
 * documentation that rots first, so every internal link and every `#anchor` is resolved
 * against the headings that actually exist, and the navigation is asserted to name every
 * page on disk exactly once. A broken link fails the build rather than shipping.
 */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

import { BLOCKS, FUNCTIONS, CONSTANTS } from 'forma-dsl';

// Anchored to this file, not to the working directory: npm runs a workspace script from
// that workspace, but a person debugging it runs `node apps/docs/build.mjs` from the root.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DOCS = join(HERE, 'content');
// Written into the editor's build output, so the site is one artifact: the editor at the
// root and the manual under /docs/.
const OUT = join(REPO, 'dist/docs');

/** Where a link that points outside the content tree is sent instead. */
const REPO_BLOB = 'https://github.com/kalpak44/forma-dsl/blob/main';

/** Links out of the content tree whose target is not in the repository. */
const outside = [];

/** Where the editor lives relative to the site root; deploys serve from a subdirectory. */
const BASE = process.env.VITE_BASE ?? '/';

/**
 * The sidebar, in reading order.
 *
 * Written out rather than discovered so the order is editorial: a directory listing would
 * put `booleans` before `param`, which is not how anyone learns this.
 */
const NAV = [
  {
    title: 'Overview',
    pages: [['README.md', 'Reference index']],
  },
  {
    title: 'Learn the language',
    pages: [
      ['language/overview.md', 'Document structure'],
      ['language/syntax.md', 'Syntax'],
      ['language/expressions.md', 'Expressions'],
      ['language/scope.md', 'Scope and names'],
      ['language/control-flow.md', 'Control flow'],
    ],
  },
  {
    title: 'Declarations',
    pages: [
      ['reference/param.md', 'param'],
      ['reference/local.md', 'local'],
      ['reference/component.md', 'component'],
      ['reference/model.md', 'model'],
    ],
  },
  {
    title: 'Geometry',
    pages: [
      ['reference/shapes-2d.md', '2D shapes'],
      ['reference/shapes-3d.md', '3D shapes'],
      ['reference/booleans.md', 'Booleans'],
      ['reference/transforms.md', 'Transforms'],
      ['reference/conversions.md', '2D ↔ 3D'],
      ['reference/refinement.md', 'Refinement'],
      ['reference/align.md', 'align'],
    ],
  },
  {
    title: 'Scene and expressions',
    pages: [
      ['reference/part.md', 'part'],
      ['reference/functions.md', 'Functions'],
    ],
  },
  {
    title: 'JavaScript API',
    pages: [
      ['api/render.md', 'render'],
      ['api/describe-parameters.md', 'describeParameters'],
      ['api/evaluation-context.md', 'EvaluationContext'],
      ['api/geometry-node.md', 'GeometryNode'],
      ['api/kernel.md', 'Kernel'],
      ['api/export.md', 'Export'],
      ['api/values.md', 'Values'],
      ['api/low-level.md', 'Compiler stages'],
    ],
  },
  {
    title: 'Reference',
    pages: [['errors.md', 'Errors']],
  },
];

// --- syntax highlighting ---------------------------------------------------------------

/** Names that introduce a construct. Mirrors the parser's own list. */
const KEYWORDS = new Set(['param', 'local', 'component', 'model', 'for', 'if', 'else', 'in', 'true', 'false', 'null']);

/**
 * Block names, taken from the registry rather than restated, plus the two the evaluator
 * handles itself and so are absent from it.
 */
const BLOCK_NAMES = new Set([...Object.keys(BLOCKS), 'part', 'align']);

/** Function names, from the registry. */
const FUNCTION_NAMES = new Set(Object.keys(FUNCTIONS));

/** Names that stand for a fixed value, plus the type names a param block writes bare. */
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
const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_-]*`;

/**
 * One pass over a forma snippet, longest-match first.
 *
 * Comments and strings come first so a `//` inside neither is mistaken for one. Assembled
 * from the four parts above rather than written as one literal: each part is legible on its
 * own, and the order they are joined in *is* the precedence rule.
 */
const TOKEN = new RegExp(`(${COMMENT})|(${STRING})|(${NUMBER})|(${IDENT})`, 'g');

/**
 * Escapes text for inclusion in HTML.
 *
 * @param {string} text The text.
 * @returns {string} The escaped text.
 */
function escapeHtml(text) {
  return text.replaceAll(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Classifies one identifier by what follows it and which registry holds it.
 *
 * @param {string} word The identifier.
 * @param {string} rest The source after it.
 * @returns {string | null} A CSS class, or null to leave it unstyled.
 */
function classifyIdentifier(word, rest) {
  if (KEYWORDS.has(word)) return 'k';
  // `size =` is an attribute; `size ==` is a comparison against a name.
  if (/^\s*=(?!=)/.test(rest)) return 'a';
  if (/^\s*\(/.test(rest) && FUNCTION_NAMES.has(word)) return 'f';
  if (BLOCK_NAMES.has(word)) return 'b';
  if (CONSTANT_NAMES.has(word)) return 'c';
  return null;
}

/**
 * Marks up a forma snippet.
 *
 * Deliberately regex-based rather than a real parse: snippets in documentation are often
 * fragments, and a parser would reject half of them.
 *
 * @param {string} code The snippet.
 * @returns {string} HTML.
 */
function highlight(code) {
  let out = '';
  let last = 0;

  for (const match of code.matchAll(TOKEN)) {
    const [text, comment, string, number, identifier] = match;
    out += escapeHtml(code.slice(last, match.index));
    last = match.index + text.length;

    if (comment) {
      out += `<span class="tok-m">${escapeHtml(text)}</span>`;
    } else if (string) {
      // `${…}` inside a string is an expression, and reads much better shown as one.
      out += `<span class="tok-s">${escapeHtml(text).replaceAll(
        /\$\{[^}]*\}/g, (splice) => `<span class="tok-i">${splice}</span>`,
      )}</span>`;
    } else if (number) {
      out += `<span class="tok-n">${escapeHtml(text)}</span>`;
    } else {
      const cls = classifyIdentifier(identifier, code.slice(last));
      out += cls ? `<span class="tok-${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
    }
  }

  return out + escapeHtml(code.slice(last));
}

// --- markdown --------------------------------------------------------------------------

/**
 * GitHub's heading-id rule, so an anchor written against the rendered Markdown on GitHub
 * also resolves on the built site.
 *
 * @param {string} text The heading's plain text.
 * @returns {string} The slug.
 */
function slugify(text) {
  return text.toLowerCase().trim()
    .replaceAll(/[^\w\- ]+/g, '')
    .replaceAll(/\s+/g, '-');
}

/**
 * Renders one page, collecting what the link checker needs.
 *
 * @param {string} file The page's path relative to docs/.
 * @param {string} markdown Its source.
 * @returns {{ html: string, title: string, headings: Array<{ id: string, text: string, depth: number }>, ids: Set<string>, links: Array<{ href: string, loc: string, emitted: string }> }}
 *   The rendered page and its headings, heading ids and internal links.
 */
function renderPage(file, markdown) {
  /** @type {Array<{ id: string, text: string, depth: number }>} */
  const headings = [];
  const ids = new Set();
  /** @type {Array<{ href: string, loc: string, emitted: string }>} */
  const links = [];
  let title = file;

  const renderer = {
    /**
     * @param {{ text: string, lang?: string }} token The code token.
     * @returns {string} HTML.
     */
    code({ text, lang }) {
      const body = lang === 'hcl' ? highlight(text) : escapeHtml(text);
      return `<pre class="code"><code data-lang="${escapeHtml(lang ?? '')}">${body}</code></pre>\n`;
    },

    /**
     * @param {{ text: string, depth: number, tokens: unknown[] }} token The heading token.
     * @returns {string} HTML.
     */
    heading({ text, depth, tokens }) {
      const inline = this.parser.parseInline(tokens);
      let id = slugify(text);
      // Two headings can legitimately slug alike — `### Caveats` under two APIs on one
      // page — and a duplicate id would send every link to the first of them.
      if (ids.has(id)) {
        let n = 2;
        while (ids.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      ids.add(id);
      if (depth === 1 && title === file) title = text;
      if (depth >= 2 && depth <= 3) headings.push({ id, text, depth });
      return `<h${depth} id="${id}">${inline}<a class="anchor" href="#${id}" aria-label="Link to ${escapeHtml(text.replaceAll('`', ''))}">#</a></h${depth}>\n`;
    },

    /**
     * @param {{ href: string, title: string | null, tokens: unknown[] }} token The link token.
     * @returns {string} HTML.
     */
    link({ href, title: linkTitle, tokens }) {
      const inline = this.parser.parseInline(tokens);
      const rewritten = rewriteHref(file, href, links);
      const external = /^[a-z]+:/i.test(rewritten);
      const attrs = [
        `href="${escapeHtml(rewritten)}"`,
        linkTitle ? `title="${escapeHtml(linkTitle)}"` : '',
        external ? 'target="_blank" rel="noreferrer noopener"' : '',
      ].filter(Boolean).join(' ');
      return `<a ${attrs}>${inline}</a>`;
    },
  };

  marked.use({ renderer, gfm: true, async: false });
  const html = /** @type {string} */ (marked.parse(markdown));

  return { html, title, headings, ids, links };
}

/**
 * Turns a link as written in Markdown into one the built site can serve, recording the
 * internal ones for checking.
 *
 * @param {string} file The page the link is written on, relative to docs/.
 * @param {string} href The link as written.
 * @param {Array<{ href: string, loc: string, emitted: string }>} links Collects internal links.
 * @returns {string} The rewritten link.
 */
function rewriteHref(file, href, links) {
  if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return href;

  // A bare fragment stays on this page.
  if (href.startsWith('#')) {
    links.push({ href: `${file}${href}`, loc: file, emitted: href });
    return href;
  }

  const [path, fragment] = href.split('#');
  const target = relative(DOCS, resolve(DOCS, dirname(file), path));

  // A link that escapes the content tree — the project README, a source file — cannot be
  // part of the built site, so it goes to the repository instead. It is still checked: a
  // path that no longer exists would otherwise become a 404 on GitHub that nothing here
  // ever looks at.
  if (target.startsWith('..')) {
    const onDisk = join(DOCS, dirname(file), path);
    if (!existsSync(onDisk)) outside.push(`${file} → ${path} (no such path in the repository)`);
    return `${REPO_BLOB}/${relative(REPO, onDisk)}`;
  }

  const emitted = linkBetween(file, target) + (fragment ? `#${fragment}` : '');
  links.push({ href: fragment ? `${target}#${fragment}` : target, loc: file, emitted });
  return emitted;
}

/**
 * @param {string} file A page path relative to docs/.
 * @returns {string} Where it is served from, relative to dist/docs/.
 */
function htmlPath(file) {
  return file === 'README.md' ? 'index.html' : file.replace(/\.md$/, '.html');
}

/**
 * @param {string} from The page being rendered, relative to docs/.
 * @param {string} to The page being linked to, relative to docs/.
 * @returns {string} A link from one to the other.
 */
function linkBetween(from, to) {
  const path = relative(dirname(htmlPath(from)), htmlPath(to));
  return path.startsWith('.') ? path : `./${path}`;
}

// --- the page shell ----------------------------------------------------------------------

/**
 * Wraps rendered content in the site chrome.
 *
 * @param {object} page The page to wrap.
 * @param {string} page.file Its path relative to docs/.
 * @param {string} page.title Its `h1`.
 * @param {string} page.html Its rendered body.
 * @param {Array<{ id: string, text: string, depth: number }>} page.headings Its h2s and h3s.
 * @returns {string} The whole document.
 */
function shell({ file, title, html, headings }) {
  const nav = NAV.map((section) => {
    const items = section.pages.map(([target, label]) => {
      const current = target === file;
      return `<li><a class="${current ? 'current' : ''}" href="${linkBetween(file, target)}">${escapeHtml(label)}</a></li>`;
    }).join('\n        ');
    return `<div class="nav-section">\n      <h2>${escapeHtml(section.title)}</h2>\n      <ul>\n        ${items}\n      </ul>\n    </div>`;
  }).join('\n    ');

  const toc = headings.length < 2 ? '' : `
    <nav class="toc" aria-label="On this page">
      <h2>On this page</h2>
      <ul>
        ${headings.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('\n        ')}
      </ul>
    </nav>`;

  const depth = file.includes('/') ? '../' : './';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · forma-dsl</title>
<meta name="description" content="Reference documentation for forma-dsl, a declarative DSL for 3D modelling solved by the Manifold CSG kernel.">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230d1117'/%3E%3Cpath d='M16 5l9 5.2v10.6L16 26l-9-5.2V10.2z' fill='none' stroke='%2382aaff' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="${depth}docs.css">
</head>
<body>
<header class="site">
  <a class="brand" href="${linkBetween(file, 'README.md')}">forma<span>-dsl</span></a>
  <span class="tag">docs</span>
  <div class="grow"></div>
  <a href="${BASE}">Editor</a>
  <a href="https://github.com/kalpak44/forma-dsl">GitHub</a>
</header>

<div class="layout">
  <input type="checkbox" id="nav-toggle" class="sr-only">
  <label for="nav-toggle" class="nav-button">Contents</label>

  <nav class="sidebar" aria-label="Documentation">
    ${nav}
  </nav>

  <main>
    <article class="prose">
${html}
    </article>
  </main>
${toc}
</div>
</body>
</html>
`;
}

// --- driver ------------------------------------------------------------------------------

/**
 * Every Markdown file under docs/, relative to it.
 *
 * @param {string} dir The directory to walk.
 * @returns {Promise<string[]>} The paths, sorted.
 */
async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [relative(DOCS, full)] : [];
  }));
  return found.flat().sort();
}

/**
 * Asserts that the navigation names every page on disk, exactly once.
 *
 * Both directions matter: a page absent from the sidebar is unreachable, and a sidebar entry
 * for a deleted page is a dead link.
 *
 * @param {ReadonlyArray<string>} files Every page found on disk.
 * @param {ReadonlyArray<string>} listed Every page the navigation names.
 * @returns {void} Exits the process if they disagree.
 */
function checkNavigation(files, listed) {
  const missing = files.filter((file) => !listed.includes(file));
  const stale = listed.filter((file) => !files.includes(file));
  if (!missing.length && !stale.length) return;

  if (missing.length) console.error(`Pages missing from the navigation in ${import.meta.filename}:\n  ${missing.join('\n  ')}`);
  if (stale.length) console.error(`Navigation names pages that do not exist:\n  ${stale.join('\n  ')}`);
  process.exit(1);
}

/**
 * Resolves one link twice: as the page-and-heading it names, and as the relative path
 * actually written into the HTML.
 *
 * The second is not redundant. A link can name a real heading and still be emitted at a path
 * that resolves nowhere, which is precisely the bug a directory move introduces.
 *
 * @param {{ href: string, loc: string, emitted: string }} link The link.
 * @param {Map<string, { ids: Set<string> }>} pages Every rendered page, by source path.
 * @param {Set<string>} written Every path the site will actually serve.
 * @returns {string[]} What is wrong with it, empty when nothing is.
 */
function checkLink(link, pages, written) {
  const problems = [];
  const [target, fragment] = link.href.split('#');
  const destination = pages.get(target);

  if (!destination) problems.push(`${link.loc} → ${link.href} (no such page)`);
  else if (fragment && !destination.ids.has(fragment)) problems.push(`${link.loc} → ${link.href} (no such heading)`);

  const path = link.emitted.split('#')[0];
  const landed = path
    ? relative(OUT, resolve(OUT, dirname(htmlPath(link.loc)), path))
    : htmlPath(link.loc);            // a bare fragment stays on its own page
  if (!written.has(landed)) problems.push(`${link.loc} → ${link.emitted} (resolves to ${landed}, which is not built)`);

  return problems;
}

/**
 * Checks every internal link on every page.
 *
 * Run after all pages are rendered, because a link may point at a heading on a page that had
 * not been read yet when the link was seen.
 *
 * @param {Map<string, { links: Array<{ href: string, loc: string, emitted: string }> }>} pages
 *   Every rendered page, by source path.
 * @returns {void} Exits the process if any link is broken.
 */
function checkLinks(pages) {
  const written = new Set([...pages.keys()].map(htmlPath));
  const broken = [...pages.values()].flatMap(
    (page) => page.links.flatMap((link) => checkLink(link, pages, written)),
  );

  if (!broken.length && !outside.length) return;

  if (broken.length) console.error(`Broken links:\n  ${broken.join('\n  ')}`);
  if (outside.length) console.error(`Links out of the content tree:\n  ${outside.join('\n  ')}`);
  process.exit(1);
}

/**
 * Renders every page, checks the result, and writes the site.
 *
 * @returns {Promise<void>} Resolves once the site is written.
 */
async function main() {
  const files = await markdownFiles(DOCS);
  const listed = NAV.flatMap((section) => section.pages.map(([file]) => file));

  checkNavigation(files, listed);

  const pages = new Map();
  for (const file of files) {
    const markdown = await readFile(join(DOCS, file), 'utf8');
    pages.set(file, { file, ...renderPage(file, markdown) });
  }

  checkLinks(pages);

  for (const page of pages.values()) {
    const out = join(OUT, htmlPath(page.file));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, shell(page));
  }
  await writeFile(join(OUT, 'docs.css'), await readFile(join(HERE, 'docs.css'), 'utf8'));

  const links = [...pages.values()].reduce((n, page) => n + page.links.length, 0);
  console.log(`docs: ${pages.size} pages, ${links} internal links checked → ${relative(REPO, OUT)}/`);
}

await main();

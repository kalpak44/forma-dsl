/**
 * The bundled manual has to be the manual.
 *
 * The copy under src/reference exists so a published install can answer offline, and a copy
 * is only safe if it cannot drift. This compares it byte for byte against apps/docs/content,
 * and skips when that is not present — a consumer running these tests from a tarball has no
 * monorepo to compare against, and should not fail for it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAGES, discoverPages, readPage, searchReference } from '../src/reference.js';

const MANUAL = fileURLToPath(new URL('../../../apps/docs/content/', import.meta.url));
const BUNDLED = fileURLToPath(new URL('../src/reference/', import.meta.url));

test('the index names every page on disk, exactly once', async () => {
  const onDisk = await discoverPages();
  const listed = PAGES.map((page) => page.path).sort((a, b) => a.localeCompare(b));

  assert.deepEqual(listed, onDisk);
  assert.equal(new Set(listed).size, listed.length);
});

test('every page has a title and a line saying what it is about', () => {
  for (const page of PAGES) {
    assert.ok(page.title, `${page.path} has no title`);
    assert.ok(page.about?.length > 10, `${page.path} needs a description`);
  }
});

test('the bundled copy matches the manual it was copied from', { skip: !existsSync(MANUAL) }, async () => {
  /**
   * Every Markdown file under a directory, relative to it.
   *
   * @param {string} root Where to look.
   * @returns {Promise<string[]>} The paths, sorted.
   */
  const walk = async (root) => {
    /** @type {string[]} */
    const found = [];
    const descend = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const child = join(directory, entry.name);
        if (entry.isDirectory()) await descend(child);
        else if (entry.name.endsWith('.md')) found.push(relative(root, child));
      }
    };
    await descend(root);
    return found.sort((a, b) => a.localeCompare(b));
  };

  const source = await walk(MANUAL);
  assert.deepEqual(
    await walk(BUNDLED),
    source,
    'run `npm run sync:reference -w forma-dsl-mcp` — the manual has gained or lost a page',
  );

  for (const path of source) {
    assert.equal(
      await readFile(join(BUNDLED, path), 'utf8'),
      await readFile(join(MANUAL, path), 'utf8'),
      `${path} has drifted — run \`npm run sync:reference -w forma-dsl-mcp\``,
    );
  }
});

test('a page reads back with its title', async () => {
  const page = await readPage('reference/part.md');

  assert.equal(page.title, 'part');
  assert.match(page.markdown, /^# `part`/);
});

test('a leading slash is tolerated, and an unknown page lists what there is', async () => {
  assert.equal((await readPage('/errors.md')).title, 'Errors');
  await assert.rejects(() => readPage('nope.md'), /no reference page "nope\.md"/);
});

test('search ranks a heading match above a passing mention', async () => {
  const hits = await searchReference('align');

  assert.ok(hits.length);
  assert.equal(hits[0].path, 'reference/align.md');
  assert.ok(hits[0].snippet.length);
});

test('search needs every term to appear, and returns nothing for a term that does not', async () => {
  assert.deepEqual(await searchReference('extrude quaternion'), []);
  assert.deepEqual(await searchReference('   '), []);
});

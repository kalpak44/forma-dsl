/**
 * The containment rules, which are the part of this server that has to be right.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Workspace, WorkspaceError } from '../src/workspace.js';

/**
 * A throwaway directory, removed when the test that made it finishes.
 *
 * @param {import('node:test').TestContext} t The test, used to register the cleanup.
 * @returns {Promise<string>} The directory.
 */
async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forma-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('a root that is not a directory is refused', async (t) => {
  const directory = await scratch(t);
  await writeFile(join(directory, 'file'), 'x');

  await assert.rejects(() => Workspace.open(join(directory, 'file')), WorkspaceError);
  await assert.rejects(() => Workspace.open(join(directory, 'nope')), /does not exist/);
});

test('a relative path resolves inside the root', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  const resolved = await workspace.resolve('parts/bracket.forma');
  assert.equal(resolved, join(workspace.root, 'parts', 'bracket.forma'));
});

test('a path that climbs out of the root is refused', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  await assert.rejects(() => workspace.resolve('../escape.forma'), /outside the workspace root/);
  await assert.rejects(() => workspace.resolve('a/b/../../../escape.forma'), /outside/);
  await assert.rejects(() => workspace.resolve('/etc/passwd'), /outside/);
  await assert.rejects(() => workspace.resolve(''), /is empty/);
});

test('a symlink pointing out of the root is refused', async (t) => {
  const directory = await scratch(t);
  const outside = await scratch(t);
  await mkdir(join(directory, 'inside'));
  await symlink(outside, join(directory, 'inside', 'away'));

  const workspace = await Workspace.open(directory);

  await assert.rejects(
    () => workspace.resolve('inside/away/escaped.forma'),
    /outside the workspace root/,
  );
  // The same directory reached without the link is fine, which is what proves the refusal
  // above is about where the path lands rather than about its spelling.
  assert.ok(await workspace.resolve('inside/kept.forma'));
});

test('writing creates the directories above it, and reports what it did', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  const written = await workspace.write('parts/bracket.forma', 'model "m" { }');
  assert.equal(written.relative, join('parts', 'bracket.forma'));
  assert.equal(written.bytes, 13);
  assert.equal(written.replaced, false);
  assert.equal(await workspace.read('parts/bracket.forma'), 'model "m" { }');
});

test('an existing file is not replaced unless overwriting was asked for', async (t) => {
  const workspace = await Workspace.open(await scratch(t));
  await workspace.write('a.forma', 'first');

  await assert.rejects(() => workspace.write('a.forma', 'second'), /already exists/);
  assert.equal(await workspace.read('a.forma'), 'first');

  const again = await workspace.write('a.forma', 'second', { overwrite: true });
  assert.equal(again.replaced, true);
  assert.equal(await workspace.read('a.forma'), 'second');
});

test('an extension can be insisted on', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  await assert.rejects(
    () => workspace.write('a.txt', 'x', { extension: '.forma' }),
    /must end in \.forma/,
  );
  assert.ok(await workspace.write('a.FORMA', 'x', { extension: '.forma' }));
});

test('reading something that is not there says so rather than throwing an ENOENT', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  await assert.rejects(() => workspace.read('missing.forma'), /no file at "missing.forma"/);
});

test('listing finds documents at depth and skips the noisy directories', async (t) => {
  const workspace = await Workspace.open(await scratch(t));
  await workspace.write('a.forma', 'x');
  await workspace.write('parts/b.forma', 'x');
  await workspace.write('notes.md', 'x');
  await mkdir(join(workspace.root, 'node_modules'));
  await writeFile(join(workspace.root, 'node_modules', 'c.forma'), 'x');

  assert.deepEqual(await workspace.list('.forma'), ['a.forma', join('parts', 'b.forma')]);
});

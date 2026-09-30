/**
 * The containment rules, which are the part of this server that has to be right.
 *
 * The directories come from the client, so a workspace is built from a list rather than from
 * one root, and the list can change under it. What must not change is that nothing lands
 * outside whatever is currently in force.
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

test('a client that declares nothing usable is told so, not left to fail on the first write', async () => {
  const empty = new Workspace([]);
  await assert.rejects(() => empty.roots(), /declared no workspace root/);

  const bogus = new Workspace(['/nowhere/at/all']);
  await assert.rejects(() => bogus.write('a.forma', 'x'), /no usable workspace root/);
});

test('roots that do not exist are dropped rather than taking the usable ones with them', async (t) => {
  const directory = await scratch(t);
  const workspace = new Workspace(['/nowhere/at/all', directory]);

  const roots = await workspace.roots();
  assert.equal(roots.length, 1);
  assert.equal(roots[0].path, directory);
});

test('a relative path resolves inside the first root', async (t) => {
  const first = await scratch(t);
  const second = await scratch(t);
  const workspace = new Workspace([first, second]);

  const { absolute, root } = await workspace.resolve('parts/bracket.forma');
  assert.equal(absolute, join(first, 'parts', 'bracket.forma'));
  assert.equal(root.path, first);
});

test('an absolute path may name any of the roots, and nothing else', async (t) => {
  const first = await scratch(t);
  const second = await scratch(t);
  const undeclared = await scratch(t);
  const workspace = new Workspace([first, second]);

  const { root } = await workspace.resolve(join(second, 'bracket.forma'));
  assert.equal(root.path, second);

  await assert.rejects(
    () => workspace.resolve(join(undeclared, 'bracket.forma')),
    /outside the workspace roots/,
  );
});

test('a path that climbs out of the roots is refused', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  await assert.rejects(() => workspace.resolve('../escape.forma'), /outside the workspace root/);
  await assert.rejects(() => workspace.resolve('a/b/../../../escape.forma'), /outside/);
  await assert.rejects(() => workspace.resolve('/etc/passwd'), /outside/);
  await assert.rejects(() => workspace.resolve(''), /is empty/);
});

test('a symlink pointing out of the roots is refused', async (t) => {
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

test('the roots are asked for once, and again once forgotten', async (t) => {
  const first = await scratch(t);
  const second = await scratch(t);

  let declared = [first];
  let asked = 0;
  const workspace = new Workspace(() => {
    asked += 1;
    return declared;
  });

  assert.equal((await workspace.primary()).path, first);
  assert.equal((await workspace.primary()).path, first);
  assert.equal(asked, 1, 'the client is not asked again on every call');

  declared = [second];
  assert.equal((await workspace.primary()).path, first, 'until it says they changed');

  workspace.forget();
  assert.equal((await workspace.primary()).path, second);
  assert.equal(asked, 2);
});

test('writing creates the directories above it, and reports where it landed', async (t) => {
  const directory = await scratch(t);
  const workspace = new Workspace([directory]);

  const written = await workspace.write('parts/bracket.forma', 'model "m" { }');
  assert.equal(written.relative, join('parts', 'bracket.forma'));
  assert.equal(written.root, directory);
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

test('a segment that could separate, escape or terminate a path is refused', async (t) => {
  const workspace = await Workspace.open(await scratch(t));

  // A NUL survives `resolve` and lands inside the root, so containment alone lets it through
  // — it used to reach the filesystem and come back as an unreadable ERR_INVALID_ARG_VALUE.
  await assert.rejects(() => workspace.resolve('a\0b.forma'), /outside the workspace root/);
  // A backslash is a legal POSIX filename character and a separator on Windows. Refusing it
  // costs nothing here and keeps the two platforms reading the same path the same way.
  await assert.rejects(() => workspace.resolve('a\\b.forma'), /outside the workspace root/);

  // Traversal that cancels out is still an ordinary path, and must not be caught by this.
  const root = await workspace.primary();
  const { absolute } = await workspace.resolve('parts/../parts/bracket.forma');
  assert.equal(absolute, join(root.path, 'parts', 'bracket.forma'));
});

test('the same directory declared twice is one root', async (t) => {
  const directory = await scratch(t);
  const workspace = new Workspace([directory, directory, `${directory}/`]);

  assert.equal((await workspace.roots()).length, 1);
});

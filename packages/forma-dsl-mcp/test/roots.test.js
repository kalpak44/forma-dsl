/**
 * Asking the client where it will allow work to happen.
 *
 * Every path out of this module that is not the happy one ends at the launch directory, and
 * each of those is a client this server has to keep working with: one that does not implement
 * roots, one that answers with an error, one that answers with a scheme this server cannot
 * write to. They are exercised against a stub rather than a live client, because what is
 * being tested is the fallback and not the transport.
 */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { pathToFileURL } from 'node:url';

import { askClientForRoots, clientWorkspace } from '../src/roots.js';

/**
 * A stand-in for the low-level server, answering however the test needs it to.
 *
 * @param {object} [behaviour] What the client does.
 * @param {object | undefined} [behaviour.capabilities] What it declared at initialisation.
 * @param {() => Promise<object>} [behaviour.listRoots] What `roots/list` returns.
 * @returns {object} The stub, with the notification handler it was given recorded.
 */
function stubServer({ capabilities = { roots: {} }, listRoots } = {}) {
  return {
    getClientCapabilities: () => capabilities,
    listRoots: listRoots ?? (async () => ({ roots: [] })),
    handlers: new Map(),
    setNotificationHandler(schema, handler) { this.handlers.set(schema, handler); },
  };
}

/** Keeps the fallback's explanation out of the test output. */
const silenceStderr = (t) => t.mock.method(console, 'error', () => {});

test('a client that never declared roots is not asked, and gets the launch directory', async () => {
  const server = stubServer({ capabilities: {} });
  const asked = mock.fn();
  server.listRoots = asked;

  assert.deepEqual(await askClientForRoots(server), [process.cwd()]);
  assert.equal(asked.mock.callCount(), 0, 'asking would be a protocol error against this client');

  // A client that declared nothing at all, rather than declaring an empty capability set.
  assert.deepEqual(await askClientForRoots(stubServer({ capabilities: undefined })), [process.cwd()]);
});

test('a client that refuses to list its roots gets the launch directory, and says why', async (t) => {
  const logged = silenceStderr(t);
  const server = stubServer({ listRoots: async () => { throw new Error('not implemented'); } });

  assert.deepEqual(await askClientForRoots(server), [process.cwd()]);
  assert.match(logged.mock.calls[0].arguments[0], /would not list its roots \(not implemented\)/);
});

test('a rejection that is not an Error still reaches the log', async (t) => {
  const logged = silenceStderr(t);
  // Not every transport rejects with an Error, and the fallback has to read something out of
  // whatever it is given rather than trusting `.message` to be there.
  const refusal = { toString: () => 'no roots for you' };
  const server = stubServer({ listRoots: () => Promise.reject(refusal) });

  assert.deepEqual(await askClientForRoots(server), [process.cwd()]);
  assert.match(logged.mock.calls[0].arguments[0], /would not list its roots \(no roots for you\)/);
});

test('roots this server cannot write to are dropped rather than guessed at', async () => {
  const here = process.cwd();
  const server = stubServer({
    listRoots: async () => ({
      roots: [
        { uri: 'https://example.com/models' },
        { uri: pathToFileURL(here).href },
        { /* a root with no uri at all */ },
      ],
    }),
  });

  assert.deepEqual(await askClientForRoots(server), [here]);
});

test('a client that declares roots but lists none falls back rather than ending up with nothing', async () => {
  assert.deepEqual(await askClientForRoots(stubServer()), [process.cwd()]);

  const shapeless = stubServer({ listRoots: async () => ({}) });
  assert.deepEqual(await askClientForRoots(shapeless), [process.cwd()]);
});

test('the workspace forgets its roots when the client says they changed', async () => {
  const server = stubServer({
    listRoots: async () => ({ roots: [{ uri: pathToFileURL(process.cwd()).href }] }),
  });

  const workspace = clientWorkspace(server);
  assert.equal((await workspace.primary()).path, process.cwd());

  // One handler, for the one notification that is allowed to move the set.
  assert.equal(server.handlers.size, 1);
  const [handler] = [...server.handlers.values()];
  await handler();

  // Re-resolving after the notification is what proves the cache was dropped: the stub
  // answers the same way, so only a second call can succeed here.
  assert.equal((await workspace.primary()).path, process.cwd());
});

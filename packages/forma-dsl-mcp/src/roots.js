/**
 * Where the client says the files may go.
 *
 * The server does not get to choose the patch of disk it writes to. The MCP `roots`
 * capability is the client's declaration of which directories it is handing over, and asking
 * for it — rather than reading an environment variable the client cannot see — is the whole
 * of this module. A client that declares nothing gets the directory it launched the server
 * in, which is the one location it did choose.
 */
import { fileURLToPath } from 'node:url';

import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import { Workspace } from './workspace.js';

/**
 * The part of the low-level server this module needs.
 *
 * Named structurally rather than as the SDK's `Server`, which is deprecated in favour of
 * `McpServer` — but `McpServer` does not carry `listRoots` or `setNotificationHandler`, so the
 * low-level object is genuinely the right one to take. Describing the three members used is
 * both the honest contract and what lets a test hand this a stub.
 *
 * @typedef {object} RootsClient
 * @property {() => ({ roots?: object } | undefined)} getClientCapabilities What the client
 *   declared at initialisation.
 * @property {() => Promise<{ roots?: Array<{ uri?: string }> }>} listRoots Asks it for them.
 * @property {(schema: object, handler: () => unknown) => void} setNotificationHandler
 *   Registers interest in a notification it may send.
 */

/**
 * Asks the client which directories the server may work in.
 *
 * Every failure funnels to the launch directory rather than to an error: a client that does
 * not implement roots is the common case, not a broken one, and a server that refuses to
 * work with such a client is worse than one that writes where it was started.
 *
 * @param {RootsClient} server The low-level server, once a client is connected.
 * @returns {Promise<string[]>} Absolute directories, in the order the client gave them.
 */
export async function askClientForRoots(server) {
  if (!server.getClientCapabilities()?.roots) return [process.cwd()];

  /** @type {{ roots?: Array<{ uri: string }> }} */
  let result;
  try {
    result = await server.listRoots();
  } catch (error) {
    const why = /** @type {Error} */ (error)?.message ?? String(error);
    console.error(`forma-dsl-mcp: the client would not list its roots (${why})`);
    return [process.cwd()];
  }

  // Roots are URIs, and the spec allows schemes this server cannot write to. Anything that
  // is not a local file is dropped rather than guessed at.
  const directories = (result?.roots ?? [])
    .map((root) => root?.uri)
    .filter((uri) => typeof uri === 'string' && uri.startsWith('file://'))
    .map((uri) => fileURLToPath(uri));

  return directories.length ? directories : [process.cwd()];
}

/**
 * A workspace that takes its roots from the connected client, and re-reads them when the
 * client says they have changed.
 *
 * The roots are asked for lazily, at the first file tool call, because `roots/list` is a
 * request back to the client and there is no client to ask until initialisation is done.
 *
 * @param {RootsClient} server The low-level server the client connects to.
 * @returns {Workspace} The workspace, with nothing resolved yet.
 */
export function clientWorkspace(server) {
  const workspace = new Workspace(() => askClientForRoots(server));
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    workspace.forget();
  });
  return workspace;
}

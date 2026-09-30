#!/usr/bin/env node
/**
 * The executable: one MCP server, speaking over stdin and stdout.
 *
 * Nothing may be written to stdout but the protocol — a stray `console.log` corrupts the
 * JSON-RPC stream and the client disconnects with an error that names nothing. Everything
 * this file has to say goes to stderr, which clients collect as the server's log.
 *
 * There is nothing to configure here. Where the file tools may read and write is asked of
 * the client over MCP's `roots` capability once it has connected, so the directories are
 * the client's to choose and to change.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { VERSION, createServer } from './server.js';
import { askClientForRoots } from './roots.js';

try {
  const server = createServer();

  // Logged for the operator's benefit, not the protocol's: a server writing somewhere
  // unexpected is the failure worth being able to see in the client's log.
  server.server.oninitialized = () => {
    askClientForRoots(server.server)
      .then((roots) => console.error(`forma-dsl-mcp: working in ${roots.join(', ')}`))
      .catch(() => {});
  };

  await server.connect(new StdioServerTransport());
  console.error(`forma-dsl-mcp ${VERSION} ready`);
} catch (error) {
  console.error(`forma-dsl-mcp failed to start: ${error?.message ?? error}`);
  process.exit(1);
}

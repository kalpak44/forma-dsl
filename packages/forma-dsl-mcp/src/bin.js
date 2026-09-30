#!/usr/bin/env node
/**
 * The executable: one MCP server, speaking over stdin and stdout.
 *
 * Nothing may be written to stdout but the protocol — a stray `console.log` corrupts the
 * JSON-RPC stream and the client disconnects with an error that names nothing. Everything
 * this file has to say goes to stderr, which clients collect as the server's log.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { Workspace } from './workspace.js';
import { VERSION, createServer } from './server.js';

/**
 * Where the file tools are allowed to read and write.
 *
 * Defaults to the working directory, which is what a client that launches the server inside
 * a project gives it. `FORMA_MCP_ROOT` overrides it.
 */
const root = process.env.FORMA_MCP_ROOT ?? process.cwd();

try {
  const workspace = await Workspace.open(root);
  const server = createServer(workspace);
  await server.connect(new StdioServerTransport());
  console.error(`forma-dsl-mcp ${VERSION} ready — workspace ${workspace.root}`);
} catch (error) {
  console.error(`forma-dsl-mcp failed to start: ${error?.message ?? error}`);
  process.exit(1);
}

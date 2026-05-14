/**
 * MCP server entrypoint for the sui-prover wrapper.
 *
 * Mirrors mcp/move-lsp-mcp/src/index.ts: stdio transport, structured
 * error logging, signal-driven cleanup. The binary probe is lazy
 * (see server.ts) so a missing sui-prover is reported at first tool
 * call rather than at startup.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, initializeBinaryOnStartup } from './server.js';
import { info, error } from './logger.js';

async function main(): Promise<void> {
  try {
    info('Starting sui-prover MCP server');

    const server = createServer();
    initializeBinaryOnStartup();

    const cleanup = async () => {
      info('Shutting down sui-prover MCP server');
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    info('sui-prover MCP server started successfully');
  } catch (err) {
    error('Failed to start sui-prover MCP server', { error: err });
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason, promise) => {
  error('Unhandled promise rejection', { reason, promise });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  error('Uncaught exception', { error: err });
  process.exit(1);
});

main().catch((err) => {
  error('Main function failed', { error: err });
  process.exit(1);
});

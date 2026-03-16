import { Command } from 'commander';
import { fork } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const runMcpCommand = new Command('run-mcp')
  .description('Start the MCP server')
  .option('--http', 'Run in HTTP mode (multi-agent, single process)')
  .option('--port <port>', 'HTTP server port (default: 3100)')
  .action(async (opts) => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const mcpPath = resolve(__dirname, 'mcp-server.js');

    // Build args to forward to the MCP server process
    const childArgs: string[] = [];
    if (opts.http) childArgs.push('--http');
    if (opts.port) childArgs.push('--port', opts.port);

    if (opts.http) {
      // HTTP mode — fork with stderr visible, no stdin/stdout piping needed
      const child = fork(mcpPath, childArgs, {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: process.env,
      });

      child.on('error', (err) => {
        console.error('Failed to start MCP server:', err.message);
        process.exit(1);
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });

      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
    } else {
      // Stdio mode — pipe stdin/stdout for MCP stdio transport
      const child = fork(mcpPath, childArgs, {
        stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
        env: process.env,
      });

      if (child.stdin && child.stdout) {
        process.stdin.pipe(child.stdin);
        child.stdout.pipe(process.stdout);
      }

      child.on('error', (err) => {
        console.error('Failed to start MCP server:', err.message);
        process.exit(1);
      });

      child.on('exit', (code) => {
        process.exit(code ?? 0);
      });

      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
    }
  });

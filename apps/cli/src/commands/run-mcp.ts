import { Command } from 'commander';
import { fork } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const runMcpCommand = new Command('run-mcp')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    // Resolve the bundled MCP server entrypoint relative to this file
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const mcpPath = resolve(__dirname, 'mcp-server.js');

    // Fork the MCP server as a child process with stdio passthrough
    // Using fork instead of spawn avoids needing npx/tsx at runtime
    const child = fork(mcpPath, [], {
      stdio: ['pipe', 'pipe', 'inherit', 'ipc'],
      env: process.env,
    });

    // Pipe stdin/stdout for MCP stdio transport
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

    // Forward SIGINT/SIGTERM to child
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  });

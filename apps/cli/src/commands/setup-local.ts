/**
 * `acr setup` — Commander entry point.
 *
 * Thin wrapper: all logic lives in ../setup/bootstrap.ts
 */

import { Command } from 'commander';
import { runSetupLocal } from '../setup/bootstrap.js';

export const setupCommand = new Command('setup')
  .description('Bootstrap a new ACR workspace')
  .option('--path <path>', 'Target directory (default: ~/Desktop/anchor)')
  .option('--name <name>', 'Folder name when using Desktop default', 'anchor')
  .option('--force', 'Overwrite existing config files without prompting')
  .option('--non-interactive', 'Run without prompts (fails if required inputs are missing)')
  .option('--storage <mode>', 'Storage mode: postgres or local')
  .option('--database-url <url>', 'Database connection string (bypasses prompt)')
  .option('--embedding-api-key <key>', 'Embedding provider API key (bypasses prompt)')
  .option('--skip-doctor', 'Skip health check after setup')
  .option('--skip-db-push', 'Skip schema push after setup')
  .addHelpText('after', `
Examples:
  acr setup
  acr setup --path ./my-project
  acr setup --database-url "postgresql://..." --embedding-api-key "sk-..."
  acr setup --non-interactive --database-url "postgresql://..." --embedding-api-key "sk-..."
  acr setup --force --skip-doctor`)
  .action(async (opts) => {
    try {
      await runSetupLocal({
        path: opts.path,
        name: opts.name,
        force: opts.force,
        nonInteractive: opts.nonInteractive,
        storage: opts.storage,
        databaseUrl: opts.databaseUrl,
        embeddingApiKey: opts.embeddingApiKey,
        skipDoctor: opts.skipDoctor,
        skipDbPush: opts.skipDbPush,
      });
    } catch (err) {
      console.error('Setup failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

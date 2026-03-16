import { Command } from 'commander';
import { requireDatabaseUrl, requireEmbeddingConfig } from '@acr/config';
import { getDb, closeDb } from '@acr/db';
import { runWorker } from '../../../worker/src/run-worker.js';

export const workerCommand = new Command('worker')
  .description('Run background sync — polls sources and keeps context fresh')
  .option('--once', 'Sync all overdue sources once, then exit')
  .option('--source <name>', 'Sync a specific source by name (implies --once)')
  .addHelpText('after', `
Examples:
  acr worker                     # run continuously (poll mode)
  acr worker --once              # sync everything overdue right now, then exit
  acr worker --source "MCP Docs" # sync one source right now, then exit

Running continuously:
  The worker checks every source's syncFrequencyMinutes and re-syncs when due.
  Run in the background or in a separate terminal alongside your agent workflow.

  # macOS background:
  acr worker &

  # Or keep it visible:
  acr worker
`)
  .action(async (opts) => {
    try {
      const dbUrl = requireDatabaseUrl('worker');
      requireEmbeddingConfig('worker');
      getDb(dbUrl);

      await runWorker({
        once: opts.once ?? false,
        source: opts.source,
      });
    } catch (err) {
      console.error('Worker error:', err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      // Only close in one-shot mode — poll mode never returns
      if (opts.once || opts.source) {
        await closeDb();
      }
    }
  });

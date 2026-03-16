import { getConfig } from '@acr/config';
import { getSourcesDueForSync } from './scheduler.js';
import { runSyncPipeline } from './sync-pipeline.js';

export interface WorkerOptions {
  /** Run once (sync all overdue sources) then exit. Default: false (poll mode). */
  once?: boolean;
  /** Only sync this specific source name or ID. Implies once. */
  source?: string;
  /** Override the poll interval in milliseconds. Falls back to config. */
  pollIntervalMs?: number;
}

/**
 * Main worker run function.
 *
 * Importable by the CLI (`acr worker`) and the standalone worker entry point.
 * No process.argv dependency — all options passed explicitly.
 *
 * Modes:
 * - one-shot (once: true, or source specified): sync overdue sources, return
 * - poll (default): loop forever, checking for due sources on interval
 */
export async function runWorker(options: WorkerOptions = {}): Promise<void> {
  const { once = false, source } = options;
  const isOneShot = once || !!source;

  if (isOneShot) {
    const due = await getSourcesDueForSync();
    const toSync = source
      ? due.filter((s) => s.name === source || s.id === source)
      : due;

    if (toSync.length === 0) {
      if (source) {
        console.log(`No overdue sync found for "${source}". (Already up to date, or source not found.)`);
      } else {
        console.log('All sources are up to date.');
      }
      return;
    }

    for (const s of toSync) {
      console.log(`Syncing: ${s.name} [${s.sourceType}]...`);
      try {
        const stats = await runSyncPipeline(s);
        const { processed, changed, unchanged, skipped } = stats;
        console.log(`  ✓ ${s.name}  processed=${processed} changed=${changed} unchanged=${unchanged} skipped=${skipped}`);
      } catch (err) {
        console.error(`  ✗ ${s.name} failed:`, err instanceof Error ? err.message : err);
      }
    }
    return;
  }

  // Poll mode
  const config = getConfig();
  const pollIntervalMs = options.pollIntervalMs ?? config.worker.syncPollIntervalMs;

  console.log(`ACR worker started — polling every ${pollIntervalMs / 1000}s`);
  console.log('Press Ctrl+C to stop.\n');

  const poll = async () => {
    try {
      const due = await getSourcesDueForSync();
      if (due.length === 0) return;

      console.log(`[${new Date().toISOString()}] ${due.length} source(s) due for sync`);
      for (const s of due) {
        console.log(`  Syncing: ${s.name}...`);
        try {
          const stats = await runSyncPipeline(s);
          console.log(`  ✓ ${s.name}  processed=${stats.processed} changed=${stats.changed}`);
        } catch (err) {
          console.error(`  ✗ ${s.name}:`, err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.error('[worker] poll error:', err instanceof Error ? err.message : err);
    }
  };

  // Initial poll
  await poll();

  // Recurring
  setInterval(poll, pollIntervalMs);

  // Keep process alive
  await new Promise<void>(() => {});
}

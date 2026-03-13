import { getConfig } from '@acr/config';
import { getSourcesDueForSync } from './scheduler.js';
import { runSyncPipeline } from './sync-pipeline.js';

/**
 * Worker entry point.
 *
 * Modes:
 * - One-shot: sync specific source(s) and exit
 * - Poll: continuously check for due sources and sync them
 */
async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1];
  const oneShot = args.includes('--once') || !!sourceArg;

  console.log('ACR Worker starting...');

  if (oneShot) {
    console.log('Running in one-shot mode');
    const dueSources = await getSourcesDueForSync();
    const toSync = sourceArg
      ? dueSources.filter((s) => s.name === sourceArg || s.id === sourceArg)
      : dueSources;

    for (const source of toSync) {
      console.log(`Syncing: ${source.name} (${source.sourceType})`);
      try {
        await runSyncPipeline(source);
      } catch (err) {
        console.error(`Failed to sync ${source.name}:`, err);
      }
    }
    process.exit(0);
  }

  // Poll mode
  const config = getConfig();
  const pollInterval = config.worker.syncPollIntervalMs;
  console.log(`Poll mode: checking every ${pollInterval / 1000}s`);

  const poll = async () => {
    try {
      const dueSources = await getSourcesDueForSync();
      if (dueSources.length > 0) {
        console.log(`Found ${dueSources.length} source(s) due for sync`);
      }
      for (const source of dueSources) {
        console.log(`Syncing: ${source.name}`);
        try {
          await runSyncPipeline(source);
        } catch (err) {
          console.error(`Failed to sync ${source.name}:`, err);
        }
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
  };

  // Initial poll
  await poll();

  // Schedule recurring polls
  setInterval(poll, pollInterval);
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});

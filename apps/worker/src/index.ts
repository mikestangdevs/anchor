/**
 * Standalone worker entry point.
 *
 * Parses CLI args and delegates to runWorker().
 * For programmatic use, import runWorker directly from './run-worker.js'.
 */
import { runWorker } from './run-worker.js';

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((a) => a.startsWith('--source='))?.split('=')[1]
    ?? (args.includes('--source') ? args[args.indexOf('--source') + 1] : undefined);
  const once = args.includes('--once') || !!sourceArg;

  await runWorker({ once, source: sourceArg });
  process.exit(0);
}

main().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});

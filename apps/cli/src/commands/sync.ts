import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, sources } from '@acr/db';
import { requireDatabaseUrl, requireEmbeddingConfig } from '@acr/config';
import { runSyncPipeline, type SyncStats } from '../../../worker/src/sync-pipeline.js';
import type { Source } from '@acr/types';

const BADGE: Record<string, string> = {
  github_repo: 'github',
  supabase_view: 'supabase',
  local_folder: 'local',
  docs_site: 'docs',
};

export const syncCommand = new Command('sync')
  .description('Sync one or all sources (fetch → chunk → embed)')
  .option('--source <nameOrId>', 'Source name or ID to sync')
  .option('--all', 'Sync all active sources')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const dbUrl = requireDatabaseUrl('sync');
      requireEmbeddingConfig('sync');

      const db = getDb(dbUrl);

      let toSync: Source[] = [];

      if (opts.all) {
        const allSources = await db
          .select()
          .from(sources)
          .where(eq(sources.status, 'active'));
        toSync = allSources as Source[];
      } else if (opts.source) {
        const found = await db
          .select()
          .from(sources)
          .where(eq(sources.name, opts.source));

        if (found.length === 0) {
          const foundById = await db
            .select()
            .from(sources)
            .where(eq(sources.id, opts.source));
          toSync = foundById as Source[];
        } else {
          toSync = found as Source[];
        }
      } else {
        console.error('Specify --source <name> or --all');
        process.exit(1);
      }

      if (toSync.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ results: [], error: 'No sources found' }));
        } else {
          console.log('No sources found to sync.');
        }
        await closeDb();
        return;
      }

      const results: Array<{
        name: string;
        type: string;
        status: 'success' | 'error';
        stats?: SyncStats;
        error?: string;
      }> = [];

      for (const source of toSync) {
        const badge = BADGE[source.sourceType] ?? source.sourceType;
        if (!opts.json) {
          console.log(`Syncing: ${source.name} [${badge}]...`);
        }
        try {
          const syncStats = await runSyncPipeline(source);
          results.push({ name: source.name, type: source.sourceType, status: 'success', stats: syncStats });
          if (!opts.json) {
            console.log(`✓ ${source.name} synced successfully`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ name: source.name, type: source.sourceType, status: 'error', error: message });
          if (!opts.json) {
            console.error(`✗ ${source.name} failed: ${message}`);
          }
        }
      }

      if (opts.json) {
        const success = results.filter(r => r.status === 'success').length;
        const errors = results.filter(r => r.status === 'error').length;
        // Aggregate stats across all sources
        const totals: SyncStats = {
          processed: 0, changed: 0, unchanged: 0, skipped: 0, stale: 0, errors: 0, chunksCreated: 0,
        };
        for (const r of results) {
          if (r.stats) {
            totals.processed += r.stats.processed;
            totals.changed += r.stats.changed;
            totals.unchanged += r.stats.unchanged;
            totals.skipped += r.stats.skipped;
            totals.stale += r.stats.stale;
            totals.errors += r.stats.errors;
            totals.chunksCreated += r.stats.chunksCreated;
          }
        }
        console.log(JSON.stringify({ results, summary: { total: results.length, success, errors, ...totals } }, null, 2));
      }

      await closeDb();
    } catch (err) {
      if (opts.json) {
        console.log(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      } else {
        console.error('Sync failed:', err instanceof Error ? err.message : err);
      }
      process.exit(1);
    }
  });

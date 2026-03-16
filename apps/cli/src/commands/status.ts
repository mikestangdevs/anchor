import { Command } from 'commander';
import { requireDatabaseUrl } from '@acr/config';
import { getDb, closeDb, sources, documents, chunks, syncJobs } from '@acr/db';
import { eq, sql, desc, and, count } from 'drizzle-orm';

// ── Health helpers ──

interface SourceHealth {
  name: string;
  type: string;
  status: string;
  trustLevel: string;
  syncFrequencyMinutes: number;
  docCount: number;
  chunkCount: number;
  latestDocCount: number;
  lastSync: {
    status: string;
    completedAt: Date | null;
    errorMessage: string | null;
    stats: Record<string, number> | null;
  } | null;
  health: 'fresh' | 'stale' | 'error' | 'never-synced';
  nextSyncDue: Date | null;
  searchable: boolean;
  searchableReason: string;
}

function computeHealth(
  sourceStatus: string,
  lastSync: SourceHealth['lastSync'],
  syncFrequencyMinutes: number,
): { health: SourceHealth['health']; nextSyncDue: Date | null } {
  if (sourceStatus === 'error') {
    return { health: 'error', nextSyncDue: null };
  }
  if (!lastSync || !lastSync.completedAt) {
    return { health: 'never-synced', nextSyncDue: null };
  }
  if (lastSync.status === 'failed') {
    return { health: 'error', nextSyncDue: null };
  }

  const nextDue = new Date(lastSync.completedAt.getTime() + syncFrequencyMinutes * 60_000);
  const isStale = nextDue.getTime() < Date.now();
  return {
    health: isStale ? 'stale' : 'fresh',
    nextSyncDue: nextDue,
  };
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ${diffMin % 60}m ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function formatDuration(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return 'now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ${diffMin % 60}m`;
}

const HEALTH_ICON: Record<SourceHealth['health'], string> = {
  'fresh': '✓ fresh',
  'stale': '⚠ stale',
  'error': '✗ error',
  'never-synced': '○ not synced',
};

const TYPE_BADGE: Record<string, string> = {
  github_repo: 'github',
  supabase_view: 'supa',
  local_folder: 'local',
  docs_site: 'docs',
};

export const statusCommand = new Command('status')
  .description('Show system-wide health: all sources, sync state, and freshness')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const dbUrl = requireDatabaseUrl('status');
      const db = getDb(dbUrl);

      // ── Fetch all sources ──
      const allSources = await db.select().from(sources);

      if (allSources.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ sources: [], summary: { total: 0 } }));
        } else {
          console.log('');
          console.log('  ━━━ Anchor Status ━━━');
          console.log('');
          console.log('  No sources registered.');
          console.log('');
          console.log('  Get started:');
          console.log('    acr source add --name "My Docs" --type local_folder --folder-path ./docs');
          console.log('    acr quickstart   # load the agent stack starter pack');
          console.log('');
        }
        await closeDb();
        return;
      }

      // ── Aggregate doc + chunk counts per source (single query) ──
      const docCounts = await db
        .select({
          sourceId: documents.sourceId,
          total: count(),
          latest: sql<number>`count(*) filter (where ${documents.isLatest} = true)`,
        })
        .from(documents)
        .groupBy(documents.sourceId);

      const chunkCounts = await db
        .select({
          sourceId: documents.sourceId,
          total: count(),
        })
        .from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .groupBy(documents.sourceId);

      const docMap = new Map(docCounts.map((d) => [d.sourceId, d]));
      const chunkMap = new Map(chunkCounts.map((c) => [c.sourceId, c]));

      // ── Latest sync job per source ──
      // Get the most recent sync job per source using a correlated subquery approach
      const recentSyncs = await db
        .select()
        .from(syncJobs)
        .orderBy(desc(syncJobs.createdAt));

      const latestSyncMap = new Map<string, typeof recentSyncs[0]>();
      for (const job of recentSyncs) {
        if (!latestSyncMap.has(job.sourceId)) {
          latestSyncMap.set(job.sourceId, job);
        }
      }

      // ── Build health objects ──
      const healthItems: SourceHealth[] = allSources.map((s) => {
        const docs = docMap.get(s.id);
        const chks = chunkMap.get(s.id);
        const lastJob = latestSyncMap.get(s.id);

        const lastSync = lastJob
          ? {
              status: lastJob.status,
              completedAt: lastJob.completedAt,
              errorMessage: lastJob.errorMessage,
              stats: lastJob.statsJson as Record<string, number> | null,
            }
          : null;

        const docCount = docs?.total ?? 0;
        const latestDocCount = docs?.latest ?? 0;
        const chunkCount = chks?.total ?? 0;

        const { health, nextSyncDue } = computeHealth(s.status, lastSync, s.syncFrequencyMinutes);

        // Searchability check
        let searchable = true;
        let searchableReason = '✓ searchable';
        if (docCount === 0) {
          searchable = false;
          searchableReason = '✗ no documents';
        } else if (chunkCount === 0) {
          searchable = false;
          searchableReason = '✗ no chunks';
        } else if (latestDocCount === 0) {
          searchable = false;
          searchableReason = '✗ all documents stale';
        } else if (!lastSync || lastSync.status !== 'completed') {
          searchable = false;
          searchableReason = '✗ no completed sync';
        }

        return {
          name: s.name,
          type: s.sourceType,
          status: s.status,
          trustLevel: s.trustLevel,
          syncFrequencyMinutes: s.syncFrequencyMinutes,
          docCount,
          chunkCount,
          latestDocCount,
          lastSync,
          health,
          nextSyncDue,
          searchable,
          searchableReason,
        };
      });

      // ── JSON output ──
      if (opts.json) {
        const summary = {
          total: healthItems.length,
          active: healthItems.filter((h) => h.status === 'active').length,
          paused: healthItems.filter((h) => h.status === 'paused').length,
          error: healthItems.filter((h) => h.status === 'error').length,
          totalDocs: healthItems.reduce((sum, h) => sum + h.docCount, 0),
          totalChunks: healthItems.reduce((sum, h) => sum + h.chunkCount, 0),
        };
        console.log(JSON.stringify({ sources: healthItems, summary }, null, 2));
        await closeDb();
        return;
      }

      // ── Pretty output ──
      const active = healthItems.filter((h) => h.status === 'active').length;
      const paused = healthItems.filter((h) => h.status === 'paused').length;
      const errored = healthItems.filter((h) => h.status === 'error').length;

      console.log('');
      console.log('  ━━━ Anchor Status ━━━');
      console.log('');
      console.log(`  Sources: ${active} active${paused ? `, ${paused} paused` : ''}${errored ? `, ${errored} error` : ''}`);
      console.log('');

      // Table header
      const nameW = Math.max(22, ...healthItems.map((h) => h.name.length + 2));
      console.log(
        `  ${'Name'.padEnd(nameW)}${'Type'.padEnd(9)}${'Docs'.padEnd(7)}${'Chunks'.padEnd(9)}${'Last Sync'.padEnd(18)}Health`,
      );
      console.log(
        `  ${'─'.repeat(nameW)}${'─'.repeat(9)}${'─'.repeat(7)}${'─'.repeat(9)}${'─'.repeat(18)}${'─'.repeat(12)}`,
      );

      for (const h of healthItems) {
        const badge = TYPE_BADGE[h.type] ?? h.type;
        const lastSyncStr = h.lastSync?.completedAt
          ? formatRelativeTime(h.lastSync.completedAt)
          : 'never';

        console.log(
          `  ${h.name.padEnd(nameW)}${badge.padEnd(9)}${String(h.latestDocCount).padEnd(7)}${String(h.chunkCount).padEnd(9)}${lastSyncStr.padEnd(18)}${HEALTH_ICON[h.health]}`,
        );
      }
      console.log('');

      // ── Next sync due ──
      const freshSources = healthItems
        .filter((h) => h.nextSyncDue && h.nextSyncDue.getTime() > Date.now())
        .sort((a, b) => a.nextSyncDue!.getTime() - b.nextSyncDue!.getTime());

      if (freshSources.length > 0) {
        const next = freshSources[0];
        console.log(`  Next sync due: ${next.name} in ${formatDuration(next.nextSyncDue!)}`);
      }

      // ── Stale/error warnings ──
      const stale = healthItems.filter((h) => h.health === 'stale');
      const errors = healthItems.filter((h) => h.health === 'error');
      if (stale.length > 0) {
        console.log(`  ⚠ ${stale.length} source(s) overdue for sync. Run: acr sync --all`);
      }
      if (errors.length > 0) {
        console.log(`  ✗ ${errors.length} source(s) in error state. Run: acr source inspect <name>`);
      }

      console.log('');

      await closeDb();
    } catch (err) {
      console.error('Status failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

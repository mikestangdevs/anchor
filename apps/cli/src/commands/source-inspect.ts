import { Command } from 'commander';
import { requireDatabaseUrl } from '@acr/config';
import { getDb, closeDb, sources, documents, chunks, syncJobs } from '@acr/db';
import { eq, sql, desc, count } from 'drizzle-orm';

export const sourceInspectCommand = new Command('source-inspect')
  .description('Show detailed info about a source: config, sync stats, sample docs')
  .argument('<name>', 'Name of the source to inspect')
  .option('--json', 'Output as JSON')
  .action(async (name: string, opts) => {
    try {
      const dbUrl = requireDatabaseUrl('source-inspect');
      const db = getDb(dbUrl);

      // Find the source
      const [source] = await db.select().from(sources).where(eq(sources.name, name)).limit(1);

      if (!source) {
        console.error(`Source "${name}" not found.`);
        const all = await db.select({ name: sources.name }).from(sources);
        if (all.length > 0) {
          console.error('\nAvailable sources:');
          for (const s of all) console.error(`  - ${s.name}`);
        }
        await closeDb();
        process.exit(1);
      }

      // Count docs and chunks
      const [docStats] = await db.select({
        total: count(),
        latest: sql<number>`count(*) filter (where ${documents.isLatest} = true)`,
      }).from(documents).where(eq(documents.sourceId, source.id));

      const [chunkStats] = await db.select({
        total: count(),
      }).from(chunks)
        .innerJoin(documents, eq(chunks.documentId, documents.id))
        .where(eq(documents.sourceId, source.id));

      // Get latest sync job
      const recentJobs = await db.select().from(syncJobs)
        .where(eq(syncJobs.sourceId, source.id))
        .orderBy(desc(syncJobs.createdAt))
        .limit(3);

      // Get sample documents (most recent 5)
      const sampleDocs = await db.select({
        id: documents.id,
        title: documents.title,
        canonicalUrl: documents.canonicalUrl,
        isLatest: documents.isLatest,
        lastVerifiedAt: documents.lastVerifiedAt,
        updatedAt: documents.updatedAt,
      }).from(documents)
        .where(eq(documents.sourceId, source.id))
        .orderBy(desc(documents.updatedAt))
        .limit(5);

      if (opts.json) {
        console.log(JSON.stringify({
          source,
          stats: { documents: docStats, chunks: chunkStats },
          recentJobs,
          sampleDocs,
        }, null, 2));
        await closeDb();
        return;
      }

      // ── Header ──
      const typeBadge = source.sourceType === 'supabase_view' ? 'supabase'
        : source.sourceType === 'github_repo' ? 'github'
        : source.sourceType === 'local_folder' ? 'local'
        : source.sourceType === 'docs_site' ? 'docs'
        : source.sourceType;

      console.log('');
      console.log(`━━━ ${source.name} ━━━`);
      console.log('');

      // ── Core Info ──
      console.log('  Type:        ' + typeBadge);
      console.log('  Trust:       ' + source.trustLevel);
      console.log('  Status:      ' + source.status);
      console.log('  Sync every:  ' + source.syncFrequencyMinutes + ' min');
      console.log('  Created:     ' + source.createdAt.toISOString().split('T')[0]);
      console.log('');

      // ── Connector-Specific Metadata ──
      if (source.sourceType === 'github_repo') {
        console.log('  ── GitHub ──');
        console.log('  Repo:    ' + source.githubOwner + '/' + source.githubRepo);
        console.log('  Branch:  ' + (source.githubBranch || 'main'));
        console.log('  Path:    ' + (source.githubDocsPath || '/'));
        if (source.baseUrl) {
          console.log('  Base URL: ' + source.baseUrl);
        }
      } else if (source.sourceType === 'supabase_view') {
        console.log('  ── Supabase ──');
        console.log('  URL:          ' + (source.supabaseUrl || '(not set)'));
        console.log('  View:         ' + (source.supabaseSchema || 'public') + '.' + (source.supabaseView || '?'));
        console.log('  ID field:     ' + (source.supabaseIdField || 'id'));
        console.log('  Title field:  ' + (source.supabaseTitleField || 'title'));
        console.log('  Content:      ' + (source.supabaseContentFields?.join(', ') || '(none)'));
        if (source.supabaseMetadataFields?.length) {
          console.log('  Metadata:     ' + source.supabaseMetadataFields.join(', '));
        }
        if (source.supabaseUpdatedAtField) {
          console.log('  Updated field: ' + source.supabaseUpdatedAtField);
        }
      } else if (source.sourceType === 'docs_site') {
        console.log('  ── Docs Site ──');
        console.log('  Base URL: ' + (source.baseUrl || '(not set)'));
      } else if (source.sourceType === 'local_folder') {
        console.log('  ── Local Folder ──');
        console.log('  Path:       ' + (source.folderPath || '(not set)'));
        console.log('  Recursive:  ' + (source.folderRecursive ?? true));
        if (source.includePatterns?.length) {
          console.log('  Include:    ' + (source.includePatterns as string[]).join(', '));
        }
        if (source.excludePatterns?.length) {
          console.log('  Exclude:    ' + (source.excludePatterns as string[]).join(', '));
        }
      }
      console.log('');

      // ── Stats ──
      console.log('  ── Stats ──');
      console.log(`  Documents:  ${docStats.total} total, ${docStats.latest} latest`);
      console.log(`  Chunks:     ${chunkStats.total}`);

      // Searchability check
      const isSearchable = docStats.total > 0 && chunkStats.total > 0 && docStats.latest > 0;
      if (isSearchable) {
        console.log('  Searchable: ✓ yes');
      } else if (docStats.total === 0) {
        console.log('  Searchable: ✗ no documents — run: acr sync --source "' + source.name + '"');
      } else if (chunkStats.total === 0) {
        console.log('  Searchable: ✗ no chunks — sync may have failed');
      } else {
        console.log('  Searchable: ✗ all documents marked stale');
      }

      // Chunk safety stats from latest completed sync
      const latestCompleted = recentJobs.find(j => j.status === 'completed');
      if (latestCompleted?.statsJson && typeof latestCompleted.statsJson === 'object') {
        const s = latestCompleted.statsJson as Record<string, number>;
        if (s.chunksSplit || s.chunksTruncated || s.chunksSkippedOversized) {
          const parts: string[] = [];
          if (s.chunksSplit) parts.push(`${s.chunksSplit} split`);
          if (s.chunksTruncated) parts.push(`${s.chunksTruncated} truncated`);
          if (s.chunksSkippedOversized) parts.push(`${s.chunksSkippedOversized} skipped (oversized)`);
          console.log('  Chunk safety: ' + parts.join(', '));
        }
      }
      console.log('');

      // ── Recent Syncs ──
      if (recentJobs.length === 0) {
        console.log('  ── Sync History ──');
        console.log('  No syncs yet. Run: acr sync --source "' + source.name + '"');
      } else {
        console.log('  ── Recent Syncs ──');
        for (const job of recentJobs) {
          const status = job.status === 'completed' ? '✓'
            : job.status === 'failed' ? '✗'
            : job.status === 'running' ? '⟳'
            : '○';

          const date = job.createdAt.toISOString().replace('T', ' ').split('.')[0];
          let duration = '';
          if (job.startedAt && job.completedAt) {
            const ms = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime();
            duration = ` (${Math.round(ms / 1000)}s)`;
          }

          let stats = '';
          if (job.statsJson && typeof job.statsJson === 'object') {
            const s = job.statsJson as Record<string, number>;
            const parts: string[] = [];
            if (s.processed) parts.push(`${s.processed} processed`);
            if (s.skipped) parts.push(`${s.skipped} skipped`);
            if (s.errors) parts.push(`${s.errors} errors`);
            if (s.totalChunks) parts.push(`${s.totalChunks} chunks`);
            if (parts.length) stats = ' — ' + parts.join(', ');
          }

          const error = job.errorMessage ? `\n               Error: ${job.errorMessage}` : '';

          console.log(`  ${status} ${job.jobType.padEnd(12)} ${date}${duration}${stats}${error}`);
        }

        // ── Next Sync Due ──
        const latestCompletedJob = recentJobs.find(j => j.status === 'completed');
        if (latestCompletedJob?.completedAt) {
          const nextDue = new Date(latestCompletedJob.completedAt.getTime() + source.syncFrequencyMinutes * 60_000);
          const now = Date.now();
          if (nextDue.getTime() > now) {
            const diffMin = Math.floor((nextDue.getTime() - now) / 60_000);
            const hr = Math.floor(diffMin / 60);
            const min = diffMin % 60;
            console.log(`  Next sync due in ${hr > 0 ? hr + 'h ' : ''}${min}m`);
          } else {
            console.log('  ⚠ Sync overdue — run: acr sync --source "' + source.name + '"');
          }
        }

        // ── Last Error ──
        const lastFailed = recentJobs.find(j => j.status === 'failed');
        if (lastFailed && lastFailed.errorMessage) {
          // Only show if the last failed job is more recent or same as last completed
          const lastCompletedTime = latestCompletedJob?.completedAt?.getTime() ?? 0;
          const lastFailedTime = lastFailed.createdAt.getTime();
          if (lastFailedTime >= lastCompletedTime) {
            console.log('');
            console.log('  ── Last Error ──');
            console.log('  ' + lastFailed.errorMessage);
          }
        }
      }
      console.log('');

      // ── Sample Documents ──
      if (sampleDocs.length > 0) {
        console.log('  ── Sample Documents ──');
        for (const doc of sampleDocs) {
          const latestMark = doc.isLatest ? '' : ' (outdated)';

          // Format URL based on source type
          let urlDisplay: string;
          if (source.sourceType === 'supabase_view' && doc.canonicalUrl.startsWith('supabase://')) {
            const parts = doc.canonicalUrl.replace('supabase://', '').split('/');
            const rowId = parts[2] || '';
            urlDisplay = rowId.slice(0, 8) + '…';
          } else if (source.sourceType === 'local_folder' && doc.canonicalUrl.startsWith('file://')) {
            urlDisplay = doc.canonicalUrl.replace('file://./', '');
          } else {
            urlDisplay = doc.canonicalUrl;
          }

          console.log(`  • ${doc.title}${latestMark}`);
          console.log(`    ${urlDisplay}`);
        }
      }
      console.log('');

      await closeDb();
    } catch (err) {
      console.error('Inspect failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

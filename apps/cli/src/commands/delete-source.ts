import { Command } from 'commander';
import { requireDatabaseUrl } from '@acr/config';
import { getDb, closeDb, sources, documents, chunks, annotations, syncJobs } from '@acr/db';
import { eq, sql, inArray } from 'drizzle-orm';

export const deleteSourceCommand = new Command('delete-source')
  .description('Delete a source and all its documents, chunks, and sync history')
  .argument('<name>', 'Name of the source to delete')
  .option('--yes', 'Skip confirmation prompt')
  .action(async (name: string, opts) => {
    try {
      const dbUrl = requireDatabaseUrl('delete-source');
      const db = getDb(dbUrl);

      // Find the source
      const [source] = await db.select().from(sources).where(eq(sources.name, name)).limit(1);

      if (!source) {
        console.error(`Source "${name}" not found.`);
        console.error('');
        console.error('Available sources:');
        const all = await db.select({ name: sources.name }).from(sources);
        if (all.length === 0) {
          console.error('  (none)');
        } else {
          for (const s of all) {
            console.error(`  - ${s.name}`);
          }
        }
        process.exit(1);
      }

      // ── Count what will be deleted — 4 aggregate queries, not N loops ──

      // Subquery: document IDs for this source
      const docIdSubquery = db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.sourceId, source.id));

      const [docCountResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .where(eq(documents.sourceId, source.id));

      const [chunkCountResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(chunks)
        .where(inArray(chunks.documentId, docIdSubquery));

      const [annotationCountResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(annotations)
        .where(inArray(annotations.documentId!, docIdSubquery));

      const [jobCountResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(syncJobs)
        .where(eq(syncJobs.sourceId, source.id));

      const docCount = docCountResult?.count ?? 0;
      const chunkCount = chunkCountResult?.count ?? 0;
      const annotationCount = annotationCountResult?.count ?? 0;
      const jobCount = jobCountResult?.count ?? 0;

      console.log(`Source: ${source.name} (${source.sourceType})`);
      console.log(`  ID:          ${source.id}`);
      console.log(`  Documents:   ${docCount}`);
      console.log(`  Chunks:      ${chunkCount}`);
      console.log(`  Annotations: ${annotationCount}`);
      console.log(`  Sync jobs:   ${jobCount}`);
      console.log('');

      if (!opts.yes) {
        console.log('This will permanently delete this source and all associated data.');
        console.log('Run with --yes to confirm:');
        console.log(`  acr delete-source "${name}" --yes`);
        process.exit(0);
      }

      // ── Delete in dependency order — explicit batched deletes, no cascade ──
      const t0 = Date.now();

      // 1. Annotations (references chunks + documents)
      if (annotationCount > 0) {
        await db.delete(annotations).where(inArray(annotations.documentId!, docIdSubquery));
      }

      // 2. Chunks (references documents)
      if (chunkCount > 0) {
        const tChunks = Date.now();
        await db.delete(chunks).where(inArray(chunks.documentId, docIdSubquery));
        console.log(`  ✓ Deleted ${chunkCount.toLocaleString()} chunks in ${Date.now() - tChunks}ms`);
      }

      // 3. Documents (references source)
      if (docCount > 0) {
        const tDocs = Date.now();
        await db.delete(documents).where(eq(documents.sourceId, source.id));
        console.log(`  ✓ Deleted ${docCount} documents in ${Date.now() - tDocs}ms`);
      }

      // 4. Sync jobs (references source)
      if (jobCount > 0) {
        await db.delete(syncJobs).where(eq(syncJobs.sourceId, source.id));
      }

      // 5. Source itself
      await db.delete(sources).where(eq(sources.id, source.id));

      const elapsed = Date.now() - t0;
      console.log(`✓ Deleted source "${name}" in ${elapsed}ms`);
      console.log(`  ${docCount} documents, ${chunkCount.toLocaleString()} chunks, ${annotationCount} annotations, ${jobCount} sync jobs removed.`);
    } catch (err) {
      console.error('Delete failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

import { Command } from 'commander';
import { requireDatabaseUrl } from '@acr/config';
import { getDb, closeDb, sources, documents, chunks, annotations, syncJobs } from '@acr/db';
import { eq } from 'drizzle-orm';

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

      // Count what will be deleted
      const docIds = await db.select({ id: documents.id }).from(documents).where(eq(documents.sourceId, source.id));
      let chunkCount = 0;
      let annotationCount = 0;

      for (const doc of docIds) {
        const docChunks = await db.select({ id: chunks.id }).from(chunks).where(eq(chunks.documentId, doc.id));
        chunkCount += docChunks.length;

        const docAnnotations = await db.select({ id: annotations.id }).from(annotations).where(eq(annotations.documentId, doc.id));
        annotationCount += docAnnotations.length;
      }

      const jobCount = (await db.select({ id: syncJobs.id }).from(syncJobs).where(eq(syncJobs.sourceId, source.id))).length;

      console.log(`Source: ${source.name} (${source.sourceType})`);
      console.log(`  ID:          ${source.id}`);
      console.log(`  Documents:   ${docIds.length}`);
      console.log(`  Chunks:      ${chunkCount}`);
      console.log(`  Annotations: ${annotationCount}`);
      console.log(`  Sync jobs:   ${jobCount}`);
      console.log('');

      if (!opts.yes) {
        // Simple confirmation without readline (works in non-interactive)
        console.log('This will permanently delete this source and all associated data.');
        console.log('Run with --yes to confirm:');
        console.log(`  acr delete-source "${name}" --yes`);
        process.exit(0);
      }

      // Delete — cascade handles documents → chunks → annotations
      await db.delete(syncJobs).where(eq(syncJobs.sourceId, source.id));
      await db.delete(sources).where(eq(sources.id, source.id));

      console.log(`✓ Deleted source "${name}" and all associated data.`);
      console.log(`  ${docIds.length} documents, ${chunkCount} chunks, ${annotationCount} annotations, ${jobCount} sync jobs removed.`);
    } catch (err) {
      console.error('Delete failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

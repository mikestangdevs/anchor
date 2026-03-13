import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, documents, sources } from '@acr/db';
import { requireDatabaseUrl } from '@acr/config';
import { listAnnotations } from '@acr/annotations';

export const getDocumentCommand = new Command('get-document')
  .description('Fetch a document by ID')
  .argument('<documentId>', 'Document ID')
  .option('--with-annotations', 'Include annotations')
  .option('--json', 'Output as JSON')
  .action(async (documentId, opts) => {
    try {
      const dbUrl = requireDatabaseUrl('get-document');
      const db = getDb(dbUrl);

      const results = await db
        .select({
          doc: documents,
          sourceName: sources.name,
          trustLevel: sources.trustLevel,
        })
        .from(documents)
        .innerJoin(sources, eq(documents.sourceId, sources.id))
        .where(eq(documents.id, documentId))
        .limit(1);

      if (results.length === 0) {
        console.error(`Document not found: ${documentId}`);
        process.exit(1);
      }

      const { doc, sourceName, trustLevel } = results[0];
      const docAnnotations = opts.withAnnotations
        ? await listAnnotations(documentId)
        : [];

      if (opts.json) {
        console.log(JSON.stringify({
          ...doc,
          sourceName,
          trustLevel,
          annotations: docAnnotations,
        }, null, 2));
        await closeDb();
        return;
      }

      console.log(`\nDocument: ${doc.title}`);
      console.log(`  ID:       ${doc.id}`);
      console.log(`  Source:   ${sourceName} (${trustLevel})`);
      console.log(`  URL:      ${doc.canonicalUrl}`);
      console.log(`  Latest:   ${doc.isLatest ? 'yes' : 'no'}`);
      console.log(`  Verified: ${doc.lastVerifiedAt.toISOString()}`);
      console.log('');
      console.log('─── Content ───');
      console.log(doc.cleanedMarkdown);

      if (docAnnotations.length > 0) {
        console.log('');
        console.log('─── Annotations ───');
        for (const ann of docAnnotations) {
          console.log(`  [${ann.kind}] ${ann.note}`);
          console.log(`    Confidence: ${ann.confidence}, By: ${ann.authorType}, Status: ${ann.status}`);
        }
      }

      await closeDb();
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

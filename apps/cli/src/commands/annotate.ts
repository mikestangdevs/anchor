import { Command } from 'commander';
import { closeDb } from '@acr/db';
import { requireDatabaseUrl } from '@acr/config';
import { getDb } from '@acr/db';
import { createAnnotation } from '@acr/annotations';
import type { AnnotationKind, AuthorType } from '@acr/types';

const VALID_KINDS: AnnotationKind[] = ['workaround', 'warning', 'example', 'migration_note'];

export const annotateCommand = new Command('annotate')
  .description('Add an annotation to a document or chunk')
  .requiredOption('--kind <kind>', 'Annotation kind: workaround, warning, example, migration_note')
  .requiredOption('--note <note>', 'Annotation text')
  .option('--document-id <id>', 'Document ID to annotate')
  .option('--chunk-id <id>', 'Chunk ID to annotate')
  .option('--confidence <n>', 'Confidence score (0-1)', '0.8')
  .option('--author-type <type>', 'Author type: human or agent', 'human')
  .option('--author-name <name>', 'Author name')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      if (!opts.documentId && !opts.chunkId) {
        console.error('Either --document-id or --chunk-id is required');
        process.exit(1);
      }

      if (!VALID_KINDS.includes(opts.kind as AnnotationKind)) {
        console.error(`Invalid kind. Must be one of: ${VALID_KINDS.join(', ')}`);
        process.exit(1);
      }

      // Validate DB is configured before calling into annotations service
      const dbUrl = requireDatabaseUrl('annotate');
      getDb(dbUrl); // Initialize DB with explicit URL

      const annotation = await createAnnotation({
        documentId: opts.documentId,
        chunkId: opts.chunkId,
        kind: opts.kind as AnnotationKind,
        note: opts.note,
        confidence: parseFloat(opts.confidence),
        authorType: opts.authorType as AuthorType,
        authorName: opts.authorName,
      });

      if (opts.json) {
        console.log(JSON.stringify(annotation, null, 2));
      } else {
        console.log(`✓ Annotation saved (${annotation.id})`);
        console.log(`  Kind:       ${annotation.kind}`);
        console.log(`  Status:     ${annotation.status}`);
        console.log(`  Confidence: ${annotation.confidence}`);
      }

      await closeDb();
    } catch (err) {
      console.error('Failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

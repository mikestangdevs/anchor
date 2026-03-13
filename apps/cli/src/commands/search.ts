import { Command } from 'commander';
import { closeDb, getDb } from '@acr/db';
import { requireDatabaseUrl, requireEmbeddingConfig } from '@acr/config';
import { searchContext } from '@acr/retrieval';
import { getEmbeddingProvider } from '@acr/embeddings';

export const searchCommand = new Command('search')
  .description('Search context across all synced sources')
  .argument('<query>', 'Search query')
  .option('--source <name>', 'Filter by source name')
  .option('--max-results <n>', 'Maximum results', '10')
  .option('--include-deprecated', 'Include non-latest documents')
  .option('--json', 'Output as JSON')
  .action(async (query, opts) => {
    try {
      // Search requires both DB and embeddings (generates query vector)
      const dbUrl = requireDatabaseUrl('search');
      requireEmbeddingConfig('search');

      // Initialize DB with explicit URL before retrieval layer calls getDb()
      getDb(dbUrl);

      const embeddingProvider = getEmbeddingProvider();

      const response = await searchContext(
        {
          query,
          sourceFilter: opts.source,
          maxResults: parseInt(opts.maxResults, 10),
          latestOnly: !opts.includeDeprecated,
        },
        embeddingProvider,
      );

      if (opts.json) {
        console.log(JSON.stringify(response, null, 2));
        await closeDb();
        return;
      }

      if (response.results.length === 0) {
        console.log('No results found.');
        await closeDb();
        return;
      }

      console.log(`\nFound ${response.results.length} results (${response.totalCandidates} candidates):\n`);

      for (let i = 0; i < response.results.length; i++) {
        const result = response.results[i];
        const c = result.citation;

        // Format source type badge
        const typeBadge = c.sourceType === 'supabase_view' ? 'supabase'
          : c.sourceType === 'github_repo' ? 'github'
          : c.sourceType === 'local_folder' ? 'local'
          : c.sourceType === 'docs_site' ? 'docs'
          : c.sourceType;

        console.log(`─── Result ${i + 1} (score: ${result.score}) ${'─'.repeat(50)}`);
        console.log(`  Source:  ${c.sourceName} [${typeBadge}] (${c.trustLevel})`);
        console.log(`  Doc:     ${c.documentTitle}`);
        if (result.sectionTitle && result.sectionTitle !== c.documentTitle) {
          console.log(`  Section: ${result.sectionTitle}`);
        }

        // Parse Supabase URLs into a cleaner format
        if (c.sourceType === 'supabase_view' && c.canonicalUrl.startsWith('supabase://')) {
          const parts = c.canonicalUrl.replace('supabase://', '').split('/');
          const view = parts[1] || '';
          const rowId = parts[2] || '';
          console.log(`  View:    ${view}`);
          console.log(`  Row ID:  ${rowId}`);
        } else if (c.sourceType === 'local_folder' && c.canonicalUrl.startsWith('file://')) {
          const relPath = c.canonicalUrl.replace('file://./', '');
          console.log(`  File:    ${relPath}`);
        } else {
          console.log(`  URL:     ${c.canonicalUrl}`);
        }

        console.log(`  Latest:  ${c.isLatest ? 'yes' : 'no'}`);
        console.log(`  Updated: ${c.lastVerifiedAt.toISOString().split('T')[0]}`);
        console.log('');

        // Truncate chunk text for display
        const preview = result.chunkText.length > 300
          ? result.chunkText.slice(0, 300) + '...'
          : result.chunkText;
        console.log(`  ${preview}`);

        if (result.annotations.length > 0) {
          console.log('');
          console.log(`  📌 Annotations (${result.annotations.length}):`);
          for (const ann of result.annotations) {
            console.log(`    [${ann.kind}] ${ann.note} (confidence: ${ann.confidence}, by: ${ann.authorType})`);
          }
        }
        console.log('');
      }

      await closeDb();
    } catch (err) {
      console.error('Search failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

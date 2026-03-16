import { Command } from 'commander';
import { closeDb, getDb } from '@acr/db';
import { requireDatabaseUrl, requireEmbeddingConfig } from '@acr/config';
import { searchContext } from '@acr/retrieval';
import { getEmbeddingProvider } from '@acr/embeddings';
import { cleanSnippet, truncateSnippet, DISPLAY_SCORE_FLOOR } from './search-helpers.js';

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
        return;
      }

      if (response.results.length === 0) {
        console.log('\nNo results found.');
        console.log('  Tip: try a broader query, or run `acr sync` to refresh your sources.\n');
        return;
      }

      // Filter results whose display score falls below the confidence floor.
      // (The retrieval layer already applies a cosine floor, but final ranking
      // includes trust/freshness boosts that can lift weak semantic matches.)
      const confident = response.results.filter((r) => r.score >= DISPLAY_SCORE_FLOOR);

      if (confident.length === 0) {
        console.log(`\nNo confident results for "${query}".`);
        console.log(`  All ${response.results.length} candidate(s) scored below ${DISPLAY_SCORE_FLOOR}.\n`);
        return;
      }

      console.log(`\nFound ${confident.length} result(s) for "${query}" (${response.totalCandidates} chunks searched):\n`);

      for (let i = 0; i < confident.length; i++) {
        const result = confident[i];
        const c = result.citation;

        // Format source type badge
        const typeBadge = c.sourceType === 'supabase_view' ? 'supabase'
          : c.sourceType === 'github_repo' ? 'github'
            : c.sourceType === 'local_folder' ? 'local'
              : c.sourceType === 'docs_site' ? 'docs'
                : c.sourceType;

        const matchDetail = result.additionalChunkCount > 0
          ? `  +${result.additionalChunkCount} more chunk${result.additionalChunkCount === 1 ? '' : 's'} from this doc`
          : '';

        // ── Header ─────────────────────────────────────────────────────────
        console.log(`─── ${i + 1}. ${c.documentTitle} ${'─'.repeat(Math.max(0, 50 - c.documentTitle.length))}`);
        console.log(`    Source:  ${c.sourceName} [${typeBadge}] (${c.trustLevel})`);
        console.log(`    Score:   ${result.score}${matchDetail}`);

        if (result.sectionTitle && result.sectionTitle !== c.documentTitle) {
          const cleanSection = result.sectionTitle.replace(/\[\s*\]\(#[^)]*\)/g, '').trim();
          if (cleanSection) console.log(`    Section: ${cleanSection}`);
        }

        // Parse Supabase URLs for cleaner display
        if (c.sourceType === 'supabase_view' && c.canonicalUrl.startsWith('supabase://')) {
          const parts = c.canonicalUrl.replace('supabase://', '').split('/');
          console.log(`    View:    ${parts[1] ?? ''}`);
          console.log(`    Row ID:  ${parts[2] ?? ''}`);
        } else if (c.sourceType === 'local_folder' && c.canonicalUrl.startsWith('file://')) {
          console.log(`    File:    ${c.canonicalUrl.replace('file://./', '')}`);
        } else {
          console.log(`    URL:     ${c.canonicalUrl}`);
        }

        // ── Snippet ────────────────────────────────────────────────────────
        const snippet = truncateSnippet(cleanSnippet(result.chunkText));
        console.log('');
        const indented = snippet.split('\n').map((l) => `    ${l}`).join('\n');
        console.log(indented);

        // ── Annotations ────────────────────────────────────────────────────
        if (result.annotations.length > 0) {
          console.log('');
          console.log(`    📌 Annotations (${result.annotations.length}):`);
          for (const ann of result.annotations) {
            console.log(`      [${ann.kind}] ${ann.note}`);
            console.log(`        confidence: ${ann.confidence}  by: ${ann.authorType}`);
          }
        }

        // ── Get-document call-to-action ────────────────────────────────────
        console.log('');
        console.log(`    → acr get-document ${result.documentId}`);
        console.log('');
      }

    } catch (err) {
      console.error('Search failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    } finally {
      await closeDb();
    }
  });

import type { SearchResult, CitationRef, Annotation } from '@acr/types';
import type { RankedResult } from './ranker.js';

/**
 * Format ranked results into citation-ready SearchResult objects.
 *
 * Groups by documentId — keeps the highest-scored chunk per document as
 * the representative, records how many additional chunks from that document
 * also matched. This prevents the same document from dominating the results
 * list as multiple near-duplicate entries.
 */
export function formatResults(
  ranked: RankedResult[],
  annotationsMap: Map<string, Annotation[]>,
  maxResults: number,
): SearchResult[] {
  // Group by documentId, preserving ranked order (first occurrence = best chunk per doc)
  const docGroups = groupByDocument(ranked);

  return docGroups.slice(0, maxResults).map(({ representative, additionalCount }) => {
    const citation: CitationRef = {
      documentTitle: representative.documentTitle,
      canonicalUrl: representative.canonicalUrl,
      sourceName: representative.sourceName,
      sourceType: representative.sourceType as CitationRef['sourceType'],
      trustLevel: representative.trustLevel as 'official' | 'community',
      lastVerifiedAt: new Date(representative.lastVerifiedAt),
      isLatest: representative.isLatest,
    };

    return {
      chunkId: representative.chunkId,
      documentId: representative.documentId,
      chunkText: representative.chunkText,
      sectionTitle: representative.sectionTitle,
      score: Math.round(representative.finalScore * 1000) / 1000,
      citation,
      annotations: annotationsMap.get(representative.chunkId) ?? [],
      additionalChunkCount: additionalCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal grouping helpers
// ---------------------------------------------------------------------------

interface DocGroup {
  representative: RankedResult;
  additionalCount: number;
}

/**
 * Group ranked chunk results by document.
 *
 * The input is already sorted by score descending (from ranker), so the first
 * chunk encountered for each documentId is automatically the best one.
 */
function groupByDocument(ranked: RankedResult[]): DocGroup[] {
  const seen = new Map<string, DocGroup>();

  for (const result of ranked) {
    const existing = seen.get(result.documentId);
    if (existing) {
      existing.additionalCount += 1;
    } else {
      seen.set(result.documentId, { representative: result, additionalCount: 0 });
    }
  }

  // Return in the order they were first seen (preserves score ranking)
  return Array.from(seen.values());
}

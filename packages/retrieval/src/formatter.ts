import type { SearchResult, CitationRef, Annotation } from '@acr/types';
import type { RankedResult } from './ranker.js';

/**
 * Format ranked results into citation-ready SearchResult objects.
 */
export function formatResults(
  ranked: RankedResult[],
  annotationsMap: Map<string, Annotation[]>,
  maxResults: number,
): SearchResult[] {
  return ranked.slice(0, maxResults).map((result) => {
    const citation: CitationRef = {
      documentTitle: result.documentTitle,
      canonicalUrl: result.canonicalUrl,
      sourceName: result.sourceName,
      sourceType: result.sourceType as CitationRef['sourceType'],
      trustLevel: result.trustLevel as 'official' | 'community',
      lastVerifiedAt: new Date(result.lastVerifiedAt),
      isLatest: result.isLatest,
    };

    return {
      chunkId: result.chunkId,
      chunkText: result.chunkText,
      sectionTitle: result.sectionTitle,
      score: Math.round(result.finalScore * 1000) / 1000,
      citation,
      annotations: annotationsMap.get(result.chunkId) ?? [],
    };
  });
}

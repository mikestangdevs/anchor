import type { VectorSearchResult } from './search.js';

/**
 * Ranking weights — configurable constants.
 */
const WEIGHTS = {
  semanticSimilarity: 0.65,
  trustBoost: 0.10,
  freshnessBoost: 0.10,
  latestBoost: 0.10,
  annotationBoost: 0.05,
} as const;

const FRESHNESS_DECAY_DAYS = 90;

export interface RankedResult extends VectorSearchResult {
  finalScore: number;
  hasApprovedAnnotations: boolean;
}

/**
 * Rerank search results using multi-signal scoring.
 *
 * final_score =
 *   semantic_similarity * 0.65
 * + trust_boost         * 0.10
 * + freshness_boost     * 0.10
 * + latest_boost        * 0.10
 * + annotation_boost    * 0.05
 */
export function rankResults(
  results: VectorSearchResult[],
  annotatedChunkIds: Set<string>,
): RankedResult[] {
  const now = Date.now();

  const ranked: RankedResult[] = results.map((result) => {
    // Semantic similarity (already 0-1 from cosine)
    const semanticScore = Math.max(0, Math.min(1, result.similarity));

    // Trust boost: official = 1.0, community = 0.5
    const trustScore = result.trustLevel === 'official' ? 1.0 : 0.5;

    // Freshness boost: linear decay over FRESHNESS_DECAY_DAYS
    const daysSinceVerified =
      (now - new Date(result.lastVerifiedAt).getTime()) / (1000 * 60 * 60 * 24);
    const freshnessScore = Math.max(0, 1 - daysSinceVerified / FRESHNESS_DECAY_DAYS);

    // Latest boost: is_latest = 1.0, else 0.0
    const latestScore = result.isLatest ? 1.0 : 0.0;

    // Annotation boost: has approved annotations = 1.0, else 0.0
    const hasAnnotations = annotatedChunkIds.has(result.chunkId);
    const annotationScore = hasAnnotations ? 1.0 : 0.0;

    const finalScore =
      semanticScore * WEIGHTS.semanticSimilarity +
      trustScore * WEIGHTS.trustBoost +
      freshnessScore * WEIGHTS.freshnessBoost +
      latestScore * WEIGHTS.latestBoost +
      annotationScore * WEIGHTS.annotationBoost;

    return {
      ...result,
      finalScore,
      hasApprovedAnnotations: hasAnnotations,
    };
  });

  // Sort by final score descending
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  return ranked;
}

import { sql, eq, and, inArray } from 'drizzle-orm';
import { getDb, chunks, documents, sources } from '@acr/db';
import type { EmbeddingProvider, SearchRequest } from '@acr/types';

export interface VectorSearchResult {
  chunkId: string;
  chunkText: string;
  sectionTitle: string | null;
  tokenCount: number;
  qualityScore: number;
  similarity: number;
  documentId: string;
  documentTitle: string;
  canonicalUrl: string;
  isLatest: boolean;
  lastVerifiedAt: Date;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  trustLevel: string;
}

/**
 * Perform vector similarity search using pgvector cosine distance.
 */
export async function vectorSearch(
  queryEmbedding: number[],
  request: SearchRequest,
): Promise<VectorSearchResult[]> {
  const db = getDb();
  // Fetch 3x to allow document-level grouping headroom (dedupe reduces displayed count).
  // Hard cap at 50 to avoid over-querying pgvector.
  const limit = Math.min((request.maxResults ?? 10) * 3, 50);

  // Build the embedding literal for pgvector
  const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

  // Base query with cosine similarity
  const results = await db
    .select({
      chunkId: chunks.id,
      chunkText: chunks.text,
      sectionTitle: chunks.sectionTitle,
      tokenCount: chunks.tokenCount,
      qualityScore: chunks.qualityScore,
      similarity: sql<number>`1 - (${chunks.embedding} <=> ${embeddingLiteral}::vector)`.as('similarity'),
      documentId: documents.id,
      documentTitle: documents.title,
      canonicalUrl: documents.canonicalUrl,
      isLatest: documents.isLatest,
      lastVerifiedAt: documents.lastVerifiedAt,
      sourceId: sources.id,
      sourceName: sources.name,
      sourceType: sources.sourceType,
      trustLevel: sources.trustLevel,
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .where(
      and(
        // Filter out chunks without embeddings
        sql`${chunks.embedding} IS NOT NULL`,
        // Minimum similarity floor — filter out semantically irrelevant noise
        // Similarity floor — raise to reduce noisy/low-confidence matches.
        // Below 0.35, cosine similarity is too weak to be useful for doc retrieval.
        sql`1 - (${chunks.embedding} <=> ${embeddingLiteral}::vector) > 0.35`,
        // Filter by latest only if requested
        request.latestOnly !== false ? eq(documents.isLatest, true) : undefined,
        // Filter by source if specified
        request.sourceFilter ? eq(sources.name, request.sourceFilter) : undefined,
      ),
    )
    .orderBy(sql`${chunks.embedding} <=> ${embeddingLiteral}::vector`)
    .limit(limit);

  return results as VectorSearchResult[];
}

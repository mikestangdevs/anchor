import { eq, inArray } from 'drizzle-orm';
import { getDb, annotations } from '@acr/db';
import type { SearchRequest, SearchResponse, EmbeddingProvider, Annotation } from '@acr/types';
import { vectorSearch } from './search.js';
import { rankResults } from './ranker.js';
import { formatResults } from './formatter.js';

export { vectorSearch } from './search.js';
export { rankResults } from './ranker.js';
export { formatResults } from './formatter.js';

/**
 * Full retrieval pipeline: embed query → vector search → load annotations → rerank → format.
 */
export async function searchContext(
  request: SearchRequest,
  embeddingProvider: EmbeddingProvider,
): Promise<SearchResponse> {
  // 1. Embed the query
  const [queryEmbedding] = await embeddingProvider.embed([request.query]);

  // 2. Vector search
  const rawResults = await vectorSearch(queryEmbedding, request);

  if (rawResults.length === 0) {
    return { results: [], query: request.query, totalCandidates: 0 };
  }

  // 3. Load annotations for matched chunks
  const db = getDb();
  const chunkIds = rawResults.map((r) => r.chunkId);

  const chunkAnnotations = await db
    .select()
    .from(annotations)
    .where(
      inArray(annotations.chunkId, chunkIds),
    );

  // Group annotations by chunk ID
  const annotationsMap = new Map<string, Annotation[]>();
  const approvedChunkIds = new Set<string>();

  for (const annotation of chunkAnnotations) {
    const list = annotationsMap.get(annotation.chunkId!) ?? [];
    list.push({
      id: annotation.id,
      documentId: annotation.documentId,
      chunkId: annotation.chunkId,
      authorType: annotation.authorType as 'human' | 'agent',
      authorName: annotation.authorName,
      kind: annotation.kind as Annotation['kind'],
      note: annotation.note,
      confidence: annotation.confidence,
      status: annotation.status as 'pending' | 'approved' | 'rejected',
      createdAt: annotation.createdAt,
    });
    annotationsMap.set(annotation.chunkId!, list);

    if (annotation.status === 'approved') {
      approvedChunkIds.add(annotation.chunkId!);
    }
  }

  // 4. Rerank with multi-signal scoring
  const ranked = rankResults(rawResults, approvedChunkIds);

  // 5. Format citation-ready results
  const maxResults = request.maxResults ?? 10;
  const results = formatResults(ranked, annotationsMap, maxResults);

  return {
    results,
    query: request.query,
    totalCandidates: rawResults.length,
  };
}

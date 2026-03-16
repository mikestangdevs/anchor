import { describe, it, expect } from 'vitest';
import { formatResults } from '../src/formatter.js';
import type { RankedResult } from '../src/ranker.js';
import type { Annotation } from '@acr/types';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeRankedResult(overrides: Partial<RankedResult> & { documentId: string }): RankedResult {
  return {
    chunkId: `chunk-${overrides.documentId}-${Math.random()}`,
    chunkText: 'Some chunk text content for testing.',
    sectionTitle: null,
    tokenCount: 20,
    qualityScore: 0.9,
    similarity: 0.8,
    documentId: overrides.documentId,
    documentTitle: `Doc ${overrides.documentId}`,
    canonicalUrl: `https://example.com/${overrides.documentId}`,
    isLatest: true,
    lastVerifiedAt: new Date('2026-01-01'),
    sourceId: 'src-1',
    sourceName: 'TestSource',
    sourceType: 'docs_site',
    trustLevel: 'official',
    finalScore: 0.8,
    hasApprovedAnnotations: false,
    ...overrides,
  };
}

const EMPTY_ANNOTATIONS_MAP = new Map<string, Annotation[]>();

// ─── Document Grouping ───────────────────────────────────────────────────────

describe('formatResults — document-level grouping', () => {
  it('collapses multiple chunks from the same document into one result', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.9, chunkId: 'c1' }),
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.75, chunkId: 'c2' }),
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.60, chunkId: 'c3' }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results).toHaveLength(1);
    expect(results[0].documentId).toBe('doc-a');
  });

  it('uses the highest-scoring chunk as the representative', () => {
    // The ranker sorts descending, so first in the array = best score
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.9, chunkId: 'best-chunk', chunkText: 'Best chunk text' }),
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.6, chunkId: 'worse-chunk', chunkText: 'Worse chunk text' }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results[0].chunkId).toBe('best-chunk');
    expect(results[0].chunkText).toBe('Best chunk text');
  });

  it('tracks additionalChunkCount correctly', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.9, chunkId: 'c1' }),
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.75, chunkId: 'c2' }),
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.60, chunkId: 'c3' }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    // 3 chunks total → 1 representative + 2 additional
    expect(results[0].additionalChunkCount).toBe(2);
  });

  it('sets additionalChunkCount to 0 for a document with a single matching chunk', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-x', finalScore: 0.85, chunkId: 'solo' }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results[0].additionalChunkCount).toBe(0);
  });

  it('returns one result per unique document across many docs', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.95, chunkId: 'ca1' }),
      makeRankedResult({ documentId: 'doc-b', finalScore: 0.90, chunkId: 'cb1' }),
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.80, chunkId: 'ca2' }), // duplicate doc-a
      makeRankedResult({ documentId: 'doc-c', finalScore: 0.75, chunkId: 'cc1' }),
      makeRankedResult({ documentId: 'doc-b', finalScore: 0.70, chunkId: 'cb2' }), // duplicate doc-b
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results).toHaveLength(3);
    const docIds = results.map((r) => r.documentId);
    expect(docIds).toContain('doc-a');
    expect(docIds).toContain('doc-b');
    expect(docIds).toContain('doc-c');
  });

  it('respects maxResults after grouping', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.95 }),
      makeRankedResult({ documentId: 'doc-b', finalScore: 0.85 }),
      makeRankedResult({ documentId: 'doc-c', finalScore: 0.75 }),
      makeRankedResult({ documentId: 'doc-d', finalScore: 0.65 }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 2);

    expect(results).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    const results = formatResults([], EMPTY_ANNOTATIONS_MAP, 10);
    expect(results).toHaveLength(0);
  });
});

// ─── documentId is always present ───────────────────────────────────────────

describe('formatResults — documentId field', () => {
  it('preserves documentId on each result', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'my-doc-id', finalScore: 0.9 }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results[0].documentId).toBe('my-doc-id');
  });
});

// ─── Annotations ────────────────────────────────────────────────────────────

describe('formatResults — annotations', () => {
  it('attaches annotations to the representative chunk', () => {
    const chunkId = 'annotated-chunk';
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.9, chunkId }),
    ];

    const ann: Annotation = {
      id: 'ann-1',
      documentId: 'doc-a',
      chunkId,
      authorType: 'human',
      authorName: 'mike',
      kind: 'workaround',
      note: 'Use idempotency keys',
      confidence: 0.9,
      status: 'approved',
      createdAt: new Date(),
    };
    const annotationsMap = new Map([[chunkId, [ann]]]);

    const results = formatResults(ranked, annotationsMap, 10);

    expect(results[0].annotations).toHaveLength(1);
    expect(results[0].annotations[0].note).toBe('Use idempotency keys');
  });

  it('returns empty annotations array when chunk has none', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.9 }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results[0].annotations).toEqual([]);
  });
});

// ─── Score formatting ────────────────────────────────────────────────────────

describe('formatResults — score', () => {
  it('rounds score to 3 decimal places', () => {
    const ranked: RankedResult[] = [
      makeRankedResult({ documentId: 'doc-a', finalScore: 0.83456789 }),
    ];

    const results = formatResults(ranked, EMPTY_ANNOTATIONS_MAP, 10);

    expect(results[0].score).toBe(0.835);
  });
});

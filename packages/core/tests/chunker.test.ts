import { describe, it, expect } from 'vitest';
import {
  chunkMarkdown,
  enforceChunkSafety,
  estimateTokens,
  EMBED_HARD_MAX_TOKENS,
  EMBED_SAFE_MAX_TOKENS,
  CHARS_PER_TOKEN,
  MAX_CHUNK_TOKENS,
} from '../src/chunker.js';
import type { ChunkOutput } from '@acr/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a string of roughly `tokens` tokens (using CHARS_PER_TOKEN estimate).
 * The text uses repeated words so it looks realistic (not just 'a'.repeat(n)).
 */
function makeText(approximateTokens: number, word = 'context'): string {
  const charsNeeded = Math.ceil(approximateTokens * CHARS_PER_TOKEN);
  const repeated = (word + ' ').repeat(Math.ceil(charsNeeded / (word.length + 1)));
  return repeated.slice(0, charsNeeded);
}

function makeChunk(text: string, overrides: Partial<ChunkOutput> = {}): ChunkOutput {
  return {
    chunkIndex: 0,
    sectionTitle: null,
    text,
    tokenCount: estimateTokens(text),
    ...overrides,
  };
}

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses CHARS_PER_TOKEN divisor', () => {
    const text = 'a'.repeat(35);
    expect(estimateTokens(text)).toBe(Math.ceil(35 / CHARS_PER_TOKEN));
  });

  it('rounds up (ceil)', () => {
    // 10 chars → ceil(10 / 2.5) = ceil(4) = 4
    expect(estimateTokens('a'.repeat(10))).toBe(4);
  });
});

// ─── Test 1: normal chunk stays unchanged ────────────────────────────────────

describe('enforceChunkSafety — normal chunk under limit', () => {
  it('passes through a safe chunk unchanged', () => {
    const text = makeText(MAX_CHUNK_TOKENS - 10);
    const input = [makeChunk(text)];

    const { safeChunks, splitCount, truncateCount } = enforceChunkSafety(input);

    expect(safeChunks).toHaveLength(1);
    expect(safeChunks[0].text).toBe(text);
    expect(splitCount).toBe(0);
    expect(truncateCount).toBe(0);
  });

  it('passes through multiple safe chunks', () => {
    const chunks = [
      makeChunk(makeText(100), { chunkIndex: 0 }),
      makeChunk(makeText(200), { chunkIndex: 1 }),
      makeChunk(makeText(300), { chunkIndex: 2 }),
    ];

    const { safeChunks, splitCount } = enforceChunkSafety(chunks);

    expect(safeChunks).toHaveLength(3);
    expect(splitCount).toBe(0);
  });
});

// ─── Test 2: slightly oversized chunk gets split ─────────────────────────────

describe('enforceChunkSafety — slightly oversized chunk', () => {
  it('splits a chunk just over EMBED_SAFE_MAX_TOKENS into pieces under the limit', () => {
    // Build a text with paragraphs, totalling ~7000 tokens
    const para = makeText(2000, 'paragraph') + '\n\n';
    const text = para.repeat(3).trim(); // ~6000 tokens via estimate

    // Force it over safe max by making it slightly larger
    const oversized = makeText(EMBED_SAFE_MAX_TOKENS + 100);

    const { safeChunks, splitCount } = enforceChunkSafety([makeChunk(oversized)]);

    expect(splitCount).toBeGreaterThan(0);
    for (const chunk of safeChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_SAFE_MAX_TOKENS);
    }
  });

  it('all output chunks satisfy the safe max after splitting', () => {
    const oversized = makeText(EMBED_SAFE_MAX_TOKENS + 500);
    const { safeChunks } = enforceChunkSafety([makeChunk(oversized)]);

    for (const chunk of safeChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_SAFE_MAX_TOKENS);
    }
  });
});

// ─── Test 3: very large document → all chunks safe ───────────────────────────

describe('enforceChunkSafety — very large document', () => {
  it('handles a document-sized chunk (30k tokens) and produces only safe chunks', () => {
    const huge = makeText(30_000);
    const { safeChunks } = enforceChunkSafety([makeChunk(huge)]);

    expect(safeChunks.length).toBeGreaterThan(1);
    for (const chunk of safeChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_SAFE_MAX_TOKENS);
    }
  });
});

// ─── Test 4: giant code block handled safely ─────────────────────────────────

describe('enforceChunkSafety — giant code block', () => {
  it('handles a giant code fence without exceeding hard max', () => {
    const code = '```python\n' + 'x = 1\n'.repeat(5000) + '```';
    const { safeChunks } = enforceChunkSafety([makeChunk(code)]);

    expect(safeChunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of safeChunks) {
      // Must never exceed hard max
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_HARD_MAX_TOKENS);
    }
  });
});

// ─── Test 5: large markdown table handled safely ──────────────────────────────

describe('enforceChunkSafety — large markdown table', () => {
  it('handles a large table without producing oversized chunks', () => {
    const header = '| Col A | Col B | Col C |\n|---|---|---|\n';
    const rows = '| data | data | data |\n'.repeat(2000);
    const table = header + rows;

    const { safeChunks } = enforceChunkSafety([makeChunk(table)]);

    expect(safeChunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of safeChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_HARD_MAX_TOKENS);
    }
  });
});

// ─── Test 6: pathological text triggers truncation fallback ──────────────────

describe('enforceChunkSafety — truncation fallback', () => {
  it('fires truncation for a single giant line with no split points', () => {
    // One massive line — no newlines, no sentence boundaries → hard truncate
    const gigantic = 'a'.repeat(Math.ceil(EMBED_SAFE_MAX_TOKENS * CHARS_PER_TOKEN) * 3);

    const { safeChunks, truncateCount } = enforceChunkSafety([makeChunk(gigantic)]);

    expect(truncateCount).toBeGreaterThan(0);
    for (const chunk of safeChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_SAFE_MAX_TOKENS);
    }
  });
});

// ─── Test 7: hard invariant — all emitted chunks <= EMBED_HARD_MAX_TOKENS ────

describe('enforceChunkSafety — hard invariant', () => {
  it('guarantees no emitted chunk exceeds EMBED_HARD_MAX_TOKENS for any input', () => {
    const inputs = [
      makeText(100),
      makeText(EMBED_SAFE_MAX_TOKENS + 1),
      makeText(20_000),
      'a'.repeat(Math.ceil(EMBED_HARD_MAX_TOKENS * CHARS_PER_TOKEN) * 2),
      '```\n' + 'code\n'.repeat(10_000) + '```',
    ].map((text) => makeChunk(text));

    const { safeChunks } = enforceChunkSafety(inputs);

    for (const chunk of safeChunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_HARD_MAX_TOKENS);
    }
  });
});

// ─── Test 8: splitCount is correct ──────────────────────────────────────────

describe('enforceChunkSafety — splitCount stat', () => {
  it('reports splitCount > 0 when at least one chunk required splitting', () => {
    const safe = makeChunk(makeText(100));
    const oversized = makeChunk(makeText(EMBED_SAFE_MAX_TOKENS + 200));

    const { splitCount } = enforceChunkSafety([safe, oversized]);

    expect(splitCount).toBeGreaterThan(0);
  });

  it('reports splitCount = 0 when all chunks are safe', () => {
    const chunks = [makeChunk(makeText(100)), makeChunk(makeText(200))];
    const { splitCount } = enforceChunkSafety(chunks);
    expect(splitCount).toBe(0);
  });
});

// ─── Test 9: truncateCount is correct ───────────────────────────────────────

describe('enforceChunkSafety — truncateCount stat', () => {
  it('reports truncateCount > 0 when hard truncation was needed', () => {
    // Solid wall of text — no newlines to split on
    const noSplits = 'x'.repeat(Math.ceil((EMBED_SAFE_MAX_TOKENS + 500) * CHARS_PER_TOKEN));
    const { truncateCount } = enforceChunkSafety([makeChunk(noSplits)]);
    expect(truncateCount).toBeGreaterThan(0);
  });

  it('reports truncateCount = 0 when splitting was sufficient', () => {
    // Text with paragraph breaks — splitting should be sufficient
    const splittable = (makeText(1500) + '\n\n').repeat(4).trim();
    const { truncateCount } = enforceChunkSafety([makeChunk(splittable)]);
    expect(truncateCount).toBe(0);
  });
});

// ─── chunkMarkdown integration ───────────────────────────────────────────────

describe('chunkMarkdown — integrated safety', () => {
  it('produces only safe chunks for a normal document', () => {
    const doc = `# Introduction\n\nThis is an intro paragraph.\n\n## Section One\n\nSome content here.\n\n## Section Two\n\nMore content here.\n`;
    const chunks = chunkMarkdown(doc);

    for (const chunk of chunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_SAFE_MAX_TOKENS);
    }
  });

  it('produces only safe chunks for a giant document', () => {
    // Build a doc with many large sections
    const sections = Array.from({ length: 10 }, (_, i) =>
      `# Section ${i + 1}\n\n${makeText(3000)}\n\n`,
    ).join('');

    const chunks = chunkMarkdown(sections);

    for (const chunk of chunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(EMBED_HARD_MAX_TOKENS);
    }
  });

  it('accumulates split/truncate counts via the stats ref', () => {
    const oversized = `# Big Section\n\n${'word '.repeat(10_000)}`;
    const stats = { splitCount: 0, truncateCount: 0 };
    chunkMarkdown(oversized, stats);

    // At least some action should have been recorded
    expect((stats.splitCount ?? 0) + (stats.truncateCount ?? 0)).toBeGreaterThan(0);
  });
});

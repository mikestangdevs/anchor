import type { ChunkOutput } from '@acr/types';

// ---------------------------------------------------------------------------
// Token limit constants — tune here, not scattered through the codebase
// ---------------------------------------------------------------------------

/** OpenAI absolute hard max. A chunk at or above this will be rejected. */
export const EMBED_HARD_MAX_TOKENS = 8192;

/** Safe operating ceiling with buffer. Chunks are guaranteed to stay under this. */
export const EMBED_SAFE_MAX_TOKENS = 6000;

/** Preferred target chunk size for normal content. Well below the safe ceiling. */
export const MAX_CHUNK_TOKENS = 512;

/** Minimum chunk size — smaller chunks get merged with the previous one. */
export const MIN_CHUNK_TOKENS = 50;

/**
 * Conservative chars-per-token estimate.
 *
 * English prose is ~4 chars/token. Dense code is ~2–2.5 (lots of short
 * tokens like parens, arrows, colons). Using 2.5 as a safe floor so we
 * never under-count tokens for code-heavy API reference pages.
 */
export const CHARS_PER_TOKEN = 2.5;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Estimate token count from text length.
 *
 * Uses CHARS_PER_TOKEN (3.5) — conservative enough that real token counts
 * should rarely exceed the estimate. This is intentionally pessimistic so
 * we err on the side of splitting rather than letting oversized chunks through.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Convert a safe token budget back to a maximum character count.
 */
function tokenBudgetToChars(tokenBudget: number): number {
  return Math.floor(tokenBudget * CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// Hard-cap safety enforcement
// ---------------------------------------------------------------------------

export interface ChunkSafetyResult {
  safeChunks: ChunkOutput[];
  /** Chunks that required splitting to get under the limit. */
  splitCount: number;
  /** Chunks that were hard-truncated as a final fallback. */
  truncateCount: number;
}

/**
 * Enforce the embedding token limit on a list of chunks.
 *
 * Every chunk emitted from this function is GUARANTEED to have
 * estimateTokens(text) <= EMBED_HARD_MAX_TOKENS.
 *
 * The invariant holds even if a chunk is a single unsplittable block —
 * the final stage hard-truncates by character budget.
 *
 * Stages for oversized chunks:
 *   1. Split by double-newline (paragraph blocks)
 *   2. Split by single newline (line-by-line)
 *   3. Hard truncation by character budget
 */
export function enforceChunkSafety(
  rawChunks: ChunkOutput[],
): ChunkSafetyResult {
  const safeChunks: ChunkOutput[] = [];
  let runningIndex = 0;
  let splitCount = 0;
  let truncateCount = 0;

  for (const chunk of rawChunks) {
    if (estimateTokens(chunk.text) <= EMBED_SAFE_MAX_TOKENS) {
      // Already safe — keep as-is (update index for continuity)
      safeChunks.push({ ...chunk, chunkIndex: runningIndex++ });
      continue;
    }

    // Oversized: enter multi-stage splitting
    splitCount++;
    const { pieces, hardTruncated } = splitToSafeSize(chunk.text);
    if (hardTruncated) truncateCount++;

    for (const text of pieces) {
      safeChunks.push({
        chunkIndex: runningIndex++,
        sectionTitle: chunk.sectionTitle,
        text,
        tokenCount: estimateTokens(text),
      });
    }
  }

  return { safeChunks, splitCount, truncateCount };
}

/**
 * Split a single text into pieces that each satisfy EMBED_SAFE_MAX_TOKENS.
 *
 * Returns the pieces and whether hard truncation was needed.
 */
function splitToSafeSize(text: string): { pieces: string[]; hardTruncated: boolean } {
  // Stage 1: split by paragraph (double newline)
  const byParagraph = splitByDelimiter(text, /\n\n+/);
  if (allSafe(byParagraph)) {
    return { pieces: byParagraph, hardTruncated: false };
  }

  // Stage 2: split any remaining oversized paragraphs by single newline
  const byLine: string[] = [];
  for (const piece of byParagraph) {
    if (estimateTokens(piece) <= EMBED_SAFE_MAX_TOKENS) {
      byLine.push(piece);
    } else {
      byLine.push(...splitByDelimiter(piece, /\n/));
    }
  }

  if (allSafe(byLine)) {
    return { pieces: byLine, hardTruncated: false };
  }

  // Stage 3: hard truncate any piece still over the limit
  const hardTruncPieces = byLine.flatMap((piece) => {
    if (estimateTokens(piece) <= EMBED_SAFE_MAX_TOKENS) return [piece];
    return hardTruncateToPieces(piece, EMBED_SAFE_MAX_TOKENS);
  });

  return { pieces: hardTruncPieces, hardTruncated: true };
}

/**
 * Split text by a delimiter, accumulating into chunks that fit EMBED_SAFE_MAX_TOKENS.
 */
function splitByDelimiter(text: string, delimiter: RegExp): string[] {
  const parts = text.split(delimiter).filter((p) => p.trim());
  const results: string[] = [];
  let current = '';

  for (const part of parts) {
    const candidate = current ? current + '\n\n' + part : part;
    if (estimateTokens(candidate) <= EMBED_SAFE_MAX_TOKENS) {
      current = candidate;
    } else {
      if (current) results.push(current.trim());
      // If a single part is itself too big, push it anyway — outer logic handles it
      current = part;
    }
  }

  if (current) results.push(current.trim());
  return results;
}

/**
 * Hard-truncate a piece that is too large to split sensibly.
 * Splits into EMBED_SAFE_MAX_TOKENS-sized character windows.
 */
function hardTruncateToPieces(text: string, maxTokens: number): string[] {
  const maxChars = tokenBudgetToChars(maxTokens);
  const pieces: string[] = [];

  for (let i = 0; i < text.length; i += maxChars) {
    pieces.push(text.slice(i, i + maxChars).trimEnd());
  }

  return pieces.filter((p) => p.trim());
}

function allSafe(pieces: string[]): boolean {
  return pieces.every((p) => estimateTokens(p) <= EMBED_SAFE_MAX_TOKENS);
}

// ---------------------------------------------------------------------------
// Main chunking entry point
// ---------------------------------------------------------------------------

/**
 * Split markdown into heading-aware chunks.
 *
 * Strategy:
 * 1. Split on h1–h3 headings to create section boundaries
 * 2. If a section exceeds MAX_CHUNK_TOKENS, split further by paragraphs
 * 3. If a paragraph still exceeds, split by sentences
 * 4. Each chunk retains its section title for context
 * 5. Final pass: enforceChunkSafety() guarantees no chunk exceeds EMBED_HARD_MAX_TOKENS
 *
 * Returns safeChunks and split/truncation stats via the optional stats ref.
 */
export function chunkMarkdown(
  markdown: string,
  stats?: { splitCount?: number; truncateCount?: number },
): ChunkOutput[] {
  const sections = splitByHeadings(markdown);
  const rawChunks: ChunkOutput[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionChunks = splitSectionIntoChunks(section.title, section.content);

    for (const text of sectionChunks) {
      const tokenCount = estimateTokens(text);
      if (tokenCount < MIN_CHUNK_TOKENS && rawChunks.length > 0) {
        // Merge tiny chunks with the previous chunk
        const prev = rawChunks[rawChunks.length - 1];
        prev.text += '\n\n' + text;
        prev.tokenCount = estimateTokens(prev.text);
        continue;
      }

      rawChunks.push({
        chunkIndex,
        sectionTitle: section.title,
        text,
        tokenCount,
      });
      chunkIndex++;
    }
  }

  // Final safety pass — guarantee hard max invariant
  const { safeChunks, splitCount, truncateCount } = enforceChunkSafety(rawChunks);

  if (stats) {
    stats.splitCount = (stats.splitCount ?? 0) + splitCount;
    stats.truncateCount = (stats.truncateCount ?? 0) + truncateCount;
  }

  return safeChunks;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Section {
  title: string | null;
  content: string;
}

/**
 * Split markdown by h1–h3 headings.
 */
function splitByHeadings(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  let currentTitle: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        });
      }
      currentTitle = headingMatch[2].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Don't forget the last section
  if (currentLines.length > 0) {
    sections.push({
      title: currentTitle,
      content: currentLines.join('\n').trim(),
    });
  }

  return sections;
}

/**
 * Split a section's content into sub-chunks respecting MAX_CHUNK_TOKENS.
 *
 * Note: this is the "preferred size" split. Final hard-cap enforcement
 * happens in enforceChunkSafety() after all sections are processed.
 */
function splitSectionIntoChunks(title: string | null, content: string): string[] {
  if (estimateTokens(content) <= MAX_CHUNK_TOKENS) {
    return [content];
  }

  // Split by paragraphs (double newline)
  const paragraphs = content.split(/\n\n+/);
  const results: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const combined = current ? current + '\n\n' + para : para;

    if (estimateTokens(combined) <= MAX_CHUNK_TOKENS) {
      current = combined;
    } else {
      if (current) results.push(current);

      // If single paragraph is too large, split by sentences
      if (estimateTokens(para) > MAX_CHUNK_TOKENS) {
        results.push(...splitBySentences(para));
        current = '';
      } else {
        current = para;
      }
    }
  }

  if (current) results.push(current);
  return results;
}

/**
 * Split by sentences — used when paragraphs are too large.
 *
 * Note: if a single "sentence" (e.g., a code fence) is enormous,
 * it will still be emitted here and caught by enforceChunkSafety() later.
 */
function splitBySentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) ?? [text];
  const results: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const combined = current + sentence;
    if (estimateTokens(combined) <= MAX_CHUNK_TOKENS) {
      current = combined;
    } else {
      if (current) results.push(current.trim());
      current = sentence;
    }
  }

  if (current) results.push(current.trim());
  return results;
}

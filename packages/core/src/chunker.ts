import type { ChunkOutput } from '@acr/types';

const MAX_CHUNK_TOKENS = 512;
const MIN_CHUNK_TOKENS = 50;

/**
 * Estimate token count from text.
 * Rough heuristic: ~4 chars per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split markdown into heading-aware chunks.
 *
 * Strategy:
 * 1. Split on h1–h3 headings to create section boundaries
 * 2. If a section exceeds MAX_CHUNK_TOKENS, split further by paragraphs
 * 3. If a paragraph still exceeds, split by sentences
 * 4. Each chunk retains its section title for context
 */
export function chunkMarkdown(markdown: string): ChunkOutput[] {
  const sections = splitByHeadings(markdown);
  const chunks: ChunkOutput[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionChunks = splitSectionIntoChunks(section.title, section.content);

    for (const text of sectionChunks) {
      const tokenCount = estimateTokens(text);
      if (tokenCount < MIN_CHUNK_TOKENS && chunks.length > 0) {
        // Merge tiny chunks with the previous chunk
        const prev = chunks[chunks.length - 1];
        prev.text += '\n\n' + text;
        prev.tokenCount = estimateTokens(prev.text);
        continue;
      }

      chunks.push({
        chunkIndex,
        sectionTitle: section.title,
        text,
        tokenCount,
      });
      chunkIndex++;
    }
  }

  return chunks;
}

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
 * Split a section's content into sub-chunks respecting token limits.
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
 * Last-resort splitting by sentences when paragraphs are too large.
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

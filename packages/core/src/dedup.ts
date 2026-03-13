import { createHash } from 'crypto';

/**
 * Generate a SHA-256 version hash from cleaned markdown content.
 * Used to detect content changes across syncs — skip re-processing if hash matches.
 */
export function computeVersionHash(cleanedMarkdown: string): string {
  // Normalize whitespace before hashing for stability
  const normalized = cleanedMarkdown
    .replace(/\s+/g, ' ')
    .trim();

  return createHash('sha256')
    .update(normalized, 'utf-8')
    .digest('hex');
}

/**
 * Check if a document has changed based on version hash comparison.
 */
export function hasContentChanged(existingHash: string, newHash: string): boolean {
  return existingHash !== newHash;
}

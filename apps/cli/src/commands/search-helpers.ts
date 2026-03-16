/**
 * Display constants for `acr search` output.
 * Change here to tune globally.
 */

/** Maximum characters shown in the inline snippet preview. */
export const SNIPPET_MAX_CHARS = 800;

/** Minimum final score to show a result. Below this → "no confident results". */
export const DISPLAY_SCORE_FLOOR = 0.35;

/**
 * Clean markdown artifacts from chunk text for readable CLI display.
 * Display-only transform — does not affect stored data or MCP output.
 */
export function cleanSnippet(text: string): string {
  let cleaned = text;

  // Remove markdown images: ![alt](url)
  cleaned = cleaned.replace(/!\[.*?\]\(.*?\)/g, '');

  // Convert markdown links [text](url) → text
  cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove raw URLs on their own line
  cleaned = cleaned.replace(/^\s*https?:\/\/\S+\s*$/gm, '');

  // Collapse 3+ newlines into 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Truncate a snippet to maxChars without cutting words or code lines.
 *
 * Tries to find a natural break (newline >> space) near the limit.
 * Falls back to a hard cut if no good break point exists.
 */
export function truncateSnippet(text: string, maxChars: number = SNIPPET_MAX_CHARS): string {
  if (text.length <= maxChars) return text;

  // Try to cut at a newline within the trailing 15% of the window
  const windowStart = Math.floor(maxChars * 0.85);
  const newlineIdx = text.lastIndexOf('\n', maxChars);
  if (newlineIdx > windowStart) {
    return text.slice(0, newlineIdx) + '\n  ...';
  }

  // Fall back to last space within the window
  const spaceIdx = text.lastIndexOf(' ', maxChars);
  if (spaceIdx > windowStart) {
    return text.slice(0, spaceIdx) + ' ...';
  }

  // Hard cut
  return text.slice(0, maxChars) + '...';
}

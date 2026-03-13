/**
 * Markdown parsing and cleanup utilities.
 */

/**
 * Extract the title from markdown content.
 * Uses the first heading found, or the filename as fallback.
 */
export function extractTitle(markdown: string, fallbackFilename?: string): string {
  // Match first heading (any level)
  const headingMatch = markdown.match(/^#{1,6}\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  // Fallback to filename without extension
  if (fallbackFilename) {
    return fallbackFilename
      .replace(/\.(md|mdx)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return 'Untitled';
}

/**
 * Clean and normalize markdown content.
 */
export function cleanMarkdown(markdown: string): string {
  let cleaned = markdown;

  // Remove HTML comments
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

  // Remove frontmatter (YAML between ---)
  cleaned = cleaned.replace(/^---\n[\s\S]*?\n---\n?/, '');

  // Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, '\n');

  // Remove excessive blank lines (max 2 consecutive)
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

  // Remove trailing whitespace on lines
  cleaned = cleaned.replace(/[ \t]+$/gm, '');

  // Normalize unicode quotes to ASCII
  cleaned = cleaned
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');

  return cleaned.trim();
}

/**
 * Build a canonical URL for a GitHub markdown file.
 */
export function buildGithubUrl(
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
): string {
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `https://github.com/${owner}/${repo}/blob/${branch}/${cleanPath}`;
}

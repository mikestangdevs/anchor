import { cleanMarkdown } from '@acr/parser';

/**
 * Normalize raw content into clean markdown.
 * Applies cleaning, whitespace normalization, and boilerplate stripping.
 */
export function normalize(rawContent: string): string {
  let content = cleanMarkdown(rawContent);

  // Remove common boilerplate patterns
  content = removeBoilerplate(content);

  // Collapse multiple consecutive headings-only sections (empty sections)
  content = content.replace(/(^#{1,6}\s+.+\n)\n(?=#{1,6}\s)/gm, '$1');

  return content.trim();
}

/**
 * Remove common documentation boilerplate.
 */
function removeBoilerplate(markdown: string): string {
  const lines = markdown.split('\n');
  const filtered: string[] = [];

  for (const line of lines) {
    // Skip common footer/navigation patterns
    if (/^(Previous|Next|Edit this page|Was this helpful|Last updated|Copyright)/i.test(line.trim())) {
      continue;
    }
    // Skip breadcrumb-like lines
    if (/^(Home\s*[>\/]|Docs\s*[>\/])/i.test(line.trim())) {
      continue;
    }
    filtered.push(line);
  }

  return filtered.join('\n');
}

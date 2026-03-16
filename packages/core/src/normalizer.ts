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
    const trimmed = line.trim();

    // Skip common footer/navigation patterns
    if (/^(Previous|Next|Edit this page|Was this helpful|Last updated|Copyright)/i.test(trimmed)) {
      continue;
    }
    // Skip breadcrumb-like lines
    if (/^(Home\s*[>\/]|Docs\s*[>\/])/i.test(trimmed)) {
      continue;
    }
    // Skip "skip to content" links: [Skip to main content](#...) or similar
    if (/^\[skip\s+to\s/i.test(trimmed)) {
      continue;
    }
    // Skip lines that are ONLY a markdown image (logos, icons, badges used as nav)
    if (/^!\[.*?\]\(.*?\)$/.test(trimmed) && trimmed.length > 0) {
      continue;
    }
    // Skip empty heading anchor links: [](#anchor-id) or [ ](#anchor-id)
    if (/^\[\s*\]\(#[^)]*\)$/.test(trimmed)) {
      continue;
    }
    // Skip lines of heading + empty anchor: ## [](#anchor) or ## [\n](#id)
    if (/^#{1,6}\s+\[\s*\]\(#[^)]*\)\s*$/.test(trimmed)) {
      continue;
    }
    // Skip nav-like link clusters: 3+ consecutive bare links with no prose
    if (/^(\[.+?\]\(.+?\)\s*){3,}$/.test(trimmed) && !/[.!?,;:]/.test(trimmed.replace(/\[.*?\]\(.*?\)/g, ''))) {
      continue;
    }
    filtered.push(line);
  }

  return filtered.join('\n');
}

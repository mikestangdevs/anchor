import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Remove script, style, nav, footer, header elements
turndown.remove(['script', 'style', 'nav', 'footer', 'iframe', 'noscript']);

/**
 * Parse HTML and extract the main body content as clean markdown.
 * Uses heuristics to find the primary content area.
 */
export function parseHtml(html: string, url?: string): { title: string; markdown: string } {
  const $ = cheerio.load(html);

  // Extract title
  const title =
    $('meta[property="og:title"]').attr('content') ??
    $('title').first().text().trim() ??
    $('h1').first().text().trim() ??
    'Untitled';

  // Remove elements that are typically non-content
  $('script, style, nav, footer, header, aside, .sidebar, .nav, .menu, .breadcrumb, .toc, .table-of-contents').remove();
  $('[role="navigation"], [role="banner"], [role="complementary"]').remove();

  // Find main content area using heuristics
  let contentEl =
    $('main').first() ||
    $('article').first() ||
    $('[role="main"]').first() ||
    $('.content, .docs-content, .markdown-body, .main-content, #content, #main').first();

  // Fallback to body if no main content area found
  if (!contentEl || contentEl.length === 0) {
    contentEl = $('body');
  }

  const contentHtml = contentEl.html() ?? '';
  const markdown = turndown.turndown(contentHtml);

  return {
    title: cleanTitle(title),
    markdown: markdown.trim(),
  };
}

/**
 * Extract canonical URL from an HTML page.
 */
export function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const $ = cheerio.load(html);
  const canonical =
    $('link[rel="canonical"]').attr('href') ??
    $('meta[property="og:url"]').attr('content');
  return canonical ?? fallbackUrl;
}

/**
 * Extract all same-domain links from an HTML page.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const links: Set<string> = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const resolved = new URL(href, baseUrl);
      // Same domain only
      if (resolved.hostname === base.hostname) {
        // Strip hash and trailing slash
        resolved.hash = '';
        const cleaned = resolved.toString().replace(/\/$/, '');
        links.add(cleaned);
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(links);
}

function cleanTitle(title: string): string {
  // Remove common suffixes like " | Site Name" or " - Docs"
  return title
    .replace(/\s*[|–—-]\s*[^|–—-]*$/, '')
    .trim() || 'Untitled';
}

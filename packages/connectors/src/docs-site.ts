import type { RawPage, ConnectorResult, SourceType } from '@acr/types';
import { parseHtml, extractCanonicalUrl, extractLinks } from '@acr/parser';
import { BaseConnector, type ConnectorConfig } from './base.js';

const DEFAULT_MAX_PAGES = 500;
const DEFAULT_MAX_DEPTH = 3;
const CRAWL_DELAY_MS = 500;

/**
 * Connector for public documentation websites.
 * Crawls same-domain pages starting from a base URL.
 */
export class DocsSiteConnector extends BaseConnector {
  sourceType: SourceType = 'docs_site';

  async fetch(config: ConnectorConfig): Promise<ConnectorResult> {
    const baseUrl = config.baseUrl;
    if (!baseUrl) {
      throw new Error('DocsSiteConnector requires a baseUrl');
    }

    const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
    const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;

    const visited = new Set<string>();
    const pages: RawPage[] = [];
    const queue: Array<{ url: string; depth: number }> = [{ url: baseUrl, depth: 0 }];
    let errors = 0;
    let skipped = 0;

    // Try to find sitemap first
    const sitemapUrls = await this.fetchSitemap(baseUrl);
    if (sitemapUrls.length > 0) {
      for (const url of sitemapUrls.slice(0, maxPages)) {
        if (!visited.has(url)) {
          queue.push({ url, depth: 1 });
        }
      }
    }

    while (queue.length > 0 && pages.length < maxPages) {
      const item = queue.shift()!;
      const normalizedUrl = item.url.replace(/\/$/, '');

      if (visited.has(normalizedUrl) || item.depth > maxDepth) {
        skipped++;
        continue;
      }
      visited.add(normalizedUrl);

      try {
        const response = await fetch(item.url, {
          headers: { 'User-Agent': 'AgentContextRepo/1.0' },
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          errors++;
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html')) {
          skipped++;
          continue;
        }

        const html = await response.text();
        const { title, markdown } = parseHtml(html, item.url);
        const canonicalUrl = extractCanonicalUrl(html, item.url);

        if (markdown.length < 100) {
          skipped++;
          continue;
        }

        pages.push({
          url: canonicalUrl,
          title,
          rawHtml: html,
          rawMarkdown: markdown,
          contentType: 'html',
          fetchedAt: new Date(),
        });

        // Extract and queue links for crawling
        if (item.depth < maxDepth) {
          const links = extractLinks(html, item.url);
          for (const link of links) {
            const normalized = link.replace(/\/$/, '');
            if (!visited.has(normalized)) {
              queue.push({ url: link, depth: item.depth + 1 });
            }
          }
        }

        // Report progress
        config.onProgress?.(pages.length, queue.length);

        // Be polite
        await sleep(CRAWL_DELAY_MS);
      } catch (err) {
        errors++;
      }
    }

    return {
      pages,
      stats: {
        fetched: pages.length,
        skipped,
        errors,
      },
    };
  }

  /**
   * Attempt to fetch and parse a sitemap.xml for the domain.
   */
  private async fetchSitemap(baseUrl: string): Promise<string[]> {
    try {
      const sitemapUrl = new URL('/sitemap.xml', baseUrl).toString();
      const response = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'AgentContextRepo/1.0' },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) return [];

      const xml = await response.text();
      // Simple regex extraction of URLs from sitemap
      const urls: string[] = [];
      const matches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
      for (const match of matches) {
        urls.push(match[1]);
      }
      return urls;
    } catch {
      return [];
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

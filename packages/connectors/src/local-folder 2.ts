import { readFileSync, statSync, readdirSync } from 'fs';
import { resolve, relative, extname, basename, join } from 'path';
import type { RawPage, ConnectorResult, SourceType } from '@acr/types';
import { BaseConnector, type ConnectorConfig } from './base.js';

/** Supported file extensions for local_folder connector */
const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json']);

/**
 * Connector for local filesystem folders containing markdown, text, or JSON files.
 * Walks a directory tree and creates one document per file.
 */
export class LocalFolderConnector extends BaseConnector {
  sourceType: SourceType = 'local_folder';

  async fetch(config: ConnectorConfig): Promise<ConnectorResult> {
    const { folderPath, folderRecursive = true, includePatterns, excludePatterns } = config;

    if (!folderPath) {
      throw new Error('LocalFolderConnector requires folderPath');
    }

    // Resolve to absolute path
    const rootPath = resolve(folderPath);

    // Safety checks
    try {
      const stat = statSync(rootPath);
      if (!stat.isDirectory()) {
        throw new Error(`"${rootPath}" is not a directory`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Directory not found: ${rootPath}`);
      }
      throw err;
    }

    const pages: RawPage[] = [];
    let errors = 0;
    let skipped = 0;

    const files = this.walkDirectory(rootPath, rootPath, folderRecursive, includePatterns, excludePatterns);

    for (const file of files) {
      try {
        const page = this.readFile(rootPath, file);
        if (page) {
          pages.push(page);
        } else {
          skipped++;
        }
      } catch {
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
   * Walk a directory tree and return all supported files as relative paths.
   */
  private walkDirectory(
    rootPath: string,
    currentPath: string,
    recursive: boolean,
    includePatterns?: string[],
    excludePatterns?: string[],
  ): string[] {
    const files: string[] = [];

    let entries: string[];
    try {
      entries = readdirSync(currentPath);
    } catch {
      return files;
    }

    for (const name of entries) {
      const fullPath = join(currentPath, name);
      const relativePath = relative(rootPath, fullPath);

      // Skip hidden files/dirs
      if (name.startsWith('.')) continue;
      // Skip node_modules, dist, etc.
      if (['node_modules', 'dist', 'build', '.git', '__pycache__'].includes(name)) continue;

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (recursive) {
          files.push(...this.walkDirectory(rootPath, fullPath, recursive, includePatterns, excludePatterns));
        }
        continue;
      }

      if (!stat.isFile()) continue;

      const ext = extname(name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      // Check include patterns (glob-like matching)
      if (includePatterns && includePatterns.length > 0) {
        const matches = includePatterns.some((pattern) => this.matchPattern(relativePath, pattern));
        if (!matches) continue;
      }

      // Check exclude patterns
      if (excludePatterns && excludePatterns.length > 0) {
        const excluded = excludePatterns.some((pattern) => this.matchPattern(relativePath, pattern));
        if (excluded) continue;
      }

      files.push(relativePath);
    }

    return files;
  }

  /**
   * Simple glob-like pattern matching.
   * Supports * (any chars in a segment) and ** (any path).
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Exact match
    if (filePath === pattern) return true;
    // Extension match: *.md
    if (pattern.startsWith('*.')) {
      return filePath.endsWith(pattern.slice(1));
    }
    // Directory prefix: docs/*
    if (pattern.endsWith('/*')) {
      return filePath.startsWith(pattern.slice(0, -2));
    }
    // Contains match
    if (pattern.startsWith('*') && pattern.endsWith('*')) {
      return filePath.includes(pattern.slice(1, -1));
    }
    return false;
  }

  /**
   * Read a file and return a RawPage, or null if content is too short.
   */
  private readFile(rootPath: string, relativePath: string): RawPage | null {
    const fullPath = join(rootPath, relativePath);
    const stat = statSync(fullPath);
    const ext = extname(relativePath).toLowerCase();

    let content: string;
    let contentType: 'markdown' | 'plain_text' = 'markdown';

    if (ext === '.json') {
      // JSON: pretty-print for readability
      const raw = readFileSync(fullPath, 'utf-8');
      try {
        const parsed = JSON.parse(raw);
        content = '```json\n' + JSON.stringify(parsed, null, 2) + '\n```';
      } catch {
        content = '```\n' + raw + '\n```';
      }
      contentType = 'plain_text';
    } else if (ext === '.txt') {
      content = readFileSync(fullPath, 'utf-8');
      contentType = 'plain_text';
    } else {
      // .md, .mdx
      content = readFileSync(fullPath, 'utf-8');
      contentType = 'markdown';
    }

    // Skip very short files
    if (content.length < 50) {
      return null;
    }

    // Extract title: first H1 if present, else filename without extension
    const h1Match = content.match(/^#\s+(.+)$/m);
    const title = h1Match
      ? h1Match[1].trim()
      : basename(relativePath, extname(relativePath));

    // Use file:// + relative path as canonical URL for citation
    const canonicalUrl = `file://./${relativePath}`;

    return {
      url: canonicalUrl,
      title,
      rawMarkdown: content,
      contentType,
      fetchedAt: stat.mtime,
    };
  }
}

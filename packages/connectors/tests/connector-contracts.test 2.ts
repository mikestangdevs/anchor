import { describe, it, expect } from 'vitest';
import { getConnector } from '../src/index.js';
import type { ConnectorConfig } from '../src/base.js';
import type { SourceType, RawPage, ConnectorResult } from '@acr/types';

/**
 * Connector contract tests.
 *
 * These tests verify that every registered connector:
 * 1. Can be instantiated from the registry
 * 2. Reports the correct sourceType
 * 3. Returns a ConnectorResult with the correct shape
 * 4. Rejects with a clear error on invalid config
 *
 * For connectors that require network (github_repo, supabase_view, docs_site),
 * we only test error handling — not live fetches.
 * For local_folder, we can test with real (temp) filesystem data.
 */

// All registered source types
const ALL_SOURCE_TYPES: SourceType[] = ['docs_site', 'github_repo', 'supabase_view', 'local_folder'];

describe('Connector Registry', () => {
  it.each(ALL_SOURCE_TYPES)('getConnector(%s) returns a connector instance', (type) => {
    const connector = getConnector(type);
    expect(connector).toBeDefined();
    expect(connector.sourceType).toBe(type);
    expect(typeof connector.fetch).toBe('function');
  });

  it('throws for unknown source type', () => {
    expect(() => getConnector('nonexistent' as SourceType)).toThrow('No connector registered');
  });
});

describe('Connector Contract: ConnectorResult shape', () => {
  function assertValidResult(result: ConnectorResult) {
    expect(result).toHaveProperty('pages');
    expect(result).toHaveProperty('stats');
    expect(Array.isArray(result.pages)).toBe(true);
    expect(typeof result.stats.fetched).toBe('number');
    expect(typeof result.stats.skipped).toBe('number');
    expect(typeof result.stats.errors).toBe('number');
  }

  function assertValidPage(page: RawPage) {
    expect(typeof page.url).toBe('string');
    expect(page.url.length).toBeGreaterThan(0);
    expect(typeof page.title).toBe('string');
    expect(page.title.length).toBeGreaterThan(0);
    expect(['markdown', 'html', 'plain_text']).toContain(page.contentType);
    expect(page.fetchedAt).toBeInstanceOf(Date);
    // At least one content field must be present
    const hasContent = page.rawMarkdown || page.rawHtml;
    expect(hasContent).toBeTruthy();
  }

  describe('github_repo', () => {
    it('rejects with clear error when githubOwner/Repo missing', async () => {
      const connector = getConnector('github_repo');
      const config: ConnectorConfig = { sourceId: 'test', name: 'test' };
      await expect(connector.fetch(config)).rejects.toThrow('githubOwner');
    });
  });

  describe('supabase_view', () => {
    it('rejects with clear error when supabaseUrl missing', async () => {
      const connector = getConnector('supabase_view');
      const config: ConnectorConfig = { sourceId: 'test', name: 'test' };
      await expect(connector.fetch(config)).rejects.toThrow();
    });
  });

  describe('docs_site', () => {
    it('rejects with clear error when baseUrl missing', async () => {
      const connector = getConnector('docs_site');
      const config: ConnectorConfig = { sourceId: 'test', name: 'test' };
      await expect(connector.fetch(config)).rejects.toThrow('baseUrl');
    });
  });

  describe('local_folder', () => {
    it('rejects when folderPath missing', async () => {
      const connector = getConnector('local_folder');
      const config: ConnectorConfig = { sourceId: 'test', name: 'test' };
      await expect(connector.fetch(config)).rejects.toThrow('folderPath');
    });

    it('rejects when directory does not exist', async () => {
      const connector = getConnector('local_folder');
      const config: ConnectorConfig = {
        sourceId: 'test',
        name: 'test',
        folderPath: '/tmp/acr-nonexistent-' + Date.now(),
      };
      await expect(connector.fetch(config)).rejects.toThrow('not found');
    });

    it('fetches files from a real directory and returns valid shape', async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import('fs');
      const { join } = await import('path');

      const testDir = `/tmp/acr-contract-test-${Date.now()}`;
      mkdirSync(join(testDir, 'sub'), { recursive: true });

      writeFileSync(join(testDir, 'readme.md'), '# Hello World\n\nThis is a test document for contract validation.\n');
      writeFileSync(join(testDir, 'data.json'), JSON.stringify({ key: 'value', description: 'A test JSON file for contract validation purposes' }, null, 2));
      writeFileSync(join(testDir, 'notes.txt'), 'These are plain text notes for testing the local folder connector contract.\n');
      writeFileSync(join(testDir, 'sub', 'nested.md'), '# Nested Doc\n\nThis file lives in a subdirectory and tests recursive walking.\n');
      writeFileSync(join(testDir, 'ignored.py'), 'print("should be skipped")\n');
      writeFileSync(join(testDir, '.hidden.md'), '# Hidden\n\nShould be ignored because starts with dot.\n');

      try {
        const connector = getConnector('local_folder');
        const config: ConnectorConfig = {
          sourceId: 'test-local',
          name: 'Test Local',
          folderPath: testDir,
          folderRecursive: true,
        };

        const result = await connector.fetch(config);

        // Shape contract
        assertValidResult(result);

        // Should find exactly 4 files: readme.md, data.json, notes.txt, sub/nested.md
        // Should skip: ignored.py (wrong ext), .hidden.md (dot prefix)
        expect(result.stats.fetched).toBe(4);
        expect(result.pages).toHaveLength(4);

        // Every page must satisfy the RawPage contract
        for (const page of result.pages) {
          assertValidPage(page);
        }

        // Check specific files
        const readmePage = result.pages.find(p => p.url.includes('readme.md'));
        expect(readmePage).toBeDefined();
        expect(readmePage!.title).toBe('Hello World');
        expect(readmePage!.contentType).toBe('markdown');
        expect(readmePage!.url).toBe('file://./readme.md');

        const jsonPage = result.pages.find(p => p.url.includes('data.json'));
        expect(jsonPage).toBeDefined();
        expect(jsonPage!.contentType).toBe('plain_text');

        const txtPage = result.pages.find(p => p.url.includes('notes.txt'));
        expect(txtPage).toBeDefined();
        expect(txtPage!.contentType).toBe('plain_text');

        const nestedPage = result.pages.find(p => p.url.includes('nested.md'));
        expect(nestedPage).toBeDefined();
        expect(nestedPage!.url).toBe('file://./sub/nested.md');
        expect(nestedPage!.title).toBe('Nested Doc');

        // .py and .hidden should not appear
        const pyPage = result.pages.find(p => p.url.includes('.py'));
        expect(pyPage).toBeUndefined();
        const hiddenPage = result.pages.find(p => p.url.includes('.hidden'));
        expect(hiddenPage).toBeUndefined();
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('respects folderRecursive = false', async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import('fs');
      const { join } = await import('path');

      const testDir = `/tmp/acr-flat-test-${Date.now()}`;
      mkdirSync(join(testDir, 'sub'), { recursive: true });
      writeFileSync(join(testDir, 'top.md'), '# Top Level\n\nThis file is at the root level of the test directory.\n');
      writeFileSync(join(testDir, 'sub', 'deep.md'), '# Deep\n\nThis file should be excluded when recursive is false.\n');

      try {
        const connector = getConnector('local_folder');
        const result = await connector.fetch({
          sourceId: 'test', name: 'test',
          folderPath: testDir,
          folderRecursive: false,
        });

        expect(result.stats.fetched).toBe(1);
        expect(result.pages[0].url).toBe('file://./top.md');
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('respects include patterns', async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import('fs');
      const { join } = await import('path');

      const testDir = `/tmp/acr-include-test-${Date.now()}`;
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'yes.md'), '# Included\n\nThis file should be included by the pattern filter.\n');
      writeFileSync(join(testDir, 'no.txt'), 'This file should be excluded by the include pattern filter.\n');

      try {
        const connector = getConnector('local_folder');
        const result = await connector.fetch({
          sourceId: 'test', name: 'test',
          folderPath: testDir,
          includePatterns: ['*.md'],
        });

        expect(result.stats.fetched).toBe(1);
        expect(result.pages[0].url).toContain('yes.md');
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('respects exclude patterns', async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import('fs');
      const { join } = await import('path');

      const testDir = `/tmp/acr-exclude-test-${Date.now()}`;
      mkdirSync(join(testDir, 'drafts'), { recursive: true });
      writeFileSync(join(testDir, 'ok.md'), '# Kept\n\nThis file should not be excluded by the pattern filter.\n');
      writeFileSync(join(testDir, 'drafts', 'wip.md'), '# Excluded\n\nThis file should be excluded by the drafts exclude pattern.\n');

      try {
        const connector = getConnector('local_folder');
        const result = await connector.fetch({
          sourceId: 'test', name: 'test',
          folderPath: testDir,
          excludePatterns: ['drafts/*'],
        });

        expect(result.stats.fetched).toBe(1);
        expect(result.pages[0].url).toContain('ok.md');
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});

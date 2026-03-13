import { Octokit } from '@octokit/rest';
import type { RawPage, ConnectorResult, SourceType } from '@acr/types';
import { buildGithubUrl } from '@acr/parser';
import { BaseConnector, type ConnectorConfig } from './base.js';

/**
 * Connector for GitHub repositories containing markdown documentation.
 * Fetches .md and .mdx files from a configured path.
 */
export class GitHubRepoConnector extends BaseConnector {
  sourceType: SourceType = 'github_repo';

  async fetch(config: ConnectorConfig): Promise<ConnectorResult> {
    const { githubOwner, githubRepo, githubBranch, githubDocsPath, githubToken } = config;

    if (!githubOwner || !githubRepo) {
      throw new Error('GitHubRepoConnector requires githubOwner and githubRepo');
    }

    const octokit = new Octokit({ auth: githubToken });
    const branch = githubBranch ?? 'main';
    const docsPath = githubDocsPath ?? '/';
    const cleanPath = docsPath.startsWith('/') ? docsPath.slice(1) : docsPath;

    const pages: RawPage[] = [];
    let errors = 0;
    let skipped = 0;

    try {
      const files = await this.listMarkdownFiles(
        octokit,
        githubOwner,
        githubRepo,
        branch,
        cleanPath,
      );

      for (const file of files) {
        try {
          const response = await octokit.repos.getContent({
            owner: githubOwner,
            repo: githubRepo,
            path: file.path,
            ref: branch,
          });

          const data = response.data;
          if ('content' in data && data.type === 'file') {
            const rawMarkdown = Buffer.from(data.content, 'base64').toString('utf-8');

            if (rawMarkdown.length < 50) {
              skipped++;
              continue;
            }

            const url = buildGithubUrl(githubOwner, githubRepo, branch, file.path);

            pages.push({
              url,
              title: file.name,
              rawMarkdown,
              contentType: 'markdown',
              fetchedAt: new Date(),
            });
          }
        } catch {
          errors++;
        }
      }
    } catch (err) {
      throw new Error(
        `Failed to list files from ${githubOwner}/${githubRepo}: ${err instanceof Error ? err.message : String(err)}`
      );
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
   * Recursively list all markdown files under a path.
   */
  private async listMarkdownFiles(
    octokit: Octokit,
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<Array<{ path: string; name: string }>> {
    const files: Array<{ path: string; name: string }> = [];

    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path: path || '.',
        ref,
      });

      const data = response.data;
      if (!Array.isArray(data)) return files;

      for (const item of data) {
        if (item.type === 'dir') {
          const subFiles = await this.listMarkdownFiles(octokit, owner, repo, ref, item.path);
          files.push(...subFiles);
        } else if (item.type === 'file' && /\.(md|mdx)$/i.test(item.name)) {
          files.push({ path: item.path, name: item.name });
        }
      }
    } catch {
      // Silently skip inaccessible directories
    }

    return files;
  }
}

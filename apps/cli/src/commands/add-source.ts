import { Command } from 'commander';
import { getDb, closeDb, sources } from '@acr/db';
import { requireDatabaseUrl } from '@acr/config';
import type { SourceType, TrustLevel } from '@acr/types';
import { resolve } from 'path';
import { existsSync, statSync } from 'fs';

export const addSourceCommand = new Command('add-source')
  .description('Register a new trusted source')
  .requiredOption('--name <name>', 'Source name (unique)')
  .requiredOption('--type <type>', 'Source type: docs_site, github_repo, supabase_view, or local_folder')
  // docs_site
  .option('--url <url>', 'Base URL (for docs_site)')
  // github_repo
  .option('--github-owner <owner>', 'GitHub owner (for github_repo)')
  .option('--github-repo <repo>', 'GitHub repo (for github_repo)')
  .option('--github-branch <branch>', 'GitHub branch', 'main')
  .option('--github-docs-path <path>', 'Path to docs in repo', '/')
  // supabase_view
  .option('--supabase-url <url>', 'Supabase project URL (for supabase_view)')
  .option('--supabase-service-key <key>', 'Supabase service role key (for supabase_view)')
  .option('--supabase-schema <schema>', 'Supabase schema name', 'public')
  .option('--supabase-view <view>', 'Supabase view/table name (for supabase_view)')
  .option('--supabase-id-field <field>', 'Row ID field name', 'id')
  .option('--supabase-title-field <field>', 'Row title field name', 'title')
  .option('--supabase-content-fields <fields>', 'Comma-separated content field names')
  .option('--supabase-metadata-fields <fields>', 'Comma-separated metadata field names')
  .option('--supabase-updated-at-field <field>', 'Row updated_at field name')
  // local_folder
  .option('--folder-path <path>', 'Path to local folder (for local_folder)')
  .option('--no-recursive', 'Do not recurse into subdirectories')
  .option('--include-patterns <patterns>', 'Comma-separated include patterns (e.g. "*.md,docs/*")')
  .option('--exclude-patterns <patterns>', 'Comma-separated exclude patterns (e.g. "drafts/*,*.tmp")')
  // common
  .option('--trust-level <level>', 'Trust level: official or community', 'community')
  .option('--sync-frequency <minutes>', 'Sync frequency in minutes', '360')
  .action(async (opts) => {
    try {
      const sourceType = opts.type as SourceType;
      if (!['docs_site', 'github_repo', 'supabase_view', 'local_folder'].includes(sourceType)) {
        console.error('Invalid source type. Must be: docs_site, github_repo, supabase_view, or local_folder');
        process.exit(1);
      }

      if (sourceType === 'docs_site' && !opts.url) {
        console.error('--url is required for docs_site sources');
        process.exit(1);
      }

      if (sourceType === 'github_repo' && (!opts.githubOwner || !opts.githubRepo)) {
        console.error('--github-owner and --github-repo are required for github_repo sources');
        process.exit(1);
      }

      if (sourceType === 'supabase_view') {
        if (!opts.supabaseUrl || !opts.supabaseServiceKey) {
          console.error('--supabase-url and --supabase-service-key are required for supabase_view sources');
          process.exit(1);
        }
        if (!opts.supabaseView) {
          console.error('--supabase-view is required for supabase_view sources');
          process.exit(1);
        }
        if (!opts.supabaseContentFields) {
          console.error('--supabase-content-fields is required for supabase_view sources');
          process.exit(1);
        }
      }

      if (sourceType === 'local_folder') {
        if (!opts.folderPath) {
          console.error('--folder-path is required for local_folder sources');
          process.exit(1);
        }
        const resolved = resolve(opts.folderPath);
        if (!existsSync(resolved)) {
          console.error(`Directory not found: ${resolved}`);
          process.exit(1);
        }
        const stat = statSync(resolved);
        if (!stat.isDirectory()) {
          console.error(`"${resolved}" is not a directory`);
          process.exit(1);
        }
      }

      const dbUrl = requireDatabaseUrl('add-source');
      const db = getDb(dbUrl);

      const contentFields = opts.supabaseContentFields
        ? opts.supabaseContentFields.split(',').map((f: string) => f.trim())
        : null;

      const metadataFields = opts.supabaseMetadataFields
        ? opts.supabaseMetadataFields.split(',').map((f: string) => f.trim())
        : null;

      const includePatterns = opts.includePatterns
        ? opts.includePatterns.split(',').map((p: string) => p.trim())
        : null;

      const excludePatterns = opts.excludePatterns
        ? opts.excludePatterns.split(',').map((p: string) => p.trim())
        : null;

      const [source] = await db
        .insert(sources)
        .values({
          name: opts.name,
          sourceType,
          baseUrl: opts.url ?? null,
          githubOwner: opts.githubOwner ?? null,
          githubRepo: opts.githubRepo ?? null,
          githubBranch: opts.githubBranch ?? null,
          githubDocsPath: opts.githubDocsPath ?? null,
          supabaseUrl: opts.supabaseUrl ?? null,
          supabaseServiceKey: opts.supabaseServiceKey ?? null,
          supabaseSchema: opts.supabaseSchema ?? null,
          supabaseView: opts.supabaseView ?? null,
          supabaseIdField: opts.supabaseIdField ?? null,
          supabaseTitleField: opts.supabaseTitleField ?? null,
          supabaseContentFields: contentFields,
          supabaseMetadataFields: metadataFields,
          supabaseUpdatedAtField: opts.supabaseUpdatedAtField ?? null,
          folderPath: sourceType === 'local_folder' ? resolve(opts.folderPath) : null,
          folderRecursive: sourceType === 'local_folder' ? opts.recursive !== false : null,
          includePatterns,
          excludePatterns,
          trustLevel: opts.trustLevel as TrustLevel,
          syncFrequencyMinutes: parseInt(opts.syncFrequency, 10),
          status: 'active',
        })
        .returning();

      console.log(`✓ Source registered: ${source.name} (${source.id})`);
      console.log(`  Type:        ${source.sourceType}`);
      console.log(`  Trust:       ${source.trustLevel}`);
      console.log(`  Sync every:  ${source.syncFrequencyMinutes} minutes`);

      if (source.baseUrl) console.log(`  URL:         ${source.baseUrl}`);
      if (source.githubOwner) console.log(`  GitHub:      ${source.githubOwner}/${source.githubRepo}`);
      if (source.supabaseView) {
        console.log(`  Supabase:    ${source.supabaseSchema}.${source.supabaseView}`);
        console.log(`  Content:     ${(source.supabaseContentFields as string[])?.join(', ')}`);
      }
      if (source.folderPath) {
        console.log(`  Path:        ${source.folderPath}`);
        console.log(`  Recursive:   ${source.folderRecursive ?? true}`);
        if (source.includePatterns) console.log(`  Include:     ${(source.includePatterns as string[]).join(', ')}`);
        if (source.excludePatterns) console.log(`  Exclude:     ${(source.excludePatterns as string[]).join(', ')}`);
      }

      await closeDb();
    } catch (err: any) {
      if (err?.code === '23505') {
        console.error(`A source with that name already exists.`);
      } else {
        console.error('Failed to add source:', err instanceof Error ? err.message : err);
      }
      process.exit(1);
    }
  });

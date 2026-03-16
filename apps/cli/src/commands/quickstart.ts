import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { requireDatabaseUrl, requireEmbeddingConfig, loadBaseConfig } from '@acr/config';
import { getDb, closeDb, sources } from '@acr/db';
import { runSyncPipeline, type SyncStats } from '../../../worker/src/sync-pipeline.js';
import type { Source } from '@acr/types';
import { searchContext } from '@acr/retrieval';
import { getEmbeddingProvider } from '@acr/embeddings';
import * as readline from 'readline';

// ── Pack definitions ──

interface PackSource {
  name: string;
  sourceType: 'docs_site' | 'github_repo' | 'supabase_view' | 'local_folder';
  trustLevel: 'official' | 'community';
  // docs_site
  baseUrl?: string;
  // github_repo
  githubOwner?: string;
  githubRepo?: string;
  githubDocsPath?: string;
}

interface Pack {
  id: string;
  name: string;
  description: string;
  sources: PackSource[];
  sampleQuery: string;
}

const PACKS: Pack[] = [
  {
    id: 'agent-stack',
    name: 'Agent Stack',
    description: 'The modern agent ecosystem — MCP, OpenAI Agents, LangGraph, and Vercel AI SDK',
    sources: [
      {
        name: 'MCP Docs',
        sourceType: 'docs_site',
        trustLevel: 'official',
        baseUrl: 'https://modelcontextprotocol.io/introduction',
      },
      {
        name: 'OpenAI Agents SDK',
        sourceType: 'github_repo',
        trustLevel: 'official',
        githubOwner: 'openai',
        githubRepo: 'openai-agents-python',
        githubDocsPath: 'docs/',
      },
      {
        name: 'LangGraph Docs',
        sourceType: 'docs_site',
        trustLevel: 'official',
        baseUrl: 'https://docs.langchain.com/oss/python/langgraph/overview',
      },
      {
        name: 'Vercel AI SDK',
        sourceType: 'docs_site',
        trustLevel: 'official',
        baseUrl: 'https://ai-sdk.dev/docs',
      },
    ],
    sampleQuery: 'how do agents use tools',
  },
];

// ── Helpers ──

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Command ──

export const quickstartCommand = new Command('quickstart')
  .description('Load a curated source pack and run a demo search in minutes')
  .option('--pack <name>', 'Pack to load (default: agent-stack)', 'agent-stack')
  .option('--yes', 'Skip confirmation prompt')
  .option('--force', 'Re-add sources that already exist (deletes + re-adds)')
  .option('--json', 'Output as JSON')
  .addHelpText('after', `
Available packs:
  agent-stack   MCP Docs, OpenAI Agents SDK, LangGraph, Vercel AI SDK

Examples:
  acr quickstart              # interactive, loads agent-stack
  acr quickstart --yes        # no prompts
  acr quickstart --force      # re-add even if sources exist
`)
  .action(async (opts) => {
    try {
      // 1. Validate setup
      const dbUrl = requireDatabaseUrl('quickstart');
      requireEmbeddingConfig('quickstart');
      const db = getDb(dbUrl);

      // Find the requested pack
      const pack = PACKS.find((p) => p.id === opts.pack);
      if (!pack) {
        const available = PACKS.map((p) => p.id).join(', ');
        console.error(`Unknown pack: "${opts.pack}". Available packs: ${available}`);
        process.exit(1);
      }

      // 2. Show what we'll do
      if (!opts.json) {
        console.log('');
        console.log(`  ━━━ Quickstart: ${pack.name} ━━━`);
        console.log(`  ${pack.description}`);
        console.log('');
        console.log('  Sources to load:');
        for (const s of pack.sources) {
          const badge = s.sourceType === 'github_repo' ? 'github'
            : s.sourceType === 'docs_site' ? 'docs'
            : s.sourceType;
          const url = s.baseUrl ?? `${s.githubOwner}/${s.githubRepo}`;
          console.log(`    • ${s.name} [${badge}] → ${url}`);
        }
        console.log('');
      }

      // 3. Confirm
      if (!opts.yes && !opts.json) {
        const answer = await ask('  Proceed? (Y/n) ');
        if (answer && answer !== 'y' && answer !== 'yes') {
          console.log('  Cancelled.');
          await closeDb();
          return;
        }
      }

      // 4. Add sources (idempotent — skip existing unless --force)
      const added: string[] = [];
      const skipped: string[] = [];
      const addErrors: Array<{ name: string; error: string }> = [];

      for (const packSource of pack.sources) {
        try {
          // Check if source already exists
          const [existing] = await db
            .select()
            .from(sources)
            .where(eq(sources.name, packSource.name))
            .limit(1);

          if (existing && !opts.force) {
            skipped.push(packSource.name);
            if (!opts.json) {
              console.log(`  ○ ${packSource.name} — already exists (skipped)`);
            }
            continue;
          }

          if (existing && opts.force) {
            // Delete existing source (cascade deletes docs + chunks)
            await db.delete(sources).where(eq(sources.id, existing.id));
            if (!opts.json) {
              console.log(`  ✗ ${packSource.name} — removed (--force)`);
            }
          }

          // Insert source
          const insertValues: Record<string, unknown> = {
            name: packSource.name,
            sourceType: packSource.sourceType,
            trustLevel: packSource.trustLevel,
            syncFrequencyMinutes: 360,
          };

          if (packSource.sourceType === 'docs_site') {
            insertValues.baseUrl = packSource.baseUrl;
          } else if (packSource.sourceType === 'github_repo') {
            insertValues.githubOwner = packSource.githubOwner;
            insertValues.githubRepo = packSource.githubRepo;
            insertValues.githubBranch = 'main';
            insertValues.githubDocsPath = packSource.githubDocsPath ?? '/';
          }

          await db.insert(sources).values(insertValues as typeof sources.$inferInsert);
          added.push(packSource.name);

          if (!opts.json) {
            console.log(`  ✓ ${packSource.name} — added`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          addErrors.push({ name: packSource.name, error: message });
          if (!opts.json) {
            console.error(`  ✗ ${packSource.name} — failed to add: ${message}`);
          }
        }
      }

      // 5. Sync only the sources we just added
      const syncResults: Array<{
        name: string;
        status: 'success' | 'error';
        stats?: SyncStats;
        error?: string;
      }> = [];

      if (added.length > 0) {
        if (!opts.json) {
          console.log('');
          console.log('  Syncing...');
        }

        for (const sourceName of added) {
          const [source] = await db
            .select()
            .from(sources)
            .where(eq(sources.name, sourceName))
            .limit(1);

          if (!source) continue;

          if (!opts.json) {
            console.log(`  ⟳ ${sourceName}...`);
          }

          try {
            const stats = await runSyncPipeline(source as Source);
            syncResults.push({ name: sourceName, status: 'success', stats });
            if (!opts.json) {
              console.log(`  ✓ ${sourceName} — ${stats.processed + stats.changed} docs, ${stats.chunksCreated} chunks`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            syncResults.push({ name: sourceName, status: 'error', error: message });
            if (!opts.json) {
              console.error(`  ✗ ${sourceName} — sync failed: ${message}`);
            }
          }
        }
      }

      // 6. Sample search (only if at least one sync succeeded)
      const successfulSyncs = syncResults.filter((r) => r.status === 'success');
      let sampleResults: unknown = null;

      if (successfulSyncs.length > 0) {
        if (!opts.json) {
          console.log('');
          console.log(`  Sample search: "${pack.sampleQuery}"`);
          console.log('');
        }

        try {
          const embeddingProvider = getEmbeddingProvider();
          const response = await searchContext(
            { query: pack.sampleQuery, maxResults: 3, latestOnly: true },
            embeddingProvider,
          );

          sampleResults = response;

          if (!opts.json && response.results.length > 0) {
            for (let i = 0; i < Math.min(3, response.results.length); i++) {
              const r = response.results[i];
              console.log(`  ${i + 1}. ${r.citation.documentTitle}`);
              console.log(`     Source: ${r.citation.sourceName}  Score: ${r.score}`);
              console.log(`     → acr get-document ${r.documentId}`);
              console.log('');
            }
          } else if (!opts.json) {
            console.log('  No results yet — sources may still be indexing.');
            console.log('');
          }
        } catch {
          if (!opts.json) {
            console.log('  Sample search skipped (embedding error).');
            console.log('');
          }
        }
      }

      // 7. Summary
      const summary = {
        pack: pack.id,
        added: added.length,
        skipped: skipped.length,
        addErrors: addErrors.length,
        synced: successfulSyncs.length,
        syncFailed: syncResults.filter((r) => r.status === 'error').length,
      };

      if (opts.json) {
        console.log(JSON.stringify({
          summary,
          addedSources: added,
          skippedSources: skipped,
          errors: addErrors,
          syncResults,
          sampleResults,
        }, null, 2));
      } else {
        console.log('  ━━━ Summary ━━━');
        const parts: string[] = [];
        if (summary.added > 0) parts.push(`${summary.added} added`);
        if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
        if (summary.synced > 0) parts.push(`${summary.synced} synced`);
        if (summary.syncFailed > 0) parts.push(`${summary.syncFailed} sync failed`);
        if (summary.addErrors > 0) parts.push(`${summary.addErrors} add failed`);
        console.log(`  ${parts.join(', ')}`);
        console.log('');
        console.log('  Next steps:');
        console.log('    acr status                    # check health');
        console.log('    acr search "your question"    # search across all sources');
        console.log('    acr run-mcp --http            # start MCP server for agents');
        console.log('');
      }

      await closeDb();
    } catch (err) {
      console.error('Quickstart failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

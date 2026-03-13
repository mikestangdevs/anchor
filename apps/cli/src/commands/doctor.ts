import { Command } from 'commander';
import { sql } from 'drizzle-orm';
import { getDb, closeDb } from '@acr/db';
import {
  loadBaseConfig,
  configFileExists,
  getConfigFilePath,
  getAcrDir,
} from '@acr/config';
import { getEmbeddingProvider } from '@acr/embeddings';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
}

export const doctorCommand = new Command('doctor')
  .description('Verify ACR configuration, database, and provider setup')
  .option('--json', 'Output as JSON')
  .option('--fix', 'Attempt to fix common issues')
  .action(async (opts) => {
    const results: CheckResult[] = [];
    const base = loadBaseConfig();

    // ── 1. Config file ──
    if (configFileExists()) {
      results.push({ name: 'Config file', status: 'pass', message: getConfigFilePath() });
    } else {
      results.push({
        name: 'Config file',
        status: 'warn',
        message: 'Not found — using env vars only',
        fix: 'acr init',
      });
    }

    // ── 2. DATABASE_URL ──
    if (base.databaseUrl) {
      const masked = base.databaseUrl.replace(/:[^@]+@/, ':***@');
      results.push({ name: 'Database URL', status: 'pass', message: masked });
    } else {
      results.push({
        name: 'Database URL',
        status: 'fail',
        message: 'Not set',
        fix: 'Set DATABASE_URL in .acr/config.json or environment',
      });
    }

    // ── 3. Database connectivity ──
    if (base.databaseUrl) {
      try {
        const db = getDb(base.databaseUrl);
        await db.execute(sql`SELECT 1`);
        results.push({ name: 'Database connection', status: 'pass', message: 'Connected' });

        // 3a. pgvector
        try {
          const extResult = await db.execute(
            sql`SELECT 1 FROM pg_extension WHERE extname = 'vector'`
          );
          const rows = extResult as unknown as unknown[];
          if (rows && (rows as unknown[]).length > 0) {
            results.push({ name: 'pgvector', status: 'pass', message: 'Installed' });
          } else {
            results.push({
              name: 'pgvector',
              status: 'fail',
              message: 'Not installed',
              fix: 'Enable in Supabase Dashboard → Extensions, or: CREATE EXTENSION vector',
            });
          }
        } catch {
          results.push({
            name: 'pgvector',
            status: 'fail',
            message: 'Could not check',
            fix: 'Enable in Supabase Dashboard → Extensions',
          });
        }

        // 3b. Schema
        try {
          await db.execute(sql`SELECT 1 FROM sources LIMIT 0`);
          results.push({ name: 'Schema', status: 'pass', message: 'Tables exist' });
        } catch {
          results.push({
            name: 'Schema',
            status: 'fail',
            message: 'Tables not found',
            fix: 'acr db-push',
          });
        }

        await closeDb();
      } catch (err) {
        results.push({
          name: 'Database connection',
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      results.push({
        name: 'Database connection',
        status: 'fail',
        message: 'Skipped — no DATABASE_URL',
      });
    }

    // ── 4. Embedding config ──
    if (base.embedding.apiKey) {
      const masked = base.embedding.apiKey.slice(0, 7) + '...';
      results.push({
        name: 'Embedding config',
        status: 'pass',
        message: `${base.embedding.provider} / ${base.embedding.model} (${masked})`,
      });
    } else {
      results.push({
        name: 'Embedding config',
        status: 'fail',
        message: 'EMBEDDING_API_KEY not set',
        fix: 'Set EMBEDDING_API_KEY in .acr/config.json or environment',
      });
    }

    // ── 5. Embedding provider ──
    if (base.embedding.apiKey) {
      try {
        const provider = getEmbeddingProvider();
        results.push({
          name: 'Embedding provider',
          status: 'pass',
          message: `${provider.modelName} (${provider.dimensions}d)`,
        });
      } catch (err) {
        results.push({
          name: 'Embedding provider',
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      results.push({
        name: 'Embedding provider',
        status: 'warn',
        message: 'Skipped — no API key',
      });
    }

    // ── Output ──
    const passCount = results.filter((r) => r.status === 'pass').length;
    const failCount = results.filter((r) => r.status === 'fail').length;
    const warnCount = results.filter((r) => r.status === 'warn').length;

    if (opts.json) {
      console.log(JSON.stringify({
        status: failCount > 0 ? 'unhealthy' : warnCount > 0 ? 'degraded' : 'healthy',
        checks: results,
        summary: { pass: passCount, warn: warnCount, fail: failCount },
      }, null, 2));
      if (failCount > 0) process.exit(1);
      return;
    }

    console.log('');
    console.log('  ACR Doctor');
    console.log('  ─────────');
    console.log('');

    for (const r of results) {
      const icon = r.status === 'pass' ? '  ✓'
        : r.status === 'warn' ? '  ⚠'
        : '  ✗';
      console.log(`${icon} ${r.name.padEnd(22)} ${r.message}`);
      if (r.fix && r.status !== 'pass') {
        console.log(`${''.padEnd(27)}→ ${r.fix}`);
      }
    }

    console.log('');
    const overall = failCount > 0 ? '✗ Unhealthy' : warnCount > 0 ? '⚠ Degraded' : '✓ Healthy';
    console.log(`  ${overall} — ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);
    console.log('');

    if (failCount > 0) process.exit(1);
  });

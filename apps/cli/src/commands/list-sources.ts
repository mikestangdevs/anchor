import { Command } from 'commander';
import { getDb, closeDb, sources } from '@acr/db';
import { requireDatabaseUrl } from '@acr/config';

// Badge map
const BADGE: Record<string, string> = {
  github_repo: 'github',
  supabase_view: 'supabase',
  local_folder: 'local',
  docs_site: 'docs',
};

export const listSourcesCommand = new Command('list')
  .description('List all registered sources')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const dbUrl = requireDatabaseUrl('list-sources');
      const db = getDb(dbUrl);
      const allSources = await db.select().from(sources);

      if (opts.json) {
        console.log(JSON.stringify(allSources, null, 2));
        await closeDb();
        return;
      }

      if (allSources.length === 0) {
        console.log('');
        console.log('  No sources registered.');
        console.log('');
        console.log('  Get started:');
        console.log('    acr source add --name "My Docs" --type local_folder --folder-path ./docs');
        console.log('    acr source add --name "API Docs" --type docs_site --url https://docs.example.com');
        console.log('');
        await closeDb();
        return;
      }

      console.log('');
      console.log(`  ${'Name'.padEnd(25)} ${'Type'.padEnd(12)} ${'Trust'.padEnd(12)} ${'Status'.padEnd(10)}`);
      console.log(`  ${'─'.repeat(25)} ${'─'.repeat(12)} ${'─'.repeat(12)} ${'─'.repeat(10)}`);

      for (const s of allSources) {
        const badge = BADGE[s.sourceType] ?? s.sourceType;
        console.log(
          `  ${s.name.padEnd(25)} ${badge.padEnd(12)} ${s.trustLevel.padEnd(12)} ${s.status.padEnd(10)}`
        );
      }
      console.log('');

      await closeDb();
    } catch (err) {
      console.error('Failed to list sources:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

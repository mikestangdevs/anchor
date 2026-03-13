import { Command } from 'commander';
import { writeConfigFile, configFileExists, getConfigFilePath } from '@acr/config';
import { printSplash } from '../branding.js';

export const initCommand = new Command('init')
  .description('Initialize ACR in the current directory')
  .option('--database-url <url>', 'Database URL (Supabase or local Postgres)')
  .option('--embedding-api-key <key>', 'Embedding provider API key')
  .action(async (opts) => {
    try {
      printSplash();

      // 1. Create .acr/config.json
      if (configFileExists()) {
        console.log(`  ✓ Config already exists: ${getConfigFilePath()}`);
      } else {
        const overrides: Record<string, string> = {};
        if (opts.databaseUrl) overrides.database_url = opts.databaseUrl;
        if (opts.embeddingApiKey) overrides.embedding_api_key = opts.embeddingApiKey;

        const path = writeConfigFile(overrides);
        console.log(`  ✓ Created ${path}`);
      }

      // 2. Print next steps
      const hasDbUrl = !!(opts.databaseUrl || process.env.DATABASE_URL);
      const hasEmbeddingKey = !!(opts.embeddingApiKey || process.env.EMBEDDING_API_KEY);

      console.log('');
      console.log('  ── Next Steps ──');
      console.log('');

      let step = 1;

      if (!hasDbUrl) {
        console.log(`  ${step}. Set DATABASE_URL`);
        console.log('     Edit .acr/config.json or set in your environment.');
        console.log('');
        console.log('     Supabase:');
        console.log('       Dashboard → Project Settings → Database → Connection string → URI');
        console.log('       postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres');
        console.log('');
        console.log('     Local Postgres:');
        console.log('       postgresql://user:pass@localhost:5432/dbname');
        step++;
      } else {
        console.log(`  ${step}. ✓ DATABASE_URL configured`);
        step++;
      }

      console.log('');
      if (!hasEmbeddingKey) {
        console.log(`  ${step}. Set EMBEDDING_API_KEY`);
        console.log('     Get an OpenAI key: https://platform.openai.com/api-keys');
        step++;
      } else {
        console.log(`  ${step}. ✓ EMBEDDING_API_KEY configured`);
        step++;
      }

      console.log('');
      console.log(`  ${step}. acr db-push          # create database tables`);
      step++;
      console.log(`  ${step}. acr doctor           # verify setup`);
      step++;
      console.log(`  ${step}. acr source add ...   # register your first source`);
      console.log('');
      console.log('  Source examples:');
      console.log('    acr source add --name "My Docs" --type local_folder --folder-path ./docs');
      console.log('    acr source add --name "API Ref" --type docs_site --url https://docs.example.com');
      console.log('    acr source add --name "Repo" --type github_repo --github-owner org --github-repo repo');
      console.log('');
    } catch (err) {
      console.error('Initialization failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

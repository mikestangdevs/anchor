/**
 * Orchestrator for `acr setup local`.
 *
 * Ties together detection, prompts, file writing, doctor, and db-push
 * into a single cohesive flow.
 */

import { existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

import {
  checkPathWritable,
  checkDesktopExists,
  checkConfigExists,
  checkDockerInstalled,
  checkDockerRunning,
  checkDatabase,
} from './detect.js';

import {
  promptProjectPath,
  promptStorageMode,
  promptEmbeddingKey,
  promptRunValidation,
  promptExistingDirectory,
  type StorageChoice,
} from './prompts.js';

import {
  createProjectTree,
  writeSetupConfig,
  writeSetupEnv,
  writeSetupReadme,
  getSiblingPath,
  type SetupConfigData,
  type SetupEnvData,
} from './file-writers.js';

import {
  printSetupHeader,
  printCreatedFiles,
  printNextSteps,
  printDetectResult,
  printDbCheckResult,
  printLocalStorageNotice,
  printDoctorSummary,
  printSetupComplete,
  printNonInteractiveMissingFlags,
  maskDatabaseUrl,
  maskSecret,
} from './messages.js';

// ─── Options from CLI ───────────────────────────────────────────

export interface SetupLocalOptions {
  path?: string;
  name?: string;
  force?: boolean;
  nonInteractive?: boolean;
  storage?: string;
  databaseUrl?: string;
  embeddingApiKey?: string;
  skipDoctor?: boolean;
  skipDbPush?: boolean;
}

// ─── Main Orchestrator ──────────────────────────────────────────

export async function runSetupLocal(opts: SetupLocalOptions): Promise<void> {
  const interactive = !opts.nonInteractive;

  printSetupHeader();

  // ── 1. Resolve target path ──

  const home = homedir();
  const desktopCheck = checkDesktopExists(home);
  const defaultBase = desktopCheck.ok ? join(home, 'Desktop') : home;
  const folderName = opts.name ?? 'anchor';
  const defaultPath = join(defaultBase, folderName);
  const fallbackPath = !desktopCheck.ok ? join(home, folderName) : defaultPath;

  let projectPath: string;

  if (opts.path) {
    projectPath = opts.path;
  } else if (interactive) {
    projectPath = await promptProjectPath(defaultPath, fallbackPath);
  } else {
    projectPath = defaultPath;
  }

  // ── 2. Check if path exists ──

  if (existsSync(projectPath)) {
    const configCheck = checkConfigExists(projectPath);

    if (opts.force) {
      console.log(`  ⓘ  --force: overwriting config files in ${projectPath}`);
    } else if (interactive) {
      const siblingPath = getSiblingPath(projectPath);
      const decision = await promptExistingDirectory(projectPath, siblingPath);

      if (decision === 'sibling') {
        projectPath = siblingPath;
      } else if (decision === 'reuse' && configCheck.ok) {
        console.log('  ⓘ  Reusing existing folder. Existing config will not be modified.');
      }
      // 'overwrite' just continues and writes new files
    } else {
      // Non-interactive + existing dir + no --force → fail
      if (configCheck.ok) {
        console.error(`\n  ✗ "${projectPath}" already has an ACR config.`);
        console.error('    Pass --force to overwrite, or choose a different path.\n');
        process.exit(1);
      }
      // Dir exists but no config → safe to continue
    }
  }

  // ── 3. Check path is writable ──

  const writableCheck = checkPathWritable(projectPath);
  if (!writableCheck.ok) {
    printDetectResult('Target path', writableCheck);
    process.exit(1);
  }

  // ── 4. Storage mode ──

  let storage: StorageChoice;
  let databaseUrl: string | undefined = opts.databaseUrl;

  if (opts.storage === 'local') {
    storage = 'local';
  } else if (opts.storage === 'postgres') {
    storage = 'postgres';
  } else if (databaseUrl) {
    storage = 'existing_url';
  } else if (interactive) {
    const storageResult = await promptStorageMode();
    storage = storageResult.storage;
    if (storageResult.databaseUrl) databaseUrl = storageResult.databaseUrl;
  } else {
    // Non-interactive with no storage specified
    const missing: string[] = [];
    if (!opts.storage) missing.push('--storage <local|postgres>');
    if (!opts.databaseUrl) missing.push('--database-url <url>  (if using postgres)');
    printNonInteractiveMissingFlags(missing);
    process.exit(1);
  }

  // Handle local storage honestly
  if (storage === 'local') {
    printLocalStorageNotice();
    if (!interactive) {
      console.error('  ✗ Local storage is not yet implemented. Use --storage postgres or provide --database-url.\n');
      process.exit(1);
    }
    // In interactive mode, fall back to re-prompting
    const retry = await promptStorageMode();
    storage = retry.storage;
    if (retry.databaseUrl) databaseUrl = retry.databaseUrl;

    if (storage === 'local') {
      console.error('  ✗ Local storage is not yet implemented.\n');
      process.exit(1);
    }
  }

  // ── 5. Database URL for postgres mode ──

  if ((storage === 'postgres' || storage === 'existing_url') && !databaseUrl) {
    if (interactive) {
      const { input } = await import('./prompts.js');
      databaseUrl = await input('Paste your DATABASE_URL') || undefined;

      if (!databaseUrl) {
        console.log('  ⓘ  No DATABASE_URL provided. You can add it to .env later.');
      }
    }
    // Non-interactive without DB URL: continue, they'll fill in .env later
  }

  // ── 6. Embedding API key ──

  let embeddingApiKey: string | undefined = opts.embeddingApiKey;

  if (!embeddingApiKey && interactive) {
    embeddingApiKey = await promptEmbeddingKey();
  }

  // ── 7. Create folder tree + files ──

  const createdDirs = createProjectTree(projectPath);

  const configData: SetupConfigData = {
    projectName: basename(projectPath),
    storageMode: storage === 'existing_url' ? 'postgres' : storage,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
  };

  const envData: SetupEnvData = {
    databaseUrl,
    embeddingApiKey,
  };

  const configPath = writeSetupConfig(projectPath, configData);
  const envPath = writeSetupEnv(projectPath, envData);
  const readmePath = writeSetupReadme(projectPath, configData.projectName);

  const createdFiles = [configPath, envPath, readmePath];

  printCreatedFiles(projectPath, [
    ...createdDirs.map(d => d + '/'),
    ...createdFiles,
  ]);

  // ── 8. Validate database if URL provided ──

  let dbOk = false;

  if (databaseUrl) {
    console.log(`  Checking database... ${maskDatabaseUrl(databaseUrl)}`);
    const dbResult = await checkDatabase(databaseUrl);
    printDbCheckResult(dbResult);
    dbOk = dbResult.ok;
  }

  // ── 9. Doctor ──

  let doctorPassed = false;
  let doctorSkipped = opts.skipDoctor ?? false;

  if (!doctorSkipped) {
    let runDoctor: boolean;
    if (interactive) {
      runDoctor = databaseUrl ? await promptRunValidation() : false;
    } else {
      runDoctor = !!databaseUrl;
    }

    if (runDoctor && databaseUrl) {
      console.log('');
      console.log('  Running health checks...');

      // Run doctor logic inline (reuse the same check pattern as doctor.ts)
      const results = await runDoctorChecks(databaseUrl, embeddingApiKey);
      printDoctorSummary(results);
      doctorPassed = results.every(r => r.status !== 'fail');

      // If doctor passed DB checks, update dbOk (user may have fixed issues mid-flow)
      const dbCheckPassed = results.some(r => r.name === 'Database connection' && r.status === 'pass');
      if (dbCheckPassed) dbOk = true;
    } else {
      doctorSkipped = true;
    }
  }

  // ── 10. db-push ──

  let dbPushPassed = false;
  let dbPushSkipped = opts.skipDbPush ?? false;

  if (!dbPushSkipped && databaseUrl && dbOk) {
    try {
      console.log('  Pushing schema...');
      await runDbPush(databaseUrl);
      dbPushPassed = true;
      console.log('  ✓ Schema push complete.\n');
    } catch (err) {
      console.error(`  ✗ Schema push failed: ${err instanceof Error ? err.message : err}`);
      console.error('    You can retry later with: acr db-push\n');
    }
  } else if (!dbPushSkipped && !databaseUrl) {
    dbPushSkipped = true;
  }

  // ── 11. Summary ──

  const setupStatus = {
    dbConfigured: !!databaseUrl,
    dbValidated: dbOk,
    embeddingConfigured: !!embeddingApiKey,
    doctorPassed,
    dbPushPassed,
  };

  printSetupComplete(projectPath, setupStatus);

  printNextSteps(projectPath, {
    needsDatabaseUrl: !databaseUrl,
    needsEmbeddingKey: !embeddingApiKey,
    doctorPassed,
    doctorSkipped,
    dbPushPassed,
    dbPushSkipped,
  });

  // Exit code: 0 = fully ready, 2 = workspace created but DB needs attention
  if (databaseUrl && !dbOk) {
    process.exit(2);
  }
}

// ─── Inline Doctor Checks ───────────────────────────────────────
// Reuses the same check pattern as doctor.ts without importing
// the Commander command directly.

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  fix?: string;
}

async function runDoctorChecks(
  databaseUrl?: string,
  embeddingApiKey?: string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Database URL
  if (databaseUrl) {
    results.push({
      name: 'Database URL',
      status: 'pass',
      message: maskDatabaseUrl(databaseUrl),
    });
  } else {
    results.push({
      name: 'Database URL',
      status: 'fail',
      message: 'Not set',
      fix: 'Set DATABASE_URL in .env',
    });
  }

  // Database connectivity + pgvector
  if (databaseUrl) {
    const dbResult = await checkDatabase(databaseUrl);
    if (dbResult.ok) {
      results.push({ name: 'Database connection', status: 'pass', message: 'Connected' });
      results.push({ name: 'pgvector', status: 'pass', message: 'Installed' });
    } else {
      results.push({
        name: 'Database connection',
        status: dbResult.failureKind === 'missing_pgvector' ? 'pass' : 'fail',
        message: dbResult.failureKind === 'missing_pgvector' ? 'Connected' : dbResult.message,
        fix: dbResult.fix,
      });
      if (dbResult.failureKind === 'missing_pgvector') {
        results.push({
          name: 'pgvector',
          status: 'fail',
          message: 'Not installed',
          fix: dbResult.fix,
        });
      }
    }
  } else {
    results.push({
      name: 'Database connection',
      status: 'fail',
      message: 'Skipped — no DATABASE_URL',
    });
  }

  // Embedding config
  if (embeddingApiKey) {
    results.push({
      name: 'Embedding config',
      status: 'pass',
      message: `openai / text-embedding-3-small (${maskSecret(embeddingApiKey)})`,
    });
  } else {
    results.push({
      name: 'Embedding config',
      status: 'warn',
      message: 'EMBEDDING_API_KEY not configured',
      fix: 'Add EMBEDDING_API_KEY to .env before syncing sources.',
    });
  }

  return results;
}

// ─── Inline db-push ─────────────────────────────────────────────
// Reuses the core schema creation logic from db-push.ts.
// We import postgres directly rather than importing the Commander command.

async function runDbPush(databaseUrl: string): Promise<void> {
  const postgres = (await import('postgres')).default;
  const isRemote =
    databaseUrl.includes('supabase') ||
    databaseUrl.includes('neon') ||
    !databaseUrl.includes('localhost');

  const sql = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {},
    ...(isRemote ? { ssl: 'require' } : {}),
    ...(databaseUrl.includes('pooler.supabase') ? { prepare: false } : {}),
  });

  // Create extension
  await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

  // Create enums
  const enums = [
    `CREATE TYPE source_type AS ENUM ('docs_site','github_repo','supabase_view','local_folder')`,
    `CREATE TYPE trust_level AS ENUM ('official','community')`,
    `CREATE TYPE source_status AS ENUM ('active','paused','error')`,
    `CREATE TYPE content_type AS ENUM ('markdown','html','plain_text')`,
    `CREATE TYPE annotation_kind AS ENUM ('workaround','warning','example','migration_note')`,
    `CREATE TYPE author_type AS ENUM ('human','agent')`,
    `CREATE TYPE moderation_status AS ENUM ('pending','approved','rejected')`,
    `CREATE TYPE sync_job_type AS ENUM ('full','incremental')`,
    `CREATE TYPE sync_job_status AS ENUM ('pending','running','completed','failed')`,
  ];
  for (const ddl of enums) {
    await sql.unsafe(`DO $$ BEGIN ${ddl}; EXCEPTION WHEN duplicate_object THEN null; END $$`);
  }

  // Create tables (IF NOT EXISTS — safe to re-run)
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(255) NOT NULL UNIQUE,
    source_type source_type NOT NULL,
    base_url text,
    github_owner varchar(255),
    github_repo varchar(255),
    github_branch varchar(255) DEFAULT 'main',
    github_docs_path varchar(500) DEFAULT '/',
    supabase_url text,
    supabase_service_key text,
    supabase_schema varchar(255) DEFAULT 'public',
    supabase_view varchar(255),
    supabase_id_field varchar(255) DEFAULT 'id',
    supabase_title_field varchar(255) DEFAULT 'title',
    supabase_content_fields json,
    supabase_metadata_fields json,
    supabase_updated_at_field varchar(255),
    folder_path text,
    folder_recursive boolean DEFAULT true,
    include_patterns json,
    exclude_patterns json,
    trust_level trust_level NOT NULL DEFAULT 'community',
    source_status source_status NOT NULL DEFAULT 'active',
    sync_frequency_minutes integer NOT NULL DEFAULT 360,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    title varchar(1000) NOT NULL,
    canonical_url text NOT NULL,
    content_type content_type NOT NULL DEFAULT 'markdown',
    cleaned_markdown text NOT NULL,
    version_hash varchar(64) NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    last_verified_at timestamptz NOT NULL DEFAULT now(),
    is_latest boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    section_title varchar(500),
    text text NOT NULL,
    embedding vector(1536),
    token_count integer NOT NULL,
    quality_score real NOT NULL DEFAULT 1.0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS annotations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id uuid REFERENCES chunks(id) ON DELETE CASCADE,
    author_type author_type NOT NULL DEFAULT 'human',
    author_name varchar(255),
    annotation_kind annotation_kind NOT NULL,
    note text NOT NULL,
    confidence real NOT NULL DEFAULT 0.8,
    moderation_status moderation_status NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  await sql.unsafe(`CREATE TABLE IF NOT EXISTS sync_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    sync_job_type sync_job_type NOT NULL DEFAULT 'full',
    sync_job_status sync_job_status NOT NULL DEFAULT 'pending',
    started_at timestamptz,
    completed_at timestamptz,
    error_message text,
    stats_json jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);

  // Indexes
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS documents_source_id_idx ON documents(source_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS documents_canonical_url_idx ON documents(canonical_url)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS documents_version_hash_idx ON documents(version_hash)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS annotations_document_id_idx ON annotations(document_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS annotations_chunk_id_idx ON annotations(chunk_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS sync_jobs_source_id_idx ON sync_jobs(source_id)`);

  await sql.end();
}

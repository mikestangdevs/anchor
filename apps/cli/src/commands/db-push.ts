import { Command } from 'commander';
import { requireDatabaseUrl } from '@acr/config';
import postgres from 'postgres';

/**
 * Push ACR schema to the configured database.
 *
 * Default mode: safe migration — creates tables/columns/enums if missing,
 * adds new enum values and columns without touching existing data.
 *
 * --force mode: drops and recreates everything, but backs up source configs
 * first and restores them after the schema push.
 */
export const dbPushCommand = new Command('db-push')
  .description('Push ACR schema to the database (creates tables, enums, indexes)')
  .option('--force', 'Drop and recreate tables (backs up + restores source configs)')
  .action(async (opts) => {
    try {
      const dbUrl = requireDatabaseUrl('db-push');

      // Detect remote connections for SSL
      const isRemote = dbUrl.includes('supabase') || dbUrl.includes('neon') || !dbUrl.includes('localhost');

      const sql = postgres(dbUrl, {
        max: 1,
        onnotice: () => {},  // suppress 'already exists, skipping' noise
        ...(isRemote ? { ssl: 'require' } : {}),
        ...(dbUrl.includes('pooler.supabase') ? { prepare: false } : {}),
      });

      console.log('Pushing ACR schema to database...\n');

      // ── FORCE MODE: backup → drop → create → restore ──
      if (opts.force) {
        // Backup source configs before dropping
        let backedUpSources: any[] = [];
        try {
          backedUpSources = await sql`SELECT * FROM sources`;
          if (backedUpSources.length > 0) {
            console.log(`  ⤓ Backed up ${backedUpSources.length} source config(s)`);
          }
        } catch {
          // Table may not exist yet
        }

        console.log('⚠ --force: dropping existing tables...');
        await sql.unsafe(`DROP TABLE IF EXISTS sync_jobs CASCADE`);
        await sql.unsafe(`DROP TABLE IF EXISTS annotations CASCADE`);
        await sql.unsafe(`DROP TABLE IF EXISTS chunks CASCADE`);
        await sql.unsafe(`DROP TABLE IF EXISTS documents CASCADE`);
        await sql.unsafe(`DROP TABLE IF EXISTS sources CASCADE`);
        // Drop enums
        const enumNames = [
          'source_type', 'trust_level', 'source_status', 'content_type',
          'annotation_kind', 'author_type', 'moderation_status',
          'sync_job_type', 'sync_job_status',
        ];
        for (const name of enumNames) {
          await sql.unsafe(`DROP TYPE IF EXISTS ${name} CASCADE`);
        }
        console.log('  Tables dropped.\n');

        // Create everything fresh
        await createSchema(sql);

        // Restore source configs (documents/chunks must be re-synced)
        if (backedUpSources.length > 0) {
          let restored = 0;
          for (const src of backedUpSources) {
            try {
              await sql`INSERT INTO sources ${sql(src)}`;
              restored++;
            } catch (err) {
              console.error(`  ⚠ Could not restore source "${src.name}":`, err instanceof Error ? err.message : err);
            }
          }
          console.log(`\n  ⤒ Restored ${restored}/${backedUpSources.length} source config(s)`);
          console.log('  Note: Documents and chunks were cleared — run `acr sync --all` to re-index.\n');
        }
      } else {
        // ── SAFE MODE: add missing columns/enums without drops ──
        await createSchema(sql);
        await migrateNewColumns(sql);
        await migrateNewEnumValues(sql);
      }

      await sql.end();
      console.log('\n✓ Schema push complete!');
      console.log('\nNext: run `acr doctor` to verify everything.');
    } catch (err) {
      console.error('Schema push failed:', err instanceof Error ? err.message : err);
      console.error('');
      console.error('Troubleshooting:');
      console.error('  - Use the Session mode (port 5432) pooler connection string for schema push');
      console.error('  - Supabase: Project Settings → Database → Connection string → URI');
      console.error('  - Make sure pgvector is enabled: Dashboard → Extensions → vector');
      process.exit(1);
    }
  });

/**
 * Create all tables, enums, and indexes if they don't exist.
 * This is safe to run repeatedly — uses IF NOT EXISTS everywhere.
 */
async function createSchema(sql: postgres.Sql) {
  // Create enums (safe to re-run — skips if they exist)
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
  console.log('  ✓ Enums');

  // Enable pgvector
  await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  console.log('  ✓ pgvector extension');

  // Sources table
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
  console.log('  ✓ sources');

  // Documents table
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
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS documents_source_id_idx ON documents(source_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS documents_canonical_url_idx ON documents(canonical_url)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS documents_version_hash_idx ON documents(version_hash)`);
  console.log('  ✓ documents');

  // Chunks table
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
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS chunks_document_id_idx ON chunks(document_id)`);
  console.log('  ✓ chunks');

  // Annotations table
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
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS annotations_document_id_idx ON annotations(document_id)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS annotations_chunk_id_idx ON annotations(chunk_id)`);
  console.log('  ✓ annotations');

  // Sync Jobs table
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
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS sync_jobs_source_id_idx ON sync_jobs(source_id)`);
  console.log('  ✓ sync_jobs');
}

/**
 * Add columns that may be missing from existing tables.
 * Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS (PostgreSQL 9.6+).
 * This is where new connector columns go so `db-push` without --force
 * can evolve the schema safely.
 */
async function migrateNewColumns(sql: postgres.Sql) {
  const migrations = [
    // local_folder columns (added v0.2.0)
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS folder_path text`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS folder_recursive boolean DEFAULT true`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS include_patterns json`,
    `ALTER TABLE sources ADD COLUMN IF NOT EXISTS exclude_patterns json`,
  ];

  let applied = 0;
  for (const m of migrations) {
    try {
      await sql.unsafe(m);
      applied++;
    } catch {
      // Column may already exist or migration may fail — safe to skip
    }
  }
  if (applied > 0) {
    console.log(`  ✓ Column migrations (${applied} checked)`);
  }
}

/**
 * Add enum values that may be missing from existing enums.
 * Uses a safe PL/pgSQL block that checks if the value exists first.
 */
async function migrateNewEnumValues(sql: postgres.Sql) {
  const newValues = [
    // local_folder source type (added v0.2.0)
    { enum: 'source_type', value: 'local_folder' },
  ];

  let applied = 0;
  for (const { enum: enumName, value } of newValues) {
    try {
      await sql.unsafe(`
        DO $$ BEGIN
          ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS '${value}';
        EXCEPTION WHEN duplicate_object THEN null;
        END $$
      `);
      applied++;
    } catch {
      // May already exist
    }
  }
  if (applied > 0) {
    console.log(`  ✓ Enum migrations (${applied} checked)`);
  }
}

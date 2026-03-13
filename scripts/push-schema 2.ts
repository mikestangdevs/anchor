import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require' });

async function pushSchema() {
  console.log('Pushing ACR schema to database...\n');

  // Create enums
  const enums = [
    `CREATE TYPE source_type AS ENUM ('docs_site','github_repo','supabase_view')`,
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
  console.log('✓ Enums created');

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
    trust_level trust_level NOT NULL DEFAULT 'community',
    status source_status NOT NULL DEFAULT 'active',
    sync_frequency_minutes integer NOT NULL DEFAULT 360,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  console.log('✓ sources table');

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
  console.log('✓ documents table');

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
  console.log('✓ chunks table');

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
  console.log('✓ annotations table');

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
  console.log('✓ sync_jobs table');

  await sql.end();
  console.log('\n✓ Schema push complete!');
}

pushSchema().catch((e) => {
  console.error('Schema push failed:', e.message);
  process.exit(1);
});

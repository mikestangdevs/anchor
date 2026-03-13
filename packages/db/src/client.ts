import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as sourcesSchema from './schema/sources.js';
import * as documentsSchema from './schema/documents.js';
import * as chunksSchema from './schema/chunks.js';
import * as annotationsSchema from './schema/annotations.js';
import * as syncJobsSchema from './schema/sync-jobs.js';

const schema = {
  ...sourcesSchema,
  ...documentsSchema,
  ...chunksSchema,
  ...annotationsSchema,
  ...syncJobsSchema,
};

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

/**
 * Get the database client.
 *
 * @param databaseUrl - Optional database URL. If provided on first call,
 *   it will be used to establish the connection. Subsequent calls ignore
 *   the parameter and return the cached client.
 *
 *   If not provided, falls back to getConfig().database.url (legacy behavior
 *   for worker/mcp-server code that already validated config).
 */
export function getDb(databaseUrl?: string) {
  if (_db) return _db;

  let url: string;
  if (databaseUrl) {
    url = databaseUrl;
  } else {
    // Legacy fallback — requires full config (DATABASE_URL + EMBEDDING_API_KEY)
    // This path is used by worker, mcp-server, and library code that calls getDb()
    // without a URL (e.g. @acr/annotations, @acr/retrieval).
    const { getConfig } = require('@acr/config');
    const config = getConfig();
    url = config.database.url;
  }

  // Detect Supabase or remote Postgres by URL pattern
  // Supabase connection strings use pooler.supabase.com or db.*.supabase.co
  const isRemote = url.includes('supabase') || url.includes('neon') || !url.includes('localhost');

  _client = postgres(url, {
    max: 10,
    // Enable SSL for remote connections (required by Supabase/Neon/etc.)
    ...(isRemote ? { ssl: 'require' } : {}),
    // Connection pooling mode — set prepare to false for Supabase/PgBouncer
    ...(url.includes('pooler.supabase') ? { prepare: false } : {}),
  });
  _db = drizzle(_client, { schema });

  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

export type Database = ReturnType<typeof getDb>;

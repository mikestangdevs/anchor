import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * List all public tables/views in a Supabase project.
 * Reads DATABASE_URL from .acr/config.json or falls back to DATABASE_URL env var.
 */
async function main() {
  // Resolve DATABASE_URL
  let dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    try {
      const configPath = resolve(process.cwd(), '.acr/config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      dbUrl = config.database_url;
    } catch {
      // try from repo root
      try {
        const configPath = resolve(__dirname, '../../../../.acr/config.json');
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        dbUrl = config.database_url;
      } catch {
        // ignore
      }
    }
  }

  if (!dbUrl) {
    console.error('No DATABASE_URL found. Set it in .acr/config.json or as an env var.');
    process.exit(1);
  }

  const isRemote = dbUrl.includes('supabase') || dbUrl.includes('neon') || !dbUrl.includes('localhost');
  const sql = postgres(dbUrl, {
    ssl: isRemote ? 'require' : undefined,
    onnotice: () => {},
    max: 1,
  });

  // List all public tables and views (excluding ACR internal tables)
  const acrTables = ['sources', 'documents', 'chunks', 'annotations', 'sync_jobs'];
  const rows = await sql`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type IN ('BASE TABLE', 'VIEW')
      AND table_name NOT IN ${sql(acrTables)}
    ORDER BY table_type, table_name
  `;

  if (rows.length === 0) {
    console.log('No tables or views found in public schema (excluding ACR tables).');
    await sql.end();
    return;
  }

  console.log('Public schema:\n');
  for (const r of rows) {
    console.log(`  ${r.table_type.padEnd(12)} ${r.table_name}`);
  }

  // Show columns and row counts for each table
  for (const t of rows) {
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${t.table_name}
      ORDER BY ordinal_position
    `;

    let countStr = '';
    try {
      const countResult = await sql.unsafe(`SELECT count(*) as n FROM "${t.table_name}"`);
      countStr = ` (${countResult[0].n} rows)`;
    } catch {
      countStr = ' (count failed)';
    }

    console.log(`\n--- ${t.table_name}${countStr} ---`);
    for (const c of cols) {
      // Highlight text columns that are good candidates for content fields
      const isText = ['text', 'character varying', 'jsonb'].includes(c.data_type);
      const marker = isText ? ' ←' : '';
      console.log(`  ${c.column_name} (${c.data_type})${marker}`);
    }
  }

  await sql.end();
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

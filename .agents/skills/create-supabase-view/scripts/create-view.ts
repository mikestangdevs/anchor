import postgres from 'postgres';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'util';

/**
 * Create a Supabase view suitable for use as an ACR supabase_view source.
 *
 * Usage:
 *   npx tsx create-view.ts \
 *     --table my_table \
 *     --view acr_my_table \
 *     --id-field id \
 *     --title-field name \
 *     --content-fields description,body \
 *     --metadata-fields category \
 *     --updated-at-field updated_at \
 *     --filter "status = 'published'"
 */
async function main() {
  const { values } = parseArgs({
    options: {
      table: { type: 'string' },
      view: { type: 'string' },
      'id-field': { type: 'string', default: 'id' },
      'title-field': { type: 'string', default: 'title' },
      'content-fields': { type: 'string' },
      'metadata-fields': { type: 'string' },
      'updated-at-field': { type: 'string' },
      filter: { type: 'string' },
      schema: { type: 'string', default: 'public' },
    },
    strict: true,
  });

  if (!values.table) {
    console.error('--table is required');
    process.exit(1);
  }

  const table = values.table;
  const viewName = values.view || `acr_${table}`;
  const schema = values.schema || 'public';
  const idField = values['id-field'] || 'id';
  const titleField = values['title-field'] || 'title';
  const contentFields = values['content-fields']?.split(',') || [];
  const metadataFields = values['metadata-fields']?.split(',') || [];
  const updatedAtField = values['updated-at-field'];
  const filter = values.filter;

  // Build SELECT columns
  const selectCols = [idField, titleField];
  selectCols.push(...contentFields);
  selectCols.push(...metadataFields);
  if (updatedAtField) selectCols.push(updatedAtField);

  // Deduplicate
  const uniqueCols = [...new Set(selectCols)];

  // Build WHERE clause
  const whereParts: string[] = [];
  for (const cf of contentFields) {
    whereParts.push(`${cf} IS NOT NULL AND ${cf} != ''`);
  }
  if (filter) {
    whereParts.push(`(${filter})`);
  }
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const ddl = `CREATE OR REPLACE VIEW ${schema}.${viewName} AS
    SELECT ${uniqueCols.join(', ')}
    FROM ${schema}.${table}
    ${whereClause}`;

  console.log('SQL:\n');
  console.log(ddl);
  console.log('');

  // Connect
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    try {
      const configPath = resolve(process.cwd(), '.acr/config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      dbUrl = config.database_url;
    } catch {
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

  await sql.unsafe(ddl);

  const count = await sql.unsafe(`SELECT count(*) as n FROM ${schema}.${viewName}`);
  console.log(`✓ View ${schema}.${viewName} created with ${count[0].n} rows`);
  console.log('');
  console.log('Next: add as ACR source:');
  console.log(`  acr add-source \\`);
  console.log(`    --name "..." --type supabase_view \\`);
  console.log(`    --supabase-view ${viewName} \\`);
  console.log(`    --supabase-title-field ${titleField} \\`);
  console.log(`    --supabase-content-fields ${contentFields.join(',')} \\`);
  if (metadataFields.length) {
    console.log(`    --supabase-metadata-fields ${metadataFields.join(',')} \\`);
  }
  if (updatedAtField) {
    console.log(`    --supabase-updated-at-field ${updatedAtField} \\`);
  }
  console.log(`    --trust-level official`);

  await sql.end();
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

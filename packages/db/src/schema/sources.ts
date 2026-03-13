import { pgTable, uuid, varchar, text, integer, json, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const sourceTypeEnum = pgEnum('source_type', ['docs_site', 'github_repo', 'supabase_view', 'local_folder']);
export const trustLevelEnum = pgEnum('trust_level', ['official', 'community']);
export const sourceStatusEnum = pgEnum('source_status', ['active', 'paused', 'error']);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  sourceType: sourceTypeEnum('source_type').notNull(),
  baseUrl: text('base_url'),
  // github_repo config
  githubOwner: varchar('github_owner', { length: 255 }),
  githubRepo: varchar('github_repo', { length: 255 }),
  githubBranch: varchar('github_branch', { length: 255 }).default('main'),
  githubDocsPath: varchar('github_docs_path', { length: 500 }).default('/'),
  // supabase_view config
  supabaseUrl: text('supabase_url'),
  supabaseServiceKey: text('supabase_service_key'),
  supabaseSchema: varchar('supabase_schema', { length: 255 }).default('public'),
  supabaseView: varchar('supabase_view', { length: 255 }),
  supabaseIdField: varchar('supabase_id_field', { length: 255 }).default('id'),
  supabaseTitleField: varchar('supabase_title_field', { length: 255 }).default('title'),
  supabaseContentFields: json('supabase_content_fields').$type<string[]>(),
  supabaseMetadataFields: json('supabase_metadata_fields').$type<string[]>(),
  supabaseUpdatedAtField: varchar('supabase_updated_at_field', { length: 255 }),
  // local_folder config
  folderPath: text('folder_path'),
  folderRecursive: boolean('folder_recursive').default(true),
  includePatterns: json('include_patterns').$type<string[]>(),
  excludePatterns: json('exclude_patterns').$type<string[]>(),
  // common
  trustLevel: trustLevelEnum('trust_level').notNull().default('community'),
  status: sourceStatusEnum('source_status').notNull().default('active'),
  syncFrequencyMinutes: integer('sync_frequency_minutes').notNull().default(360),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

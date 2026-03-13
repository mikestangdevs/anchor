import { pgTable, uuid, varchar, text, boolean, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { sources } from './sources.js';

export const contentTypeEnum = pgEnum('content_type', ['markdown', 'html', 'plain_text']);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 1000 }).notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  contentType: contentTypeEnum('content_type').notNull().default('markdown'),
  cleanedMarkdown: text('cleaned_markdown').notNull(),
  versionHash: varchar('version_hash', { length: 64 }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }).notNull().defaultNow(),
  isLatest: boolean('is_latest').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceIdx: index('documents_source_id_idx').on(table.sourceId),
  urlIdx: index('documents_canonical_url_idx').on(table.canonicalUrl),
  versionHashIdx: index('documents_version_hash_idx').on(table.versionHash),
}));

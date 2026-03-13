import { pgTable, uuid, varchar, text, real, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { documents } from './documents.js';
import { chunks } from './chunks.js';

export const annotationKindEnum = pgEnum('annotation_kind', [
  'workaround', 'warning', 'example', 'migration_note',
]);
export const authorTypeEnum = pgEnum('author_type', ['human', 'agent']);
export const moderationStatusEnum = pgEnum('moderation_status', [
  'pending', 'approved', 'rejected',
]);

export const annotations = pgTable('annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  chunkId: uuid('chunk_id').references(() => chunks.id, { onDelete: 'cascade' }),
  authorType: authorTypeEnum('author_type').notNull().default('human'),
  authorName: varchar('author_name', { length: 255 }),
  kind: annotationKindEnum('annotation_kind').notNull(),
  note: text('note').notNull(),
  confidence: real('confidence').notNull().default(0.8),
  status: moderationStatusEnum('moderation_status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentIdx: index('annotations_document_id_idx').on(table.documentId),
  chunkIdx: index('annotations_chunk_id_idx').on(table.chunkId),
}));

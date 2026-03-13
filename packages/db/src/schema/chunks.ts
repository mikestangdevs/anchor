import { pgTable, uuid, integer, varchar, text, real, timestamp, index, customType } from 'drizzle-orm/pg-core';
import { documents } from './documents.js';

/**
 * Custom pgvector column type for drizzle-orm.
 * Stores vectors as float arrays, serialized to pgvector literal format.
 */
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns strings like "[0.1,0.2,0.3]"
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  sectionTitle: varchar('section_title', { length: 500 }),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  tokenCount: integer('token_count').notNull(),
  qualityScore: real('quality_score').notNull().default(1.0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentIdx: index('chunks_document_id_idx').on(table.documentId),
}));

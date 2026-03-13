import { pgTable, uuid, text, timestamp, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';
import { sources } from './sources.js';

export const syncJobTypeEnum = pgEnum('sync_job_type', ['full', 'incremental']);
export const syncJobStatusEnum = pgEnum('sync_job_status', [
  'pending', 'running', 'completed', 'failed',
]);

export const syncJobs = pgTable('sync_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  jobType: syncJobTypeEnum('sync_job_type').notNull().default('full'),
  status: syncJobStatusEnum('sync_job_status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  statsJson: jsonb('stats_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceIdx: index('sync_jobs_source_id_idx').on(table.sourceId),
}));

// @acr/db — database schema, client, and type exports

export { getDb, closeDb, type Database } from './client.js';

// Schema exports
export { sources, sourceTypeEnum, trustLevelEnum, sourceStatusEnum } from './schema/sources.js';
export { documents, contentTypeEnum } from './schema/documents.js';
export { chunks } from './schema/chunks.js';
export {
  annotations,
  annotationKindEnum,
  authorTypeEnum,
  moderationStatusEnum,
} from './schema/annotations.js';
export {
  syncJobs,
  syncJobTypeEnum,
  syncJobStatusEnum,
} from './schema/sync-jobs.js';

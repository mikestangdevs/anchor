// =========================================================
// @acr/types — shared TypeScript interfaces and type literals
// =========================================================

// ---------- Enums / Literal Unions ----------

export type SourceType = 'docs_site' | 'github_repo' | 'supabase_view' | 'local_folder';
export type TrustLevel = 'official' | 'community';
export type SourceStatus = 'active' | 'paused' | 'error';
export type ContentType = 'markdown' | 'html' | 'plain_text';
export type AnnotationKind = 'workaround' | 'warning' | 'example' | 'migration_note';
export type AuthorType = 'human' | 'agent';
export type ModerationStatus = 'pending' | 'approved' | 'rejected';
export type SyncJobType = 'full' | 'incremental';
export type SyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

// ---------- Domain Models ----------

export interface Source {
  id: string;
  name: string;
  sourceType: SourceType;
  baseUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  githubDocsPath: string | null;
  // supabase_view config
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  supabaseSchema: string | null;
  supabaseView: string | null;
  supabaseIdField: string | null;
  supabaseTitleField: string | null;
  supabaseContentFields: string[] | null;
  supabaseMetadataFields: string[] | null;
  supabaseUpdatedAtField: string | null;
  // local_folder config
  folderPath: string | null;
  folderRecursive: boolean | null;
  includePatterns: string[] | null;
  excludePatterns: string[] | null;
  trustLevel: TrustLevel;
  status: SourceStatus;
  syncFrequencyMinutes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: string;
  sourceId: string;
  title: string;
  canonicalUrl: string;
  contentType: ContentType;
  cleanedMarkdown: string;
  versionHash: string;
  lastSeenAt: Date;
  lastVerifiedAt: Date;
  isLatest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  sectionTitle: string | null;
  text: string;
  embedding: number[] | null;
  tokenCount: number;
  qualityScore: number;
  createdAt: Date;
}

export interface Annotation {
  id: string;
  documentId: string | null;
  chunkId: string | null;
  authorType: AuthorType;
  authorName: string | null;
  kind: AnnotationKind;
  note: string;
  confidence: number;
  status: ModerationStatus;
  createdAt: Date;
}

export interface SyncJob {
  id: string;
  sourceId: string;
  jobType: SyncJobType;
  status: SyncJobStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
  statsJson: Record<string, unknown> | null;
  createdAt: Date;
}

// ---------- Connector Contracts ----------

export interface RawPage {
  url: string;
  title: string;
  rawHtml?: string;
  rawMarkdown?: string;
  contentType: ContentType;
  fetchedAt: Date;
}

export interface ConnectorResult {
  pages: RawPage[];
  stats: {
    fetched: number;
    skipped: number;
    errors: number;
  };
}

// ---------- Retrieval Contracts ----------

export interface SearchRequest {
  query: string;
  sourceFilter?: string;
  maxResults?: number;
  latestOnly?: boolean;
}

export interface CitationRef {
  documentTitle: string;
  canonicalUrl: string;
  sourceName: string;
  sourceType: SourceType;
  trustLevel: TrustLevel;
  lastVerifiedAt: Date;
  isLatest: boolean;
}

export interface SearchResult {
  chunkId: string;
  chunkText: string;
  sectionTitle: string | null;
  score: number;
  citation: CitationRef;
  annotations: Annotation[];
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalCandidates: number;
}

// ---------- Provider Abstractions ----------
// Core business logic depends only on these interfaces.
// Provider-specific code (OpenAI, Cohere, local models, etc.)
// lives behind adapters that implement these contracts.

/**
 * Embedding provider abstraction.
 * Converts text into dense vector representations.
 * One concrete implementation ships per deployment for v1.
 */
export interface EmbeddingProvider {
  /** Embed one or more texts into vectors. Order of output matches input. */
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensionality of the output vectors. */
  readonly dimensions: number;
  /** Human-readable model identifier (e.g. "text-embedding-3-small"). */
  readonly modelName: string;
}

/**
 * Reranker provider abstraction (v2+).
 * Takes candidate chunks and a query, returns refined ranking scores.
 * Not implemented in v1 — interface-first for future providers.
 */
export interface RerankerProvider {
  /** Rerank candidate texts against a query. Returns scores in input order. */
  rerank(query: string, candidates: string[]): Promise<RerankerResult[]>;
  /** Human-readable model identifier. */
  readonly modelName: string;
}

export interface RerankerResult {
  /** Index into the original candidates array. */
  index: number;
  /** Relevance score (higher = more relevant). Scale is provider-dependent. */
  relevanceScore: number;
}

/**
 * Extraction/summarization provider abstraction (v2+).
 * Used for content summarization, entity extraction, or quality scoring.
 * Not implemented in v1 — interface-first for future providers.
 */
export interface ExtractionProvider {
  /** Summarize a text block. */
  summarize(text: string, maxLength?: number): Promise<string>;
  /** Extract key entities or concepts from text. */
  extractEntities(text: string): Promise<ExtractedEntity[]>;
  /** Human-readable model identifier. */
  readonly modelName: string;
}

export interface ExtractedEntity {
  name: string;
  kind: string;
  confidence: number;
}

/**
 * Provider configuration — allows config-driven provider swapping
 * without changing business logic code.
 */
export type EmbeddingProviderType = 'openai' | string;
export type RerankerProviderType = 'none' | 'cohere' | string;
export type ExtractionProviderType = 'none' | 'openai' | string;

export interface ProviderConfig {
  embedding: {
    provider: EmbeddingProviderType;
    model: string;
    apiKey: string;
    /** Provider-specific options (e.g. base URL for self-hosted). */
    options?: Record<string, unknown>;
  };
  reranker: {
    provider: RerankerProviderType;
    model?: string;
    apiKey?: string;
    options?: Record<string, unknown>;
  };
  extraction: {
    provider: ExtractionProviderType;
    model?: string;
    apiKey?: string;
    options?: Record<string, unknown>;
  };
}

// ---------- Chunking Output ----------

export interface ChunkOutput {
  chunkIndex: number;
  sectionTitle: string | null;
  text: string;
  tokenCount: number;
}

// ---------- Normalization Output ----------

export interface NormalizedDocument {
  title: string;
  cleanedMarkdown: string;
  versionHash: string;
  contentType: ContentType;
}

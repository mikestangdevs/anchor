import type { SourceType, RawPage, ConnectorResult } from '@acr/types';

/**
 * Abstract base class for source connectors.
 * Each connector knows how to fetch raw pages from its source type.
 */
export abstract class BaseConnector {
  abstract sourceType: SourceType;

  /**
   * Fetch all pages from the source.
   * Returns raw HTML or markdown pages with metadata.
   */
  abstract fetch(config: ConnectorConfig): Promise<ConnectorResult>;
}

export interface ConnectorConfig {
  // Common
  sourceId: string;
  name: string;

  // docs_site
  baseUrl?: string;
  maxPages?: number;
  maxDepth?: number;

  // github_repo
  githubOwner?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubDocsPath?: string;
  githubToken?: string;

  // supabase_view
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  supabaseSchema?: string;
  supabaseView?: string;
  supabaseIdField?: string;
  supabaseTitleField?: string;
  supabaseContentFields?: string[];
  supabaseMetadataFields?: string[];
  supabaseUpdatedAtField?: string;

  // local_folder
  folderPath?: string;
  folderRecursive?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

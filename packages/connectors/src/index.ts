import type { SourceType } from '@acr/types';
import { BaseConnector, type ConnectorConfig } from './base.js';
import { DocsSiteConnector } from './docs-site.js';
import { GitHubRepoConnector } from './github-repo.js';
import { SupabaseViewConnector } from './supabase-view.js';
import { LocalFolderConnector } from './local-folder.js';

export { BaseConnector, type ConnectorConfig } from './base.js';
export { DocsSiteConnector } from './docs-site.js';
export { GitHubRepoConnector } from './github-repo.js';
export { SupabaseViewConnector } from './supabase-view.js';
export { LocalFolderConnector } from './local-folder.js';

const connectorRegistry = new Map<SourceType, () => BaseConnector>();

connectorRegistry.set('docs_site', () => new DocsSiteConnector());
connectorRegistry.set('github_repo', () => new GitHubRepoConnector());
connectorRegistry.set('supabase_view', () => new SupabaseViewConnector());
connectorRegistry.set('local_folder', () => new LocalFolderConnector());

/**
 * Get a connector instance for a source type.
 */
export function getConnector(sourceType: SourceType): BaseConnector {
  const factory = connectorRegistry.get(sourceType);
  if (!factory) {
    throw new Error(`No connector registered for source type: ${sourceType}`);
  }
  return factory();
}

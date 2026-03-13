import { config } from 'dotenv';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import type { ProviderConfig } from '@acr/types';

// ─── Config File Model ──────────────────────────────────────────
// Project-local config lives in .acr/config.json
// Values can be overridden by environment variables.
// The config file is optional — env vars alone are sufficient.

export interface AcrConfigFile {
  database_url?: string;
  embedding_provider?: string;
  embedding_model?: string;
  embedding_api_key?: string;
  embedding_base_url?: string;
  reranker_provider?: string;
  extraction_provider?: string;
  github_token?: string;
  sync_poll_interval_ms?: number;
  max_crawl_pages?: number;
  max_crawl_depth?: number;
}

export interface AcrConfig {
  database: {
    url: string;
  };
  providers: ProviderConfig;
  github: {
    token: string | undefined;
  };
  worker: {
    syncPollIntervalMs: number;
    maxCrawlPages: number;
    maxCrawlDepth: number;
  };
}

// ─── Base Config (no throwing) ──────────────────────────────────
// All fields optional — for commands that need partial config.

export interface BaseConfig {
  databaseUrl?: string;
  embedding: {
    provider: string;
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  reranker: { provider: string };
  extraction: { provider: string };
  github: { token?: string };
  worker: {
    syncPollIntervalMs: number;
    maxCrawlPages: number;
    maxCrawlDepth: number;
  };
}

// ─── Config Discovery ───────────────────────────────────────────

const ACR_DIR = '.acr';
const CONFIG_FILENAME = 'config.json';

/**
 * Find the project root by walking up from cwd looking for .acr/
 * Falls back to cwd if not found.
 */
export function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, ACR_DIR))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Get the .acr directory path for the current project.
 */
export function getAcrDir(): string {
  return join(findProjectRoot(), ACR_DIR);
}

/**
 * Get the config file path.
 */
export function getConfigFilePath(): string {
  return join(getAcrDir(), CONFIG_FILENAME);
}

/**
 * Check if .acr/config.json exists.
 */
export function configFileExists(): boolean {
  return existsSync(getConfigFilePath());
}

/**
 * Load the config file. Returns empty object if not found.
 */
function loadConfigFile(): AcrConfigFile {
  const path = getConfigFilePath();
  if (!existsSync(path)) return {};

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as AcrConfigFile;
  } catch {
    return {};
  }
}

/**
 * Create the .acr directory and write an initial config file.
 * Called by `acr init`.
 *
 * Uses placeholder values instead of localhost defaults to avoid
 * suggesting an incorrect setup.
 */
export function writeConfigFile(overrides: Partial<AcrConfigFile> = {}): string {
  const acrDir = join(process.cwd(), ACR_DIR);
  if (!existsSync(acrDir)) {
    mkdirSync(acrDir, { recursive: true });
  }

  const defaults: AcrConfigFile = {
    database_url: process.env.DATABASE_URL ?? '<YOUR_DATABASE_URL>',
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-3-small',
    embedding_api_key: process.env.EMBEDDING_API_KEY ?? '<YOUR_EMBEDDING_API_KEY>',
    github_token: process.env.GITHUB_TOKEN ?? '',
  };

  const configData = { ...defaults, ...overrides };
  const filePath = join(acrDir, CONFIG_FILENAME);
  writeFileSync(filePath, JSON.stringify(configData, null, 2) + '\n');
  return filePath;
}

// ─── Env + Config Unified Loading ───────────────────────────────

/**
 * Resolve a config value: env var > config file > default.
 */
function resolveValue(envKey: string, fileValue: string | number | undefined, defaultValue?: string): string | undefined {
  return process.env[envKey] ?? (fileValue != null ? String(fileValue) : undefined) ?? defaultValue;
}

function resolveInt(envKey: string, fileValue: number | undefined, defaultValue: number): number {
  const raw = process.env[envKey] ?? (fileValue != null ? String(fileValue) : undefined);
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if a resolved value is a real value vs a placeholder.
 */
function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return value.startsWith('<') && value.endsWith('>');
}

let _baseConfig: BaseConfig | null = null;

/**
 * Load base config without throwing on missing required values.
 * Safe for all commands to call — returns all fields as optional.
 *
 * Resolution order:
 * 1. Environment variables (highest priority)
 * 2. .acr/config.json (project-local)
 * 3. .env file in cwd (loaded by dotenv)
 * 4. Built-in defaults
 */
export function loadBaseConfig(): BaseConfig {
  if (_baseConfig) return _baseConfig;

  // Load .env from cwd (lowest priority, dotenv won't override existing env vars)
  config({ path: resolve(process.cwd(), '.env') });

  // Load project-local config file
  const file = loadConfigFile();

  const databaseUrl = resolveValue('DATABASE_URL', file.database_url);
  const embeddingApiKey = resolveValue('EMBEDDING_API_KEY', file.embedding_api_key);

  _baseConfig = {
    databaseUrl: databaseUrl && !isPlaceholder(databaseUrl) ? databaseUrl : undefined,
    embedding: {
      provider: resolveValue('EMBEDDING_PROVIDER', file.embedding_provider, 'openai')!,
      model: resolveValue('EMBEDDING_MODEL', file.embedding_model, 'text-embedding-3-small')!,
      apiKey: embeddingApiKey && !isPlaceholder(embeddingApiKey) ? embeddingApiKey : undefined,
      baseUrl: resolveValue('EMBEDDING_BASE_URL', file.embedding_base_url),
    },
    reranker: { provider: resolveValue('RERANKER_PROVIDER', file.reranker_provider, 'none')! },
    extraction: { provider: resolveValue('EXTRACTION_PROVIDER', file.extraction_provider, 'none')! },
    github: { token: resolveValue('GITHUB_TOKEN', file.github_token) },
    worker: {
      syncPollIntervalMs: resolveInt('SYNC_POLL_INTERVAL_MS', file.sync_poll_interval_ms, 60_000),
      maxCrawlPages: resolveInt('MAX_CRAWL_PAGES', file.max_crawl_pages, 500),
      maxCrawlDepth: resolveInt('MAX_CRAWL_DEPTH', file.max_crawl_depth, 3),
    },
  };

  return _baseConfig;
}

// ─── Command-Specific Validators ────────────────────────────────

/**
 * Require DATABASE_URL for a specific command.
 * Throws a command-specific error if not configured.
 */
export function requireDatabaseUrl(commandName: string): string {
  const base = loadBaseConfig();
  if (!base.databaseUrl) {
    throw new Error(
      `\`${commandName}\` requires DATABASE_URL but it is not configured.\n` +
      `  Set DATABASE_URL in your environment, .acr/config.json, or .env file.\n` +
      `  Example: DATABASE_URL=postgresql://user:pass@host:5432/dbname`
    );
  }
  return base.databaseUrl;
}

/**
 * Require embedding provider config for a specific command.
 * Throws a command-specific error if not configured.
 */
export function requireEmbeddingConfig(commandName: string): {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
} {
  const base = loadBaseConfig();
  if (!base.embedding.apiKey) {
    throw new Error(
      `\`${commandName}\` requires an embedding provider but EMBEDDING_API_KEY is not configured.\n` +
      `  Set EMBEDDING_API_KEY in your environment, .acr/config.json, or .env file.`
    );
  }
  return {
    provider: base.embedding.provider,
    model: base.embedding.model,
    apiKey: base.embedding.apiKey,
    baseUrl: base.embedding.baseUrl,
  };
}

// ─── Legacy getConfig() — backward compat ───────────────────────

let _config: AcrConfig | null = null;

/**
 * Get the full unified config (legacy).
 *
 * This throws if DATABASE_URL or EMBEDDING_API_KEY are missing.
 * Preferred for worker/mcp-server where all subsystems are needed.
 *
 * For CLI commands, use requireDatabaseUrl() / requireEmbeddingConfig()
 * directly so errors are command-specific.
 */
export function getConfig(): AcrConfig {
  if (_config) return _config;

  const dbUrl = requireDatabaseUrl('getConfig');
  const embeddingConfig = requireEmbeddingConfig('getConfig');
  const base = loadBaseConfig();

  _config = {
    database: {
      url: dbUrl,
    },
    providers: {
      embedding: {
        provider: embeddingConfig.provider,
        model: embeddingConfig.model,
        apiKey: embeddingConfig.apiKey,
        options: {
          baseUrl: embeddingConfig.baseUrl,
        },
      },
      reranker: {
        provider: base.reranker.provider,
      },
      extraction: {
        provider: base.extraction.provider,
      },
    },
    github: {
      token: base.github.token,
    },
    worker: base.worker,
  };

  return _config;
}

/**
 * Load config without throwing on missing required values.
 * Used by `acr doctor` to inspect partial config state.
 */
export function getConfigSafe(): { config: Partial<AcrConfig>; errors: string[] } {
  const base = loadBaseConfig();
  const errors: string[] = [];

  if (!base.databaseUrl) errors.push('DATABASE_URL is not set');
  if (!base.embedding.apiKey) errors.push('EMBEDDING_API_KEY is not set');

  return {
    config: {
      database: base.databaseUrl ? { url: base.databaseUrl } : undefined,
      providers: {
        embedding: {
          provider: base.embedding.provider,
          model: base.embedding.model,
          apiKey: base.embedding.apiKey ?? '',
          options: { baseUrl: base.embedding.baseUrl },
        },
        reranker: { provider: base.reranker.provider },
        extraction: { provider: base.extraction.provider },
      },
      github: { token: base.github.token },
    },
    errors,
  };
}

/**
 * Reset the config cache. Useful for testing.
 */
export function resetConfig(): void {
  _config = null;
  _baseConfig = null;
}

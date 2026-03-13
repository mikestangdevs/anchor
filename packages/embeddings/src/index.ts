import type { EmbeddingProvider, RerankerProvider, ExtractionProvider, ProviderConfig } from '@acr/types';
import { getConfig } from '@acr/config';
import { OpenAIEmbeddingAdapter } from './openai.js';

// Re-export interfaces for consumer convenience (but never concrete classes)
export type { EmbeddingProvider, RerankerProvider, ExtractionProvider } from '@acr/types';

// ─── Embedding Provider Factory ─────────────────────────────────

type EmbeddingAdapterFactory = (config: ProviderConfig['embedding']) => EmbeddingProvider;

const embeddingAdapters = new Map<string, EmbeddingAdapterFactory>();

/**
 * Register an embedding adapter for a provider type.
 * Called at module load for built-in adapters, can be called
 * externally to add custom providers.
 */
export function registerEmbeddingAdapter(providerType: string, factory: EmbeddingAdapterFactory): void {
  embeddingAdapters.set(providerType, factory);
}

// Register built-in adapters
registerEmbeddingAdapter('openai', (config) => new OpenAIEmbeddingAdapter({
  apiKey: config.apiKey,
  model: config.model,
  baseUrl: config.options?.baseUrl as string | undefined,
}));

let _embeddingProvider: EmbeddingProvider | null = null;

/**
 * Get the configured embedding provider.
 * Resolves provider type from config, instantiates the correct adapter.
 * Singleton per process — one embedding space per deployment.
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (_embeddingProvider) return _embeddingProvider;

  const config = getConfig();
  const providerType = config.providers.embedding.provider;
  const factory = embeddingAdapters.get(providerType);

  if (!factory) {
    const available = Array.from(embeddingAdapters.keys()).join(', ');
    throw new Error(
      `Unknown embedding provider: "${providerType}". Available: ${available}. ` +
      `Set EMBEDDING_PROVIDER to one of: ${available}`
    );
  }

  _embeddingProvider = factory(config.providers.embedding);
  return _embeddingProvider;
}

// ─── Reranker Provider Factory ──────────────────────────────────

type RerankerAdapterFactory = (config: ProviderConfig['reranker']) => RerankerProvider;

const rerankerAdapters = new Map<string, RerankerAdapterFactory>();

export function registerRerankerAdapter(providerType: string, factory: RerankerAdapterFactory): void {
  rerankerAdapters.set(providerType, factory);
}

let _rerankerProvider: RerankerProvider | null | undefined = undefined;

/**
 * Get the configured reranker provider, if any.
 * Returns null if provider is set to "none".
 */
export function getRerankerProvider(): RerankerProvider | null {
  if (_rerankerProvider !== undefined) return _rerankerProvider;

  const config = getConfig();
  const providerType = config.providers.reranker.provider;

  if (providerType === 'none') {
    _rerankerProvider = null;
    return null;
  }

  const factory = rerankerAdapters.get(providerType);
  if (!factory) {
    const available = Array.from(rerankerAdapters.keys()).join(', ');
    throw new Error(
      `Unknown reranker provider: "${providerType}". Available: none, ${available}`
    );
  }

  _rerankerProvider = factory(config.providers.reranker);
  return _rerankerProvider;
}

// ─── Extraction Provider Factory ────────────────────────────────

type ExtractionAdapterFactory = (config: ProviderConfig['extraction']) => ExtractionProvider;

const extractionAdapters = new Map<string, ExtractionAdapterFactory>();

export function registerExtractionAdapter(providerType: string, factory: ExtractionAdapterFactory): void {
  extractionAdapters.set(providerType, factory);
}

let _extractionProvider: ExtractionProvider | null | undefined = undefined;

/**
 * Get the configured extraction provider, if any.
 * Returns null if provider is set to "none".
 */
export function getExtractionProvider(): ExtractionProvider | null {
  if (_extractionProvider !== undefined) return _extractionProvider;

  const config = getConfig();
  const providerType = config.providers.extraction.provider;

  if (providerType === 'none') {
    _extractionProvider = null;
    return null;
  }

  const factory = extractionAdapters.get(providerType);
  if (!factory) {
    const available = Array.from(extractionAdapters.keys()).join(', ');
    throw new Error(
      `Unknown extraction provider: "${providerType}". Available: none, ${available}`
    );
  }

  _extractionProvider = factory(config.providers.extraction);
  return _extractionProvider;
}

// ─── Reset (for testing) ────────────────────────────────────────

/**
 * Reset all cached provider instances.
 * Useful for testing with different configurations.
 */
export function resetProviders(): void {
  _embeddingProvider = null;
  _rerankerProvider = undefined;
  _extractionProvider = undefined;
}

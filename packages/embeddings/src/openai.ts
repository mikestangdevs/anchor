import OpenAI from 'openai';
import type { EmbeddingProvider } from '@acr/types';

const BATCH_SIZE = 100;

/**
 * OpenAI embedding adapter.
 *
 * This is an adapter that wraps the OpenAI SDK behind the
 * provider-agnostic EmbeddingProvider interface.
 * No business logic code should import this class directly —
 * use createEmbeddingProvider() from the package root instead.
 *
 * Supports any OpenAI-compatible API (Azure, local models, etc.)
 * via the baseUrl option.
 */
export class OpenAIEmbeddingAdapter implements EmbeddingProvider {
  private client: OpenAI;
  public readonly dimensions: number;
  public readonly modelName: string;

  constructor(config: {
    apiKey: string;
    model: string;
    baseUrl?: string;
  }) {
    this.modelName = config.model;
    this.dimensions = this.resolveDimensions(config.model);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  /**
   * Embed an array of texts. Automatically batches large inputs.
   * Output order matches input order.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.client.embeddings.create({
        model: this.modelName,
        input: batch,
      });

      // Sort by index to ensure order matches input
      const sorted = response.data.sort((a, b) => a.index - b.index);
      for (const item of sorted) {
        allEmbeddings.push(item.embedding);
      }
    }

    return allEmbeddings;
  }

  /**
   * Resolve vector dimensions for known OpenAI models.
   * Falls back to 1536 for unknown models.
   */
  private resolveDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    return dimensionMap[model] ?? 1536;
  }
}

/**
 * LRU cache for query embeddings with in-flight deduplication.
 *
 * When multiple agents send the same query concurrently:
 *   1. First request misses cache → starts embedding
 *   2. Subsequent identical requests await the same in-flight promise
 *   3. Result is cached for future requests
 *
 * This eliminates redundant OpenAI API calls in federated search.
 */
export class EmbedCache {
  private cache = new Map<string, { embedding: number[]; expiresAt: number }>();
  private inflight = new Map<string, Promise<number[]>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  public hits = 0;
  public misses = 0;
  public deduped = 0;

  constructor(opts?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = opts?.maxEntries ?? 200;
    this.ttlMs = opts?.ttlMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  /**
   * Get or compute an embedding for a query string.
   *
   * @param query - The raw query text
   * @param embedFn - Function that calls the embedding provider
   * @returns The embedding vector
   */
  async getOrEmbed(
    query: string,
    embedFn: (text: string) => Promise<number[]>,
  ): Promise<number[]> {
    const key = query.trim().toLowerCase();

    // 1. Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.hits++;
      return cached.embedding;
    }
    // Clean up expired entry
    if (cached) this.cache.delete(key);

    // 2. Check in-flight (singleflight dedup)
    const pending = this.inflight.get(key);
    if (pending) {
      this.deduped++;
      return pending;
    }

    // 3. Start embedding and register as in-flight
    this.misses++;
    const promise = embedFn(key).then((embedding) => {
      // Store in cache
      this.evictIfNeeded();
      this.cache.set(key, { embedding, expiresAt: Date.now() + this.ttlMs });
      // Clear in-flight
      this.inflight.delete(key);
      return embedding;
    }).catch((err) => {
      // Clear in-flight on error so next request retries
      this.inflight.delete(key);
      throw err;
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Remove oldest entries if over capacity. */
  private evictIfNeeded() {
    while (this.cache.size >= this.maxEntries) {
      // Map iteration order = insertion order → oldest first
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  get size() { return this.cache.size; }
  get inflightCount() { return this.inflight.size; }

  stats() {
    return {
      size: this.cache.size,
      inflight: this.inflight.size,
      hits: this.hits,
      misses: this.misses,
      deduped: this.deduped,
      hitRate: this.hits + this.misses > 0
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}

export { normalize } from './normalizer.js';
export {
  chunkMarkdown,
  estimateTokens,
  enforceChunkSafety,
  EMBED_HARD_MAX_TOKENS,
  EMBED_SAFE_MAX_TOKENS,
  CHARS_PER_TOKEN,
  MAX_CHUNK_TOKENS,
} from './chunker.js';
export { computeVersionHash, hasContentChanged } from './dedup.js';
export { Semaphore } from './semaphore.js';
export { EmbedCache } from './embed-cache.js';

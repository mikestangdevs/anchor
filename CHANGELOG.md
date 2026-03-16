# Changelog

## 0.1.0-beta.3 (2026-03-16)

### Added
- **`acr status`** — system-wide health dashboard showing all sources with doc/chunk counts, last sync, freshness (✓ fresh / ⚠ stale / ✗ error), next sync due, and actionable tips; supports `--json`
- **`acr quickstart`** — loads a curated "Agent Stack" source pack (MCP Docs, OpenAI Agents SDK, LangGraph, Vercel AI SDK) in one command; idempotent (skips existing sources), syncs only newly added sources, continues past failures, runs a sample search on success; supports `--yes`, `--force`, `--json`
- **MCP HTTP transport mode** — `acr run-mcp --http` starts a single shared server for multi-agent use, replacing the per-agent process model that exhausted DB connections at 5+ agents
  - Session-aware transport with idle timeout (10min), max age (1hr), and periodic cleanup
  - Configurable port via `--port` or `ACR_MCP_PORT` (default: 3100)
- **Embedding concurrency limiter** — caps concurrent OpenAI embed calls (default: 3, configurable via `ACR_EMBED_CONCURRENCY`) with 30s timeout and clean error on overload
- **Embedding query cache** — LRU cache (200 entries, 5min TTL) with in-flight deduplication; identical concurrent queries share a single API call
- **Per-request metrics logging** in HTTP mode: query, latency, cache hit rate, active sessions, embed queue depth
- **Sync progress indicator** — real-time progress during crawl (`N pages fetched, M queued`) and processing (`[processed/total]` with status), sync duration logged on completion
- **Chunk safety pipeline** — 4-stage fallback ensures all chunks satisfy OpenAI's 8192-token limit: smart split → paragraph split → line split → hard truncation
- **Load test harness** — `scripts/load-test-mcp.mjs` for testing 1/5/10/20 concurrent agents with p50/p95/error-rate reporting
- `packages/core/src/semaphore.ts` — reusable async semaphore with timeout
- `packages/core/src/embed-cache.ts` — reusable LRU cache with singleflight dedup
- 27 new unit tests across chunker safety and search formatting

### Improved
- **`acr source inspect` enhanced** — now shows searchability status (✓/✗ with reason), chunk safety stats (split/truncated counts), next sync due with overdue warning, and last error if the most recent sync failed
- **Golden path help text** — `acr --help` now shows quick start flows (solo/dev, agents, demo) and mode guidance (stdio vs HTTP MCP); description updated to "the context layer for agents"
- **`acr search` output overhauled** — results grouped at the document level (one result per doc), 800-char previews with word-aware truncation, `→ acr get-document <id>` on every result
- **Delete/resync 100x faster** — batched SQL deletes replace row-by-row cascades; stale marking uses single `UPDATE ... WHERE IN` instead of per-row loops; per-phase timing logged
- **DB pool default reduced** from 10 → 5 connections, configurable via `ACR_DB_POOL_SIZE`
- Similarity confidence floor raised (0.20 → 0.35), over-fetch multiplier reduced (5× → 3×)
- Token estimation tightened (`CHARS_PER_TOKEN` 3.5 → 2.5) for dense code-heavy content

### Fixed
- Oversized chunks no longer crash the embedding API — enforced across all connectors
- MCP server ESM compatibility — eager DB init prevents `Dynamic require` errors in bundled context
- Session ID lifecycle corrected — stored after `handleRequest()`, not `connect()`

---

## 0.1.0-beta.2 (2026-03-13)

### Added
- **Sync diffing across all connectors** — every connector now computes a content hash per document and compares it against previously synced state
- Unchanged docs are skipped during sync — no re-embedding, no wasted API calls
- Changed docs are updated in place and re-chunked cleanly — old chunks are removed before new ones are inserted
- Deleted docs (present in DB but absent from source) are marked stale and excluded from search results

### Improved
- Repeated syncs are now significantly faster and cheaper
- Sync output clearly reports processed, changed, unchanged, skipped, and stale document counts

---

## 0.1.0-beta.1 (2026-03-10)

Initial public beta.

- CLI with `init`, `db-push`, `doctor`, `add-source`, `list-sources`, `sync`, `search` commands
- Connectors: `github_repo`, `docs_site`, `supabase_view`, `local_folder`
- Embedding via OpenAI `text-embedding-3-small`
- pgvector-powered semantic search with citation metadata
- MCP server for agent integration
- Branded terminal splash on `acr init`

# Changelog

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

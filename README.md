# Anchor

```
░█████╗░███╗░░██╗░█████╗░██╗░░██╗░█████╗░██████╗
██╔══██╗████╗░██║██╔══██╗██║░░██║██╔══██╗██╔══██╗
███████║██╔██╗██║██║░░╚═╝███████║██║░░██║██████╔╝
██╔══██║██║╚████║██║░░██╗██╔══██║██║░░██║██╔══██╗
██║░░██║██║░╚███║╚█████╔╝██║░░██║╚█████╔╝██║░░██║
╚═╝░░╚═╝╚═╝░░╚══╝░╚════╝░╚═╝░░╚═╝░╚════╝░╚═╝░░╚═╝
```

**The context layer for agents.**
Give agents a fresh, queryable, source-aware context plane they can reliably use.

Coding agents hallucinate APIs and work without context. Anchor gives them curated, searchable docs from your actual sources — local files, websites, GitHub repos, databases — with citations they can trust. Everything flows through a CLI and MCP server built for agents.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/anchor-acr)](https://www.npmjs.com/package/anchor-acr)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

## Quick Start

```bash
npm install -g anchor-acr
acr setup                             # bootstrap workspace
acr doctor                            # verify setup
```

You'll need a Postgres database with pgvector ([Supabase](https://supabase.com) free tier works) and an embedding API key (OpenAI default, any compatible provider supported).

**Fastest path — load the starter pack:**

```bash
acr quickstart --yes                  # loads MCP, OpenAI Agents, LangGraph, Vercel AI SDK
acr status                            # check health
acr search "how do agents use tools"
```

**Manual setup:**

```bash
acr db-push                           # create tables
acr doctor                            # all 7 checks should pass ✓
```

## Add Sources

Point Anchor at your docs. It handles the rest — fetch, chunk, embed, store.

```bash
# Local files (easiest, zero auth)
acr source add --name "My Docs" --type local_folder --folder-path ./docs
acr sync --source "My Docs"
acr search "deployment guide"

# Any public docs site
acr source add --name "React" --type docs_site --url https://react.dev/reference
acr sync --source "React"
acr search "useEffect cleanup"

# GitHub repo
acr source add --name "Drizzle" --type github_repo \
  --github-owner drizzle-team --github-repo drizzle-orm --github-docs-path docs

# Supabase view
acr source add --name "Knowledge Base" --type supabase_view \
  --supabase-url https://<ref>.supabase.co --supabase-service-key "eyJ..." \
  --supabase-view kb_articles --supabase-content-fields body
```

## Source Types

| Type | What it indexes | Auth |
|------|----------------|------|
| `local_folder` | Files on disk (.md, .txt, .json, .mdx) | None |
| `docs_site` | Public docs websites (HTML → markdown) | None |
| `github_repo` | Markdown files from a GitHub repo | Optional PAT |
| `supabase_view` | Rows from a Supabase database view | Service role key |

## Commands

| Command | Purpose |
|---------|---------|
| `acr setup` | Bootstrap a new workspace (interactive) |
| `acr init` | Create config file and print setup steps |
| `acr db-push` | Create or migrate database schema |
| `acr doctor` | Health check — shows what's wrong and how to fix it |
| `acr status` | System-wide health dashboard — source freshness, sync state, doc/chunk counts |
| `acr quickstart` | Load a curated starter pack and run a demo search |
| `acr source add` | Register a new source |
| `acr source list` | List all sources |
| `acr source inspect <name>` | Diagnostics: config, sync stats, searchability, chunk safety |
| `acr source delete <name>` | Delete a source and all its data |
| `acr sync --source <name>` | Sync one source (`--all` for everything) |
| `acr search <query>` | Semantic search — returns one result per doc with citations |
| `acr get-document <id>` | Fetch the full content of a document by ID |
| `acr annotate <id>` | Attach a persistent note to a document |
| `acr run-mcp` | Start MCP server (stdio, single agent) |
| `acr run-mcp --http` | Start MCP server (HTTP, multi-agent) |
| `acr worker` | Background sync daemon — keeps sources fresh automatically |

All key commands support `--json` for agent and script consumption.

## Search Workflow

`acr search` is document-first. It finds the right document, shows you a meaningful preview, and tells you exactly how to read the full thing:

```bash
acr search "stripe webhook verification"

# Output:
# ─── 1. Stripe Payments API ─────────────────────────────────────────
#     Source:  stripe-docs [docs] (official)
#     Score:   0.847  +2 more chunks from this doc
#     URL:     https://stripe.com/docs/webhooks
#
#     Webhook verification requires the raw request body — not parsed JSON...
#     [800-character preview]
#
#     → acr get-document abc123def456

# Then fetch the full document:
acr get-document abc123def456
```

**Key behaviors:**
- One result per document — no duplicate chunks from the same page
- `+N more chunks` indicates additional matching sections in that doc
- Results below a confidence threshold are filtered out entirely
- `--source <name>` to scope results to one source
- `--json` for structured output in scripts or agents


## MCP Server

Anchor exposes its context to any MCP-compatible agent.

### Stdio mode (single agent)

```bash
acr run-mcp
```

Claude Desktop config:
```json
{
  "mcpServers": {
    "acr": {
      "command": "acr",
      "args": ["run-mcp"]
    }
  }
}
```

### HTTP mode (multi-agent)

For federated search or multi-agent setups, use HTTP mode. One process serves all agents over a shared connection pool.

```bash
acr run-mcp --http               # default port 3100
acr run-mcp --http --port 3200    # custom port
```

HTTP mode includes:
- **Session management** — one transport per client, automatic idle/expired cleanup
- **Embedding concurrency limiter** — prevents OpenAI rate exhaustion under load
- **Query cache with deduplication** — identical concurrent queries share a single API call
- **Per-request metrics** — query, latency, cache hit rate, session count

Tools: `search_context`, `get_document`, `save_annotation`, `list_sources`

## How It Works

```
Sources → Fetch → Normalize → Chunk → Embed → Store
                                  ↓                 ↓
                         Safety check        Sync diffing
                      (max token limit)    (skip unchanged)
                                                    ↓
                              Search → Rank → Group by doc → Cite
```

Anchor crawls your configured sources, converts everything to clean markdown, splits into sections (with a safety pipeline that ensures no chunk exceeds embedding API limits), generates embeddings, and stores them in Postgres with pgvector. Repeated syncs diff against previously stored content — unchanged documents are skipped, changed documents are re-chunked, and stale documents are excluded from search. Search queries are embedded and matched via cosine similarity, with results grouped at the document level.

## Configuration

Config is loaded from (highest priority first):

1. Environment variables
2. `.acr/config.json` (created by `acr init`)
3. `.env` file

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | Yes | — |
| `EMBEDDING_API_KEY` | Yes (sync/search) | — |
| `EMBEDDING_PROVIDER` | No | `openai` |
| `EMBEDDING_MODEL` | No | `text-embedding-3-small` |
| `GITHUB_TOKEN` | No | — |

> ⚠️ **Supabase users:** Use the **Session mode pooler** URL (port 5432), not Transaction mode (6543).

### MCP Server

| Variable | Default | What it does |
|----------|---------|------|
| `ACR_MCP_PORT` | `3100` | HTTP server port for `acr run-mcp --http` |
| `ACR_DB_POOL_SIZE` | `5` | Max database connections per process |
| `ACR_EMBED_CONCURRENCY` | `3` | Max concurrent OpenAI embedding calls |

## Troubleshooting

```bash
acr doctor     # shows exactly what's wrong and how to fix it
```

| Issue | Fix |
|-------|-----|
| pgvector not enabled | Supabase Dashboard → Extensions → enable `vector` |
| Connection refused | Check DATABASE_URL, use pooler URL for Supabase |
| Schema not found | Run `acr db-push` |
| Embedding errors | Verify EMBEDDING_API_KEY is set and valid |

## Contributing

```bash
git clone https://github.com/mikestangdevs/anchor.git
cd anchor && pnpm install && pnpm build
pnpm -F @acr/connectors test         # 14 connector contract tests
```

## License

MIT

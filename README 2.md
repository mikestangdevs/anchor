# Anchor

Coding agents hallucinate APIs and work without context. Anchor gives them curated, searchable docs from your actual sources — local files, websites, GitHub repos, databases — with citations they can trust. Everything flows through a CLI and MCP server built for agents.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/anchor-acr)](https://www.npmjs.com/package/anchor-acr)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

## Quick Start

```bash
npm install -g anchor-acr
acr init                              # create config
acr doctor                            # verify setup
```

You'll need a Postgres database with pgvector ([Supabase](https://supabase.com) free tier works) and an [OpenAI API key](https://platform.openai.com/api-keys) for embeddings.

```bash
# edit .acr/config.json with DATABASE_URL and EMBEDDING_API_KEY
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
| `acr init` | Create config file and print setup steps |
| `acr db-push` | Create or migrate database schema |
| `acr doctor` | Health check — shows what's wrong and how to fix it |
| `acr source add` | Register a new source |
| `acr source list` | List all sources |
| `acr source inspect <name>` | Diagnostics: config, sync stats, sample docs |
| `acr source delete <name>` | Delete a source and all its data |
| `acr sync --source <name>` | Sync one source (`--all` for everything) |
| `acr search <query>` | Semantic search with citations |
| `acr run-mcp` | Start MCP server (stdio) |

All key commands support `--json` for agent and script consumption.

## MCP Server

Anchor exposes its context to any MCP-compatible agent:

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

Tools: `search_context`, `get_document`, `save_annotation`, `list_sources`

## How It Works

```
Sources → Fetch → Normalize → Chunk → Embed → Store → Search
```

Anchor crawls your configured sources, converts everything to clean markdown, splits into chunks, generates embeddings via OpenAI, and stores them in Postgres with pgvector. Search queries are embedded the same way and matched via cosine similarity. Results come back with source attribution, section titles, and URLs — citation-ready.

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

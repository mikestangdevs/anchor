---
description: How to build, test, and link the ACR CLI from source
---

# Dev Build & Test

## Build all packages

// turbo
```bash
cd /Users/michaelstang/Desktop/DevProjects/Anchor && pnpm build
```

This builds all workspace packages in dependency order via tsup.
Exit code 0 means success. Build output goes to each package's `dist/` folder.

## Run CLI commands

Always run from the **repo root** (not from `apps/cli/`):

```bash
node apps/cli/dist/index.js <command>
```

Do NOT cd into `apps/cli` and then use the same path — it doubles up:
```bash
# WRONG (from apps/cli/):
node apps/cli/dist/index.js <command>  # → looks for apps/cli/apps/cli/dist/...

# RIGHT (from repo root):
node apps/cli/dist/index.js <command>
```

## Link globally (optional)

```bash
cd apps/cli && pnpm link --global
acr <command>  # works from anywhere
```

## Known build issues

### drizzle-kit push doesn't work

The schema files use ESM `.js` import extensions (`import { documents } from './documents.js'`).
`drizzle-kit` loads these files with a CJS loader and can't resolve the `.js` extensions.

**Fix:** Use `acr db-push` instead. This is a self-contained schema push built into the CLI.

### tsx not available at root

`tsx` is installed in the `apps/cli` workspace but not at the monorepo root.
To run a `.ts` script that needs workspace deps:

```bash
cd apps/cli && npx tsx ../../scripts/some-script.ts
```

### pnpm strict module resolution

pnpm hoists packages strictly. If a script can't find `postgres` or other modules,
run it from a workspace that has that dependency (e.g., `apps/cli/`).

## Project structure

```
apps/
  cli/          → CLI (acr command, all subcommands)
  mcp-server/   → Standalone MCP server
  worker/       → Sync pipeline worker
packages/
  config/       → Layered config loading (loadBaseConfig, requireDatabaseUrl, requireEmbeddingConfig)
  db/           → Drizzle ORM schema + getDb() client
  connectors/   → Source connectors (github_repo, docs_site, supabase_view)
  embeddings/   → Embedding provider abstraction
  retrieval/    → Vector search + citation formatting
  annotations/  → Annotation CRUD
  core/         → Chunking, normalization
  parser/       → HTML/markdown parsing
  types/        → Shared TypeScript types
scripts/
  push-schema.ts → Standalone schema push (backup, prefer acr db-push)
```

## Config loading architecture

Commands validate only what they need:

- `loadBaseConfig()` — never throws, returns all values as optional. Used by `doctor`.
- `requireDatabaseUrl('commandName')` — throws command-specific error if missing
- `requireEmbeddingConfig('commandName')` — throws command-specific error if missing
- `getConfig()` — legacy, validates everything. Used by worker/mcp-server.
- `getDb(databaseUrl?)` — accepts optional URL, falls back to getConfig() if not provided

## Adding a new CLI command

1. Create `apps/cli/src/commands/your-command.ts`
2. Export a `Command` from `commander`
3. Use `requireDatabaseUrl('your-command')` and/or `requireEmbeddingConfig('your-command')` as needed
4. Import and register in `apps/cli/src/index.ts`
5. Rebuild: `pnpm build`

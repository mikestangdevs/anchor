---
description: Full end-to-end smoke test for the ACR CLI
---

# Smoke Test

Two distinct test modes. Both should pass before shipping.

---

## Mode A: From Source

Run the CLI directly from the monorepo build output. This tests that the code compiles and runs correctly.

### Prerequisites
- pnpm installed
- Supabase project with credentials (see `/setup-supabase`)
- OpenAI API key

### Build

// turbo
```bash
cd /Users/michaelstang/Desktop/DevProjects/Anchor && pnpm build
```

### Run

All commands use `node apps/cli/dist/index.js` from the **repo root** (NOT from `apps/cli/`):

```bash
# 1. Init
node apps/cli/dist/index.js init \
  --database-url "postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  --embedding-api-key "sk-..."

# 2. Push schema
node apps/cli/dist/index.js db-push

# 3. Verify (7/7 should pass)
node apps/cli/dist/index.js doctor

# 4. Add source
node apps/cli/dist/index.js add-source \
  --name "Drizzle Docs" --type github_repo \
  --github-owner drizzle-team --github-repo drizzle-orm \
  --github-docs-path docs --trust-level official

# 5. Sync + search
node apps/cli/dist/index.js list-sources
node apps/cli/dist/index.js sync --source "Drizzle Docs"
node apps/cli/dist/index.js search "how to define relations"
```

### Source-mode gotchas
- Always run from repo root — `cd apps/cli` then using the same path doubles up to `apps/cli/apps/cli/dist/...`
- `pnpm link --global` may warn "has no binaries" — this is fine, the link still works
- After code changes, you MUST `pnpm build` before testing — it runs compiled JS, not TS

---

## Mode B: From Installed CLI (Tarball / npm)

Run `acr` as a globally installed binary. This tests packaging, bundling, and the real user experience.

### Package and install

```bash
# Build
cd /Users/michaelstang/Desktop/DevProjects/Anchor && pnpm build

# Pack tarball
cd apps/cli && npm pack

# Install globally
npm install -g ./anchor-0.1.0.tgz
```

### Run from a clean directory

```bash
mkdir /tmp/acr-test && cd /tmp/acr-test

# 1. Init
acr init

# 2. Configure
# Edit .acr/config.json with DATABASE_URL + EMBEDDING_API_KEY

# 3. Push schema
acr db-push

# 4. Verify
acr doctor

# 5. Add source + sync + search
acr add-source --name "Drizzle Docs" --type github_repo \
  --github-owner drizzle-team --github-repo drizzle-orm \
  --github-docs-path docs --trust-level official
acr sync --source "Drizzle Docs"
acr search "how to define relations"
```

### Tarball-mode gotchas
- Test from a directory OUTSIDE the monorepo — in-repo the workspace deps mask bundling issues
- If `acr` command not found after install, check `npm bin -g` is in your PATH
- All workspace packages must be bundled into the CLI dist — if you see "Cannot find module @acr/config", tsup isn't bundling correctly
- The `package.json` `bin` field must point to `./dist/index.js` with the `#!/usr/bin/env node` shebang

### Uninstall

```bash
npm uninstall -g anchor
# or if linked:
pnpm unlink --global anchor
```

---

## Supabase View Source Test

Works in both modes. First create test data in Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.context_test_docs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  category text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.context_test_docs (title, body, category) VALUES
  ('API Auth', 'All API requests require a Bearer token in the Authorization header.', 'api'),
  ('Rate Limits', 'Free tier: 100 req/min. Pro tier: 1000 req/min.', 'api'),
  ('Deployment', 'Deploy using Vercel or Docker. Set all environment variables first.', 'ops');

CREATE VIEW public.context_test_view AS SELECT * FROM public.context_test_docs;
```

Then add and sync (replace `acr` with `node apps/cli/dist/index.js` for source mode):

```bash
acr add-source \
  --name "Internal Docs" --type supabase_view \
  --supabase-url "https://<ref>.supabase.co" \
  --supabase-service-key "eyJ..." \
  --supabase-view context_test_view \
  --supabase-content-fields body \
  --supabase-metadata-fields category \
  --supabase-updated-at-field updated_at \
  --trust-level official

acr sync --source "Internal Docs"
acr search "API authentication"
```

- `--supabase-url`: Dashboard → Settings → API → Project URL
- `--supabase-service-key`: Dashboard → Settings → API → `service_role` key (secret, not anon)

---

## Expected Results

| Step | Expected |
|------|----------|
| `doctor` | 7/7 ✓ |
| `list-sources` | Shows registered sources |
| `sync` | "X pages fetched, Y chunks" exit 0 |
| `search` | Results with citation metadata (source, trust, URL, scores) |

## Clean State Reset

```bash
acr db-push --force   # drop and recreate all tables
rm -rf .acr/          # remove config
```

## Command Dependency Quick Reference

| Command | DB | Embeddings |
|---------|-----|-----------|
| `init` | No | No |
| `db-push` | Yes | No |
| `doctor` | Tests | Tests |
| `list-sources` / `add-source` | Yes | No |
| `sync` / `search` | Yes | Yes |

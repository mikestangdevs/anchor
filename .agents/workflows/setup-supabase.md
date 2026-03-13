---
description: How to set up ACR with a Supabase database backend
---

# Setup Supabase as ACR Backend

This configures Supabase as ACR's core database (DATABASE_URL). This is NOT for adding a supabase_view source — see `/smoke-test` for that.

## Prerequisites
- A Supabase project (free tier works)
- An OpenAI API key for embeddings

## Steps

### 1. Get the connection string

Go to **Supabase Dashboard → Project Settings → Database → Connection string → URI tab**.

Copy the **Session mode (port 5432)** pooler connection string. It looks like:
```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

> [!CAUTION]
> **Do NOT use these — they will fail:**
> - Direct URL (`db.*.supabase.co`) — fails on IPv6 networks with ECONNREFUSED
> - Transaction mode pooler (port 6543) — breaks prepared statements and schema push
> - Wrong region — gives "Tenant or user not found" error
>
> Always copy the exact string from the dashboard. Never guess the region.

### 2. Initialize ACR

```bash
# From the project root:
node apps/cli/dist/index.js init \
  --database-url "postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
  --embedding-api-key "sk-..."
```

Or edit `.acr/config.json` directly:
```json
{
  "database_url": "postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres",
  "embedding_provider": "openai",
  "embedding_model": "text-embedding-3-small",
  "embedding_api_key": "sk-...",
  "github_token": ""
}
```

### 3. Push schema

```bash
node apps/cli/dist/index.js db-push
```

This creates all tables, enums, indexes, and enables pgvector. Safe to re-run.

Use `--force` to drop and recreate everything (destructive):
```bash
node apps/cli/dist/index.js db-push --force
```

> [!WARNING]
> **Do NOT use `drizzle-kit push`** — it fails because schema files use ESM `.js` import extensions
> that drizzle-kit's CJS loader can't resolve. Always use `acr db-push` instead.

### 4. Verify

```bash
node apps/cli/dist/index.js doctor
```

All 7 checks should pass:
```
✓ Config file
✓ DATABASE_URL
✓ Database connection
✓ pgvector extension
✓ Schema: Tables exist
✓ Embedding config
✓ Embedding provider ready
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `password authentication failed` | Wrong password or wrong host | Reset password in Dashboard → Settings → Database |
| `ECONNREFUSED` on IPv6 | Using direct URL on IPv6 network | Switch to pooler URL |
| `Tenant or user not found` | Wrong region in pooler URL | Copy exact string from dashboard |
| `Tables not found` | Schema not pushed | Run `acr db-push` |
| `column "source_status" does not exist` | Old schema with wrong column names | Run `acr db-push --force` |

## Important: Column name mapping

The `db-push` DDL must match Drizzle ORM's expected column names exactly. In Drizzle, the string
passed to the column type function IS the SQL column name:

```typescript
status: sourceStatusEnum('source_status')  // SQL column = 'source_status', NOT 'status'
kind: annotationKindEnum('annotation_kind')  // SQL column = 'annotation_kind', NOT 'kind'
```

If adding new columns to the schema, make sure `db-push.ts` uses the same column names.

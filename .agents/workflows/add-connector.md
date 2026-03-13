---
description: How to add a new source connector type to ACR
---

# Add a New Source Connector

This workflow covers adding a new source type (like `github_repo`, `supabase_view`, or a new one).

## Files to modify (in order)

### 1. Types — add the source type name

**File:** `packages/types/src/index.ts`

Add the new type to the `SourceType` union:
```typescript
export type SourceType = 'docs_site' | 'github_repo' | 'supabase_view' | 'your_new_type';
```

### 2. DB Schema — add columns to the sources table

**File:** `packages/db/src/schema/sources.ts`

1. Add the new type to the `sourceTypeEnum`:
```typescript
export const sourceTypeEnum = pgEnum('source_type', ['docs_site', 'github_repo', 'supabase_view', 'your_new_type']);
```

2. Add config columns for the new source type:
```typescript
// your_new_type config
yourFieldName: text('your_field_name'),
```

> [!CAUTION]
> The string passed to the column type function IS the SQL column name.
> `myField: text('my_field')` creates SQL column `my_field`, NOT `myField`.
> The `db-push.ts` DDL must use the SAME SQL column names.

### 3. DB Push — add columns to the DDL

**File:** `apps/cli/src/commands/db-push.ts`

1. Add the new enum value (users will need `--force` to recreate enums)
2. Add columns to the `CREATE TABLE sources` statement, using the EXACT column names from step 2

### 4. Connector Config — add fields

**File:** `packages/connectors/src/base.ts`

Add fields to `ConnectorConfig`:
```typescript
export interface ConnectorConfig {
  // ... existing fields ...

  // your_new_type
  yourField?: string;
  yourOtherField?: string;
}
```

### 5. Connector Class — implement fetch logic

**File:** `packages/connectors/src/your-new-type.ts` [NEW]

```typescript
import type { RawPage, ConnectorResult, SourceType } from '@acr/types';
import { BaseConnector, type ConnectorConfig } from './base.js';

export class YourNewTypeConnector extends BaseConnector {
  sourceType: SourceType = 'your_new_type';

  async fetch(config: ConnectorConfig): Promise<ConnectorResult> {
    // Validate required fields
    // Fetch data from your source
    // Map each item to a RawPage:
    //   { url, title, rawMarkdown, contentType: 'markdown', fetchedAt: new Date() }
    // Return { pages, stats: { fetched, skipped, errors } }
  }
}
```

Key requirements:
- Each item must have a stable canonical URL for deduplication
- Body text should be markdown (used for chunking + embedding)
- Content should be >50 chars to avoid being skipped

### 6. Connector Registry — register it

**File:** `packages/connectors/src/index.ts`

```typescript
import { YourNewTypeConnector } from './your-new-type.js';
export { YourNewTypeConnector } from './your-new-type.js';

connectorRegistry.set('your_new_type', () => new YourNewTypeConnector());
```

### 7. CLI add-source — add flags

**File:** `apps/cli/src/commands/add-source.ts`

1. Add CLI options:
```typescript
.option('--your-field <value>', 'Description')
```

2. Handle the new source type in the action handler — map CLI flags to DB insert values
3. Map source row to `ConnectorConfig` in the sync path

### 8. CLI sync — map source to connector config

**File:** `apps/cli/src/commands/sync.ts`

The sync command loads the source from DB and maps it to a `ConnectorConfig`. Make sure your
new fields are included in this mapping.

### 9. Build and test

```bash
pnpm build
node apps/cli/dist/index.js db-push --force  # recreate with new enum values
node apps/cli/dist/index.js add-source --name "Test" --type your_new_type --your-field "value"
node apps/cli/dist/index.js sync --source "Test"
node apps/cli/dist/index.js search "test query"
```

---

## Required Checklist

> [!IMPORTANT]
> Every new connector MUST complete ALL 8 sections below.
> Do not skip any — half-added connectors break the pipeline silently.

### ☐ 1. Config shape
- [ ] `ConnectorConfig` in `packages/connectors/src/base.ts` has all new fields
- [ ] `SourceType` union in `packages/types/src/index.ts` includes new type
- [ ] `sourceTypeEnum` in `packages/db/src/schema/sources.ts` includes new type
- [ ] DB columns added to `sources` table schema (column names match exactly)
- [ ] DB columns added to `db-push.ts` DDL (same SQL column names!)

### ☐ 2. Validation changes
- [ ] Connector validates its required fields in `fetch()` with clear error messages
- [ ] `add-source` CLI validates required flags before inserting
- [ ] No new global config requirements added (keep command-specific validation)

### ☐ 3. Source registry
- [ ] Connector class created in `packages/connectors/src/`
- [ ] Connector exported from `packages/connectors/src/index.ts`
- [ ] Connector registered in `connectorRegistry` map

### ☐ 4. Sync path
- [ ] `add-source` CLI maps CLI flags → DB insert for new source type
- [ ] `sync` CLI maps DB source row → `ConnectorConfig` for new fields
- [ ] Connector `fetch()` returns `ConnectorResult` with `pages` + `stats`
- [ ] Pagination/batching handled for large sources

### ☐ 5. Document normalization
- [ ] Each item maps to a `RawPage` with `{ url, title, rawMarkdown, contentType, fetchedAt }`
- [ ] Canonical URL is stable and unique per item (used for deduplication)
- [ ] Body text is markdown with proper headings from content fields
- [ ] Metadata fields appended as structured block
- [ ] Content hash computed for change detection
- [ ] Items with <50 chars of content are skipped

### ☐ 6. Citation format
- [ ] Search results include: source name, source type, trust level
- [ ] Canonical URL is meaningful (e.g. `supabase://ref/schema.view/row-id`)
- [ ] Document title is populated (falls back to ID if needed)
- [ ] Freshness metadata (updated_at) passed through when available

### ☐ 7. Smoke test commands
- [ ] `pnpm build` passes
- [ ] `acr db-push --force` creates new columns/enums
- [ ] `acr add-source` registers the new source type correctly
- [ ] `acr list-sources` shows it with correct metadata
- [ ] `acr sync --source "..."` fetches and embeds without errors
- [ ] `acr search "..."` returns results with correct citations
- [ ] `acr get-document <id>` returns a synced document

### ☐ 8. README updates
- [ ] New source type listed in command reference table
- [ ] Smoke test section added with example commands
- [ ] Config fields documented (what they mean, where to find values)
- [ ] Security notes if credentials are involved (e.g. service role keys)
- [ ] Command dependency matrix updated if needed

---

## Architecture notes

The sync pipeline flow:
```
add-source (CLI) → sources table (DB)
sync (CLI) → load source → get connector → connector.fetch() → RawPage[]
  → normalize → chunk → embed → store documents + chunks
search (CLI) → embed query → vector search → rank → format citations
```

Each connector returns `RawPage[]` with `{ url, title, rawMarkdown }`.
The core pipeline handles normalization, chunking, embedding, and storage.
Connectors don't need to know about embeddings or the database.

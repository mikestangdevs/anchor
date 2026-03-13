---
name: create-supabase-view
description: Create a Supabase view suitable for use as an ACR supabase_view source
---

# Create Supabase View

Use this skill when setting up a `supabase_view` source and the target table doesn't have a clean
view already. This creates a view that maps columns to ACR's expected shape.

## Usage

Run from the `apps/cli` workspace:

```bash
cd apps/cli && npx tsx ../../.agents/skills/create-supabase-view/scripts/create-view.ts \
  --table scenario_agents \
  --view acr_scenario_agents \
  --id-field id \
  --title-field name \
  --content-fields description \
  --metadata-fields category,group_type \
  --updated-at-field updated_at
```

The script connects using the DATABASE_URL from `.acr/config.json`.

## What it does

1. Creates a `CREATE OR REPLACE VIEW` statement
2. Selects the specified columns, aliasing them if needed
3. Filters out rows with empty content
4. Reports row count after creation

## When to use

- Table has many columns but you only need a few for ACR
- Column names don't match ACR defaults (`title`, `body`, etc.)
- You want to filter rows (e.g. exclude drafts, only published content)
- You need to combine multiple content columns into one

## After creating the view

Add it as a source:
```bash
acr add-source \
  --name "My Source" --type supabase_view \
  --supabase-url "https://<ref>.supabase.co" \
  --supabase-service-key "..." \
  --supabase-view <view_name> \
  --supabase-title-field <title_column> \
  --supabase-content-fields <content_column> \
  --trust-level official
```

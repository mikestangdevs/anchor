---
name: inspect-supabase-schema
description: List all tables, views, columns, and row counts in a Supabase project's public schema
---

# Inspect Supabase Schema

Use this skill when you need to discover what tables and views exist in a Supabase project.
Common use cases: setting up a supabase_view source, debugging connector issues, designing views.

## Usage

Run the script from the `apps/cli` workspace (for module resolution):

```bash
cd apps/cli && npx tsx ../../.agents/skills/inspect-supabase-schema/scripts/list-tables.ts
```

The script connects using the DATABASE_URL from `.acr/config.json`.

## What it does

1. Lists all tables and views in the `public` schema (excluding ACR internal tables)
2. Shows the column name and data type for each table
3. Shows row count for each table
4. Helps identify:
   - Which tables have text content suitable for embedding
   - What column names to use for `--supabase-title-field`, `--supabase-content-fields`, etc.
   - Whether a view already exists or needs to be created

## Output example

```
Your public tables/views:

  BASE TABLE   profiles
  BASE TABLE   scenario_agents
  VIEW         my_custom_view

--- profiles (38 rows) ---
  id (uuid)
  email (text)
  full_name (text)
  created_at (timestamp with time zone)
```

## Integration with workflows

This skill is called from:
- `/setup-supabase` — to discover available tables
- `setup-supabase-view-source.md` — to pick columns for the view source

import { createClient } from '@supabase/supabase-js';
import type { RawPage, ConnectorResult, SourceType } from '@acr/types';
import { BaseConnector, type ConnectorConfig } from './base.js';

/**
 * Connector for ingesting structured data from a Supabase view.
 *
 * Fetches rows from a configured view, converts each into a normalized
 * document with chunkable body text built from configured content fields.
 *
 * Canonical URL format: supabase://<project-ref>/<schema>.<view>/<row-id>
 */
export class SupabaseViewConnector extends BaseConnector {
  sourceType: SourceType = 'supabase_view';

  async fetch(config: ConnectorConfig): Promise<ConnectorResult> {
    const {
      supabaseUrl,
      supabaseServiceKey,
      supabaseSchema,
      supabaseView,
      supabaseIdField,
      supabaseTitleField,
      supabaseContentFields,
      supabaseMetadataFields,
      supabaseUpdatedAtField,
    } = config;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('SupabaseViewConnector requires supabaseUrl and supabaseServiceKey');
    }
    if (!supabaseView) {
      throw new Error('SupabaseViewConnector requires supabaseView');
    }
    if (!supabaseContentFields || supabaseContentFields.length === 0) {
      throw new Error('SupabaseViewConnector requires at least one content field');
    }

    const schema = supabaseSchema ?? 'public';
    const idField = supabaseIdField ?? 'id';
    const titleField = supabaseTitleField ?? 'title';

    // Create Supabase client with service role for admin access
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema },
      auth: { persistSession: false },
    });

    // Build the field selection
    const selectFields = new Set<string>([idField, titleField, ...supabaseContentFields]);
    if (supabaseMetadataFields) {
      supabaseMetadataFields.forEach((f) => selectFields.add(f));
    }
    if (supabaseUpdatedAtField) {
      selectFields.add(supabaseUpdatedAtField);
    }

    const pages: RawPage[] = [];
    let errors = 0;
    let skipped = 0;

    try {
      // Fetch rows from the view
      // Supabase client uses PostgREST, paginated in batches
      let offset = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from(supabaseView)
          .select(Array.from(selectFields).join(','))
          .range(offset, offset + batchSize - 1);

        if (error) {
          throw new Error(`Supabase query error: ${error.message} (code: ${error.code})`);
        }

        if (!data || data.length === 0) {
          hasMore = false;
          break;
        }

        for (const row of data) {
          try {
            const page = this.rowToPage(row as unknown as Record<string, unknown>, {
              supabaseUrl,
              schema,
              view: supabaseView,
              idField,
              titleField,
              contentFields: supabaseContentFields,
              metadataFields: supabaseMetadataFields,
              updatedAtField: supabaseUpdatedAtField,
            });

            if (page) {
              pages.push(page);
            } else {
              skipped++;
            }
          } catch {
            errors++;
          }
        }

        offset += batchSize;
        hasMore = data.length === batchSize;
      }
    } catch (err) {
      throw new Error(
        `Failed to fetch from ${schema}.${supabaseView}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return {
      pages,
      stats: {
        fetched: pages.length,
        skipped,
        errors,
      },
    };
  }

  /**
   * Convert a Supabase row into a RawPage.
   *
   * Body text is built by joining content fields with headings.
   * Metadata fields are appended as a structured block.
   */
  private rowToPage(
    row: Record<string, unknown>,
    config: {
      supabaseUrl: string;
      schema: string;
      view: string;
      idField: string;
      titleField: string;
      contentFields: string[];
      metadataFields?: string[];
      updatedAtField?: string;
    },
  ): RawPage | null {
    const rowId = String(row[config.idField] ?? '');
    if (!rowId) return null;

    const title = String(row[config.titleField] ?? rowId);

    // Build body from content fields
    const bodyParts: string[] = [];

    // Add title as H1
    bodyParts.push(`# ${title}`);
    bodyParts.push('');

    for (const field of config.contentFields) {
      const value = row[field];
      if (value == null || value === '') continue;

      const text = String(value);

      // If there's more than one content field, add the field name as a heading
      if (config.contentFields.length > 1) {
        const heading = field
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        bodyParts.push(`## ${heading}`);
        bodyParts.push('');
      }

      bodyParts.push(text);
      bodyParts.push('');
    }

    // Append metadata as a structured block
    if (config.metadataFields && config.metadataFields.length > 0) {
      const metaParts: string[] = [];
      for (const field of config.metadataFields) {
        const value = row[field];
        if (value == null || value === '') continue;
        const label = field
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        metaParts.push(`- **${label}**: ${String(value)}`);
      }
      if (metaParts.length > 0) {
        bodyParts.push('## Metadata');
        bodyParts.push('');
        bodyParts.push(...metaParts);
        bodyParts.push('');
      }
    }

    const rawMarkdown = bodyParts.join('\n');

    // Skip very short content
    if (rawMarkdown.length < 50) return null;

    // Build a canonical identifier
    // Extract project ref from URL (e.g., https://abc123.supabase.co → abc123)
    const projectRef = config.supabaseUrl
      .replace(/^https?:\/\//, '')
      .split('.')[0];

    const canonicalUrl = `supabase://${projectRef}/${config.schema}.${config.view}/${rowId}`;

    return {
      url: canonicalUrl,
      title,
      rawMarkdown,
      contentType: 'markdown',
      fetchedAt: new Date(),
    };
  }
}

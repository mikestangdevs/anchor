import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, sources, documents } from '@acr/db';
import { searchContext } from '@acr/retrieval';
import { createAnnotation, listAnnotations } from '@acr/annotations';
import { getEmbeddingProvider } from '@acr/embeddings';

const server = new McpServer({
  name: 'agent-context-repo',
  version: '0.1.0',
});

const embeddingProvider = getEmbeddingProvider();

// ─── Tool: search_context ───────────────────────────────────────
server.tool(
  'search_context',
  'Search across synced documentation context. Returns ranked, citation-ready results.',
  {
    query: z.string().describe('Search query'),
    source_filter: z.string().optional().describe('Filter by source name'),
    max_results: z.number().optional().default(10).describe('Maximum results to return'),
    latest_only: z.boolean().optional().default(true).describe('Only include latest versions'),
  },
  async ({ query, source_filter, max_results, latest_only }) => {
    const response = await searchContext(
      {
        query,
        sourceFilter: source_filter,
        maxResults: max_results,
        latestOnly: latest_only,
      },
      embeddingProvider,
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            results: response.results.map((r) => ({
              chunk_text: r.chunkText,
              section_title: r.sectionTitle,
              score: r.score,
              citation: {
                document_title: r.citation.documentTitle,
                canonical_url: r.citation.canonicalUrl,
                source_name: r.citation.sourceName,
                trust_level: r.citation.trustLevel,
                last_verified_at: r.citation.lastVerifiedAt.toISOString(),
                is_latest: r.citation.isLatest,
              },
              annotations: r.annotations.map((a) => ({
                kind: a.kind,
                note: a.note,
                confidence: a.confidence,
                author_type: a.authorType,
                status: a.status,
              })),
            })),
            query: response.query,
            total_candidates: response.totalCandidates,
          }, null, 2),
        },
      ],
    };
  },
);

// ─── Tool: get_document ─────────────────────────────────────────
server.tool(
  'get_document',
  'Fetch a single document by ID with its full content and metadata.',
  {
    document_id: z.string().describe('Document ID'),
  },
  async ({ document_id }) => {
    const db = getDb();
    const results = await db
      .select({
        doc: documents,
        sourceName: sources.name,
        trustLevel: sources.trustLevel,
      })
      .from(documents)
      .innerJoin(sources, eq(documents.sourceId, sources.id))
      .where(eq(documents.id, document_id))
      .limit(1);

    if (results.length === 0) {
      return {
        content: [{ type: 'text' as const, text: `Document not found: ${document_id}` }],
        isError: true,
      };
    }

    const { doc, sourceName, trustLevel } = results[0];
    const docAnnotations = await listAnnotations(document_id);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            id: doc.id,
            title: doc.title,
            canonical_url: doc.canonicalUrl,
            content: doc.cleanedMarkdown,
            source_name: sourceName,
            trust_level: trustLevel,
            is_latest: doc.isLatest,
            last_verified_at: doc.lastVerifiedAt.toISOString(),
            annotations: docAnnotations.map((a) => ({
              kind: a.kind,
              note: a.note,
              confidence: a.confidence,
            })),
          }, null, 2),
        },
      ],
    };
  },
);

// ─── Tool: save_annotation ──────────────────────────────────────
server.tool(
  'save_annotation',
  'Save a structured annotation (workaround, warning, example, migration note).',
  {
    document_id: z.string().optional().describe('Document ID to annotate'),
    chunk_id: z.string().optional().describe('Chunk ID to annotate'),
    kind: z.enum(['workaround', 'warning', 'example', 'migration_note']).describe('Annotation type'),
    note: z.string().describe('Annotation text'),
    confidence: z.number().optional().default(0.8).describe('Confidence score (0-1)'),
    author_type: z.enum(['human', 'agent']).optional().default('agent').describe('Author type'),
  },
  async ({ document_id, chunk_id, kind, note, confidence, author_type }) => {
    if (!document_id && !chunk_id) {
      return {
        content: [{ type: 'text' as const, text: 'Error: document_id or chunk_id is required' }],
        isError: true,
      };
    }

    const annotation = await createAnnotation({
      documentId: document_id,
      chunkId: chunk_id,
      kind,
      note,
      confidence,
      authorType: author_type,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            id: annotation.id,
            kind: annotation.kind,
            note: annotation.note,
            status: annotation.status,
            created_at: annotation.createdAt.toISOString(),
          }, null, 2),
        },
      ],
    };
  },
);

// ─── Tool: list_sources ─────────────────────────────────────────
server.tool(
  'list_sources',
  'List all registered documentation sources.',
  {},
  async () => {
    const db = getDb();
    const allSources = await db.select().from(sources);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            sources: allSources.map((s) => ({
              id: s.id,
              name: s.name,
              source_type: s.sourceType,
              trust_level: s.trustLevel,
              status: s.status,
            })),
          }, null, 2),
        },
      ],
    };
  },
);

// ─── Start server ───────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ACR MCP server running on stdio');
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});

/**
 * MCP server entrypoint — bundled into the CLI package.
 *
 * Supports two transport modes:
 *   stdio  — single agent, spawned as child process (default)
 *   http   — multi-agent, one shared server process via StreamableHTTP
 *
 * Usage:
 *   acr run-mcp              # stdio (default)
 *   acr run-mcp --http       # HTTP mode on port 3100
 *   acr run-mcp --http --port 3200
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, sources, documents } from '@acr/db';
import { searchContext } from '@acr/retrieval';
import { createAnnotation, listAnnotations } from '@acr/annotations';
import { getEmbeddingProvider } from '@acr/embeddings';
import { getConfig } from '@acr/config';
import { Semaphore, EmbedCache } from '@acr/core';

// ─── Configuration ──────────────────────────────────────────────
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_MAX_AGE_MS = 60 * 60 * 1000;      // 1 hour max
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;     // sweep every 60s
const EMBED_CONCURRENCY = parseInt(process.env.ACR_EMBED_CONCURRENCY ?? '3', 10);
const EMBED_TIMEOUT_MS = 30_000;

// ─── Shared resources (process-level, shared across all sessions) ──
const config = getConfig();
getDb(config.database.url); // Eagerly init DB connection (avoids lazy require in ESM)
const embeddingProvider = getEmbeddingProvider();
const embedSemaphore = new Semaphore(EMBED_CONCURRENCY, EMBED_TIMEOUT_MS);
const embedCache = new EmbedCache({ maxEntries: 200, ttlMs: 5 * 60 * 1000 });

/** Detect HTTP mode for metrics logging. */
let httpMode = false;

// ─── Tool registration ─────────────────────────────────────────
// Register tools on a McpServer instance. Called once for stdio,
// or once per session for HTTP mode.
function registerTools(server: McpServer) {
  // ─── Tool: search_context ─────────────────────────────────────
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
      const t0 = Date.now();
      const response = await searchContext(
        {
          query,
          sourceFilter: source_filter,
          maxResults: max_results,
          latestOnly: latest_only,
        },
        embeddingProvider,
        { embedCache, embedSemaphore },
      );
      const latency = Date.now() - t0;

      // Per-request metrics (HTTP mode only — stdio is single-agent)
      if (httpMode) {
        const cache = embedCache.stats();
        console.error(
          `[search] query="${query.slice(0, 40)}" latency=${latency}ms cache=${cache.hitRate} sessions=${sessions.size} embed_active=${embedSemaphore.activeCount} embed_queued=${embedSemaphore.queueLength}`,
        );
      }

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

  // ─── Tool: get_document ───────────────────────────────────────
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

  // ─── Tool: save_annotation ────────────────────────────────────
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

  // ─── Tool: list_sources ───────────────────────────────────────
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
}

// ─── Session state for HTTP mode ────────────────────────────────
interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
  lastActiveAt: number;
}

const sessions = new Map<string, SessionEntry>();

function evictStaleSessions() {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    const idle = now - entry.lastActiveAt > SESSION_IDLE_TIMEOUT_MS;
    const expired = now - entry.createdAt > SESSION_MAX_AGE_MS;
    if (idle || expired) {
      console.error(`[mcp] Evicting session ${id} (${idle ? 'idle' : 'expired'})`);
      entry.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

// ─── Start server ───────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const httpMode = args.includes('--http');
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 && args[portIdx + 1]
    ? parseInt(args[portIdx + 1], 10)
    : parseInt(process.env.ACR_MCP_PORT ?? '3100', 10);

  if (httpMode) {
    await startHttpServer(port);
  } else {
    await startStdioServer();
  }
}

async function startStdioServer() {
  const server = new McpServer({
    name: 'agent-context-repo',
    version: '0.1.0',
  });
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ACR MCP server running on stdio');
}

async function startHttpServer(port: number) {
  httpMode = true;
  const sweepTimer = setInterval(evictStaleSessions, SESSION_SWEEP_INTERVAL_MS);
  sweepTimer.unref(); // don't block process exit

  const httpServer = createServer(async (req, res) => {
    // CORS for browser-based MCP clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only handle /mcp endpoint
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. MCP endpoint is POST /mcp' }));
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Try to reuse existing session
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      entry.lastActiveAt = Date.now();
      await entry.transport.handleRequest(req, res);
      return;
    }

    // If client sends a session ID we don't know, reject
    if (sessionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found. Send an initialize request without a session ID.' }));
      return;
    }

    // New session — create server + transport pair
    const sessionServer = new McpServer({
      name: 'agent-context-repo',
      version: '0.1.0',
    });
    registerTools(sessionServer);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Clean up on close
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        console.error(`[mcp] Session ${transport.sessionId} closed (${sessions.size} remaining)`);
      }
    };

    await sessionServer.connect(transport);
    await transport.handleRequest(req, res);

    // Store session AFTER handleRequest — sessionId is assigned during the
    // initialize handshake inside handleRequest, not during connect().
    if (transport.sessionId && !sessions.has(transport.sessionId)) {
      sessions.set(transport.sessionId, {
        transport,
        server: sessionServer,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      console.error(`[mcp] New session ${transport.sessionId} (${sessions.size} active)`);
    }
  });

  httpServer.listen(port, () => {
    console.error(`ACR MCP server running on http://localhost:${port}/mcp`);
    console.error(`  Sessions: idle timeout ${SESSION_IDLE_TIMEOUT_MS / 60000}min, max age ${SESSION_MAX_AGE_MS / 60000}min`);
    console.error(`  Sweep interval: ${SESSION_SWEEP_INTERVAL_MS / 1000}s`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.error('\n[mcp] Shutting down...');
    clearInterval(sweepTimer);
    for (const [id, entry] of sessions) {
      await entry.transport.close().catch(() => {});
      sessions.delete(id);
    }
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});

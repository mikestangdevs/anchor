import { eq, and, inArray } from 'drizzle-orm';
import { getDb, documents, chunks, syncJobs, sources } from '@acr/db';
import { getConnector, type ConnectorConfig } from '@acr/connectors';
import { normalize, chunkMarkdown, computeVersionHash, hasContentChanged, estimateTokens, EMBED_HARD_MAX_TOKENS } from '@acr/core';
import { extractTitle } from '@acr/parser';
import { getEmbeddingProvider } from '@acr/embeddings';
import { getConfig } from '@acr/config';
import type { Source, RawPage, EmbeddingProvider } from '@acr/types';

export interface SyncStats {
  /** Brand-new documents indexed for the first time */
  processed: number;
  /** Existing documents reprocessed because content changed */
  changed: number;
  /** Existing documents skipped because content hash matched */
  unchanged: number;
  /** Pages ignored for validation reasons (too short, empty, etc.) */
  skipped: number;
  /** Documents previously seen but missing this run, marked non-latest */
  stale: number;
  /** Pages that threw errors during processing */
  errors: number;
  /** Total chunks created or recreated */
  chunksCreated: number;
  /** Chunks that exceeded preferred size and were split by enforceChunkSafety() */
  chunksSplit: number;
  /** Chunks that exceeded safe size and were hard-truncated as final fallback */
  chunksTruncated: number;
  /** Chunks skipped before embedding because they exceeded EMBED_HARD_MAX_TOKENS */
  chunksSkippedOversized: number;
}

function emptyStats(): SyncStats {
  return {
    processed: 0, changed: 0, unchanged: 0, skipped: 0, stale: 0,
    errors: 0, chunksCreated: 0, chunksSplit: 0, chunksTruncated: 0, chunksSkippedOversized: 0,
  };
}

/**
 * Run the full sync pipeline for a single source.
 *
 * Steps:
 * 1. Create SyncJob record (status: running)
 * 2. Fetch raw pages via connector
 * 3. For each page: normalize → diff → skip/upsert → chunk → embed
 * 4. Mark unseen documents as stale (isLatest: false)
 * 5. Complete SyncJob
 */
export async function runSyncPipeline(source: Source): Promise<SyncStats> {
  const db = getDb();
  const embeddingProvider = getEmbeddingProvider();

  // 1. Create sync job
  const [syncJob] = await db
    .insert(syncJobs)
    .values({
      sourceId: source.id,
      jobType: 'full',
      status: 'running',
      startedAt: new Date(),
    })
    .returning();

  const stats = emptyStats();

  try {
    // 2. Fetch raw pages
    const connector = getConnector(source.sourceType);
    const config = getConfig();
    const connectorConfig: ConnectorConfig = {
      sourceId: source.id,
      name: source.name,
      baseUrl: source.baseUrl ?? undefined,
      githubOwner: source.githubOwner ?? undefined,
      githubRepo: source.githubRepo ?? undefined,
      githubBranch: source.githubBranch ?? undefined,
      githubDocsPath: source.githubDocsPath ?? undefined,
      githubToken: config.github.token ?? undefined,
      supabaseUrl: source.supabaseUrl ?? undefined,
      supabaseServiceKey: source.supabaseServiceKey ?? undefined,
      supabaseSchema: source.supabaseSchema ?? undefined,
      supabaseView: source.supabaseView ?? undefined,
      supabaseIdField: source.supabaseIdField ?? undefined,
      supabaseTitleField: source.supabaseTitleField ?? undefined,
      supabaseContentFields: source.supabaseContentFields ?? undefined,
      supabaseMetadataFields: source.supabaseMetadataFields ?? undefined,
      supabaseUpdatedAtField: source.supabaseUpdatedAtField ?? undefined,
      folderPath: source.folderPath ?? undefined,
      folderRecursive: source.folderRecursive ?? undefined,
      includePatterns: source.includePatterns ?? undefined,
      excludePatterns: source.excludePatterns ?? undefined,
    };

    // Detect TTY for inline progress (used for both crawl and processing phases)
    const isTTY = process.stdout.isTTY ?? false;

    // Wire crawl progress so user isn't staring at a blank screen
    connectorConfig.onProgress = (fetched, queued) => {
      if (isTTY) {
        process.stdout.write(`\r  Crawling: ${fetched} page${fetched !== 1 ? 's' : ''} fetched, ${queued} queued`);
      } else if (fetched % 25 === 0) {
        console.log(`  Crawling: ${fetched} pages fetched, ${queued} queued`);
      }
    };

    const result = await connector.fetch(connectorConfig);

    // Clear crawl progress line on TTY
    if (isTTY) {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }
    console.log(`  Fetched ${result.pages.length} pages from ${source.name}`);

    // Track seen document URLs for staleness detection
    const seenUrls = new Set<string>();
    const totalPages = result.pages.length;
    const tSync = Date.now();

    // 3. Process each page — with progress
    for (let i = 0; i < result.pages.length; i++) {
      const page = result.pages[i];
      try {
        await processPage(db, embeddingProvider, source, page, seenUrls, stats);
      } catch (err) {
        console.error(`  Error processing ${page.url}:`, err);
        stats.errors++;
      }

      // Progress output
      const done = i + 1;
      const parts: string[] = [];
      if (stats.processed > 0) parts.push(`${stats.processed} new`);
      if (stats.changed > 0) parts.push(`${stats.changed} changed`);
      if (stats.unchanged > 0) parts.push(`${stats.unchanged} unchanged`);
      if (stats.errors > 0) parts.push(`${stats.errors} errors`);
      const summary = parts.length > 0 ? ` — ${parts.join(', ')}` : '';

      if (isTTY) {
        process.stdout.write(`\r  [${done}/${totalPages}]${summary}`);
      } else if (done === totalPages || done % 25 === 0) {
        // Non-TTY: print every 25 pages + final
        console.log(`  [${done}/${totalPages}]${summary}`);
      }
    }

    // Clear the progress line on TTY
    if (isTTY && totalPages > 0) {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }

    const syncDuration = ((Date.now() - tSync) / 1000).toFixed(1);

    // 4. Mark unseen documents as stale — single batched UPDATE
    const existingDocs = await db
      .select({ id: documents.id, canonicalUrl: documents.canonicalUrl })
      .from(documents)
      .where(
        and(
          eq(documents.sourceId, source.id),
          eq(documents.isLatest, true),
        ),
      );

    const staleIds = existingDocs
      .filter((d) => !seenUrls.has(d.canonicalUrl))
      .map((d) => d.id);

    if (staleIds.length > 0) {
      const tStale = Date.now();
      await db
        .update(documents)
        .set({ isLatest: false, updatedAt: new Date() })
        .where(inArray(documents.id, staleIds));
      stats.stale = staleIds.length;
      console.log(`  Marked ${staleIds.length} document(s) stale in ${Date.now() - tStale}ms`);
    }

    // 5. Complete sync job
    await db
      .update(syncJobs)
      .set({
        status: 'completed',
        completedAt: new Date(),
        statsJson: stats,
      })
      .where(eq(syncJobs.id, syncJob.id));

    const parts: string[] = [];
    if (stats.processed > 0) parts.push(`${stats.processed} new`);
    if (stats.changed > 0) parts.push(`${stats.changed} changed`);
    if (stats.unchanged > 0) parts.push(`${stats.unchanged} unchanged`);
    if (stats.stale > 0) parts.push(`${stats.stale} stale`);
    if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`);
    if (stats.errors > 0) parts.push(`${stats.errors} errors`);
    console.log(`  Sync completed: ${parts.join(', ')} (${stats.chunksCreated} chunks) in ${syncDuration}s`);
    if (stats.chunksSplit > 0)
      console.log(`  ⚡ Split ${stats.chunksSplit} oversized chunk(s) for embedding safety`);
    if (stats.chunksTruncated > 0)
      console.log(`  ✂ Hard-truncated ${stats.chunksTruncated} chunk(s) as final fallback`);
    if (stats.chunksSkippedOversized > 0)
      console.log(`  ⚠ Skipped ${stats.chunksSkippedOversized} chunk(s) that exceeded absolute hard max (bug — report this)`);

    return stats;
  } catch (err) {
    // Mark sync job as failed
    await db
      .update(syncJobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
        statsJson: stats,
      })
      .where(eq(syncJobs.id, syncJob.id));

    // Mark source as error
    await db
      .update(sources)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(sources.id, source.id));

    throw err;
  }
}

async function processPage(
  db: ReturnType<typeof getDb>,
  embeddingProvider: EmbeddingProvider,
  source: Source,
  page: RawPage,
  seenUrls: Set<string>,
  stats: SyncStats,
): Promise<void> {
  const content = page.rawMarkdown ?? '';
  if (!content || content.length < 50) {
    stats.skipped++;
    return;
  }

  // Normalize
  const cleaned = normalize(content);
  const versionHash = computeVersionHash(cleaned);
  const title = extractTitle(cleaned, page.title);
  const url = page.url;

  seenUrls.add(url);

  // Check for existing document with same identity (source + canonical URL)
  const existingDocs = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.sourceId, source.id),
        eq(documents.canonicalUrl, url),
        eq(documents.isLatest, true),
      ),
    )
    .limit(1);

  if (existingDocs.length > 0) {
    const existing = existingDocs[0];

    if (!hasContentChanged(existing.versionHash, versionHash)) {
      // Content hasn't changed — update timestamps only
      await db
        .update(documents)
        .set({
          lastSeenAt: new Date(),
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, existing.id));
      stats.unchanged++;
      return;
    }

    // Content changed — update document in-place and replace chunks transactionally
    await db.transaction(async (tx) => {
      // Update document row
      await tx
        .update(documents)
        .set({
          title,
          cleanedMarkdown: cleaned,
          versionHash,
          lastSeenAt: new Date(),
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, existing.id));

      // Delete old chunks
      await tx
        .delete(chunks)
        .where(eq(chunks.documentId, existing.id));
    });

    // Re-chunk and re-embed (outside transaction — embedding API calls are slow)
    const chunkStats = { splitCount: 0, truncateCount: 0 };
    const chunkOutputs = chunkMarkdown(cleaned, chunkStats);
    stats.chunksSplit += chunkStats.splitCount;
    stats.chunksTruncated += chunkStats.truncateCount;

    if (chunkOutputs.length > 0) {
      const texts = chunkOutputs.map((c) => c.text);

      // Pre-flight guard: last-resort protection before hitting OpenAI
      const safeTexts = texts.filter((t) => {
        if (estimateTokens(t) > EMBED_HARD_MAX_TOKENS) {
          stats.chunksSkippedOversized++;
          return false;
        }
        return true;
      });
      const embeddings = await embeddingProvider.embed(safeTexts);

      // Re-align embeddings with chunkOutputs (skip over any dropped chunks)
      let embIdx = 0;
      const chunkValues = chunkOutputs
        .filter((_, i) => estimateTokens(texts[i]) <= EMBED_HARD_MAX_TOKENS)
        .map((chunk) => ({
          documentId: existing.id,
          chunkIndex: chunk.chunkIndex,
          sectionTitle: chunk.sectionTitle ?? null,
          text: chunk.text,
          embedding: embeddings[embIdx++],
          tokenCount: chunk.tokenCount,
          qualityScore: 1.0,
        }));

      await db.insert(chunks).values(chunkValues);
      stats.chunksCreated += chunkValues.length;
    }

    stats.changed++;
    return;
  }

  // New document — insert fresh
  const [doc] = await db
    .insert(documents)
    .values({
      sourceId: source.id,
      title,
      canonicalUrl: url,
      contentType: page.contentType,
      cleanedMarkdown: cleaned,
      versionHash,
      lastSeenAt: new Date(),
      lastVerifiedAt: new Date(),
      isLatest: true,
    })
    .returning();

  // Chunk
  const chunkStats2 = { splitCount: 0, truncateCount: 0 };
  const chunkOutputs = chunkMarkdown(cleaned, chunkStats2);
  stats.chunksSplit += chunkStats2.splitCount;
  stats.chunksTruncated += chunkStats2.truncateCount;

  if (chunkOutputs.length === 0) {
    stats.processed++;
    return;
  }

  // Embed all chunks — pre-flight guard as last-resort protection
  const texts = chunkOutputs.map((c) => c.text);
  const safeTexts = texts.filter((t) => {
    if (estimateTokens(t) > EMBED_HARD_MAX_TOKENS) {
      stats.chunksSkippedOversized++;
      return false;
    }
    return true;
  });
  const embeddings = await embeddingProvider.embed(safeTexts);

  // Re-align embeddings with chunkOutputs (skip dropped chunks)
  let embIdx = 0;
  const chunkValues = chunkOutputs
    .filter((_, i) => estimateTokens(texts[i]) <= EMBED_HARD_MAX_TOKENS)
    .map((chunk) => ({
      documentId: doc.id,
      chunkIndex: chunk.chunkIndex,
      sectionTitle: chunk.sectionTitle ?? null,
      text: chunk.text,
      embedding: embeddings[embIdx++],
      tokenCount: chunk.tokenCount,
      qualityScore: 1.0,
    }));

  await db.insert(chunks).values(chunkValues);

  stats.processed++;
  stats.chunksCreated += chunkValues.length;
}

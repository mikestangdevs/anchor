import { eq, and } from 'drizzle-orm';
import { getDb, documents, chunks, syncJobs, sources } from '@acr/db';
import { getConnector, type ConnectorConfig } from '@acr/connectors';
import { normalize, chunkMarkdown, computeVersionHash, hasContentChanged } from '@acr/core';
import { extractTitle } from '@acr/parser';
import { getEmbeddingProvider } from '@acr/embeddings';
import { getConfig } from '@acr/config';
import type { Source, RawPage, EmbeddingProvider } from '@acr/types';

/**
 * Run the full sync pipeline for a single source.
 *
 * Steps:
 * 1. Create SyncJob record (status: running)
 * 2. Fetch raw pages via connector
 * 3. For each page: normalize → dedup → upsert document → chunk → embed → upsert chunks
 * 4. Mark stale documents as not latest
 * 5. Complete SyncJob
 */
export async function runSyncPipeline(source: Source): Promise<void> {
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

  const stats = { processed: 0, skipped: 0, errors: 0, chunksCreated: 0 };

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
      // local_folder
      folderPath: source.folderPath ?? undefined,
      folderRecursive: source.folderRecursive ?? undefined,
      includePatterns: source.includePatterns ?? undefined,
      excludePatterns: source.excludePatterns ?? undefined,
    };

    const result = await connector.fetch(connectorConfig);
    console.log(`  Fetched ${result.pages.length} pages from ${source.name}`);

    // Track seen document URLs for staleness detection
    const seenUrls = new Set<string>();

    // 3. Process each page
    for (const page of result.pages) {
      try {
        await processPage(db, embeddingProvider, source, page, seenUrls, stats);
      } catch (err) {
        console.error(`  Error processing ${page.url}:`, err);
        stats.errors++;
      }
    }

    // 4. Mark unseen documents as not latest
    const existingDocs = await db
      .select({ id: documents.id, canonicalUrl: documents.canonicalUrl })
      .from(documents)
      .where(
        and(
          eq(documents.sourceId, source.id),
          eq(documents.isLatest, true),
        ),
      );

    for (const doc of existingDocs) {
      if (!seenUrls.has(doc.canonicalUrl)) {
        await db
          .update(documents)
          .set({ isLatest: false, updatedAt: new Date() })
          .where(eq(documents.id, doc.id));
      }
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

    console.log(`  Sync completed: ${stats.processed} processed, ${stats.skipped} skipped, ${stats.errors} errors, ${stats.chunksCreated} chunks`);
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
  stats: { processed: number; skipped: number; errors: number; chunksCreated: number },
): Promise<void> {
  const content = page.rawMarkdown ?? '';
  if (!content || content.length < 50) {
    stats.skipped++;
    return;
  }

  // Normalize
  const cleaned = normalize(content);
  const versionHash = computeVersionHash(cleaned);
  // Prefer H1 from markdown content, fall back to humanized filename
  const title = extractTitle(cleaned, page.title);
  const url = page.url;

  seenUrls.add(url);

  // Check for existing document with same URL
  const existingDocs = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.sourceId, source.id),
        eq(documents.canonicalUrl, url),
      ),
    )
    .limit(1);

  if (existingDocs.length > 0) {
    const existing = existingDocs[0];
    if (!hasContentChanged(existing.versionHash, versionHash)) {
      // Content hasn't changed — just update timestamps
      await db
        .update(documents)
        .set({
          lastSeenAt: new Date(),
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, existing.id));
      stats.skipped++;
      return;
    }

    // Content changed — mark old version as not latest
    await db
      .update(documents)
      .set({ isLatest: false, updatedAt: new Date() })
      .where(eq(documents.id, existing.id));
  }

  // Insert new document
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
  const chunkOutputs = chunkMarkdown(cleaned);

  if (chunkOutputs.length === 0) {
    stats.processed++;
    return;
  }

  // Embed all chunks
  const texts = chunkOutputs.map((c) => c.text);
  const embeddings = await embeddingProvider.embed(texts);

  // Insert chunks
  const chunkValues = chunkOutputs.map((chunk, i) => ({
    documentId: doc.id,
    chunkIndex: chunk.chunkIndex,
    sectionTitle: chunk.sectionTitle ?? null,
    text: chunk.text,
    embedding: embeddings[i],
    tokenCount: chunk.tokenCount,
    qualityScore: 1.0,
  }));

  await db.insert(chunks).values(chunkValues);

  stats.processed++;
  stats.chunksCreated += chunkOutputs.length;
}

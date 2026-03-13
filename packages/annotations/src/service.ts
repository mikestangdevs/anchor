import { eq, and } from 'drizzle-orm';
import { getDb, annotations } from '@acr/db';
import type { Annotation, AnnotationKind, AuthorType, ModerationStatus } from '@acr/types';

export interface CreateAnnotationInput {
  documentId?: string;
  chunkId?: string;
  kind: AnnotationKind;
  note: string;
  confidence?: number;
  authorType?: AuthorType;
  authorName?: string;
}

/**
 * Create a new annotation on a document or chunk.
 */
export async function createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  if (!input.documentId && !input.chunkId) {
    throw new Error('At least one of documentId or chunkId must be provided');
  }

  const db = getDb();

  const [result] = await db
    .insert(annotations)
    .values({
      documentId: input.documentId ?? null,
      chunkId: input.chunkId ?? null,
      kind: input.kind,
      note: input.note,
      confidence: input.confidence ?? 0.8,
      authorType: input.authorType ?? 'human',
      authorName: input.authorName ?? null,
      status: 'pending',
    })
    .returning();

  return {
    id: result.id,
    documentId: result.documentId,
    chunkId: result.chunkId,
    authorType: result.authorType as AuthorType,
    authorName: result.authorName,
    kind: result.kind as AnnotationKind,
    note: result.note,
    confidence: result.confidence,
    status: result.status as ModerationStatus,
    createdAt: result.createdAt,
  };
}

/**
 * List annotations for a document.
 */
export async function listAnnotations(documentId: string): Promise<Annotation[]> {
  const db = getDb();
  const results = await db
    .select()
    .from(annotations)
    .where(eq(annotations.documentId, documentId));

  return results.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    chunkId: r.chunkId,
    authorType: r.authorType as AuthorType,
    authorName: r.authorName,
    kind: r.kind as AnnotationKind,
    note: r.note,
    confidence: r.confidence,
    status: r.status as ModerationStatus,
    createdAt: r.createdAt,
  }));
}

/**
 * Update annotation moderation status.
 */
export async function updateAnnotationStatus(
  annotationId: string,
  status: ModerationStatus,
): Promise<void> {
  const db = getDb();
  await db
    .update(annotations)
    .set({ status })
    .where(eq(annotations.id, annotationId));
}

import { eq, and, lte, sql } from 'drizzle-orm';
import { getDb, sources, syncJobs } from '@acr/db';
import type { Source } from '@acr/types';

/**
 * Find sources that are due for sync based on their sync frequency.
 */
export async function getSourcesDueForSync(): Promise<Source[]> {
  const db = getDb();

  // Find sources where:
  // 1. Status is 'active'
  // 2. No sync job is currently running
  // 3. Last completed sync was > syncFrequencyMinutes ago (or never synced)
  const results = await db
    .select({
      source: sources,
    })
    .from(sources)
    .where(eq(sources.status, 'active'));

  const dueSources: Source[] = [];

  for (const { source } of results) {
    // Check if there's a running job
    const runningJobs = await db
      .select()
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.sourceId, source.id),
          eq(syncJobs.status, 'running'),
        ),
      )
      .limit(1);

    if (runningJobs.length > 0) continue;

    // Check last completed sync
    const lastSync = await db
      .select()
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.sourceId, source.id),
          eq(syncJobs.status, 'completed'),
        ),
      )
      .orderBy(sql`${syncJobs.completedAt} DESC`)
      .limit(1);

    if (lastSync.length === 0) {
      // Never synced
      dueSources.push(source as Source);
      continue;
    }

    const lastCompletedAt = lastSync[0].completedAt;
    if (!lastCompletedAt) {
      dueSources.push(source as Source);
      continue;
    }

    const minutesSinceSync = (Date.now() - lastCompletedAt.getTime()) / (1000 * 60);
    if (minutesSinceSync >= source.syncFrequencyMinutes) {
      dueSources.push(source as Source);
    }
  }

  return dueSources;
}

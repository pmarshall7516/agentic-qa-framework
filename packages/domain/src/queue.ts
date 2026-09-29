import { z } from 'zod';
import type { WorkItemSnapshot } from './work-item.js';

export const QueueEntrySchema = z
  .object({
    key: z.string().min(1),
    organization: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    workItemId: z.number().int().positive(),
    queuedAt: z.iso.datetime(),
    stale: z.boolean(),
  })
  .strict();

export type QueueEntry = z.infer<typeof QueueEntrySchema>;

export function makeQueueEntry(
  snapshot: WorkItemSnapshot,
  queuedAt = new Date().toISOString(),
): QueueEntry {
  const organization = snapshot.organization.trim().toLocaleLowerCase('en-US');
  const projectId = snapshot.projectId.trim();
  return QueueEntrySchema.parse({
    key: `${organization}:${projectId}:${snapshot.id}`,
    organization,
    projectId,
    workItemId: snapshot.id,
    queuedAt,
    stale: false,
  });
}

export function addToQueue(
  queue: readonly QueueEntry[],
  entry: QueueEntry,
): QueueEntry[] {
  if (queue.some(({ key }) => key === entry.key)) return [...queue];
  return [...queue, QueueEntrySchema.parse(entry)];
}

export function removeFromQueue(
  queue: readonly QueueEntry[],
  key: string,
): QueueEntry[] {
  return queue.filter((entry) => entry.key !== key);
}

export function reorderQueue(
  queue: readonly QueueEntry[],
  orderedKeys: readonly string[],
): QueueEntry[] {
  const existingKeys = new Set(queue.map(({ key }) => key));
  if (
    orderedKeys.length !== queue.length ||
    new Set(orderedKeys).size !== orderedKeys.length ||
    orderedKeys.some((key) => !existingKeys.has(key))
  ) {
    throw new Error('Queue order must contain every key exactly once');
  }
  const byKey = new Map(queue.map((entry) => [entry.key, entry]));
  return orderedKeys.map((key) => byKey.get(key)!);
}

export function markQueueItemStale(
  queue: readonly QueueEntry[],
  key: string,
  stale: boolean,
): QueueEntry[] {
  return queue.map((entry) => (entry.key === key ? { ...entry, stale } : entry));
}

import { describe, expect, it } from 'vitest';
import {
  addToQueue,
  makeQueueEntry,
  markQueueItemStale,
  removeFromQueue,
  reorderQueue,
} from '../src/queue.js';
import type { WorkItemSnapshot } from '../src/work-item.js';

const snapshot: WorkItemSnapshot = {
  organization: 'Contoso',
  projectId: 'p-1',
  projectName: 'Portal',
  id: 40,
  revision: 3,
  type: 'User Story',
  kind: 'REQUIREMENT',
  title: 'Remember filters',
  state: 'Active',
  url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/40',
  retrievedAt: '2026-09-27T12:00:00.000Z',
};

describe('QA Queue', () => {
  it('deduplicates by normalized organization, project and work item id', () => {
    const first = makeQueueEntry(snapshot, '2026-09-27T12:00:00.000Z');
    const duplicate = makeQueueEntry(
      { ...snapshot, organization: 'contoso', revision: 4 },
      '2026-09-27T12:30:00.000Z',
    );

    const queue = addToQueue(addToQueue([], first), duplicate);

    expect(queue).toHaveLength(1);
    expect(queue[0].queuedAt).toBe('2026-09-27T12:00:00.000Z');
  });

  it('marks an inaccessible or changed item stale without losing its source key', () => {
    const entry = makeQueueEntry(snapshot, '2026-09-27T12:00:00.000Z');
    expect(markQueueItemStale([entry], entry.key, true)[0]).toMatchObject({
      key: entry.key,
      stale: true,
    });
  });

  it('removes and reorders only existing entries', () => {
    const first = makeQueueEntry(snapshot, '2026-09-27T12:00:00.000Z');
    const second = makeQueueEntry(
      { ...snapshot, id: 41, title: 'Retain sort' },
      '2026-09-27T12:01:00.000Z',
    );
    expect(reorderQueue([first, second], [second.key, first.key])).toEqual([
      second,
      first,
    ]);
    expect(removeFromQueue([first, second], first.key)).toEqual([second]);
    expect(() => reorderQueue([first, second], [first.key])).toThrow(
      'Queue order must contain every key exactly once',
    );
  });
});

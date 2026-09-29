import { describe, expect, it } from 'vitest';
import { classifyWorkItemType, WorkItemSnapshotSchema } from '../src/work-item.js';

describe('work-item classification', () => {
  it.each([
    ['User Story', 'REQUIREMENT'],
    ['Product Backlog Item', 'REQUIREMENT'],
    ['Issue', 'REQUIREMENT'],
    ['Requirement', 'REQUIREMENT'],
    ['Task', 'TASK'],
    ['Custom Feature', 'OTHER'],
  ] as const)('classifies %s as %s', (type, expected) => {
    expect(classifyWorkItemType(type)).toBe(expected);
  });

  it('uses project type mappings for custom requirement types', () => {
    expect(
      classifyWorkItemType('Feature Request', {
        'Feature Request': 'REQUIREMENT',
      }),
    ).toBe('REQUIREMENT');
  });
});

describe('work item snapshot schema', () => {
  it('preserves source revision and parent identity', () => {
    const snapshot = WorkItemSnapshotSchema.parse({
      organization: 'contoso',
      projectId: 'project-1',
      projectName: 'Portal',
      id: 48,
      revision: 7,
      type: 'Task',
      kind: 'TASK',
      title: 'Add retry state',
      state: 'Active',
      parentId: 40,
      url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/48',
      retrievedAt: '2026-09-27T12:00:00.000Z',
    });

    expect(snapshot.revision).toBe(7);
    expect(snapshot.parentId).toBe(40);
  });

  it('rejects missing or invalid source revisions', () => {
    expect(() =>
      WorkItemSnapshotSchema.parse({
        organization: 'contoso',
        projectId: 'project-1',
        projectName: 'Portal',
        id: 48,
        revision: 0,
        type: 'Task',
        kind: 'TASK',
        title: 'Add retry state',
        state: 'Active',
        url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/48',
        retrievedAt: 'not-a-date',
      }),
    ).toThrow();
  });
});

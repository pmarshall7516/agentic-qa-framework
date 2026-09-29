// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App.js';
import type { DesktopApi, DesktopState } from '../src/shared/ipc.js';

afterEach(cleanup);

describe('QA Queue layout', () => {
  it('nests queued child Tasks as their own rows beneath the main Story row', async () => {
    const user = userEvent.setup();
    const story = {
      organization: 'Contoso', projectId: 'project-1', projectName: 'Portal', id: 42, revision: 3,
      type: 'User Story', kind: 'REQUIREMENT' as const, title: 'Search stays clear', state: 'Active',
      acceptanceCriteria: 'The filtered result remains visible.', url: 'https://dev.azure.com/Contoso/project-1/_workitems/edit/42', retrievedAt: '2026-09-29T12:00:00.000Z',
    };
    const task = {
      ...story, id: 43, parentId: story.id, revision: 1, type: 'Task', kind: 'TASK' as const,
      title: 'Preserve the current filter', acceptanceCriteria: undefined,
      url: 'https://dev.azure.com/Contoso/project-1/_workitems/edit/43',
    };
    const state: DesktopState = {
      accounts: [], selectedProject: { id: 'project-1', name: 'Portal' },
      queue: [
        { entry: { key: 'contoso:project-1:42', organization: 'contoso', projectId: 'project-1', workItemId: 42, queuedAt: '2026-09-29T12:01:00.000Z', stale: false }, snapshot: story },
        { entry: { key: 'contoso:project-1:43', organization: 'contoso', projectId: 'project-1', workItemId: 43, queuedAt: '2026-09-29T12:02:00.000Z', stale: false }, snapshot: task },
      ],
    };
    render(<App api={{} as DesktopApi} initialState={state} />);

    await user.click(screen.getByRole('button', { name: /^QA Queue/ }));
    const storyGroup = screen.getByRole('region', { name: 'Story #42 Search stays clear' });
    expect(within(storyGroup).getByText('Search stays clear')).toBeTruthy();
    expect(within(storyGroup).getByText('Preserve the current filter')).toBeTruthy();
    expect(within(storyGroup).getAllByRole('article')).toHaveLength(2);
  });
});

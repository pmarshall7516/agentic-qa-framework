// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SprintWorkPicker } from '../src/renderer/SprintWorkPicker.js';
import type { DesktopApi, DesktopState } from '../src/shared/ipc.js';

const story = { organization: 'Contoso', projectId: 'project-1', projectName: 'Portal', id: 51, revision: 3, type: 'User Story', kind: 'REQUIREMENT' as const, title: 'Reset password', state: 'Active', description: '', acceptanceCriteria: 'A user can reset a password.', url: 'https://dev.azure.com/Contoso/project-1/_workitems/edit/51', retrievedAt: '2026-09-29T12:00:00.000Z' };
const task = { ...story, id: 52, parentId: story.id, type: 'Task', kind: 'TASK' as const, title: 'Send reset email', acceptanceCriteria: undefined };
const initialState: DesktopState = { accounts: [], queue: [] };

afterEach(cleanup);

describe('sprint work picker', () => {
  it('loads a sprint, selects nested Tasks, and adds selected work in one queue operation', async () => {
    const listProfileIterations = vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12', timeFrame: 'current' as const }]);
    const searchActiveStories = vi.fn(async () => ({ items: [story] }));
    const getChildren = vi.fn(async () => [task]);
    const addQueueItems = vi.fn(async () => initialState);
    const onQueueChanged = vi.fn();
    const onError = vi.fn();
    const api = { listProfileIterations, searchActiveStories, getChildren, listSprintTaskboard: async () => [], addQueueItems } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={onQueueChanged} onError={onError} onNotice={vi.fn()} />);

    await waitFor(() => expect(listProfileIterations).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Load active Stories' }));
    expect(await screen.findByText('#51 · Reset password')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load child Tasks' }));
    expect(await screen.findByText('#52 · Send reset email')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select #51 Reset password'));
    fireEvent.click(screen.getByLabelText('Select #52 Send reset email'));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected to QA Queue' }));

    await waitFor(() => expect(addQueueItems).toHaveBeenCalledWith([{ workItemId: 51 }, { workItemId: 52, parentId: 51 }]));
    expect(onQueueChanged).toHaveBeenCalledWith(initialState);
    expect(onError.mock.calls.every(([message]) => message === '')).toBe(true);
  });

  it('lets keyboard users choose a sprint and load its active Stories', async () => {
    const user = userEvent.setup();
    const api = {
      listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12' }],
      listSprintTaskboard: async () => [],
      searchActiveStories: async () => ({ items: [story] }),
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />);
    const sprint = await screen.findByRole('combobox', { name: 'Sprint' });
    for (let i = 0; i < 8 && document.activeElement !== sprint; i += 1) await user.tab();
    expect(document.activeElement).toBe(sprint);
    await user.keyboard('{ArrowDown}{Enter}');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Load active Stories' }));
    await user.keyboard('{Enter}');
    expect(await screen.findByText('#51 · Reset password')).toBeTruthy();
  });

  it('searches sprint names and paths with an accessible keyboard combobox', async () => {
    const user = userEvent.setup();
    const api = {
      listProfileIterations: async () => [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12', timeFrame: 'current' as const },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Sprint 13', path: 'Portal\\Sprint 13' },
      ],
      searchActiveStories: vi.fn(async () => ({ items: [story] })),
      listSprintTaskboard: async () => [],
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />);

    const sprint = await screen.findByRole('combobox', { name: 'Sprint' });
    await user.click(sprint);
    await user.type(sprint, '13');
    expect(screen.getByRole('option', { name: /Sprint 13/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Sprint 12/ })).toBeNull();
    await user.keyboard('{ArrowDown}{Enter}');
    expect((sprint as HTMLInputElement).value).toBe('Sprint 13');
    await user.click(sprint);
    await user.type(sprint, '12');
    await user.keyboard('{Escape}');
    expect((sprint as HTMLInputElement).value).toBe('Sprint 13');
    await user.click(screen.getByRole('button', { name: 'Load active Stories' }));
    await waitFor(() => expect(api.searchActiveStories).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', undefined));
  });

  it('filters sprint Stories and loaded Tasks by ADO ID or title', async () => {
    const user = userEvent.setup();
    const api = {
      listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12' }],
      searchActiveStories: async () => ({ items: [story, { ...story, id: 60, title: 'Update profile' }] }),
      listSprintTaskboard: async () => [],
      getChildren: async () => [task],
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Load active Stories' }));
    expect(await screen.findByText('#60 · Update profile')).toBeTruthy();

    const search = screen.getByRole('searchbox', { name: 'Filter Stories and Tasks' });
    await user.type(search, '60');
    expect(screen.getByText('#60 · Update profile')).toBeTruthy();
    expect(screen.queryByText('#51 · Reset password')).toBeNull();

    await user.clear(search);
    await user.click(screen.getAllByRole('button', { name: 'Load child Tasks' })[0]!);
    expect(await screen.findByText('#52 · Send reset email')).toBeTruthy();
    await user.type(search, 'send reset');
    expect(screen.getByText('#51 · Reset password')).toBeTruthy();
    expect(screen.getByText('#52 · Send reset email')).toBeTruthy();
    expect(screen.queryByText('#60 · Update profile')).toBeNull();
  });

  it('keeps a Story’s loaded Tasks visible when the text filter matches the parent Story', async () => {
    const user = userEvent.setup();
    const api = {
      listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12' }],
      searchActiveStories: async () => ({ items: [story] }),
      listSprintTaskboard: async () => [{ workItemId: task.id, column: 'In Progress' }],
      getChildren: async () => [task],
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Load active Stories' }));
    const search = await screen.findByRole('searchbox', { name: 'Filter Stories and Tasks' });
    await user.type(search, '51');
    await user.click(screen.getByRole('button', { name: 'Load child Tasks' }));

    expect(await screen.findByText('#52 · Send reset email')).toBeTruthy();
    expect(screen.getByLabelText('Taskboard column: In Progress')).toBeTruthy();
  });

  it('places Hide Tasks after the nested task rows and shows a sticky queue action when selected', async () => {
    const user = userEvent.setup();
    const api = {
      listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12' }],
      searchActiveStories: async () => ({ items: [story] }),
      listSprintTaskboard: async () => [],
      getChildren: async () => [task],
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Load active Stories' }));
    await user.click(screen.getByRole('button', { name: 'Load child Tasks' }));
    const storyCard = screen.getByText('#51 · Reset password').closest('article')!;
    const taskList = storyCard.querySelector('.sprint-task-list')!;
    const hideButton = within(storyCard).getByRole('button', { name: 'Hide Tasks' });
    expect(taskList.compareDocumentPosition(hideButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByLabelText('Select #52 Send reset email'));
    expect(screen.getByRole('region', { name: 'QA Queue selection actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add 1 selected to QA Queue' })).toBeTruthy();
  });

  it('filters only child Tasks by multiple selected taskboard columns', async () => {
    const user = userEvent.setup();
    const task2 = { ...task, id: 53, title: 'Review recovery flow' };
    const task3 = { ...task, id: 54, title: 'Deploy password reset' };
    const api = {
      listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12' }],
      searchActiveStories: async () => ({ items: [story] }),
      listSprintTaskboard: async () => [{ workItemId: task.id, column: 'In Progress' }, { workItemId: task2.id, column: 'Ready' }, { workItemId: task3.id, column: 'Done' }],
      getChildren: async () => [task, task2, task3],
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Load active Stories' }));
    await user.click(screen.getByRole('button', { name: 'Load child Tasks' }));
    expect(await screen.findByText('#53 · Review recovery flow')).toBeTruthy();

    await user.click(screen.getByText('Task columns', { exact: true }));
    await user.click(screen.getByLabelText('In Progress'));
    await user.click(screen.getByLabelText('Ready'));

    expect(screen.getByText('#51 · Reset password')).toBeTruthy();
    expect(screen.getByText('#52 · Send reset email')).toBeTruthy();
    expect(screen.getByText('#53 · Review recovery flow')).toBeTruthy();
    expect(screen.queryByText('#54 · Deploy password reset')).toBeNull();
    expect(screen.getByText('2', { selector: '.task-column-count' })).toBeTruthy();
    expect(screen.getByLabelText('Taskboard column: In Progress')).toBeTruthy();
  });

  it('explains when the active team has no sprints', async () => {
    const onNotice = vi.fn();
    const api = { listProfileIterations: async () => [], listSprintTaskboard: async () => [] } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={vi.fn()} onNotice={onNotice} />);
    expect(await screen.findByRole('button', { name: 'Refresh sprints' })).toBeTruthy();
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('No sprints are available for this project team. The sprint search stays available and has no options.'));
    expect(screen.getByRole('button', { name: 'Load active Stories' }).hasAttribute('disabled')).toBe(true);
  });

  it('surfaces a safe operation-specific ADO failure from sprint search', async () => {
    const onError = vi.fn();
    const api = {
      listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 12', path: 'Portal\\Sprint 12' }],
      listSprintTaskboard: async () => [],
      searchActiveStories: async () => { throw new Error("Error invoking remote method 'qa:search-active-stories': AdoRequestError: Azure DevOps rejected the work item details request (HTTP 400). Check the selected project, sprint, filters, and work item types."); },
    } as unknown as DesktopApi;
    render(<SprintWorkPicker api={api} activeAdoProfileId="profile-1" queuedIds={new Set()} onQueueChanged={vi.fn()} onError={onError} onNotice={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Load active Stories' }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('Azure DevOps rejected the work item details request (HTTP 400). Check the selected project, sprint, filters, and work item types.'));
  });
});

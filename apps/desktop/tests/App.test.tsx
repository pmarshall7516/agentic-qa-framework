// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { App } from '../src/renderer/App.js';
import type { DesktopApi, DesktopState } from '../src/shared/ipc.js';

const api = {} as DesktopApi;
const state: DesktopState = {
  azureCliAvailable: false,
  accounts: [],
  selectedAccountId: undefined,
  selectedOrganization: undefined,
  selectedProject: undefined,
  queue: [],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('desktop M1 screens', () => {
  it('offers ADO-branded first-run sign-in without asking users to enter a client ID', () => {
    const markup = renderToStaticMarkup(<App api={api} initialState={state} />);
    expect(markup).toContain('Sign in with Azure DevOps');
    expect(markup).not.toContain('Entra application client ID');
    expect(markup).not.toContain('Save application ID');
  });

  it('shows the simplified first-run screen without exposing credentials', () => {
    const markup = renderToStaticMarkup(<App api={api} initialState={state} />);
    expect(markup).toContain('data-theme="dark"');
    expect(markup).toContain('Start your QA workspace');
    expect(markup).toContain('Azure DevOps');
    expect(markup).toContain('Sign in with Azure DevOps');
    expect(markup).not.toContain('application client ID');
    expect(markup).not.toContain('Save application ID');
    expect(markup).not.toContain('accessToken');

    const connectedMarkup = renderToStaticMarkup(<App api={api} initialState={{
      ...state,
      azureCliAvailable: true,
      accounts: [{ homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' }],
      selectedOrganization: 'contoso',
      selectedProject: { id: 'project-1', name: 'Portal' },
    }} />);
    expect(connectedMarkup).toContain('Work items');
    expect(connectedMarkup).toContain('QA Queue');
    expect(connectedMarkup).toContain('Runs');
    expect(connectedMarkup).toContain('Settings');
    expect(connectedMarkup).toContain('aria-label="Workspace navigation"');
    expect(connectedMarkup).toContain('data-theme="dark"');
    expect(connectedMarkup).toContain('aria-current="page"');
    expect(connectedMarkup).toContain('contoso');
    expect(connectedMarkup).toContain('Portal');
    expect(connectedMarkup).not.toContain('accessToken');
  });

  it('restores a saved project with the sprint picker and without work item mapping controls', async () => {
    const restoredState: DesktopState = {
      azureCliAvailable: true,
      accounts: [{ homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' }],
      selectedAccountId: 'account-1',
      selectedOrganization: 'contoso',
      selectedProject: { id: 'project-1', name: 'Portal' },
      queue: [],
    };
    const listWorkItemTypes = vi.fn(async () => ['User Story', 'Task', 'Feature Request']);
    const testApi = { getState: async () => restoredState, listWorkItemTypes } as unknown as DesktopApi;

    render(<App api={testApi} />);

    expect(await screen.findByRole('combobox', { name: 'Sprint' })).toBeTruthy();
    expect(screen.queryByLabelText('Map Feature Request')).toBeNull();
    expect(listWorkItemTypes).toHaveBeenCalledOnce();
  });

  it('shows saved models with per-model reachability actions in Settings', async () => {
    const user = userEvent.setup();
    const model = { id: '77777777-7777-4777-8777-777777777777', providerId: 'openai' as const, modelId: 'gpt-6-luna', displayName: 'GPT-6 Luna', capabilities: { structuredOutput: true, toolUse: true }, maxOutputTokens: 1200, testStatus: 'unreachable' as const };
    const initialState: DesktopState = { ...state, azureCliAvailable: true, accounts: [{ homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' }], selectedAccountId: 'account-1', selectedOrganization: 'contoso', selectedProject: { id: 'project-1', name: 'Portal' }, modelProvider: 'openai', modelProviderConfigured: true, modelId: 'gpt-6-luna', savedModels: [model] };
    const testSavedModel = vi.fn(async () => ({ reachable: true as const, testStatus: 'reachable' as const, message: 'Model is reachable and completed a prompt.' }));
    const getState = vi.fn(async () => ({ ...initialState, savedModels: [{ ...model, testStatus: 'reachable' as const, testedAt: '2026-09-30T12:00:00.000Z' }] }));
    const testApi = { ...api, testSavedModel, getState, listBrowserTestAccounts: async () => [], isBrowserInstalled: async () => false, isRepoWorkerImageInstalled: async () => false } as DesktopApi;
    render(<App api={testApi} initialState={initialState} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText(/openai \/ gpt-6-luna/)).toBeTruthy();
    expect(screen.getByText('Test Fail')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retest' }));
    expect(testSavedModel).toHaveBeenCalledWith(model.id);
    const successBadge = await screen.findByText('Test Success');
    expect(successBadge.className).toContain('test-status-success');
    expect(await screen.findByText('Test Success. The model returned a response.')).toBeTruthy();
  });

  it('shows only the connected Claude account models after discovery', async () => {
    const user = userEvent.setup();
    const availableModel = { providerId: 'claude-code' as const, modelId: 'haiku', displayName: 'Claude Haiku (subscription)', capabilities: { structuredOutput: true, toolUse: true } };
    const listProviderModels = vi.fn(async () => [availableModel]);
    const initialState: DesktopState = {
      ...state,
      azureCliAvailable: true,
      accounts: [{ homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' }],
      selectedAccountId: 'account-1',
      selectedOrganization: 'contoso',
      selectedProject: { id: 'project-1', name: 'Portal' },
      modelProvider: 'claude-code',
      modelProviderConfigured: true,
      modelProviderAccountEmail: 'qa@example.com',
      savedModels: [],
    };
    const testApi = { ...api, listProviderModels, listOrganizations: async () => [], listBrowserTestAccounts: async () => [], isBrowserInstalled: async () => false, isRepoWorkerImageInstalled: async () => false } as unknown as DesktopApi;
    render(<App api={testApi} initialState={initialState} />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getAllByText('qa@example.com').length).toBeGreaterThan(1);
    await user.click(screen.getByRole('button', { name: 'Check account models' }));
    expect(listProviderModels).toHaveBeenCalledWith('claude-code');

    await user.click(screen.getByRole('combobox', { name: 'Search and choose a supported model' }));
    expect(await screen.findByRole('option', { name: /Claude Haiku \(subscription\).*haiku/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Claude Sonnet/ })).toBeNull();
  });
});

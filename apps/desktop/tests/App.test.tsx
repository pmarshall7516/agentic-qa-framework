// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(connectedMarkup).toContain('aria-label="Main navigation"');
    expect(connectedMarkup).toContain('data-theme="dark"');
    expect(connectedMarkup).toContain('aria-current="page"');
    expect(connectedMarkup).toContain('contoso');
    expect(connectedMarkup).toContain('Portal');
    expect(connectedMarkup).not.toContain('accessToken');
  });

  it('loads custom work item types when restoring a saved project on startup', async () => {
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

    expect(await screen.findByLabelText('Map Feature Request')).toBeTruthy();
    expect(listWorkItemTypes).toHaveBeenCalledOnce();
  });
});

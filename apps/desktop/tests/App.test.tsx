import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
});

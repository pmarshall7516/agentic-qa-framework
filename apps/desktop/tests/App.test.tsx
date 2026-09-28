import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App.js';
import type { DesktopApi, DesktopState } from '../src/shared/ipc.js';

const api = {} as DesktopApi;
const state: DesktopState = {
  clientIdConfigured: false,
  accounts: [],
  selectedAccountId: undefined,
  selectedOrganization: undefined,
  selectedProject: undefined,
  queue: [],
};

describe('desktop M1 screens', () => {
  it('offers Entra configuration and sign-in without exposing credential values', () => {
    const markup = renderToStaticMarkup(<App api={api} initialState={state} />);
    expect(markup).toContain('Agentic QA');
    expect(markup).toContain('Azure DevOps');
    expect(markup).toContain('Entra application client ID');
    expect(markup).toContain('vso.work');
    expect(markup).toContain('http://localhost');
    expect(markup).not.toContain('accessToken');

    const connectedMarkup = renderToStaticMarkup(<App api={api} initialState={{
      ...state,
      clientIdConfigured: true,
      clientId: 'public-client-id',
    }} />);
    expect(connectedMarkup).toContain('Sign in with Microsoft');
    expect(connectedMarkup).not.toContain('accessToken');
  });
});

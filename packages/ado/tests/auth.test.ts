import { describe, expect, it, vi } from 'vitest';
import {
  ADO_DELEGATED_SCOPES,
  createMsalCachePlugin,
  EntraAdoAuthService,
  type PublicClientPort,
} from '../src/auth.js';

const account = {
  homeAccountId: 'home-1',
  environment: 'login.microsoftonline.com',
  tenantId: 'tenant-1',
  username: 'qa@example.test',
  localAccountId: 'local-1',
  name: 'QA User',
};

function makeClient(): PublicClientPort {
  const accounts = [account];
  return {
    getTokenCache: () => ({
      getAllAccounts: async () => accounts,
      removeAccount: async (target) => {
        const index = accounts.findIndex((item) => item.homeAccountId === target.homeAccountId);
        if (index >= 0) accounts.splice(index, 1);
      },
    }),
    acquireTokenInteractive: vi.fn(async (request) => {
      await request.openBrowser('https://login.microsoftonline.com/authorize');
      return { account, accessToken: 'private-access-token' };
    }),
    acquireTokenSilent: vi.fn(async () => ({ account, accessToken: 'private-access-token' })),
  };
}

describe('Entra ADO identity service', () => {
  it('requests only delegated Azure DevOps default permissions', () => {
    expect(ADO_DELEGATED_SCOPES).toEqual([
      'https://app.vssps.visualstudio.com/.default',
    ]);
  });

  it('opens the system browser and returns no token to the UI', async () => {
    const client = makeClient();
    const openBrowser = vi.fn(async () => undefined);
    const auth = new EntraAdoAuthService({ client, openBrowser });

    const summary = await auth.signIn();

    expect(openBrowser).toHaveBeenCalledWith('https://login.microsoftonline.com/authorize');
    expect(summary).toEqual({
      homeAccountId: 'home-1',
      tenantId: 'tenant-1',
      username: 'qa@example.test',
      displayName: 'QA User',
    });
    expect(Object.keys(summary)).not.toContain('accessToken');
  });

  it('silently obtains the ADO token for a selected cached account', async () => {
    const client = makeClient();
    const auth = new EntraAdoAuthService({ client, openBrowser: vi.fn() });

    await expect(auth.getAccessToken('home-1')).resolves.toBe('private-access-token');
    expect(client.acquireTokenSilent).toHaveBeenCalledWith({
      account,
      scopes: ADO_DELEGATED_SCOPES,
    });
  });

  it('requires an explicit sign-in when no cached account is selected', async () => {
    const client = makeClient();
    await client.getTokenCache().removeAccount(account);
    const auth = new EntraAdoAuthService({ client, openBrowser: vi.fn() });

    await expect(auth.getAccessToken('home-1')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Sign in to Azure DevOps to continue.',
    });
  });

  it('removes only the selected account from the local MSAL cache on sign-out', async () => {
    const client = makeClient();
    const auth = new EntraAdoAuthService({ client, openBrowser: vi.fn() });

    await auth.signOut('home-1');

    await expect(auth.getAccounts()).resolves.toEqual([]);
  });
});

describe('MSAL cache plugin contract', () => {
  it('loads before cache access and persists only when the MSAL cache changed', async () => {
    const store = { load: vi.fn(async () => '{"cached":"yes"}'), save: vi.fn(async () => undefined) };
    const plugin = createMsalCachePlugin(store);
    const cache = { deserialize: vi.fn(), serialize: vi.fn(() => '{"updated":"yes"}') };
    await plugin.beforeCacheAccess({ tokenCache: cache } as any);
    expect(cache.deserialize).toHaveBeenCalledWith('{"cached":"yes"}');
    await plugin.afterCacheAccess({ tokenCache: cache, cacheHasChanged: false } as any);
    expect(store.save).not.toHaveBeenCalled();
    await plugin.afterCacheAccess({ tokenCache: cache, cacheHasChanged: true } as any);
    expect(store.save).toHaveBeenCalledWith('{"updated":"yes"}');
  });
});

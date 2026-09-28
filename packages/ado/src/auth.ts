import { PublicClientApplication } from '@azure/msal-node';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';

export const ADO_DELEGATED_SCOPES = Object.freeze([
  'https://app.vssps.visualstudio.com/.default',
]);

export interface CachedAccount {
  homeAccountId: string;
  environment: string;
  tenantId: string;
  username: string;
  localAccountId: string;
  name?: string;
}

export interface AccountSummary {
  homeAccountId: string;
  tenantId: string;
  username: string;
  displayName?: string;
}

interface AuthenticationResultLike {
  account: CachedAccount | null;
  accessToken: string;
}

export interface PublicClientPort {
  getTokenCache(): {
    getAllAccounts(): Promise<CachedAccount[]>;
    removeAccount(account: CachedAccount): Promise<void>;
  };
  acquireTokenInteractive(request: {
    scopes: readonly string[];
    openBrowser(url: string): Promise<void>;
  }): Promise<AuthenticationResultLike>;
  acquireTokenSilent(request: {
    scopes: readonly string[];
    account: CachedAccount;
  }): Promise<AuthenticationResultLike>;
}

export interface MsalCacheStore {
  load(): Promise<string | undefined>;
  save(serializedCache: string): Promise<void>;
}

export function createMsalCachePlugin(store: MsalCacheStore): ICachePlugin {
  return {
    async beforeCacheAccess(context: TokenCacheContext) {
      const serialized = await store.load();
      if (serialized) context.tokenCache.deserialize(serialized);
    },
    async afterCacheAccess(context: TokenCacheContext) {
      if (context.cacheHasChanged) await store.save(context.tokenCache.serialize());
    },
  };
}

export class AdoAuthError extends Error {
  readonly code: 'AUTH_REQUIRED' | 'AUTH_CANCELLED' | 'AUTH_FAILED' | 'ACCOUNT_UNSUPPORTED';

  constructor(code: AdoAuthError['code'], message: string) {
    super(message);
    this.name = 'AdoAuthError';
    this.code = code;
  }
}

function accountSummary(account: CachedAccount): AccountSummary {
  return {
    homeAccountId: account.homeAccountId,
    tenantId: account.tenantId,
    username: account.username,
    ...(account.name ? { displayName: account.name } : {}),
  };
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as Record<string, unknown>;
  return [record.errorCode, record.code, record.subError]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function authError(error: unknown): AdoAuthError {
  const code = errorCode(error);
  if (code.includes('user_cancelled') || code.includes('user_canceled')) {
    return new AdoAuthError('AUTH_CANCELLED', 'Sign-in was cancelled.');
  }
  if (code.includes('50020') || code.includes('accounttype') || code.includes('unsupported_account')) {
    return new AdoAuthError(
      'ACCOUNT_UNSUPPORTED',
      'This app supports Entra-backed Azure DevOps organizations. Personal Microsoft accounts are not supported.',
    );
  }
  if (code.includes('interaction_required') || code.includes('invalid_grant')) {
    return new AdoAuthError('AUTH_REQUIRED', 'Sign in to Azure DevOps again to continue.');
  }
  return new AdoAuthError(
    'AUTH_FAILED',
    'Entra sign-in failed. Check account access, organization policy, and admin consent.',
  );
}

export class EntraAdoAuthService {
  private readonly client: PublicClientPort;
  private readonly openBrowser: (url: string) => Promise<void>;

  constructor(options: {
    client: PublicClientPort;
    openBrowser: (url: string) => Promise<void>;
  }) {
    this.client = options.client;
    this.openBrowser = options.openBrowser;
  }

  async getAccounts(): Promise<AccountSummary[]> {
    const accounts = await this.client.getTokenCache().getAllAccounts();
    return accounts.map(accountSummary);
  }

  async signIn(): Promise<AccountSummary> {
    try {
      const result = await this.client.acquireTokenInteractive({
        scopes: ADO_DELEGATED_SCOPES,
        openBrowser: this.openBrowser,
      });
      if (!result.account || !result.accessToken) {
        throw new AdoAuthError('AUTH_FAILED', 'Entra sign-in completed without an Azure DevOps account.');
      }
      return accountSummary(result.account);
    } catch (error) {
      if (error instanceof AdoAuthError) throw error;
      throw authError(error);
    }
  }

  async getAccessToken(homeAccountId: string): Promise<string> {
    try {
      const accounts = await this.client.getTokenCache().getAllAccounts();
      const account = accounts.find((candidate) => candidate.homeAccountId === homeAccountId);
      if (!account) {
        throw new AdoAuthError('AUTH_REQUIRED', 'Sign in to Azure DevOps to continue.');
      }
      const result = await this.client.acquireTokenSilent({
        scopes: ADO_DELEGATED_SCOPES,
        account,
      });
      if (!result.accessToken) {
        throw new AdoAuthError('AUTH_REQUIRED', 'Sign in to Azure DevOps again to continue.');
      }
      return result.accessToken;
    } catch (error) {
      if (error instanceof AdoAuthError) throw error;
      throw authError(error);
    }
  }

  async signOut(homeAccountId: string): Promise<void> {
    const accounts = await this.client.getTokenCache().getAllAccounts();
    const account = accounts.find((candidate) => candidate.homeAccountId === homeAccountId);
    if (account) await this.client.getTokenCache().removeAccount(account);
  }
}

export async function createEntraAdoAuthService(options: {
  clientId: string;
  cache: MsalCacheStore;
  openBrowser: (url: string) => Promise<void>;
}): Promise<EntraAdoAuthService> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(options.clientId)) {
    throw new Error('Configure a valid Entra public application client ID first.');
  }

  const client = new PublicClientApplication({
    auth: {
      clientId: options.clientId,
      authority: 'https://login.microsoftonline.com/organizations',
    },
    cache: { cachePlugin: createMsalCachePlugin(options.cache) },
  });

  return new EntraAdoAuthService({
    client: client as unknown as PublicClientPort,
    openBrowser: options.openBrowser,
  });
}

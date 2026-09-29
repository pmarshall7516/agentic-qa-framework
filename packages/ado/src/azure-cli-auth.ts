import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AccountSummary, AdoAuthService } from './auth.js';

const execFile = promisify(execFileCallback);
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
const timeout = 5 * 60_000;

function cliEnvironment(): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'AZURE_CONFIG_DIR'];
  return { ...Object.fromEntries(allowed.flatMap((key) => process.env[key] ? [[key, process.env[key]!] as const] : [])), AZURE_CORE_COLLECT_TELEMETRY: 'false' };
}

interface CliAccount {
  tenantId?: unknown;
  user?: { name?: unknown };
  isDefault?: unknown;
}

function idFor(tenantId: string, username: string): string {
  return `azure-cli:${tenantId.toLocaleLowerCase('en-US')}:${username.toLocaleLowerCase('en-US')}`;
}

function parseAccounts(text: string): AccountSummary[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Azure CLI returned unreadable sign-in information. Run `az login` in Terminal and try again.'); }
  if (!Array.isArray(parsed)) throw new Error('Azure CLI returned unreadable sign-in information.');
  const accounts = new Map<string, AccountSummary>();
  for (const item of parsed as CliAccount[]) {
    const tenantId = typeof item.tenantId === 'string' ? item.tenantId : '';
    const username = typeof item.user?.name === 'string' ? item.user.name : '';
    if (!tenantId || !username) continue;
    const homeAccountId = idFor(tenantId, username);
    accounts.set(homeAccountId, { homeAccountId, tenantId, username });
  }
  return [...accounts.values()];
}

function findCli(): string {
  const configured = process.env.AGENTIC_QA_AZ_CLI_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  const executable = process.platform === 'win32' ? 'az.cmd' : 'az';
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  const homeCandidate = join(homedir(), '.local', 'share', 'agentic-qa', 'azure-cli', 'bin', executable);
  if (existsSync(homeCandidate)) return homeCandidate;
  throw new Error('Azure CLI was not found. Install Azure CLI, then restart Agentic QA.');
}

function runCli(executable: string, args: string[], options: Parameters<typeof execFile>[2]) {
  if (process.platform === 'win32' && executable.toLocaleLowerCase('en-US').endsWith('.cmd')) {
    const python = join(dirname(dirname(executable)), 'python.exe');
    return execFile(python, ['-IB', '-m', 'azure.cli', ...args], options);
  }
  return execFile(executable, args, options);
}

export class AzureCliAdoAuthService implements AdoAuthService {
  constructor(private readonly executable = findCli()) {}

  async getAccounts(): Promise<AccountSummary[]> {
    try {
      const { stdout } = await runCli(this.executable, ['account', 'list', '--all', '--output', 'json', '--only-show-errors'], { env: cliEnvironment(), timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' });
      return parseAccounts(String(stdout));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Azure CLI was not found. Install Azure CLI, then restart Agentic QA.');
      throw new Error('Could not read the Azure CLI sign-in. Run `az login` in Terminal and try again.');
    }
  }

  async signIn(): Promise<AccountSummary> {
    let stdout: string;
    try {
      stdout = String((await runCli(this.executable, ['login', '--allow-no-subscriptions', '--output', 'json', '--only-show-errors'], { env: cliEnvironment(), timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' })).stdout);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Azure CLI was not found. Install Azure CLI, then restart Agentic QA.');
      throw new Error('Azure CLI sign-in did not complete. Finish the Microsoft browser sign-in or run `az login` in Terminal, then retry.');
    }
    const accounts = parseAccounts(stdout);
    if (!accounts.length) throw new Error('Azure CLI sign-in completed without an Azure account. Run `az login` and try again.');
    return accounts[0]!;
  }

  async getAccessToken(homeAccountId: string): Promise<string> {
    const account = (await this.getAccounts()).find(({ homeAccountId: id }) => id === homeAccountId);
    if (!account) throw new Error('The selected Azure CLI account is no longer signed in. Sign in again to continue.');
    try {
      const { stdout } = await runCli(this.executable, ['account', 'get-access-token', '--resource', ADO_RESOURCE_ID, '--tenant', account.tenantId, '--query', 'accessToken', '--output', 'tsv', '--only-show-errors'], { env: cliEnvironment(), timeout: 30_000, maxBuffer: 16 * 1024, windowsHide: true, encoding: 'utf8' });
      const token = String(stdout).trim();
      if (!token || /\s/.test(token)) throw new Error('empty token');
      return token;
    } catch {
      throw new Error('Could not get an Azure DevOps token from Azure CLI. Check that the selected account can access this organization and run `az login` again if needed.');
    }
  }

  async signOut(_homeAccountId: string): Promise<void> {
    // Keep the user's machine-wide Azure CLI session intact; this only disconnects the app.
  }
}

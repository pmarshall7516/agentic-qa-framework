import { normalizeHtmlText, normalizeWorkItem, type RawAdoWorkItem } from './normalize.js';
import type { WorkItemSnapshot, WorkItemTypeMappings } from '@agentic-qa/domain/work-item';

const ADO_API_VERSION = '7.1';
const MAX_BATCH_SIZE = 200;
const MAX_PROJECT_PAGES = 100;
const MAX_RETRIES = 2;
const ADO_RESOURCE = 'https://app.vssps.visualstudio.com';

export type AdoRequestErrorKind =
  | 'authentication'
  | 'permission'
  | 'rate-limited'
  | 'network'
  | 'service'
  | 'malformed-response';

export class AdoRequestError extends Error {
  readonly kind: AdoRequestErrorKind;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(kind: AdoRequestErrorKind, message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'AdoRequestError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
  }
}

export interface AdoProject {
  id: string;
  name: string;
  state?: string;
}

export interface AdoTeam { id: string; name: string }
export interface AdoIteration { id: string; name: string; path?: string }
export interface AdoTaskboardItem { workItemId: number; column: string; state?: string }

export interface AdoOrganization {
  id: string;
  name: string;
}

export interface AdoGitRepository { id: string; name: string; defaultBranch?: string }
export interface AdoGitRef { name: string; objectId: string }
export interface AdoGitItem { path: string; isFolder: boolean }

export interface SearchInput {
  organization: string;
  projectId: string;
  projectName: string;
  term: string;
  types?: string[];
  states?: string[];
  afterId?: number;
  customTypeMappings?: WorkItemTypeMappings;
}

export interface WorkItemSearchPage { items: WorkItemSnapshot[]; nextAfterId?: number }

export interface FetchItemsInput {
  organization: string;
  projectId: string;
  projectName: string;
  ids: number[];
  customTypeMappings?: WorkItemTypeMappings;
}

export interface AdoClientOptions {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => string;
}

interface JsonResponse {
  [key: string]: unknown;
}

export function resolveOrganization(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Enter an Azure DevOps organization name or dev.azure.com URL');
  }

  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('Enter an Azure DevOps organization name or dev.azure.com URL');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'dev.azure.com' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      segments.length !== 1
    ) {
      throw new Error('Enter an Azure DevOps organization name or dev.azure.com URL');
    }
    try {
      candidate = decodeURIComponent(segments[0]);
    } catch {
      throw new Error('Enter an Azure DevOps organization name or dev.azure.com URL');
    }
  }

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?$/.test(candidate)) {
    throw new Error('Enter an Azure DevOps organization name or dev.azure.com URL');
  }
  return candidate;
}

function quoteWiql(value: string): string {
  return `'${value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120).replace(/'/g, "''")}'`;
}

function responseError(status: number): AdoRequestError {
  if (status === 401) {
    return new AdoRequestError('authentication', 'Azure DevOps sign-in expired. Sign in again.', status);
  }
  if (status === 403) {
    return new AdoRequestError('permission', 'Azure DevOps denied access to this organization or project.', status);
  }
  if (status === 429) {
    return new AdoRequestError('rate-limited', 'Azure DevOps is rate limiting requests. Try again shortly.', status, true);
  }
  return new AdoRequestError('service', `Azure DevOps request failed with status ${status}.`, status, status >= 500);
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
    return Math.min(30_000, Math.max(0, Number(retryAfter) * 1000));
  }
  return 250 * 2 ** attempt;
}

function idsFromRelations(raw: RawAdoWorkItem | undefined, relationType: string): number[] {
  const ids = new Set<number>();
  for (const relation of raw?.relations ?? []) {
    if (relation.rel !== relationType || typeof relation.url !== 'string') continue;
    const match = relation.url.match(/\/workItems\/(\d+)(?:\?.*)?$/i);
    if (match) ids.add(Number(match[1]));
  }
  return [...ids];
}

export class AdoClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => string;

  constructor(options: AdoClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async getProfile(accessToken: string): Promise<JsonResponse> {
    return this.requestJson(
      `${ADO_RESOURCE}/_apis/profile/profiles/me?api-version=7.1-preview.3`,
      accessToken,
    );
  }

  async listOrganizations(accessToken: string, memberId: string): Promise<AdoOrganization[]> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
      throw new AdoRequestError('malformed-response', 'Azure DevOps returned an invalid profile ID for organization discovery.');
    }
    const url = new URL(`${ADO_RESOURCE}/_apis/accounts`);
    url.searchParams.set('memberId', memberId);
    url.searchParams.set('api-version', ADO_API_VERSION);
    const data = await this.requestJson(url.toString(), accessToken);
    if (!Array.isArray(data.value)) {
      throw new AdoRequestError('malformed-response', 'Azure DevOps returned an unreadable organization list.');
    }
    return data.value.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const account = value as Record<string, unknown>;
      if (typeof account.accountId !== 'string' || typeof account.accountName !== 'string') return [];
      try {
        return [{ id: account.accountId, name: resolveOrganization(account.accountName) }];
      } catch {
        return [];
      }
    });
  }

  async listProjects(accessToken: string, organizationInput: string): Promise<AdoProject[]> {
    const organization = resolveOrganization(organizationInput);
    const baseUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects`;
    const projects: AdoProject[] = [];
    let continuationToken: string | null = null;

    for (let page = 0; page < MAX_PROJECT_PAGES; page += 1) {
      const url = new URL(baseUrl);
      url.searchParams.set('api-version', ADO_API_VERSION);
      url.searchParams.set('$top', '100');
      if (continuationToken) url.searchParams.set('continuationToken', continuationToken);
      const { data, response } = await this.requestJsonWithResponse(url.toString(), accessToken);
      const values = Array.isArray(data.value) ? data.value : [];
      for (const value of values) {
        if (!value || typeof value !== 'object') continue;
        const project = value as Record<string, unknown>;
        if (typeof project.id !== 'string' || typeof project.name !== 'string') continue;
        projects.push({
          id: project.id,
          name: project.name,
          ...(typeof project.state === 'string' ? { state: project.state } : {}),
        });
      }
      continuationToken = response.headers.get('x-ms-continuationtoken');
      if (!continuationToken) return projects;
    }

    throw new AdoRequestError('malformed-response', 'Azure DevOps project listing exceeded the page limit.');
  }

  async listTeams(accessToken: string, organizationInput: string, projectId: string): Promise<AdoTeam[]> {
    const organization = resolveOrganization(organizationInput);
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects/${encodeURIComponent(projectId)}/teams`);
    url.searchParams.set('api-version', ADO_API_VERSION);
    const data = await this.requestJson(url.toString(), accessToken);
    if (!Array.isArray(data.value)) return [];
    return data.value.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const team = entry as Record<string, unknown>;
      return typeof team.id === 'string' && typeof team.name === 'string' ? [{ id: team.id, name: team.name }] : [];
    });
  }

  async getCurrentIteration(accessToken: string, organizationInput: string, projectId: string, team: string): Promise<AdoIteration | undefined> {
    const organization = resolveOrganization(organizationInput);
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectId)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations`);
    url.searchParams.set('$timeframe', 'current');
    url.searchParams.set('api-version', ADO_API_VERSION);
    const data = await this.requestJson(url.toString(), accessToken);
    if (!Array.isArray(data.value)) return undefined;
    const item = data.value.find((entry) => entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'string') as Record<string, unknown> | undefined;
    return item ? { id: String(item.id), name: typeof item.name === 'string' ? item.name : '', ...(typeof item.path === 'string' ? { path: item.path } : {}) } : undefined;
  }

  async getTaskboardItems(accessToken: string, organizationInput: string, projectId: string, team: string, iterationId: string): Promise<AdoTaskboardItem[]> {
    const organization = resolveOrganization(organizationInput);
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectId)}/${encodeURIComponent(team)}/_apis/work/taskboardworkitems/${encodeURIComponent(iterationId)}`);
    url.searchParams.set('api-version', ADO_API_VERSION);
    const data = await this.requestJson(url.toString(), accessToken);
    const candidates = Array.isArray(data.workItems) ? data.workItems : Array.isArray(data.value) ? data.value : [];
    return candidates.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const workItemId = Number(item.workItemId ?? item.id);
      if (!Number.isSafeInteger(workItemId) || workItemId < 1 || typeof item.column !== 'string') return [];
      return [{ workItemId, column: item.column, ...(typeof item.state === 'string' ? { state: item.state } : {}) }];
    });
  }

  async getWorkItemComments(accessToken: string, organizationInput: string, projectId: string, workItemId: number): Promise<string[]> {
    const organization = resolveOrganization(organizationInput);
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectId)}/_apis/wit/workItems/${workItemId}/comments`);
    url.searchParams.set('api-version', '7.1-preview.4');
    const data = await this.requestJson(url.toString(), accessToken);
    if (!Array.isArray(data.comments) && !Array.isArray(data.value)) return [];
    const comments = Array.isArray(data.comments) ? data.comments : data.value as unknown[];
    return comments.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const text = (entry as Record<string, unknown>).text ?? (entry as Record<string, unknown>).commentText;
      if (typeof text !== 'string') return [];
      const plain = normalizeHtmlText(text)?.trim() ?? '';
      return plain ? [plain.slice(0, 12_000)] : [];
    });
  }

  async getWorkItemTypes(accessToken: string, organizationInput: string, projectId: string): Promise<string[]> {
    const organization = resolveOrganization(organizationInput);
    const url = new URL(
      `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectId)}/_apis/wit/workitemtypes`,
    );
    url.searchParams.set('api-version', ADO_API_VERSION);
    const data = await this.requestJson(url.toString(), accessToken);
    if (!Array.isArray(data.value)) return [];
    return data.value
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).name : undefined))
      .filter((name): name is string => typeof name === 'string');
  }

  async listGitRepositories(accessToken: string, organizationInput: string, projectId: string): Promise<AdoGitRepository[]> {
    const organization = resolveOrganization(organizationInput);
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(projectId)}/_apis/git/repositories`);
    url.searchParams.set('api-version', ADO_API_VERSION);
    const data = await this.requestJson(url.toString(), accessToken);
    if (!Array.isArray(data.value)) throw new AdoRequestError('malformed-response', 'Azure DevOps returned an unreadable repository list.');
    return data.value.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.name !== 'string') return [];
      return [{ id: item.id, name: item.name, ...(typeof item.defaultBranch === 'string' ? { defaultBranch: item.defaultBranch } : {}) }];
    });
  }

  async listGitRefs(accessToken: string, organizationInput: string, repositoryId: string): Promise<AdoGitRef[]> {
    const organization = resolveOrganization(organizationInput);
    const refs: AdoGitRef[] = [];
    let continuationToken: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/refs`);
      url.searchParams.set('api-version', ADO_API_VERSION);
      url.searchParams.set('$top', '1000');
      if (continuationToken) url.searchParams.set('continuationToken', continuationToken);
      const { data, response } = await this.requestJsonWithResponse(url.toString(), accessToken);
      if (!Array.isArray(data.value)) throw new AdoRequestError('malformed-response', 'Azure DevOps returned an unreadable repository ref list.');
      for (const value of data.value) {
        if (!value || typeof value !== 'object') continue;
        const item = value as Record<string, unknown>;
        if (typeof item.name === 'string' && typeof item.objectId === 'string' && /^[a-f0-9]{40,64}$/i.test(item.objectId)) refs.push({ name: item.name, objectId: item.objectId });
      }
      continuationToken = response.headers.get('x-ms-continuationtoken');
      if (!continuationToken) return refs;
    }
    throw new AdoRequestError('malformed-response', 'Azure DevOps repository ref listing exceeded the page limit.');
  }

  async listGitItems(accessToken: string, organizationInput: string, repositoryId: string, commit: string): Promise<AdoGitItem[]> {
    const organization = resolveOrganization(organizationInput);
    if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw new Error('Select a repository ref with a resolved commit SHA.');
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items`);
    url.searchParams.set('api-version', ADO_API_VERSION);
    url.searchParams.set('scopePath', '/');
    url.searchParams.set('recursionLevel', 'Full');
    url.searchParams.set('includeContentMetadata', 'true');
    url.searchParams.set('$top', '10000');
    url.searchParams.set('versionDescriptor.versionType', 'commit');
    url.searchParams.set('versionDescriptor.version', commit);
    const { data, response } = await this.requestJsonWithResponse(url.toString(), accessToken);
    const values = Array.isArray(data.value) ? data.value : [];
    const items: AdoGitItem[] = [];
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      if (typeof item.path !== 'string' || typeof item.isFolder !== 'boolean') continue;
      items.push({ path: item.path, isFolder: item.isFolder });
    }
    if (response.headers.get('x-ms-continuationtoken') || items.length >= 10000) throw new AdoRequestError('malformed-response', 'This repository has too many files for the v1 snapshot limit.');
    return items;
  }

  async getGitItemContent(accessToken: string, organizationInput: string, repositoryId: string, commit: string, path: string): Promise<string> {
    const organization = resolveOrganization(organizationInput);
    if (!/^[a-f0-9]{40,64}$/i.test(commit) || !path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new Error('The selected Git item path or commit is invalid.');
    const url = new URL(`https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items`);
    url.searchParams.set('api-version', ADO_API_VERSION);
    url.searchParams.set('path', path);
    url.searchParams.set('includeContent', 'true');
    url.searchParams.set('versionDescriptor.versionType', 'commit');
    url.searchParams.set('versionDescriptor.version', commit);
    const data = await this.requestJson(url.toString(), accessToken);
    if (typeof data.content !== 'string' || data.content.length > 120 * 1024 * 1024) throw new AdoRequestError('malformed-response', 'A selected repository file is missing or exceeds the source snapshot limit.');
    const metadata = data.contentMetadata as Record<string, unknown> | undefined;
    if (metadata?.isBinary === true || (metadata?.encoding !== undefined && metadata.encoding !== 65001)) throw new AdoRequestError('malformed-response', 'Binary or non-UTF-8 repository files are not supported in the source snapshot.');
    return data.content;
  }

  async search(accessToken: string, input: SearchInput): Promise<WorkItemSearchPage> {
    const organization = resolveOrganization(input.organization);
    const projectName = quoteWiql(input.projectName);
    const predicates = [`[System.TeamProject] = ${projectName}`];
    const term = input.term.trim();
    if (input.afterId !== undefined && (!Number.isInteger(input.afterId) || input.afterId < 1 || input.afterId > 2_147_483_647)) throw new Error('The search continuation ID is invalid.');
    if (/^\d+$/.test(term)) {
      predicates.push(`[System.Id] = ${Number(term)}`);
    } else {
      if (term) predicates.push(`[System.Title] CONTAINS ${quoteWiql(term)}`);
      if (input.afterId !== undefined) predicates.push(`[System.Id] > ${input.afterId}`);
    }
    if (input.types?.length) {
      predicates.push(
        `[System.WorkItemType] IN (${input.types.map(quoteWiql).join(', ')})`,
      );
    }
    if (input.states?.length) {
      predicates.push(`[System.State] IN (${input.states.map(quoteWiql).join(', ')})`);
    }

    const url = new URL(
      `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(input.projectId)}/_apis/wit/wiql`,
    );
    url.searchParams.set('api-version', ADO_API_VERSION);
    url.searchParams.set('$top', String(MAX_BATCH_SIZE));
    const result = await this.requestJson(url.toString(), accessToken, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `SELECT [System.Id] FROM WorkItems WHERE ${predicates.join(' AND ')} ORDER BY [System.Id] ASC`,
      }),
    });
    const ids = Array.isArray(result.workItems)
      ? result.workItems
          .slice(0, MAX_BATCH_SIZE)
          .map((item) => (item && typeof item === 'object' ? Number((item as Record<string, unknown>).id) : NaN))
          .filter((id) => Number.isInteger(id) && id > 0)
      : [];

    const snapshots = await this.fetchWorkItems(accessToken, {
      ...input,
      organization,
      ids,
    });
    const isExactIdSearch = /^\d+$/.test(term);
    return {
      items: snapshots.sort((left, right) => left.id - right.id),
      ...(!isExactIdSearch && ids.length === MAX_BATCH_SIZE ? { nextAfterId: ids.at(-1) } : {}),
    };
  }

  async fetchWorkItems(accessToken: string, input: FetchItemsInput): Promise<WorkItemSnapshot[]> {
    const organization = resolveOrganization(input.organization);
    const ids = [...new Set(input.ids)].filter((id) => Number.isInteger(id) && id > 0);
    const snapshots: WorkItemSnapshot[] = [];
    const fields = [
      'System.TeamProject',
      'System.WorkItemType',
      'System.Title',
      'System.State',
      'System.Description',
      'Microsoft.VSTS.Common.AcceptanceCriteria',
    ];

    for (let index = 0; index < ids.length; index += MAX_BATCH_SIZE) {
      const batch = ids.slice(index, index + MAX_BATCH_SIZE);
      const url = new URL(
        `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/workitemsbatch`,
      );
      url.searchParams.set('api-version', ADO_API_VERSION);
      const data = await this.requestJson(url.toString(), accessToken, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: batch, fields, $expand: 'Relations' }),
      });
      if (!Array.isArray(data.value)) continue;
      for (const item of data.value) {
        if (!item || typeof item !== 'object') continue;
        snapshots.push(
          normalizeWorkItem(item as RawAdoWorkItem, {
            organization,
            projectId: input.projectId,
            projectName: input.projectName,
            customTypeMappings: input.customTypeMappings,
            now: this.now,
          }),
        );
      }
    }
    return snapshots;
  }

  async getChildren(
    accessToken: string,
    input: Omit<FetchItemsInput, 'ids'> & { parentId: number },
  ): Promise<WorkItemSnapshot[]> {
    const childIds = await this.getChildIds(accessToken, input);
    const children = await this.fetchWorkItems(accessToken, { ...input, ids: childIds });
    return children.filter(({ kind }) => kind === 'TASK');
  }

  async getChildIds(
    accessToken: string,
    input: Pick<FetchItemsInput, 'organization'> & { parentId: number },
  ): Promise<number[]> {
    const organization = resolveOrganization(input.organization);
    if (!Number.isInteger(input.parentId) || input.parentId < 1) return [];
    const url = new URL(
      `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/wit/workitems/${input.parentId}`,
    );
    url.searchParams.set('api-version', ADO_API_VERSION);
    url.searchParams.set('$expand', 'Relations');
    const parent = (await this.requestJson(url.toString(), accessToken)) as RawAdoWorkItem;
    return idsFromRelations(parent, 'System.LinkTypes.Hierarchy-Forward');
  }

  private async requestJson(
    url: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<JsonResponse> {
    return (await this.requestJsonWithResponse(url, accessToken, init)).data;
  }

  private async requestJsonWithResponse(
    url: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<{ data: JsonResponse; response: Response }> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json',
          },
        });
      } catch {
        throw new AdoRequestError('network', 'Could not reach Azure DevOps. Check the connection and try again.', undefined, true);
      }

      if (response.ok) {
        try {
          const data: unknown = await response.json();
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('invalid');
          }
          return { data: data as JsonResponse, response };
        } catch {
          throw new AdoRequestError('malformed-response', 'Azure DevOps returned an unreadable response.');
        }
      }

      const error = responseError(response.status);
      const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === MAX_RETRIES) throw error;
      await this.sleep(retryDelay(response, attempt));
    }
    throw new AdoRequestError('service', 'Azure DevOps request stopped unexpectedly.');
  }
}

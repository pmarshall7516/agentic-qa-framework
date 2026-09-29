import { describe, expect, it, vi } from 'vitest';
import { AdoClient, AdoRequestError } from '../src/client.js';

function jsonResponse(value: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('read-only ADO client', () => {
  it('discovers the signed-in member organizations through the fixed Accounts API', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const memberId = '11111111-1111-4111-8111-111111111111';
    const client = new AdoClient({ fetcher: async (input, init) => {
      requests.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') });
      return jsonResponse({ value: [
        { accountId: 'org-1', accountName: 'contoso' },
        { accountId: 'org-2', accountName: 'fabrikam-team' },
        { accountId: 'org-bad', accountName: 'https://attacker.example' },
      ] });
    } });

    await expect(client.listOrganizations('test-token', memberId)).resolves.toEqual([
      { id: 'org-1', name: 'contoso' },
      { id: 'org-2', name: 'fabrikam-team' },
    ]);
    expect(requests[0]?.url).toContain('https://app.vssps.visualstudio.com/_apis/accounts?');
    expect(new URL(requests[0]!.url).searchParams.get('memberId')).toBe(memberId);
    expect(new URL(requests[0]!.url).searchParams.get('api-version')).toBe('7.1');
    expect(requests[0]?.authorization).toBe('Bearer test-token');
  });

  it('rejects malformed organization account responses', async () => {
    const client = new AdoClient({ fetcher: async () => jsonResponse({ value: 'not-an-array' }) });
    await expect(client.listOrganizations('test-token', '11111111-1111-4111-8111-111111111111'))
      .rejects.toMatchObject({ kind: 'malformed-response' });
  });

  it('lists repositories and refs through fixed Azure DevOps endpoints and pins commit identities', async () => {
    const requests: string[] = [];
    const client = new AdoClient({ fetcher: async (input) => {
      const url = String(input); requests.push(url);
      if (url.includes('/repositories?')) return jsonResponse({ value: [{ id: 'repo-1', name: 'Portal', defaultBranch: 'refs/heads/main' }] });
      if (url.includes('continuationToken=')) return jsonResponse({ value: [{ name: 'refs/tags/v1', objectId: 'b'.repeat(40) }] });
      return jsonResponse({ value: [{ name: 'refs/heads/main', objectId: 'a'.repeat(40) }, { name: 'bad', objectId: 'not-a-commit' }] }, { 'x-ms-continuationtoken': 'next' });
    }, sleep: async () => undefined });
    await expect(client.listGitRepositories('token', 'contoso', 'project-1')).resolves.toEqual([{ id: 'repo-1', name: 'Portal', defaultBranch: 'refs/heads/main' }]);
    await expect(client.listGitRefs('token', 'contoso', 'repo-1')).resolves.toEqual([{ name: 'refs/heads/main', objectId: 'a'.repeat(40) }, { name: 'refs/tags/v1', objectId: 'b'.repeat(40) }]);
    expect(requests.every((url) => new URL(url).hostname === 'dev.azure.com')).toBe(true);
  });

  it('rejects binary repository items before staging', async () => {
    const client = new AdoClient({ fetcher: async () => jsonResponse({ content: 'base64-data', contentMetadata: { encoding: 1200, isBinary: true } }) });
    await expect(client.getGitItemContent('token', 'contoso', 'repo-1', 'a'.repeat(40), '/file.bin')).rejects.toThrow('Binary or non-UTF-8');
  });
  it('validates organization identifiers and never accepts a caller-provided API host', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ id: 'me' }));
    const client = new AdoClient({ fetcher });

    await expect(client.listProjects('token', 'https://attacker.example/contoso')).rejects.toThrow(
      'Enter an Azure DevOps organization name or dev.azure.com URL',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('follows project continuation tokens and sends only bearer authorization', async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token');
      if (!url.includes('continuationToken=')) {
        return jsonResponse(
          { value: [{ id: 'p1', name: 'Alpha' }] },
          { 'x-ms-continuationtoken': 'next + page' },
        );
      }
      return jsonResponse({ value: [{ id: 'p2', name: 'Beta' }] });
    };
    const client = new AdoClient({ fetcher });

    await expect(client.listProjects('test-token', 'contoso')).resolves.toEqual([
      { id: 'p1', name: 'Alpha', state: undefined },
      { id: 'p2', name: 'Beta', state: undefined },
    ]);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => new URL(url).hostname === 'dev.azure.com')).toBe(true);
  });

  it('limits batch reads to 200 work item IDs', async () => {
    const batchSizes: number[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { ids: number[] };
      batchSizes.push(body.ids.length);
      return jsonResponse({
        value: body.ids.map((id) => ({
          id,
          rev: 1,
          fields: { 'System.WorkItemType': 'Task', 'System.Title': `Task ${id}` },
        })),
      });
    };
    const client = new AdoClient({ fetcher, now: () => '2026-09-27T12:00:00.000Z' });

    const items = await client.fetchWorkItems('test-token', {
      organization: 'contoso',
      projectId: 'p1',
      projectName: 'Portal',
      ids: Array.from({ length: 201 }, (_, index) => index + 1),
    });

    expect(batchSizes).toEqual([200, 1]);
    expect(items).toHaveLength(201);
  });

  it('returns only Task children when browsing a Story', async () => {
    const client = new AdoClient({ fetcher: async (input) => {
      const url = String(input);
      if (url.includes('/workitems/42?')) return jsonResponse({ id: 42, rev: 1, relations: [
        { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/contoso/_apis/wit/workItems/43' },
        { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/contoso/_apis/wit/workItems/44' },
      ] });
      return jsonResponse({ value: [
        { id: 43, rev: 1, fields: { 'System.WorkItemType': 'Task', 'System.Title': 'Implement filters' }, relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/contoso/_apis/wit/workItems/42' }] },
        { id: 44, rev: 1, fields: { 'System.WorkItemType': 'Bug', 'System.Title': 'Related bug' }, relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/contoso/_apis/wit/workItems/42' }] },
      ] });
    }, now: () => '2026-09-27T12:00:00.000Z' });

    const children = await client.getChildren('token', { organization: 'contoso', projectId: 'p1', projectName: 'Portal', parentId: 42 });
    expect(children.map(({ id, kind }) => ({ id, kind }))).toEqual([{ id: 43, kind: 'TASK' }]);
  });

  it('pages search results by immutable work item ID cursor', async () => {
    const queries: string[] = [];
    const client = new AdoClient({ fetcher: async (input, init) => {
      if (String(input).includes('/wiql?')) {
        const query = (JSON.parse(String(init?.body)) as { query: string }).query;
        queries.push(query);
        const start = query.includes('[System.Id] > 200') ? 201 : 1;
        return jsonResponse({ workItems: Array.from({ length: 200 }, (_, index) => ({ id: start + index })) });
      }
      const ids = (JSON.parse(String(init?.body)) as { ids: number[] }).ids;
      return jsonResponse({ value: [...ids.filter((id) => id !== 400)].reverse().map((id) => ({ id, rev: 1, fields: { 'System.WorkItemType': 'User Story', 'System.Title': `Story ${id}`, 'System.State': 'Active' } })) });
    } });
    const page = await client.search('token', { organization: 'contoso', projectId: 'p1', projectName: 'Portal', term: 'login', afterId: 200 });
    expect(page.items).toHaveLength(199);
    expect(page.items[0]?.id).toBe(201);
    expect(page.nextAfterId).toBe(400);
    expect(queries[0]).toContain('[System.Id] > 200');
    expect(queries[0]).toContain('ORDER BY [System.Id] ASC');
  });

  it('escapes WIQL text and keeps the request on the validated organization host', async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.includes('/wiql?')) return jsonResponse({ workItems: [] });
      return jsonResponse({ value: [] });
    };
    const client = new AdoClient({ fetcher });

    await client.search('test-token', {
      organization: 'contoso',
      projectId: 'p1',
      projectName: "Portal's QA",
      term: "x' OR [System.Id] > 0 --",
    });

    const wiql = requests.find((request) => request.url.includes('/wiql?'))!;
    expect(wiql.url).toContain('https://dev.azure.com/contoso/');
    expect(wiql.body).toContain("x'' OR [System.Id] > 0 --");
    expect(wiql.body).toContain("Portal''s QA");
    expect(requests.every((request) => new URL(request.url).hostname === 'dev.azure.com')).toBe(true);
  });

  it.each([
    [401, 'authentication'],
    [403, 'permission'],
  ] as const)('maps HTTP %s to an actionable %s error', async (status, kind) => {
    const fetcher: typeof fetch = async () => new Response('', { status });
    const client = new AdoClient({ fetcher });

    await expect(client.getProfile('token')).rejects.toMatchObject({ kind });
  });

  it('retries a bounded read after a rate limit and honors Retry-After', async () => {
    let calls = 0;
    const waits: number[] = [];
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 429, headers: { 'retry-after': '2' } })
        : jsonResponse({ id: 'profile-1', displayName: 'QA User' });
    };
    const client = new AdoClient({
      fetcher,
      sleep: async (ms) => { waits.push(ms); },
    });

    await expect(client.getProfile('token')).resolves.toMatchObject({ displayName: 'QA User' });
    expect(calls).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it('stops after the retry budget when the service remains rate-limited', async () => {
    const client = new AdoClient({
      fetcher: async () => new Response('', { status: 429 }),
      sleep: async () => undefined,
    });
    await expect(client.getProfile('token')).rejects.toMatchObject({
      kind: 'rate-limited',
      retryable: true,
    } satisfies Partial<AdoRequestError>);
  });
});

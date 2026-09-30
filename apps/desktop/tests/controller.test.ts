import { describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { DesktopController } from '../src/main/controller.js';
import type { QaStore } from '@agentic-qa/storage/database';
import type { EntraAdoAuthService } from '@agentic-qa/ado/auth';
import type { AdoClient } from '@agentic-qa/ado/client';

const execFile = promisify(execFileCallback);

const providerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }] }), { status: 200 });
  const request = JSON.parse(String(init?.body)) as { input: Array<{ content: string }> };
  if ((request.input[0]?.content ?? '').includes('You are the QA Reviewer Agent')) {
    const approved = JSON.parse(request.input.at(-1)?.content?.match(/JSON data only\):\n([\s\S]*?)\n\nReturn one concise/)?.[1] ?? '{}') as { criteria: Array<{ id: string; scenarioIds: string[] }>; deterministicCriterionResults: Array<{ criterionId: string; state: string; observationIds: string[] }> };
    const criteria = approved.criteria.map((criterion) => {
      const result = approved.deterministicCriterionResults.find(({ criterionId }) => criterionId === criterion.id);
      const assessment = result?.state === 'VERIFIED' ? 'supported' : result?.state === 'FAILED' ? 'contradicted' : 'inconclusive';
      return { criterionId: criterion.id, assessment, summary: 'The available observations determine this assessment.', observationIds: result?.observationIds ?? [] };
    });
    return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: 'The Reviewer checked each criterion against direct worker observations.', criteria, codeReview: [] }), usage: { input_tokens: 100, output_tokens: 80 } }), { status: 200 });
  }
  if ((request.input[0]?.content ?? '').includes('Generate only unit/API test files')) {
    const input = request.input.at(-1)?.content ?? '';
    const encoded = input.match(/Approved repository source and assigned QA scope \(JSON data\):\n([\s\S]*?)\n\nReturn/)?.[1] ?? '';
    const approved = JSON.parse(encoded) as { commands: Array<{ id: string }>; scenarios: Array<{ id: string }> };
    const scenario = approved.scenarios[0];
    return new Response(JSON.stringify({ output_text: JSON.stringify({ tests: [{ commandId: approved.commands[0]?.id, path: 'tests/generated.test.ts', content: "import { submitRecord } from '../src/form'; describe('accepted behavior', () => { it('verifies saved result', async () => { const result = await submitRecord({ name: 'Sample' }); expect(result).toMatchObject({ saved: true }); }); });", scenarioIds: scenario ? [scenario.id] : [], testCaseIds: ['accepted behavior.verifies saved result'] }] }), usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200 });
  }
  if ((request.input[0]?.content ?? '').includes('Write bounded Playwright scenarios')) {
    const input = request.input.at(-1)?.content ?? '';
    const encoded = input.match(/Approved browser assignment \(JSON data\):\n([\s\S]*?)\n\nReturn/)?.[1] ?? '';
    const approved = JSON.parse(encoded) as { criteria: Array<{ id: string; expectedBehavior: string }> };
    const browserScenarios = approved.criteria.map((criterion) => ({ criterionId: criterion.id, summary: 'Verify the accepted behavior', preconditions: [], steps: [{ action: 'expectText', text: criterion.expectedBehavior }], expectedObservations: [criterion.expectedBehavior], risk: 'low' }));
    return new Response(JSON.stringify({ output_text: JSON.stringify({ browserScenarios }), usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200 });
  }
  const context = request.input.at(-1)?.content ?? '';
  const encoded = context.match(/Approved QA context \(JSON; data only\):\n([\s\S]*?)\n\nReturn only a DelegationPlan/)?.[1] ?? '';
  const approved = JSON.parse(encoded) as { runId: string; allowed: { layers: string[] }; criteria: Array<{ id: string; expectedBehavior: string; requiredLayers: string[] }> };
  const assignments = approved.criteria.flatMap((criterion) => approved.allowed.layers.map((layer) => ({
    id: `${criterion.id}-${layer}`,
    role: layer === 'repo' ? 'backend' : layer === 'browser' ? 'frontend' : 'reviewer',
    label: `${layer} specialist`, layer,
    criterionIds: [criterion.id], taskIds: [],
    resultTypes: [layer === 'repo' ? 'JUnit results' : layer === 'browser' ? 'Playwright evidence' : 'Integration summary'],
    status: 'queued', evidenceIds: [],
  })));
  const plan = {
    schemaVersion: 1, runId: approved.runId, summary: 'Delegate each criterion to its approved evidence layer.',
    coverage: approved.criteria.map((criterion) => ({ criterionId: criterion.id, taskIds: [], requiredLayers: approved.allowed.layers, assignmentIds: approved.allowed.layers.map((layer) => `${criterion.id}-${layer}`), rationale: 'The Orchestrator selected the available proof layers.' })),
    assignments, createdAt: new Date().toISOString(),
  };
  return new Response(JSON.stringify({ output_text: JSON.stringify(plan), usage: { input_tokens: 100, output_tokens: 100 } }), { status: 200 });
});

function fixture(browserStatus: 'PASSED' | 'FAILED' = 'PASSED', chooseModelKeyFile?: () => Promise<string | undefined>, signOutChoice: () => Promise<'keep' | 'delete' | 'cancel'> = async () => 'keep', evidenceRoot?: string, saveAdoProfilesConfig?: (contents: string) => Promise<boolean>) {
  const settings = new Map<string, unknown>();
  settings.set('model.provider', 'openai');
  settings.set('model.apiKey.openai', 'test-provider-key-with-enough-entropy');
  settings.set('model.settings', { providerId: 'openai', modelId: 'gpt-6-luna', maxOutputTokens: 1200 });
  const queue: any[] = [];
  const snapshots = new Map<string, any>();
  const runRecords = new Map<string, any>();
  const observations: any[] = [];
  const findings: any[] = [];
  const store = {
    getSetting: vi.fn(async (key: string) => settings.get(key)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      if (!/^[A-Za-z][A-Za-z0-9._-]{0,100}$/.test(key)) throw new Error('Invalid setting key');
      settings.set(key, value);
    }),
    getQueue: vi.fn(async () => queue),
    getSnapshot: vi.fn(async (key: string) => snapshots.get(key)),
    addToQueue: vi.fn(async (snapshot: any) => {
      const entry = { key: `org:${snapshot.projectId}:${snapshot.id}`, organization: 'org', projectId: snapshot.projectId, workItemId: snapshot.id, queuedAt: '2026-01-01T00:00:00.000Z', stale: false };
      const existing = queue.find((candidate) => candidate.key === entry.key);
      if (existing) { existing.stale = false; snapshots.set(entry.key, snapshot); return existing; }
      queue.push(entry); snapshots.set(entry.key, snapshot); return entry;
    }),
    removeFromQueue: vi.fn(async (key: string) => { const i = queue.findIndex((item) => item.key === key); if (i >= 0) queue.splice(i, 1); }),
    reorderQueue: vi.fn(async () => {}),
    markStale: vi.fn(async () => {}),
    createRun: vi.fn(async (manifest: any, contract: any) => { runRecords.set(manifest.runId, { manifest, contract, observations: [], findings: [], artifacts: [], progress: [] }); }),
    listRuns: vi.fn(async () => [...runRecords.values()].map(({ manifest, report }) => ({ manifest, ...(report ? { report } : {}) }))),
    getRun: vi.fn(async (runId: string) => runRecords.get(runId)),
    appendObservation: vi.fn(async (observation: any) => { observations.push(observation); runRecords.get(observation.runId)?.observations.push(observation); }),
    appendFinding: vi.fn(async (runId: string, finding: any) => { findings.push(finding); runRecords.get(runId)?.findings.push(finding); }),
    appendProgress: vi.fn(async (event: any) => { runRecords.get(event.runId)?.progress.push(event); }),
    getProgress: vi.fn(async (runId: string) => runRecords.get(runId)?.progress ?? []),
    finalizeRun: vi.fn(async (report: any) => { const run = runRecords.get(report.runId); run.report = report; }),
    finalizeReview: vi.fn(async (report: any) => { const run = runRecords.get(report.runId); run.reviewedReport = report; }),
    deleteRun: vi.fn(async (runId: string) => { runRecords.delete(runId); }),
    deleteLocalQaData: vi.fn(async () => { queue.splice(0); snapshots.clear(); runRecords.clear(); }),
    recordArtifact: vi.fn(async (artifact: any) => { runRecords.get(artifact.runId)?.artifacts.push(artifact); }),
  } as unknown as QaStore;
  const account = { homeAccountId: 'account-1', tenantId: 'tenant', username: 'qa@example.com' };
  settings.set('entra.selectedAccountId', account.homeAccountId);
  const auth = {
    getAccounts: vi.fn(async () => [account]),
    signIn: vi.fn(async () => account),
    signOut: vi.fn(async () => {}),
    getAccessToken: vi.fn(async () => 'secret-token'),
  } as unknown as EntraAdoAuthService;
  const ado = {
    getProfile: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
    listOrganizations: vi.fn(async () => [{ id: 'org-id-1', name: 'org' }]),
    listProjects: vi.fn(async () => [{ id: 'project-1', name: 'Project One' }]),
    getWorkItemTypes: vi.fn(async () => ['User Story', 'Task']),
    listTeams: vi.fn(async () => [{ id: 'team-1', name: 'QA Team' }]),
    listTeamIterations: vi.fn(async () => []),
    getTaskboardItems: vi.fn(async () => []),
    getChildIds: vi.fn(async () => []),
    getWorkItemTypeStates: vi.fn(async () => []),
    search: vi.fn(async () => [{ id: 17, organization: 'org', projectId: 'project-1' }]),
    fetchWorkItems: vi.fn(async (_token: string, input: any) => input.ids.map((id: number) => {
      const previous = snapshots.get(`org:${input.projectId}:${id}`);
      return { ...previous, organization: input.organization, projectId: input.projectId, projectName: input.projectName,
        id, revision: previous?.revision ?? 1, type: previous?.type ?? 'User Story', kind: previous?.kind ?? 'REQUIREMENT', title: previous?.title ?? `Item ${id}`, state: previous?.state ?? 'New',
        url: previous?.url ?? `https://dev.azure.com/${input.organization}/${input.projectId}/_workitems/edit/${id}`,
        retrievedAt: '2026-01-01T00:00:00.000Z' };
    })),
  } as unknown as AdoClient;
  const browserScenarioRunner = vi.fn(async (input: any) => ({
    observation: { id: randomUUID(), runId: input.runId, scenarioId: input.scenario.id, status: browserStatus, worker: 'browser', startedAt: '2026-09-27T12:00:00.000Z', endedAt: '2026-09-27T12:00:01.000Z', assertion: browserStatus === 'PASSED' ? 'Expected text is visible.' : 'Expected text was not visible.', artifactIds: [], sourceIdentity: new URL(input.target.siteBaseUrl).origin },
    artifacts: [], cancelled: false,
  }));
  const controller = new DesktopController({ store, authFactory: async () => auth, ado, browserScenarioRunner: browserScenarioRunner as any, sitePreflight: async () => undefined, browserExecutablePath: () => process.execPath, confirmDeleteRun: async () => true, selectSignOutDataAction: signOutChoice, chooseModelKeyFile, evidenceRoot, saveAdoProfilesConfig, providerFetch: providerFetch as typeof fetch });
  return { controller, settings, store, auth, ado, queue, snapshots, runRecords, browserScenarioRunner };
}

describe('desktop controller', () => {
  it('requires a saved provider key and a supported agent model before creating a run plan', async () => {
    const { controller, settings } = fixture();
    settings.delete('model.provider');
    settings.delete('model.apiKey.openai');
    settings.delete('model.settings');
    await expect(controller.createDraftPlan()).rejects.toThrow('Configure a provider API key and select a supported model');
  });

  it('stores provider credentials outside renderer state and validates selected models through discovery', async () => {
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-6-luna' }] }), { status: 200 }));
    const { store, auth } = fixture();
    const keyDirectory = await mkdtemp(join(tmpdir(), 'agentic-provider-key-'));
    const keyPath = join(keyDirectory, 'key.txt');
    const keyText = 'test-provider-key-with-enough-entropy';
    await writeFile(keyPath, keyText, { mode: 0o600 });
    try {
      const securedController = new DesktopController({
        store, authFactory: async () => auth, chooseModelKeyFile: async () => keyPath,
        providerFetch: providerFetch as typeof fetch,
      });
      await securedController.importProviderKey('openai');
      const models = await securedController.listProviderModels('openai');
      expect(models.map(({ modelId }) => modelId)).toEqual(['gpt-6-luna']);
      await securedController.saveAgentModelSettings({ providerId: 'openai', modelId: 'gpt-6-luna', maxOutputTokens: 1200 });
      const state = await securedController.getState();
      expect(state.modelProviderConfigured).toBe(true);
      expect(state.modelId).toBe('gpt-6-luna');
      expect(JSON.stringify(state)).not.toContain(keyText);
      expect(providerFetch).toHaveBeenCalledTimes(2);
    } finally { await rm(keyDirectory, { recursive: true, force: true }); }
  });

  it('uses the injected Azure CLI auth adapter without returning credential data to the renderer', async () => {
    const { store, settings, auth } = fixture();
    settings.delete('entra.clientId');
    const authFactory = vi.fn(async () => auth);
    const controller = new DesktopController({ store, authFactory });

    const state = await controller.signIn();

    expect(authFactory).toHaveBeenCalledOnce();
    expect(authFactory).toHaveBeenCalledWith();
    expect(state.azureCliAvailable).toBe(true);
    expect(state).not.toHaveProperty('accessToken');
  });

  it('records local Git cleanliness without persisting changed filenames', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-git-state-'));
    const { controller } = fixture();
    try {
      await execFile('git', ['init', '--quiet', directory]);
      expect(await (controller as any).inspectLocalGitState(directory)).toBe('clean');
      await writeFile(join(directory, 'private-change.txt'), 'local work');
      expect(await (controller as any).inspectLocalGitState(directory)).toBe('dirty');
      expect(JSON.stringify(await (controller as any).inspectLocalGitState(directory))).not.toContain('private-change.txt');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('discovers organizations using the selected account profile ID', async () => {
    const { controller, ado } = fixture();

    await expect(controller.listOrganizations()).resolves.toEqual([{ id: 'org-id-1', name: 'org' }]);

    expect(ado.getProfile).toHaveBeenCalledWith('secret-token');
    expect(ado.listOrganizations).toHaveBeenCalledWith('secret-token', '11111111-1111-4111-8111-111111111111');
  });

  it('validates and remembers organizations per signed-in account without duplicates', async () => {
    const { controller, settings, auth } = fixture();
    await controller.selectOrganization('https://dev.azure.com/org');
    await controller.selectOrganization('org');

    expect(settings.get('ado.organizations.account-1')).toEqual(['org']);
    expect((await controller.getState()).savedOrganizations).toEqual(['org']);

    const secondAccount = { homeAccountId: 'account-2', tenantId: 'tenant-2', username: 'other@example.com' };
    (auth.getAccounts as any).mockResolvedValue([{ homeAccountId: 'account-1', tenantId: 'tenant', username: 'qa@example.com' }, secondAccount]);
    settings.set('entra.selectedAccountId', secondAccount.homeAccountId);
    await controller.selectOrganization('fabrikam');
    expect(settings.get('ado.organizations.account-2')).toEqual(['fabrikam']);
    expect(settings.get('ado.organization.account-1')).toBe('org');
  });

  it('uses a storage-safe key for Azure CLI account IDs containing punctuation', async () => {
    const { controller, settings, auth, store } = fixture();
    const cliAccount = {
      homeAccountId: 'azure-cli:11111111-1111-4111-8111-111111111111:qa@example.com',
      tenantId: '11111111-1111-4111-8111-111111111111',
      username: 'qa@example.com',
    };
    (auth.getAccounts as any).mockResolvedValue([cliAccount]);
    settings.set('entra.selectedAccountId', cliAccount.homeAccountId);

    await controller.selectOrganization('org');

    const persistedKeys = (store.setSetting as any).mock.calls.map(([key]: [string]) => key);
    const accountHash = createHash('sha256').update(cliAccount.homeAccountId).digest('hex');
    expect(persistedKeys).toContain(`ado.organizations.${accountHash}`);
    expect(persistedKeys.every((key: string) => /^[A-Za-z][A-Za-z0-9._-]{0,100}$/.test(key))).toBe(true);
  });

  it('does not save an organization until project access has been validated', async () => {
    const { controller, settings, ado } = fixture();
    (ado.listProjects as any).mockRejectedValueOnce(new Error('Azure DevOps denied access to this organization or project.'));

    await expect(controller.selectOrganization('not-a-member')).rejects.toThrow('denied access');

    expect(settings.has('ado.organizations.account-1')).toBe(false);
    expect(settings.has('ado.organization.account-1')).toBe(false);
  });
  it('keeps tokens in the main service and sends only account summaries to the UI', async () => {
    const { controller, auth } = fixture();
    const state = await controller.signIn();
    expect(auth.signIn).toHaveBeenCalledOnce();
    expect(JSON.stringify(state)).not.toContain('secret-token');
    expect(state.accounts).toEqual([{ homeAccountId: 'account-1', tenantId: 'tenant', username: 'qa@example.com' }]);
  });

  it('deletes retained local QA data only after the user chooses delete during sign-out', async () => {
    const { controller, store, auth } = fixture('PASSED', undefined, async () => 'delete');

    const state = await controller.signOut('account-1');

    expect(store.deleteLocalQaData).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledWith('account-1');
    expect(state.queue).toEqual([]);
  });

  it('preserves sign-in and local data when sign-out is cancelled', async () => {
    const { controller, store, auth } = fixture('PASSED', undefined, async () => 'cancel');

    const state = await controller.signOut('account-1');

    expect(store.deleteLocalQaData).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(state.selectedAccountId).toBe('account-1');
  });

  it('removes each retained evidence directory when local QA data deletion is selected', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'agentic-sign-out-evidence-'));
    const { controller, runRecords } = fixture('PASSED', undefined, async () => 'delete', evidenceRoot);
    const runId = '22222222-2222-4222-8222-222222222222';
    const runDirectory = join(evidenceRoot, runId);
    await mkdir(runDirectory);
    await writeFile(join(runDirectory, 'encrypted-artifact.aqe'), 'ciphertext');
    runRecords.set(runId, { manifest: { runId }, contract: {}, observations: [], findings: [], artifacts: [] });
    try {
      await controller.signOut('account-1');
      await expect(access(runDirectory)).rejects.toThrow();
    } finally { await rm(evidenceRoot, { recursive: true, force: true }); }
  });

  it('scopes queue additions to the selected organization and project', async () => {
    const { controller, ado } = fixture();
    await controller.signIn();
    await controller.selectOrganization('org');
    await controller.listProjects();
    await controller.selectProject({ id: 'project-1', name: 'Project One' });
    await controller.addQueueItem(17);
    expect(ado.fetchWorkItems).toHaveBeenCalledWith('secret-token', expect.objectContaining({
      organization: 'org', projectId: 'project-1', ids: [17],
    }));
  });

  it('loads teams from the organization and project currently entered in the profile form', async () => {
    const { controller, ado } = fixture();

    await expect(controller.listAdoTeams({ organization: 'other-org', project: { name: 'Project One' } })).resolves.toEqual([{ id: 'team-1', name: 'QA Team' }]);

    expect(ado.listProjects).toHaveBeenCalledWith('secret-token', 'other-org');
    expect(ado.listTeams).toHaveBeenCalledWith('secret-token', 'other-org', 'project-1');
  });

  it('lists iterations only for the active validated profile team', async () => {
    const { controller, settings, ado } = fixture();
    const profileId = '55555555-5555-4555-8555-555555555555';
    settings.set('ado.profiles.account-1', [{ id: profileId, name: 'QA', organization: 'org', project: { id: 'project-1', name: 'Project One' }, team: 'QA Team', boardColumn: 'Ready', storyIds: [] }]);
    settings.set('ado.activeProfile.account-1', profileId);
    (ado.listTeamIterations as any).mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 1', path: 'Project One\\Sprint 1' }]);

    await expect((controller as any).listProfileIterations()).resolves.toEqual([{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 1', path: 'Project One\\Sprint 1' }]);
    expect(ado.listTeamIterations).toHaveBeenCalledWith('secret-token', 'org', 'project-1', 'QA Team');
  });

  it('loads taskboard columns only for a sprint available to the active profile team', async () => {
    const { controller, settings, ado } = fixture();
    const profileId = '55555555-5555-4555-8555-555555555555';
    const iterationId = '11111111-1111-4111-8111-111111111111';
    settings.set('ado.profiles.account-1', [{ id: profileId, name: 'QA', organization: 'org', project: { id: 'project-1', name: 'Project One' }, team: 'QA Team', boardColumn: '', storyIds: [] }]);
    settings.set('ado.activeProfile.account-1', profileId);
    (ado.listTeamIterations as any).mockResolvedValue([{ id: iterationId, name: 'Sprint 1', path: 'Project One\\Sprint 1' }]);
    (ado.getTaskboardItems as any).mockResolvedValue([{ workItemId: 17, column: 'In Progress', state: 'Active' }]);

    await expect(controller.listSprintTaskboard(iterationId)).resolves.toEqual([{ workItemId: 17, column: 'In Progress', state: 'Active' }]);
    expect(ado.getTaskboardItems).toHaveBeenCalledWith('secret-token', 'org', 'project-1', 'QA Team', iterationId);
    await expect(controller.listSprintTaskboard('22222222-2222-4222-8222-222222222222')).rejects.toThrow('not available to the active profile team');
    expect(ado.getTaskboardItems).toHaveBeenCalledOnce();
  });

  it('searches a sprint for Requirements in proposed or in-progress states by their actual type', async () => {
    const { controller, settings, ado } = fixture();
    const profileId = '55555555-5555-4555-8555-555555555555';
    settings.set('ado.profiles.account-1', [{ id: profileId, name: 'QA', organization: 'org', project: { id: 'project-1', name: 'Project One' }, team: 'QA Team', boardColumn: 'Ready', storyIds: [] }]);
    settings.set('ado.activeProfile.account-1', profileId);
    (ado.listTeamIterations as any).mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 1', path: 'Project One\\Sprint 1' }]);
    (ado.getWorkItemTypeStates as any).mockResolvedValue([{ name: 'New', category: 'Proposed' }, { name: 'Doing', category: 'InProgress' }, { name: 'Done', category: 'Completed' }]);
    (ado.search as any).mockResolvedValue({ items: [] });

    await (controller as any).searchActiveStories('11111111-1111-4111-8111-111111111111');

    expect(ado.search).toHaveBeenCalledWith('secret-token', expect.objectContaining({
      organization: 'org', projectId: 'project-1', iterationPath: 'Project One\\Sprint 1',
      statesByType: { 'User Story': ['New', 'Doing'] },
    }));
  });

  it('adds a bounded, unique selection to the queue with one batched work-item fetch', async () => {
    const { controller, store, ado } = fixture();
    await controller.selectOrganization('org');
    await controller.selectProject({ id: 'project-1', name: 'Project One' });

    await controller.addQueueItems([{ workItemId: 17 }, { workItemId: 18 }, { workItemId: 17 }]);

    expect(ado.fetchWorkItems).toHaveBeenCalledTimes(1);
    expect(ado.fetchWorkItems).toHaveBeenCalledWith('secret-token', expect.objectContaining({ ids: [17, 18] }));
    expect(store.addToQueue).toHaveBeenCalledTimes(2);
  });

  it('persists a validated Task-to-Story relationship when batch ADO details omit parent relations', async () => {
    const { controller, store, ado } = fixture();
    await controller.selectOrganization('org');
    await controller.selectProject({ id: 'project-1', name: 'Project One' });
    (ado.fetchWorkItems as any).mockImplementationOnce(async (_token: string, input: any) => input.ids.map((id: number) => ({
      organization: input.organization, projectId: input.projectId, projectName: input.projectName, id, revision: 1,
      type: id === 17 ? 'User Story' : 'Task', kind: id === 17 ? 'REQUIREMENT' : 'TASK', title: `Item ${id}`, state: 'New',
      url: `https://dev.azure.com/${input.organization}/${input.projectId}/_workitems/edit/${id}`, retrievedAt: '2026-01-01T00:00:00.000Z',
    })));
    (ado.getChildIds as any).mockResolvedValue([18]);

    await controller.addQueueItems([{ workItemId: 18, parentId: 17 }]);

    expect(ado.fetchWorkItems).toHaveBeenCalledWith('secret-token', expect.objectContaining({ ids: [18, 17] }));
    expect(ado.getChildIds).toHaveBeenCalledWith('secret-token', { organization: 'org', parentId: 17 });
    expect(store.addToQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 18, kind: 'TASK', parentId: 17 }));
  });

  it('rejects a forged or stale Task-to-Story relationship before adding any selected item', async () => {
    const { controller, store, ado } = fixture();
    await controller.selectOrganization('org');
    await controller.selectProject({ id: 'project-1', name: 'Project One' });
    (ado.fetchWorkItems as any).mockImplementationOnce(async (_token: string, input: any) => input.ids.map((id: number) => ({
      organization: input.organization, projectId: input.projectId, projectName: input.projectName, id, revision: 1,
      type: id === 17 ? 'User Story' : 'Task', kind: id === 17 ? 'REQUIREMENT' : 'TASK', title: `Item ${id}`, state: 'New',
      url: `https://dev.azure.com/${input.organization}/${input.projectId}/_workitems/edit/${id}`, retrievedAt: '2026-01-01T00:00:00.000Z',
    })));

    await expect(controller.addQueueItems([{ workItemId: 18, parentId: 17 }])).rejects.toThrow('no longer linked');
    expect(store.addToQueue).not.toHaveBeenCalled();
  });

  it('rejects an unsupported selected work item before writing any of the batch to the queue', async () => {
    const { controller, store, ado } = fixture();
    await controller.selectOrganization('org');
    await controller.selectProject({ id: 'project-1', name: 'Project One' });
    (ado.fetchWorkItems as any).mockImplementationOnce(async (_token: string, input: any) => input.ids.map((id: number) => ({
      organization: input.organization, projectId: input.projectId, projectName: input.projectName,
      id, revision: 1, type: id === 18 ? 'Bug' : 'User Story', kind: id === 18 ? 'OTHER' : 'REQUIREMENT', title: `Item ${id}`, state: 'New',
      url: `https://dev.azure.com/${input.organization}/${input.projectId}/_workitems/edit/${id}`, retrievedAt: '2026-01-01T00:00:00.000Z',
    })));

    await expect(controller.addQueueItems([{ workItemId: 17 }, { workItemId: 18 }])).rejects.toThrow('No selected items were added');

    expect(store.addToQueue).not.toHaveBeenCalled();
  });

  it('exports saved profile settings without app secrets or work-item payloads', async () => {
    const serialized: string[] = [];
    const { controller, settings } = fixture('PASSED', undefined, undefined, undefined, async (contents) => {
      serialized.push(contents);
      return true;
    });
    settings.set('ado.profiles.account-1', [{
      id: '55555555-5555-4555-8555-555555555555', name: 'Portal QA', organization: 'contoso',
      project: { id: 'project-1', name: 'Portal', state: 'wellFormed' }, team: 'Portal Team',
      boardColumn: 'Ready for QA', storyIds: [42, 43],
    }]);
    settings.set('model.apiKey', 'secret-key-canary');

    await expect((controller as any).exportAdoProfilesConfig()).resolves.toBe(true);

    expect(JSON.parse(serialized[0]!)).toEqual({ schemaVersion: 1, profiles: [{
      name: 'Portal QA', organization: 'contoso',
      project: { id: 'project-1', name: 'Portal', state: 'wellFormed' },
      team: 'Portal Team', boardColumn: 'Ready for QA', storyIds: [42, 43],
    }] });
    expect(serialized[0]).not.toContain('secret-key-canary');
  });

  it('persists project-scoped custom work item mappings and applies them to searches', async () => {
    const { controller, ado } = fixture();
    (ado.getWorkItemTypes as any).mockResolvedValue(['Feature Request', 'Task']);
    await controller.selectOrganization('org');
    await controller.selectProject({ id: 'project-1', name: 'Project One' });
    const state = await controller.saveWorkItemTypeMapping('Feature Request', 'REQUIREMENT');
    expect(state.customTypeMappings).toEqual({ 'Feature Request': 'REQUIREMENT' });
    await controller.searchItems({ term: 'login', types: ['Feature Request'], states: [] });
    expect((ado.search as any).mock.calls.at(-1)?.[1].customTypeMappings).toEqual({ 'Feature Request': 'REQUIREMENT' });
  });

  it('creates a local disclosure draft from requirement criteria and keeps tasks as context', async () => {
    const { controller, settings, store, queue, snapshots, runRecords, browserScenarioRunner } = fixture();
    const requirement = {
      organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 17, revision: 5,
      type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active',
      acceptanceCriteria: '- Results show the title\n- Filters remain selected',
      url: 'https://dev.azure.com/org/project-1/_workitems/edit/17', retrievedAt: '2026-09-27T12:00:00.000Z',
    };
    const task = { ...requirement, id: 18, type: 'Task', kind: 'TASK', description: 'Add a filter-state API check.', acceptanceCriteria: 'Task text is context only' };
    for (const snapshot of [requirement, task]) {
      const entry = { key: `org:project-1:${snapshot.id}`, organization: 'org', projectId: 'project-1', workItemId: snapshot.id, queuedAt: '2026-01-01T00:00:00.000Z', stale: false };
      queue.push(entry); snapshots.set(entry.key, snapshot);
    }
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    expect(draft.contract.criteria.map(({ expectedBehavior }) => expectedBehavior)).toEqual(['Results show the title', 'Filters remain selected']);
    expect(draft.contract.criteria).toHaveLength(2);
    expect(draft.contract.sourceContext.find(({ workItemId }) => workItemId === 18)?.description).toBe('Add a filter-state API check.');
    expect(draft.contract.taskCandidates).toMatchObject([{ source: { workItemId: 18, field: 'System.Description' }, text: 'Add a filter-state API check.', disposition: 'PROPOSED' }]);
    expect(draft.notes[0]).toContain('does not prove parent acceptance criteria');
    expect(draft.manifest.sources).toHaveLength(2);
    const approved = { ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
    await controller.approvePlan(approved);
    expect(store.createRun).toHaveBeenCalledOnce();
    const storedContract = runRecords.get(draft.manifest.runId).contract;
    expect(storedContract.scenarios.filter(({ layer }: { layer: string }) => layer === 'browser')).toHaveLength(2);
    expect(storedContract.scenarios.find(({ layer }: { layer: string }) => layer === 'browser')?.steps)
      .toEqual([{ action: 'expectText', text: 'Results show the title' }]);
    const report = await controller.startRun(draft.manifest.runId);
    expect(report.executionState).toBe('COMPLETED');
    expect(report.verdict).toBe('PASS');
    expect(report.criterionResults.every(({ state }: { state: string }) => state === 'VERIFIED')).toBe(true);
    expect(browserScenarioRunner).toHaveBeenCalledTimes(2);
    expect(runRecords.get(draft.manifest.runId).report).toEqual(report);
    const agentRun = await controller.getRun(draft.manifest.runId);
    expect(agentRun?.reviewerReport?.summary).toContain('Reviewer checked each criterion');
    expect(agentRun?.agentSummary).toContain('observations');
    expect(agentRun?.delegationDiagram?.nodes.find(({ id }) => id === 'agent:reviewer')).toMatchObject({ status: 'completed' });
    await expect(controller.approvePlan(approved)).rejects.toThrow('no longer current');
  });

  it('approves a Task-derived candidate only when it retains its queued description provenance', async () => {
    const { controller, settings, queue, snapshots, store } = fixture();
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 71, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Save sheet', state: 'Active', acceptanceCriteria: 'The sheet appears after save.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/71', retrievedAt: '2026-09-27T12:00:00.000Z' };
    const task = { ...requirement, id: 72, revision: 4, type: 'Task', kind: 'TASK', title: 'Persist sheet', acceptanceCriteria: undefined, description: 'Persist selected sheet values through the API.' };
    const missingCriteria = { ...requirement, id: 73, acceptanceCriteria: undefined, title: 'Export sheet' };
    for (const snapshot of [requirement, task, missingCriteria]) {
      const key = `org:project-1:${snapshot.id}`;
      queue.push({ key, organization: 'org', projectId: 'project-1', workItemId: snapshot.id, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
      snapshots.set(key, snapshot);
    }
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    const candidate = draft.contract.taskCandidates[0]!;
    const criterionId = `${candidate.id}-criterion`;
    const scenarioId = `${candidate.id}-browser`;
    const contract = {
      ...draft.contract,
      criteria: [...draft.contract.criteria, { id: criterionId, source: { userAdded: true as const, author: 'Reviewer', derivedFrom: candidate.source }, expectedBehavior: candidate.text, requiredLayers: ['browser' as const], scenarioIds: [scenarioId], ambiguityNotes: [] }],
      scenarios: [...draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })), { id: scenarioId, criterionIds: [criterionId], layer: 'browser' as const, preconditions: [], steps: [{ action: 'expectText' as const, text: candidate.text }], expectedObservations: [candidate.text], risk: 'medium' as const, approved: true }],
      taskCandidates: [{ ...candidate, disposition: 'ACCEPTED' as const, criterionId }],
    };
    await expect(controller.approvePlan({ ...draft, contract: { ...contract, coverageGaps: [] } })).rejects.toThrow('source context and coverage gaps are frozen');
    await controller.approvePlan({ ...draft, contract });
    expect(store.createRun).toHaveBeenCalledOnce();
    await expect(controller.getRunProgress(draft.manifest.runId)).resolves.toEqual([]);
  });

  it('encrypts browser artifacts before persistence and links them from observations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-browser-evidence-'));
    const tracePath = join(directory, 'trace.zip');
    await writeFile(tracePath, 'private trace canary');
    const { controller, settings, queue, snapshots, runRecords, store, browserScenarioRunner } = fixture();
    (controller as any).evidenceRoot = join(directory, 'encrypted');
    (controller as any).artifactKey = async () => Buffer.alloc(32, 7);
    (browserScenarioRunner as any).mockImplementation(async (input: any) => ({
      observation: { id: randomUUID(), runId: input.runId, scenarioId: input.scenario.id, status: 'PASSED', worker: 'browser', startedAt: '2026-09-27T12:00:00.000Z', endedAt: '2026-09-27T12:00:01.000Z', assertion: 'Expected text is visible.', artifactIds: [], sourceIdentity: new URL(input.target.siteBaseUrl).origin },
      artifacts: [{ kind: 'trace', path: tracePath }], cancelled: false,
    }));
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 117, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/117', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:117', organization: 'org', projectId: 'project-1', workItemId: 117, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:117', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    try {
      const draft = await controller.createDraftPlan();
      await controller.approvePlan({ ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } });
      await controller.startRun(draft.manifest.runId);
      const run = runRecords.get(draft.manifest.runId);
      expect(run.observations[0]?.artifactIds).toHaveLength(1);
      expect(run.artifacts[0]?.kind).toBe('trace');
      const encryptedPath = join((controller as any).evidenceRoot, run.artifacts[0].relativePath);
      expect(await readFile(encryptedPath, 'utf8')).not.toContain('private trace canary');
      expect(store.recordArtifact).toHaveBeenCalledOnce();
      const saveEvidenceFile = vi.fn(async (_filename: string, contents: Buffer, restricted: boolean) => {
        expect(restricted).toBe(true);
        expect(contents.toString('utf8')).toBe('private trace canary');
        return true;
      });
      (controller as any).saveEvidenceFile = saveEvidenceFile;
      await expect(controller.exportArtifact(draft.manifest.runId, run.artifacts[0].id)).resolves.toBe(true);
      expect(saveEvidenceFile).toHaveBeenCalledOnce();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('preserves observations and original report when a reviewer confirms a product failure', async () => {
    const { controller, settings, queue, snapshots, runRecords, store } = fixture('FAILED');
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 27, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/27', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:27', organization: 'org', projectId: 'project-1', workItemId: 27, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:27', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    const approved = { ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
    await controller.approvePlan(approved);
    const originalReport = await controller.startRun(draft.manifest.runId);
    expect(originalReport.verdict).toBe('NEEDS_REVIEW');
    const observationsBefore = [...runRecords.get(draft.manifest.runId).observations];
    const finding = runRecords.get(draft.manifest.runId).findings[0];
    const reviewed = await controller.classifyFinding({ runId: draft.manifest.runId, findingId: finding.id, kind: 'PRODUCT_FAILURE', author: 'Reviewer', reason: 'Reproduced the missing result in staging.' });
    expect(reviewed.verdict).toBe('FAIL');
    expect(runRecords.get(draft.manifest.runId).report).toEqual(originalReport);
    expect(runRecords.get(draft.manifest.runId).reviewedReport).toEqual(reviewed);
    expect(runRecords.get(draft.manifest.runId).observations).toEqual(observationsBefore);
    expect(runRecords.get(draft.manifest.runId).findings.at(-1).humanOverride).toMatchObject({ author: 'Reviewer', previousKind: 'INSUFFICIENT_EVIDENCE' });
    expect(store.finalizeReview).toHaveBeenCalledOnce();
  });

  it('creates an independently approved rerun linked to its immutable predecessor', async () => {
    const { controller, settings, queue, snapshots, runRecords, store } = fixture();
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 28, revision: 3, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/28', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:28', organization: 'org', projectId: 'project-1', workItemId: 28, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:28', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const first = await controller.createDraftPlan();
    const approved = { ...first, contract: { ...first.contract, scenarios: first.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
    await controller.approvePlan(approved);
    await controller.startRun(first.manifest.runId);

    const rerun = await controller.createDraftPlan(first.manifest.runId);
    expect(rerun.manifest.runId).not.toBe(first.manifest.runId);
    expect(rerun.manifest.previousRunId).toBe(first.manifest.runId);
    expect(rerun.manifest.sources).toEqual(first.manifest.sources);
    expect(rerun.contract.id).not.toBe(first.contract.id);
    expect(rerun.contract.scenarios.every(({ approved: isApproved }) => !isApproved)).toBe(true);
    expect(store.createRun).toHaveBeenCalledOnce();
    expect(runRecords.get(first.manifest.runId).report.verdict).toBe('PASS');
  });

  it('restores verified Story and Task grouping when refreshing an older queue without parent links', async () => {
    const { controller, queue, snapshots, ado, store } = fixture();
    const story = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 48, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'Results appear', url: 'https://dev.azure.com/org/project-1/_workitems/edit/48', retrievedAt: '2026-09-27T12:00:00.000Z' };
    const task = { ...story, id: 49, revision: 1, type: 'Task', kind: 'TASK', title: 'Build search UI', acceptanceCriteria: undefined, url: 'https://dev.azure.com/org/project-1/_workitems/edit/49' };
    queue.push(
      { key: 'org:project-1:48', organization: 'org', projectId: 'project-1', workItemId: 48, queuedAt: '2026-09-27T12:00:00.000Z', stale: false },
      { key: 'org:project-1:49', organization: 'org', projectId: 'project-1', workItemId: 49, queuedAt: '2026-09-27T12:00:00.000Z', stale: false },
    );
    snapshots.set('org:project-1:48', story);
    snapshots.set('org:project-1:49', task);
    (store.getQueue as any).mockResolvedValueOnce([...queue]);
    (ado.getChildIds as any).mockResolvedValue([49]);
    (ado.fetchWorkItems as any).mockImplementation(async (_token: string, input: any) => input.ids.map((id: number) => id === 48 ? story : task));

    await controller.refreshQueue();

    expect(ado.getChildIds).toHaveBeenCalledWith('secret-token', { organization: 'org', parentId: 48 });
    expect(store.addToQueue).toHaveBeenCalledWith({ ...task, parentId: 48 });
  });

  it('marks an ADO item stale when its revision changes after draft creation and refuses approval', async () => {
    const { controller, settings, queue, snapshots, ado, store } = fixture();
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 38, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/38', retrievedAt: '2026-09-27T12:00:00.000Z' };
    const key = 'org:project-1:38';
    queue.push({ key, organization: 'org', projectId: 'project-1', workItemId: 38, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set(key, requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    const approved = { ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
    (ado.fetchWorkItems as any).mockImplementation(async (_token: string, input: any) => input.ids.map((id: number) => ({ ...requirement, id, revision: 3 })));
    await expect(controller.approvePlan(approved)).rejects.toThrow('changed after this plan was created');
    expect(store.markStale).toHaveBeenCalledWith(key, true);
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it('stages only configured non-secret files from an ADO Git commit and freezes the commit SHA', async () => {
    const { controller, settings, queue, snapshots, ado } = fixture();
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 29, revision: 4, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/29', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:29', organization: 'org', projectId: 'project-1', workItemId: 29, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:29', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const commit = 'a'.repeat(40);
    const config = `schemaVersion: 1\nproject:\n  name: fixture\nrepository:\n  include: [package.json, .env]\n  exclude: []\nsetup: []\ntests:\n  - id: unit\n    label: Unit\n    executable: npm\n    arguments: [test]\n    workingDirectory: .\n    timeoutSeconds: 30\n    network: none\n    resultFormat: none\n    resultPaths: []\n    scenarioMappings: []\nlimits:\n  browserActions: 100\n  runSeconds: 1800\n  artifactMiB: 500\n`;
    (ado as any).listGitItems = vi.fn(async () => [
      { path: '/.agentic-qa.yml', isFolder: false }, { path: '/package.json', isFolder: false }, { path: '/.env', isFolder: false },
    ]);
    (ado as any).getGitItemContent = vi.fn(async (_token: string, _org: string, _repo: string, _commit: string, path: string) => path === '/.agentic-qa.yml' ? config : path === '/package.json' ? '{"name":"safe"}' : 'SECRET=canary');
    settings.set('entra.selectedAccountId', 'account-1');
    settings.set('run.target', { targetKind: 'repository', repositorySource: 'ado-git', adoRepository: { organization: 'org', projectId: 'project-1', id: 'repo-1', name: 'Portal', refName: 'refs/heads/main', commit }, allowedOrigins: [] });
    const draft = await controller.createDraftPlan();
    expect(draft.manifest.sourceCommit).toBe(commit);
    expect(draft.manifest.sourceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect((ado as any).getGitItemContent).toHaveBeenCalledWith('secret-token', 'org', 'repo-1', commit, '/package.json');
    expect((ado as any).getGitItemContent).not.toHaveBeenCalledWith('secret-token', 'org', 'repo-1', commit, '/.env');
  });

  it('recovers partial evidence after interruption and prevents retrying the same immutable run', async () => {
    const { controller, settings, queue, snapshots, runRecords, store } = fixture();
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 37, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/37', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:37', organization: 'org', projectId: 'project-1', workItemId: 37, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:37', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    const approved = { ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
    await controller.approvePlan(approved);
    const scenario = approved.contract.scenarios[0];
    const partialObservation = { id: randomUUID(), runId: draft.manifest.runId, scenarioId: scenario.id, status: 'PASSED' as const, worker: 'browser' as const, startedAt: '2026-09-27T12:00:00.000Z', endedAt: '2026-09-27T12:00:01.000Z', assertion: 'The expected result was visible.', artifactIds: [], sourceIdentity: 'https://site.example.test' };
    await store.appendObservation(partialObservation);

    const [recovered] = await controller.listRuns();
    expect(recovered.report).toMatchObject({ executionState: 'INTERRUPTED', verdict: 'BLOCKED' });
    expect(runRecords.get(draft.manifest.runId).observations).toEqual([partialObservation]);
    expect(runRecords.get(draft.manifest.runId).findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'ENVIRONMENT_FAILURE', unresolved: true })]));
    await expect(controller.startRun(draft.manifest.runId)).rejects.toThrow('immutable run already has a final report');
  });

  it('recovers a run that crashed after progress began but before evidence was written', async () => {
    const { controller, settings, queue, snapshots, store, runRecords } = fixture();
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 75, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A result appears.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/75', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:75', organization: 'org', projectId: 'project-1', workItemId: 75, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:75', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    await controller.approvePlan({ ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } });
    await store.appendProgress({ runId: draft.manifest.runId, worker: 'orchestrator', state: 'RUNNING', stage: 'preflight', message: 'Checking target.', at: '2026-09-27T12:00:02.000Z' });
    const [recovered] = await controller.listRuns();
    expect(recovered.report).toMatchObject({ executionState: 'INTERRUPTED', verdict: 'BLOCKED' });
    expect(runRecords.get(draft.manifest.runId).progress.at(-1)).toMatchObject({ worker: 'orchestrator', state: 'FAILED', stage: 'interrupted-recovery' });
  });

  it('keeps the optional suggestion route from bypassing mandatory agentic run planning', async () => {
    const { controller } = fixture();
    await expect(controller.previewModelRequest(randomUUID(), ['criterion-1']))
      .rejects.toThrow('This plan is no longer current');
  });

  it('creates and saves an encrypted app-local repository config starter without editing the repository', async () => {
    const { controller, settings } = fixture();
    const target = { targetKind: 'repository' as const, repositorySource: 'local' as const, repositoryPath: join(tmpdir(), 'fixture-repo'), allowedOrigins: [] };
    const starter = await controller.getRepositoryConfigDraft(target);
    const parsed = JSON.parse(starter);
    expect(parsed.tests[0]).toMatchObject({ executable: 'npm', arguments: ['test'], network: 'none', resultFormat: 'none' });
    await controller.saveRepositoryConfigDraft({ target, content: starter });
    expect(JSON.parse(await controller.getRepositoryConfigDraft(target))).toEqual(parsed);
    expect([...settings.keys()].some((key) => key.startsWith('repository.config.'))).toBe(true);
  });

  it('uses the encrypted app-local config to create a repository plan without a repo config file', async () => {
    const { controller, settings, queue, snapshots } = fixture();
    const repositoryPath = await mkdtemp(join(tmpdir(), 'qa-configured-repo-'));
    try {
      const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 74, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Persist', state: 'Active', acceptanceCriteria: 'The saved record is returned by the API.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/74', retrievedAt: '2026-09-27T12:00:00.000Z' };
      queue.push({ key: 'org:project-1:74', organization: 'org', projectId: 'project-1', workItemId: 74, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
      snapshots.set('org:project-1:74', requirement);
      const target = { targetKind: 'repository' as const, repositorySource: 'local' as const, repositoryPath, allowedOrigins: [] };
      settings.set('run.target', target);
      const starter = await controller.getRepositoryConfigDraft(target);
      await controller.saveRepositoryConfigDraft({ target, content: starter });
      const draft = await controller.createDraftPlan();
      expect(draft.repositoryCommands).toMatchObject([{ executable: 'npm', arguments: ['test'] }]);
      expect(draft.notes.some((note) => note.toLocaleLowerCase('en-US').includes('repository scenario'))).toBe(true);
    } finally { await rm(repositoryPath, { recursive: true, force: true }); }
  });

  it('delegates repository test generation, persists reviewable source, and maps it to approved JUnit evidence', async () => {
    const { controller, settings, queue, snapshots, store, runRecords } = fixture();
    const repositoryPath = await mkdtemp(join(tmpdir(), 'qa-generated-repo-test-'));
    const source = join(repositoryPath, 'src');
    await mkdir(source, { recursive: true });
    await writeFile(join(repositoryPath, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'vitest run' } }));
    await writeFile(join(source, 'form.ts'), 'export function submitRecord(value) { return api.post("/records", value); }');
    await mkdir(join(repositoryPath, 'tests'), { recursive: true });
    await writeFile(join(repositoryPath, '.agentic-qa.yml'), `schemaVersion: 1\nproject:\n  name: fixture\nrepository:\n  include: ["**/*.ts", package.json]\n  exclude: []\nsetup: []\ntests:\n  - id: unit\n    label: Run JUnit tests\n    executable: npm\n    arguments: [test, --, --reporter=junit, --outputFile=reports/junit.xml]\n    workingDirectory: .\n    timeoutSeconds: 30\n    network: none\n    resultFormat: junit\n    resultPaths: [reports/junit.xml]\n    scenarioMappings: []\nlimits:\n  browserActions: 100\n  runSeconds: 1800\n  artifactMiB: 500\n`);
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 92, revision: 1, type: 'User Story', kind: 'REQUIREMENT', title: 'Save record', state: 'Active', acceptanceCriteria: 'Submitting the form stores a record.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/92', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:92', organization: 'org', projectId: 'project-1', workItemId: 92, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:92', requirement);
    settings.set('run.target', { targetKind: 'repository', repositorySource: 'local', repositoryPath, allowedOrigins: [] });
    try {
      const draft = await controller.createDraftPlan();
      expect(draft.envelopePreview?.commandIds).toEqual(['unit']);
      await controller.approvePlan({ ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } });
      const detail = await controller.getRun(draft.manifest.runId);
      expect(detail?.repositoryTests).toMatchObject([{ path: 'tests/generated.test.ts', commandId: 'unit', testCaseIds: ['accepted behavior.verifies saved result'] }]);
      expect(detail?.repositoryTests?.[0]?.content).toContain('submitRecord({ name: \'Sample\' })');
      const stored = runRecords.get(draft.manifest.runId);
      expect(stored.contract.scenarios.some(({ layer }: { layer: string }) => layer === 'repo')).toBe(true);
      expect(store.createRun).toHaveBeenCalledOnce();
    } finally { await rm(repositoryPath, { recursive: true, force: true }); }
  });

  it('discovers a repository test command and creates a plan without manual repository configuration', async () => {
    const { controller, settings, queue, snapshots } = fixture();
    const repositoryPath = await mkdtemp(join(tmpdir(), 'qa-auto-config-repo-'));
    try {
      await writeFile(join(repositoryPath, 'package.json'), JSON.stringify({
        name: 'fixture-app',
        packageManager: 'npm@10.0.0',
        scripts: { test: 'vitest run' },
      }));
      await writeFile(join(repositoryPath, 'package-lock.json'), '{}');
      const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 86, revision: 3, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'Search results are visible.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/86', retrievedAt: '2026-09-27T12:00:00.000Z' };
      queue.push({ key: 'org:project-1:86', organization: 'org', projectId: 'project-1', workItemId: 86, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
      snapshots.set('org:project-1:86', requirement);
      settings.set('run.target', { targetKind: 'both', repositorySource: 'local', repositoryPath, siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });

      const draft = await controller.createDraftPlan();

      expect(draft.repositoryCommands).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Discovered npm test script', executable: 'npm', arguments: ['test'], resultFormat: 'none', scenarioMappings: [] }),
      ]));
      expect(draft.contract.scenarios.some(({ layer }) => layer === 'browser')).toBe(true);
      expect(draft.notes.some((note) => note.includes('added its exact command automatically'))).toBe(true);
      expect(draft.notes.join(' ')).not.toContain('No repository check configuration is available');
      await controller.approvePlan({ ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } });
      expect(settings.get(`run.target.${draft.manifest.runId}`)).toMatchObject({ targetKind: 'both', repositoryPath });
    } finally { await rm(repositoryPath, { recursive: true, force: true }); }
  });

  it('discovers a .NET solution as a diagnostic test command without restoring dependencies', async () => {
    const { controller, settings, queue, snapshots } = fixture();
    const repositoryPath = await mkdtemp(join(tmpdir(), 'qa-auto-dotnet-config-'));
    try {
      await writeFile(join(repositoryPath, 'DerseVista.slnx'), '<Solution />');
      await writeFile(join(repositoryPath, 'DerseVista.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />');
      const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 119, revision: 1, type: 'User Story', kind: 'REQUIREMENT', title: 'Availability', state: 'Active', acceptanceCriteria: 'Sold inventory cannot be reserved twice.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/119', retrievedAt: '2026-09-27T12:00:00.000Z' };
      queue.push({ key: 'org:project-1:119', organization: 'org', projectId: 'project-1', workItemId: 119, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
      snapshots.set('org:project-1:119', requirement);
      settings.set('run.target', { targetKind: 'repository', repositorySource: 'local', repositoryPath, allowedOrigins: [] });
      const draft = await controller.createDraftPlan();
      expect(draft.repositoryCommands).toEqual(expect.arrayContaining([
        expect.objectContaining({ executable: 'dotnet', arguments: ['test', 'DerseVista.slnx', '--no-restore'], resultFormat: 'none', scenarioMappings: [] }),
      ]));
      expect(draft.notes.join(' ')).toContain('diagnostic');
    } finally { await rm(repositoryPath, { recursive: true, force: true }); }
  });

  it('discovers a root npm test script from an ADO Git repository without a config file', async () => {
    const { controller, settings, queue, snapshots, ado } = fixture();
    const commit = 'b'.repeat(40);
    queue.push({ key: 'org:project-1:87', organization: 'org', projectId: 'project-1', workItemId: 87, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:87', { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 87, revision: 2, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'Search results are visible.', url: 'https://dev.azure.com/org/project-1/_workitems/edit/87', retrievedAt: '2026-09-27T12:00:00.000Z' });
    settings.set('run.target', { targetKind: 'repository', repositorySource: 'ado-git', adoRepository: { organization: 'org', projectId: 'project-1', id: 'repo-1', name: 'Portal', refName: 'refs/heads/main', commit }, allowedOrigins: [] });
    settings.set('entra.selectedAccountId', 'account-1');
    (ado as any).listGitItems = vi.fn(async () => [{ path: '/package.json', isFolder: false }, { path: '/package-lock.json', isFolder: false }, { path: '/src/index.js', isFolder: false }]);
    (ado as any).getGitItemContent = vi.fn(async (_token: string, _org: string, _repo: string, _commit: string, path: string) => path === '/package.json' ? '{"name":"ado-portal","scripts":{"test":"node --test"}}' : path === '/package-lock.json' ? '{}' : 'export {};');

    const draft = await controller.createDraftPlan();

    expect(draft.repositoryCommands?.[0]).toMatchObject({ label: 'Discovered npm test script', arguments: ['test'] });
    expect((ado as any).getGitItemContent).toHaveBeenCalledWith('secret-token', 'org', 'repo-1', commit, '/package.json');
  });
});

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

function fixture(browserStatus: 'PASSED' | 'FAILED' = 'PASSED', chooseModelKeyFile?: () => Promise<string | undefined>, signOutChoice: () => Promise<'keep' | 'delete' | 'cancel'> = async () => 'keep', evidenceRoot?: string, saveAdoProfilesConfig?: (contents: string) => Promise<boolean>) {
  const settings = new Map<string, unknown>();
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
      queue.push(entry); snapshots.set(entry.key, snapshot); return entry;
    }),
    removeFromQueue: vi.fn(async (key: string) => { const i = queue.findIndex((item) => item.key === key); if (i >= 0) queue.splice(i, 1); }),
    reorderQueue: vi.fn(async () => {}),
    markStale: vi.fn(async () => {}),
    createRun: vi.fn(async (manifest: any, contract: any) => { runRecords.set(manifest.runId, { manifest, contract, observations: [], findings: [], artifacts: [] }); }),
    listRuns: vi.fn(async () => [...runRecords.values()].map(({ manifest, report }) => ({ manifest, ...(report ? { report } : {}) }))),
    getRun: vi.fn(async (runId: string) => runRecords.get(runId)),
    appendObservation: vi.fn(async (observation: any) => { observations.push(observation); runRecords.get(observation.runId)?.observations.push(observation); }),
    appendFinding: vi.fn(async (runId: string, finding: any) => { findings.push(finding); runRecords.get(runId)?.findings.push(finding); }),
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
    fetchWorkItems: vi.fn(async (_token: string, input: any) => input.ids.map((id: number) => ({
      organization: input.organization, projectId: input.projectId, projectName: input.projectName,
      id, revision: snapshots.get(`org:${input.projectId}:${id}`)?.revision ?? 1, type: 'User Story', kind: 'REQUIREMENT', title: `Item ${id}`, state: 'New',
      url: `https://dev.azure.com/${input.organization}/${input.projectId}/_workitems/edit/${id}`,
      retrievedAt: '2026-01-01T00:00:00.000Z',
    }))),
  } as unknown as AdoClient;
  const browserScenarioRunner = vi.fn(async (input: any) => ({
    observation: { id: randomUUID(), runId: input.runId, scenarioId: input.scenario.id, status: browserStatus, worker: 'browser', startedAt: '2026-09-27T12:00:00.000Z', endedAt: '2026-09-27T12:00:01.000Z', assertion: browserStatus === 'PASSED' ? 'Expected text is visible.' : 'Expected text was not visible.', artifactIds: [], sourceIdentity: new URL(input.target.siteBaseUrl).origin },
    artifacts: [], cancelled: false,
  }));
  const controller = new DesktopController({ store, authFactory: async () => auth, ado, browserScenarioRunner: browserScenarioRunner as any, sitePreflight: async () => undefined, browserExecutablePath: () => process.execPath, confirmDeleteRun: async () => true, selectSignOutDataAction: signOutChoice, chooseModelKeyFile, evidenceRoot, saveAdoProfilesConfig });
  return { controller, settings, store, auth, ado, queue, snapshots, runRecords, browserScenarioRunner };
}

describe('desktop controller', () => {
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
    const task = { ...requirement, id: 18, type: 'Task', kind: 'TASK', acceptanceCriteria: 'Task text is context only' };
    for (const snapshot of [requirement, task]) {
      const entry = { key: `org:project-1:${snapshot.id}`, organization: 'org', projectId: 'project-1', workItemId: snapshot.id, queuedAt: '2026-01-01T00:00:00.000Z', stale: false };
      queue.push(entry); snapshots.set(entry.key, snapshot);
    }
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const draft = await controller.createDraftPlan();
    expect(draft.contract.criteria.map(({ expectedBehavior }) => expectedBehavior)).toEqual(['Results show the title', 'Filters remain selected']);
    expect(draft.contract.criteria).toHaveLength(2);
    expect(draft.notes[0]).toContain('does not prove parent acceptance criteria');
    expect(draft.manifest.sources).toHaveLength(2);
    const approved = { ...draft, contract: { ...draft.contract, scenarios: draft.contract.scenarios.map((scenario) => ({ ...scenario, approved: true })) } };
    await controller.approvePlan(approved);
    expect(store.createRun).toHaveBeenCalledOnce();
    const report = await controller.startRun(draft.manifest.runId);
    expect(report.executionState).toBe('COMPLETED');
    expect(report.verdict).toBe('PASS');
    expect(report.criterionResults.every(({ state }: { state: string }) => state === 'VERIFIED')).toBe(true);
    expect(browserScenarioRunner).toHaveBeenCalledTimes(2);
    expect(runRecords.get(draft.manifest.runId).report).toEqual(report);
    await expect(controller.approvePlan(approved)).rejects.toThrow('no longer current');
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

  it('requires a reviewed one-use provider preview and keeps the imported API key out of UI state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentic-model-key-'));
    const keyPath = join(directory, 'openai-key.txt');
    await writeFile(keyPath, 'sk-test-provider-key', { mode: 0o600 });
    const { controller, settings, queue, snapshots } = fixture('PASSED', async () => keyPath);
    const requirement = { organization: 'org', projectId: 'project-1', projectName: 'Project One', id: 47, revision: 3, type: 'User Story', kind: 'REQUIREMENT', title: 'Search', state: 'Active', acceptanceCriteria: 'A search result appears', url: 'https://dev.azure.com/org/project-1/_workitems/edit/47', retrievedAt: '2026-09-27T12:00:00.000Z' };
    queue.push({ key: 'org:project-1:47', organization: 'org', projectId: 'project-1', workItemId: 47, queuedAt: '2026-09-27T12:00:00.000Z', stale: false });
    snapshots.set('org:project-1:47', requirement);
    settings.set('run.target', { targetKind: 'site', siteBaseUrl: 'https://site.example.test', allowedOrigins: ['https://site.example.test'] });
    const originalFetch = globalThis.fetch;
    let criterionId = '';
    const fetchMock = vi.fn(async () => {
      const outputText = JSON.stringify({ suggestions: [{ criterionId, title: 'Check search result', expectedObservations: ['A search result appears'], steps: [{ action: 'expectText', text: 'A search result appears' }] }] });
      const result = { output: [{ type: 'message', content: [{ type: 'output_text', text: outputText }] }], usage: { input_tokens: 100, output_tokens: 50 } };
      return new Response(JSON.stringify(result), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(controller.previewModelRequest(randomUUID(), ['criterion-1'])).rejects.toThrow('Import an OpenAI API key');
      await controller.importModelKey();
      const state = await controller.getState();
      expect(state.modelProviderConfigured).toBe(true);
      expect(JSON.stringify(state)).not.toContain('sk-test-provider-key');
      const draft = await controller.createDraftPlan();
      criterionId = draft.contract.criteria[0].id;
      const preview = await controller.previewModelRequest(draft.manifest.runId, draft.contract.criteria.map(({ id }) => id));
      expect(JSON.stringify(preview.requestBody)).toContain('A search result appears');
      expect(fetchMock).not.toHaveBeenCalled();
      const suggested = await controller.generateModelSuggestions(preview.previewId);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(suggested.manifest.modelId).toBe(preview.model);
      expect(suggested.manifest.limits).toMatchObject({ modelInputTokensUsed: 100, modelOutputTokensUsed: 50 });
      expect(suggested.contract.scenarios.at(-1)).toMatchObject({ summary: 'Check search result', approved: false });
      await expect(controller.generateModelSuggestions(preview.previewId)).rejects.toThrow('expired or was already used');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.stubGlobal('fetch', originalFetch);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

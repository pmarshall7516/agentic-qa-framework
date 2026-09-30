// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App.js';
import type { DesktopApi, DesktopState } from '../src/shared/ipc.js';

const listRuns = vi.fn(async () => []);
const api = {
  isBrowserInstalled: async () => false,
  isRepoWorkerImageInstalled: async () => false,
  listRuns,
} as unknown as DesktopApi;

const state: DesktopState = { azureCliAvailable: false, accounts: [], queue: [] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('desktop keyboard navigation', () => {
  it('opens each first-release workflow screen using only Tab and Enter', async () => {
    const user = userEvent.setup();
    const account = { homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' };
    render(<App api={api} initialState={{ ...state, azureCliAvailable: true, accounts: [account], selectedProject: { id: 'project-1', name: 'Portal' } }} />);

    const screens = [
      { nav: 'Work items', heading: 'Find work to verify' },
      { nav: 'QA Queue', heading: 'Your QA Queue' },
      { nav: 'Runs', heading: 'Run history' },
      { nav: 'Settings', heading: 'Settings' },
    ];

    for (const { nav, heading } of screens) {
      await user.tab();
      const button = screen.getByRole('button', { name: nav });
      expect(document.activeElement).toBe(button);
      await user.keyboard('{Enter}');
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    await waitFor(() => expect(listRuns).toHaveBeenCalledOnce());
  });

  it('lets a keyboard user start Azure DevOps sign-in without entering an app ID', async () => {
    const user = userEvent.setup();
    const signedIn = { ...state, azureCliAvailable: true, selectedAccountId: 'account-1', accounts: [{ homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' }] };
    const signIn = vi.fn(async () => signedIn);
    const listOrganizations = vi.fn(async () => [{ id: 'org-1', name: 'contoso' }]);
    const testApi = { ...api, signIn, listOrganizations } as unknown as DesktopApi;
    render(<App api={testApi} initialState={{ ...state, azureCliAvailable: true }} />);

    async function tabTo(element: HTMLElement) {
      for (let i = 0; i < 20 && document.activeElement !== element; i += 1) await user.tab();
      expect(document.activeElement).toBe(element);
    }

    const signInButton = screen.getByRole('button', { name: /Sign in with Azure DevOps/ });
    await tabTo(signInButton);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /contoso/ })).toBeTruthy();
    expect(listOrganizations).toHaveBeenCalledOnce();
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('does not invoke sign-in when Azure CLI is unavailable', async () => {
    const user = userEvent.setup();
    const signIn = vi.fn(async () => state);
    const testApi = { ...api, signIn } as unknown as DesktopApi;
    render(<App api={testApi} initialState={state} />);

    const signInButton = screen.getByRole('button', { name: /Sign in with Azure DevOps/ });
    expect(signInButton.getAttribute('disabled')).not.toBeNull();
    await user.click(signInButton);
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByRole('note').textContent).toMatch(/Azure CLI is not installed/i);
  });

  it('searches, queues, plans, runs, and exports a report using keyboard input only', async () => {
    const user = userEvent.setup();
    const runId = '22222222-2222-4222-8222-222222222222';
    const criterionId = 'criterion-1';
    const scenarioId = 'scenario-1';
    const account = { homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' };
    const initialState: DesktopState = { azureCliAvailable: true, accounts: [], queue: [] };
    const signedInState: DesktopState = {
      azureCliAvailable: true,
      accounts: [account],
      selectedAccountId: account.homeAccountId,
      modelProvider: 'openai',
      modelProviderConfigured: true,
      modelId: 'gpt-6-luna',
      queue: [],
    };
    const snapshot = {
      organization: 'contoso', projectId: 'project-1', projectName: 'Portal', id: 42, revision: 3,
      type: 'User Story', kind: 'REQUIREMENT', title: 'Search keeps its filters', state: 'Active',
      acceptanceCriteria: 'Search results remain visible after filtering.',
      url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/42', retrievedAt: '2026-09-27T12:00:00.000Z',
    };
    const taskSnapshot = {
      organization: 'contoso', projectId: 'project-1', projectName: 'Portal', id: 43, parentId: 42, revision: 1,
      type: 'Task', kind: 'TASK', title: 'Keep the filter state', state: 'Active',
      url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/43', retrievedAt: '2026-09-27T12:00:00.000Z',
    };
    const entry = { key: 'contoso:project-1:42', organization: 'contoso', projectId: 'project-1', workItemId: 42, queuedAt: '2026-09-27T12:01:00.000Z', stale: false };
    const taskEntry = { key: 'contoso:project-1:43', organization: 'contoso', projectId: 'project-1', workItemId: 43, queuedAt: '2026-09-27T12:01:30.000Z', stale: false };
    const source = { organization: 'contoso', projectId: 'project-1', workItemId: 42, revision: 3, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: 'a'.repeat(64) };
    const plan = {
      manifest: { schemaVersion: 1, runId, startedAt: '2026-09-27T12:02:00.000Z', sources: [source], targetKind: 'site', siteBaseUrl: 'https://staging.example.test', contractId: '11111111-1111-4111-8111-111111111111', contractRevision: 1, configHash: 'b'.repeat(64), toolVersions: { app: '1.0.0' }, limits: { runSeconds: 300 } },
      contract: {
        schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', revision: 1,
        criteria: [{ id: criterionId, source, expectedBehavior: 'Search results remain visible after filtering.', requiredLayers: ['browser'], scenarioIds: [scenarioId], ambiguityNotes: [] }],
        scenarios: [{ id: scenarioId, criterionIds: [criterionId], summary: 'Verify filtered search results', layer: 'browser', preconditions: [], steps: [{ action: 'expectVisible', role: 'heading', name: 'Results' }], expectedObservations: ['The Results heading is visible.'], risk: 'low', approved: true }],
        approvedAt: '2026-09-27T12:02:00.000Z',
      },
      notes: [],
    };
    const observation = { id: '33333333-3333-4333-8333-333333333333', runId, scenarioId, status: 'PASSED', worker: 'browser', startedAt: '2026-09-27T12:03:00.000Z', endedAt: '2026-09-27T12:03:01.000Z', assertion: 'Verified visible heading “Results”.', artifactIds: [], sourceIdentity: 'https://staging.example.test' };
    const finding = { id: '44444444-4444-4444-8444-444444444444', kind: 'INSUFFICIENT_EVIDENCE', criterionId, observationIds: [observation.id], rationale: 'The reviewer must classify the remaining uncertainty.', highRisk: false, unresolved: true };
    const report = { schemaVersion: 1, runId, executionState: 'COMPLETED', verdict: 'NEEDS_REVIEW', criterionResults: [{ criterionId, state: 'VERIFIED', observationIds: [observation.id], missingEvidence: [], findingIds: [finding.id] }], findingIds: [finding.id], completedAt: '2026-09-27T12:03:01.000Z', explanation: 'A reviewer must classify the retained finding.' };
    const reviewedReport = { ...report, completedAt: '2026-09-27T12:04:00.000Z', explanation: 'Reviewer classification was recorded; observations and the original report remain unchanged.' };
    const reviewedFinding = { ...finding, humanOverride: { author: 'QA reviewer', reason: 'The locator assertion needs test repair.', at: '2026-09-27T12:04:00.000Z', previousKind: finding.kind } };
    const detail = { manifest: plan.manifest, contract: plan.contract, observations: [observation], findings: [finding], artifacts: [], report: undefined };
    const reviewedDetail = { ...detail, findings: [reviewedFinding], report, reviewedReport };
    const selectedIds = new Set<number>();
    let approved = false;
    let executed = false;
    let classified = false;
    const searchItems = vi.fn(async () => ({ items: [snapshot], nextAfterId: undefined }));
    const createDraftPlan = vi.fn(async () => plan);
    const approvePlan = vi.fn(async () => { approved = true; });
    const startRun = vi.fn(async () => { executed = true; return report; });
    const exportReport = vi.fn(async () => true);
    const classifyFinding = vi.fn(async () => { classified = true; return reviewedReport; });
    const testApi = {
      isBrowserInstalled: async () => false,
      isRepoWorkerImageInstalled: async () => false,
      signIn: async () => signedInState,
      listOrganizations: async () => [{ id: 'org-1', name: 'contoso' }],
      selectOrganization: async (organization: string) => ({ ...signedInState, selectedOrganization: organization }),
      listProjects: async () => [{ id: 'project-1', name: 'Portal' }],
      selectProject: async (project: DesktopState['selectedProject']) => ({ ...signedInState, selectedOrganization: 'contoso', selectedProject: project }),
      listWorkItemTypes: async () => ['User Story', 'Task'],
      getChildren: async (parentId: number) => parentId === 42 ? [taskSnapshot] : [],
      searchItems,
      addQueueItem: async (id: number) => {
        selectedIds.add(id);
        const queue = [...selectedIds].map((workItemId) => workItemId === 42 ? { entry, snapshot } : { entry: taskEntry, snapshot: taskSnapshot });
        return { ...signedInState, selectedOrganization: 'contoso', selectedProject: { id: 'project-1', name: 'Portal' }, queue };
      },
      saveTarget: async (target: DesktopState['target']) => {
        const queue = [...selectedIds].map((workItemId) => workItemId === 42 ? { entry, snapshot } : { entry: taskEntry, snapshot: taskSnapshot });
        return { ...signedInState, selectedOrganization: 'contoso', selectedProject: { id: 'project-1', name: 'Portal' }, queue, target };
      },
      createDraftPlan,
      approvePlan,
      listRuns: async () => approved ? [{ manifest: plan.manifest, ...(executed ? { report: classified ? reviewedReport : report } : {}) }] : [],
      getRun: async () => classified ? reviewedDetail : detail,
      getRunProgress: async () => [],
      startRun,
      exportReport,
      classifyFinding,
    } as unknown as DesktopApi;
    render(<App api={testApi} initialState={initialState} />);

    async function tabTo(element: HTMLElement) {
      for (let i = 0; i < 80 && document.activeElement !== element; i += 1) await user.tab();
      expect(document.activeElement).toBe(element);
    }
    async function focusNavigation(label: string) {
      const button = screen.getByRole('button', { name: new RegExp(`^${label}(?:\\d+)?$`) });
      await tabTo(button);
      await user.keyboard('{Enter}');
    }

    const adoSignIn = screen.getByRole('button', { name: 'Sign in with Azure DevOps' });
    await tabTo(adoSignIn);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Choose an organization' })).toBeTruthy();
    const discoveredOrganization = await screen.findByRole('button', { name: /contoso/ });
    await tabTo(discoveredOrganization);
    await user.keyboard('{Enter}');
    const project = await screen.findByRole('button', { name: /Portal/ });
    await tabTo(project);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Find work to verify' })).toBeTruthy();

    await focusNavigation('Work items');
    const search = screen.getByRole('textbox', { name: 'Work item ID or title' });
    await tabTo(search);
    await user.keyboard('42{Enter}');
    expect(await screen.findByRole('heading', { name: 'Search results' })).toBeTruthy();
    const addToQueue = await screen.findByRole('button', { name: 'Add to queue' });
    await tabTo(addToQueue);
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('button', { name: 'Queued' })).toHaveLength(1);
    const browseTasks = screen.getByRole('button', { name: 'Browse child tasks' });
    await tabTo(browseTasks);
    await user.keyboard('{Enter}');
    const taskCard = await screen.findByRole('heading', { name: 'Keep the filter state' });
    await user.click(within(taskCard.closest('article')!).getByRole('button', { name: 'Add to queue' }));
    expect(searchItems).toHaveBeenCalledWith({ term: '42', types: [], states: [] });
    expect(screen.getAllByRole('button', { name: 'Queued' })).toHaveLength(2);

    await focusNavigation('QA Queue');
    expect(screen.getByText('Search keeps its filters')).toBeTruthy();
    const startQa = screen.getByRole('button', { name: 'Start QA' });
    await tabTo(startQa);
    await user.keyboard('{Enter}');
    const siteUrl = screen.getByRole('textbox', { name: 'Development or staging URL' });
    await tabTo(siteUrl);
    await user.keyboard('https://staging.example.test');
    const reviewPlan = screen.getByRole('button', { name: 'Prepare agentic QA plan' });
    await tabTo(reviewPlan);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Review the QA plan' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Orchestrator plan' })).toBeTruthy();
    expect(screen.getByText(/Delegate to Playwright worker/)).toBeTruthy();
    expect(screen.getByText('1 Story · 1 Task')).toBeTruthy();
    expect(screen.getByText('1 acceptance criterion · Browser checks')).toBeTruthy();
    expect(screen.getByText('contoso / Portal')).toBeTruthy();
    expect(screen.getByText(/Tasks provide context; they do not verify their Story's acceptance criteria/)).toBeTruthy();
    expect(createDraftPlan).toHaveBeenCalledOnce();
    const approve = screen.getByRole('button', { name: 'Approve reviewed QA scope' });
    await tabTo(approve);
    await user.keyboard('{Enter}');
    const start = await screen.findByRole('button', { name: 'Approve generated checks and start' });
    await tabTo(start);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('VERIFIED · Search results remain visible after filtering.')).toBeTruthy();
    const exportHtml = screen.getByRole('button', { name: 'Export HTML' });
    await tabTo(exportHtml);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(exportReport).toHaveBeenCalledWith(runId, 'html'));
    const classification = screen.getByRole('combobox', { name: 'Reviewer classification' });
    await tabTo(classification);
    expect((classification as HTMLSelectElement).value).toBe('PRODUCT_FAILURE');
    const reviewer = screen.getByRole('textbox', { name: 'Reviewer' });
    await tabTo(reviewer);
    await user.keyboard('QA reviewer');
    const reason = screen.getByRole('textbox', { name: 'Reason' });
    await tabTo(reason);
    await user.keyboard('The locator assertion needs test repair.');
    const saveReview = screen.getByRole('button', { name: 'Save reviewer classification' });
    await tabTo(saveReview);
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Reviewed by QA reviewer:/)).toBeTruthy();
    expect(startRun).toHaveBeenCalledWith(runId);
    expect(approvePlan).toHaveBeenCalledOnce();
    expect(classifyFinding).toHaveBeenCalledWith({ runId, findingId: finding.id, kind: 'PRODUCT_FAILURE', author: 'QA reviewer', reason: 'The locator assertion needs test repair.' });
  });
});

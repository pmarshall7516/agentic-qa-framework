// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const state: DesktopState = { clientIdConfigured: false, accounts: [], queue: [] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('desktop keyboard navigation', () => {
  it('opens each first-release workflow screen using only Tab and Enter', async () => {
    const user = userEvent.setup();
    render(<App api={api} initialState={state} />);

    const screens = [
      { nav: '01 Connections', heading: 'Connect your work' },
      { nav: '02 Project', heading: 'Choose your project' },
      { nav: '03 Work items', heading: 'Find work to verify' },
      { nav: '04 QA Queue', heading: 'Your QA Queue' },
      { nav: '05 Run setup', heading: 'Set up a QA run' },
      { nav: '06 Plan review', heading: 'Review the QA plan' },
      { nav: '07 History', heading: 'Run history' },
    ];

    for (const { nav, heading } of screens) {
      await user.tab();
      const [number, ...label] = nav.split(' ');
      const button = screen.getByRole('button', { name: new RegExp(`^${number}\\s*${label.join(' ')}$`) });
      expect(document.activeElement).toBe(button);
      await user.keyboard('{Enter}');
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    await waitFor(() => expect(listRuns).toHaveBeenCalledOnce());
  });

  it('lets a keyboard user configure the public client and start sign-in', async () => {
    const user = userEvent.setup();
    const clientId = '11111111-1111-4111-8111-111111111111';
    const configured = { ...state, clientIdConfigured: true, clientId };
    const signedIn = { ...configured, selectedAccountId: 'account-1', accounts: [{ homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' }] };
    const saveClientId = vi.fn(async () => configured);
    const signIn = vi.fn(async () => signedIn);
    const testApi = { ...api, saveClientId, signIn } as unknown as DesktopApi;
    render(<App api={testApi} initialState={state} />);

    async function tabTo(element: HTMLElement) {
      for (let i = 0; i < 20 && document.activeElement !== element; i += 1) await user.tab();
      expect(document.activeElement).toBe(element);
    }

    const input = screen.getByRole('textbox', { name: 'Entra application client ID' });
    await tabTo(input);
    await user.keyboard(clientId);
    await user.tab();
    const setup = screen.getByText('Set up the Entra public client');
    expect(document.activeElement).toBe(setup);
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/Register an app for accounts in any organizational directory/)).toBeTruthy();
    await user.tab();
    const save = screen.getByRole('button', { name: 'Save application ID' });
    expect(document.activeElement).toBe(save);
    await user.keyboard('{Enter}');
    const signInButton = await screen.findByRole('button', { name: /Sign in with Microsoft/ });
    await tabTo(signInButton);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(saveClientId).toHaveBeenCalledWith(clientId);
    expect(signIn).toHaveBeenCalledOnce();
  });

  it('searches, queues, plans, runs, and exports a report using keyboard input only', async () => {
    const user = userEvent.setup();
    const runId = '22222222-2222-4222-8222-222222222222';
    const criterionId = 'criterion-1';
    const scenarioId = 'scenario-1';
    const account = { homeAccountId: 'account-1', tenantId: 'tenant-1', username: 'qa@example.com' };
    const initialState: DesktopState = {
      clientIdConfigured: true,
      accounts: [account],
      selectedAccountId: account.homeAccountId,
      queue: [],
    };
    const snapshot = {
      organization: 'contoso', projectId: 'project-1', projectName: 'Portal', id: 42, revision: 3,
      type: 'User Story', kind: 'REQUIREMENT', title: 'Search keeps its filters', state: 'Active',
      acceptanceCriteria: 'Search results remain visible after filtering.',
      url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/42', retrievedAt: '2026-09-27T12:00:00.000Z',
    };
    const entry = { key: 'contoso:project-1:42', organization: 'contoso', projectId: 'project-1', workItemId: 42, queuedAt: '2026-09-27T12:01:00.000Z', stale: false };
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
    let queued = false;
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
      selectOrganization: async (organization: string) => ({ ...initialState, selectedOrganization: organization }),
      listProjects: async () => [{ id: 'project-1', name: 'Portal' }],
      selectProject: async (project: DesktopState['selectedProject']) => ({ ...initialState, selectedOrganization: 'contoso', selectedProject: project }),
      listWorkItemTypes: async () => ['User Story', 'Task'],
      searchItems,
      addQueueItem: async () => { queued = true; return { ...initialState, selectedOrganization: 'contoso', selectedProject: { id: 'project-1', name: 'Portal' }, queue: [{ entry, snapshot }] }; },
      saveTarget: async (target: DesktopState['target']) => ({ ...initialState, selectedOrganization: 'contoso', selectedProject: { id: 'project-1', name: 'Portal' }, queue: queued ? [{ entry, snapshot }] : [], target }),
      createDraftPlan,
      approvePlan,
      listRuns: async () => approved ? [{ manifest: plan.manifest, ...(executed ? { report: classified ? reviewedReport : report } : {}) }] : [],
      getRun: async () => classified ? reviewedDetail : detail,
      startRun,
      exportReport,
      classifyFinding,
    } as unknown as DesktopApi;
    render(<App api={testApi} initialState={initialState} />);

    async function tabTo(element: HTMLElement) {
      for (let i = 0; i < 80 && document.activeElement !== element; i += 1) await user.tab();
      expect(document.activeElement).toBe(element);
    }
    async function focusNavigation(number: string, label: string) {
      const button = screen.getByRole('button', { name: new RegExp(`^${number}\\s*${label}(?:\\d+)?$`) });
      await tabTo(button);
      await user.keyboard('{Enter}');
    }

    await focusNavigation('02', 'Project');
    const organization = screen.getByRole('textbox', { name: 'Organization' });
    await tabTo(organization);
    await user.keyboard('contoso');
    const findProjects = screen.getByRole('button', { name: 'Find projects' });
    await tabTo(findProjects);
    await user.keyboard('{Enter}');
    const project = await screen.findByRole('button', { name: /Portal/ });
    await tabTo(project);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Find work to verify' })).toBeTruthy();

    await focusNavigation('03', 'Work items');
    const search = screen.getByRole('textbox', { name: 'Work item ID or title' });
    await tabTo(search);
    await user.keyboard('42{Enter}');
    expect(await screen.findByRole('heading', { name: 'Search results' })).toBeTruthy();
    const addToQueue = await screen.findByRole('button', { name: 'Add to queue' });
    await tabTo(addToQueue);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Queued' })).toBeTruthy();
    expect(searchItems).toHaveBeenCalledWith({ term: '42', types: [], states: [] });

    await focusNavigation('04', 'QA Queue');
    expect(screen.getByText('Search keeps its filters')).toBeTruthy();
    await focusNavigation('05', 'Run setup');
    const siteUrl = screen.getByRole('textbox', { name: 'Development or staging URL' });
    await tabTo(siteUrl);
    await user.keyboard('https://staging.example.test');
    const reviewPlan = screen.getByRole('button', { name: 'Review local plan' });
    await tabTo(reviewPlan);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Review the QA plan' })).toBeTruthy();
    expect(createDraftPlan).toHaveBeenCalledOnce();
    const approve = screen.getByRole('button', { name: 'Approve contract and save run' });
    await tabTo(approve);
    await user.keyboard('{Enter}');

    const historyRun = await screen.findByRole('button', { name: new RegExp(runId) });
    await tabTo(historyRun);
    await user.keyboard('{Enter}');
    const start = await screen.findByRole('button', { name: 'Start approved run' });
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

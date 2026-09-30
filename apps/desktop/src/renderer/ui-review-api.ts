import type { AdoProject, WorkItemSearchPage } from '@agentic-qa/ado/client';
import type { QueueEntry } from '@agentic-qa/domain/queue';
import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { Finding, Observation, QAReport, RunManifest } from '@agentic-qa/domain/run';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { DesktopApi, DesktopState, DraftPlan, TargetConfig } from '../shared/ipc.js';

const account = {
  homeAccountId: 'azure-cli:fixture-tenant:qa@example.test',
  tenantId: 'fixture-tenant',
  username: 'qa@example.test',
  displayName: 'QA Reviewer',
};
const organization = 'Contoso';
const project: AdoProject = { id: 'project-portal', name: 'Portal Experience', state: 'wellFormed' };
const runId = '22222222-2222-4222-8222-222222222222';
const contractId = '11111111-1111-4111-8111-111111111111';
const requirement: WorkItemSnapshot = {
  organization,
  projectId: project.id,
  projectName: project.name,
  id: 4821,
  revision: 7,
  type: 'User Story',
  kind: 'REQUIREMENT',
  title: 'Search keeps the selected filters',
  state: 'Active',
  description: 'As a user, I can keep the active filters while browsing results.',
  acceptanceCriteria: 'Selected filters remain visible after opening a result.\nThe result list updates when a filter changes.',
  url: `https://dev.azure.com/${organization}/${project.id}/_workitems/edit/4821`,
  retrievedAt: '2026-09-29T12:00:00.000Z',
};
const task: WorkItemSnapshot = {
  organization,
  projectId: project.id,
  projectName: project.name,
  id: 4822,
  parentId: requirement.id,
  revision: 3,
  type: 'Task',
  kind: 'TASK',
  title: 'Persist filter selection while opening results',
  state: 'Active',
  description: 'Retain selected type and state filters.',
  url: `https://dev.azure.com/${organization}/${project.id}/_workitems/edit/4822`,
  retrievedAt: '2026-09-29T12:00:00.000Z',
};

const criterion: QAContract['criteria'][number] = {
  id: 'criterion-filter-persistence',
  source: {
    organization,
    projectId: project.id,
    workItemId: requirement.id,
    revision: requirement.revision,
    field: 'Microsoft.VSTS.Common.AcceptanceCriteria',
    excerptHash: 'a'.repeat(64),
  },
  expectedBehavior: 'Selected filters remain visible after opening a result.',
  requiredLayers: ['browser'],
  scenarioIds: ['scenario-filter-persistence'],
  ambiguityNotes: [],
};
const scenario = {
  id: 'scenario-filter-persistence',
  criterionIds: [criterion.id],
  summary: 'Verify selected filters remain visible',
  layer: 'browser' as const,
  preconditions: ['A result list is visible.'],
  steps: [{ action: 'expectText' as const, text: 'Filters remain selected' }],
  expectedObservations: ['The selected filter chips remain visible.'],
  risk: 'low' as const,
  approved: false,
};
const contract: QAContract = {
  schemaVersion: 3,
  id: contractId,
  revision: 1,
  criteria: [criterion],
  scenarios: [scenario],
  sourceContext: [requirement, task].map(({ id, ...snapshot }) => ({ ...snapshot, workItemId: id })),
  taskCandidates: [],
  coverageGaps: [],
  taskPlans: [],
  proposals: [],
};
const manifest: RunManifest = {
  schemaVersion: 1,
  runId,
  startedAt: '2026-09-29T12:00:00.000Z',
  sources: [{
    organization,
    projectId: project.id,
    workItemId: requirement.id,
    revision: requirement.revision,
    field: 'Microsoft.VSTS.Common.AcceptanceCriteria',
    excerptHash: 'a'.repeat(64),
  }],
  targetKind: 'site',
  siteBaseUrl: 'https://staging.example.test',
  contractId,
  contractRevision: 1,
  configHash: 'b'.repeat(64),
  toolVersions: { app: '1.0.0' },
  limits: { runSeconds: 300, browserActions: 100 },
};
const plan: DraftPlan = { manifest, contract, notes: ['Review the browser scenario before approving this local plan.'] };
const observation: Observation = {
  id: '33333333-3333-4333-8333-333333333333',
  runId,
  scenarioId: scenario.id,
  status: 'PASSED',
  worker: 'browser',
  startedAt: '2026-09-29T12:01:00.000Z',
  endedAt: '2026-09-29T12:01:02.000Z',
  assertion: 'The selected filters remained visible after opening a result.',
  artifactIds: [],
  sourceIdentity: 'https://staging.example.test',
};
const finding: Finding = {
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'INSUFFICIENT_EVIDENCE',
  criterionId: criterion.id,
  observationIds: [observation.id],
  rationale: 'A screenshot is needed to confirm the complete result state.',
  highRisk: false,
  unresolved: true,
};
const report: QAReport = {
  schemaVersion: 1,
  runId,
  executionState: 'COMPLETED',
  verdict: 'NEEDS_REVIEW',
  criterionResults: [{
    criterionId: criterion.id,
    state: 'VERIFIED',
    observationIds: [observation.id],
    missingEvidence: [],
    findingIds: [finding.id],
  }],
  findingIds: [finding.id],
  completedAt: '2026-09-29T12:01:02.000Z',
  explanation: 'Direct browser evidence was collected; a reviewer still needs to classify the retained finding.',
};
const blockedObservation: Observation = {
  ...observation,
  id: '55555555-5555-4555-8555-555555555555',
  status: 'FAILED',
  assertion: 'The site displayed a sign-in page before the check could run.',
  diagnostic: { stage: 'authentication', category: 'authentication_required', detail: 'The site requires sign-in before showing this page.', nextAction: 'Select a named test account for this site origin and create a fresh plan.', retryable: true },
};
const blockedFinding: Finding = { ...finding, observationIds: [blockedObservation.id], rationale: 'Browser QA is blocked by the site authentication requirement.' };
const blockedReport: QAReport = {
  ...report,
  executionState: 'BLOCKED',
  verdict: 'BLOCKED',
  criterionResults: [{ criterionId: criterion.id, state: 'BLOCKED', observationIds: [blockedObservation.id], missingEvidence: ['Authentication blocked browser evidence.'], findingIds: [blockedFinding.id] }],
  explanation: 'The browser check was blocked because the site requires sign-in. Select a named test account for this site origin and create a fresh plan.',
};
const queueEntry: QueueEntry = {
  key: `${organization.toLowerCase()}:${project.id}:${requirement.id}`,
  organization,
  projectId: project.id,
  workItemId: requirement.id,
  queuedAt: '2026-09-29T11:59:00.000Z',
  stale: false,
};

type RunDetail = NonNullable<Awaited<ReturnType<DesktopApi['getRun']>>>;

export function createUiReviewFixture(scenarioName: string): { api: DesktopApi; state: DesktopState } {
  const initialConnection = scenarioName === 'onboarding';
  let state: DesktopState = initialConnection
    ? { azureCliAvailable: true, accounts: [], queue: [], modelId: 'gpt-5.6-terra', modelMaxOutputTokens: 1200 }
    : {
        azureCliAvailable: true,
        accounts: [account],
        selectedAccountId: account.homeAccountId,
        selectedOrganization: organization,
        savedOrganizations: [organization],
        selectedProject: project,
        queue: scenarioName === 'queue' || scenarioName === 'report' || scenarioName === 'blocked-report' ? [{ entry: queueEntry, snapshot: requirement }] : [],
        target: { targetKind: 'site', siteBaseUrl: 'https://staging.example.test', allowedOrigins: ['https://staging.example.test'] },
        modelProviderConfigured: false,
        modelProvider: 'openai',
        modelId: 'gpt-5.6-terra',
        modelMaxOutputTokens: 1200,
        savedModels: [{ id: '77777777-7777-4777-8777-777777777777', providerId: 'openai', modelId: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', capabilities: { structuredOutput: true, toolUse: true }, maxOutputTokens: 1200, testStatus: 'reachable', testedAt: '2026-09-29T12:00:00.000Z' }],
      };
  let approved = scenarioName === 'report' || scenarioName === 'blocked-report';
  let providerConnected = approved;
  let executed = approved;
  const scenarioObservation = scenarioName === 'blocked-report' ? blockedObservation : observation;
  const scenarioFinding = scenarioName === 'blocked-report' ? blockedFinding : finding;
  const scenarioReport = scenarioName === 'blocked-report' ? blockedReport : report;
  const runDetail: RunDetail = {
    manifest,
    contract: { ...contract, scenarios: contract.scenarios.map((item) => ({ ...item, approved: true })) },
    observations: [scenarioObservation],
    findings: [scenarioFinding],
    artifacts: [],
    ...(approved ? { report: scenarioReport } : {}),
  };

  const currentState = (): DesktopState => ({ ...state, queue: [...state.queue], modelProviderConfigured: providerConnected });
  const withState = (updates: Partial<DesktopState>): DesktopState => {
    state = { ...state, ...updates };
    return currentState();
  };
  const runs = () => approved ? [{ manifest, report: executed ? scenarioReport : undefined }] : [];
  let browserAccounts: Array<import('../shared/ipc.js').BrowserTestAccountSummary> = [];
  const api: DesktopApi = {
    onModelStream: () => () => undefined,
    openPlanProgressWindow: async () => undefined,
    readyPlanProgressWindow: async () => undefined,
    getState: async () => currentState(),
    signIn: async () => withState({ accounts: [account], selectedAccountId: account.homeAccountId }),
    signOut: async () => withState({ accounts: [], selectedAccountId: undefined, selectedOrganization: undefined, selectedProject: undefined }),
    selectAccount: async () => withState({ selectedAccountId: account.homeAccountId }),
    listOrganizations: async () => [{ id: 'org-contoso', name: organization }, { id: 'org-fabrikam', name: 'Fabrikam' }],
    selectOrganization: async (name) => withState({ selectedOrganization: name }),
    listProjects: async () => [project, { id: 'project-commerce', name: 'Commerce Platform', state: 'wellFormed' }],
    selectProject: async (selected) => withState({ selectedProject: selected }),
    saveAdoProfile: async (input) => {
      const profile = { ...input, id: input.id ?? '55555555-5555-4555-8555-555555555555', organization: input.organization, project: { id: input.project.id ?? project.id, name: input.project.name } };
      return withState({ adoProfiles: [...(state.adoProfiles ?? []), profile] });
    },
    activateAdoProfile: async (id) => withState({ activeAdoProfileId: id }),
    deleteAdoProfile: async (id) => withState({ adoProfiles: (state.adoProfiles ?? []).filter((item) => item.id !== id) }),
    importAdoProfilesConfig: async () => currentState(),
    exportAdoProfilesConfig: async () => true,
    loadActiveProfileWorkItems: async () => ({ iterationName: 'Sprint 14', stories: [requirement], tasksByStory: { [requirement.id]: [task] } }),
    listProfileIterations: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Sprint 14', path: 'Portal\\Sprint 14', timeFrame: 'current' }],
    listSprintTaskboard: async () => [{ workItemId: task.id, column: 'In Progress', state: task.state }],
    listAdoTeams: async () => [{ id: 'team-1', name: 'Portal Experience Team' }],
    searchActiveStories: async () => ({ items: [requirement] }),
    listWorkItemTypes: async () => ['User Story', 'Task', 'Feature Request'],
    saveWorkItemTypeMapping: async () => currentState(),
    searchItems: async (): Promise<WorkItemSearchPage> => ({ items: [requirement] }),
    getChildren: async () => [task],
    addQueueItem: async (id) => {
      const snapshot = id === task.id ? task : requirement;
      const entry: QueueEntry = { ...queueEntry, key: `${organization.toLowerCase()}:${project.id}:${id}`, workItemId: id, queuedAt: new Date().toISOString() };
      const queue = state.queue.some(({ entry: existing }) => existing.key === entry.key) ? state.queue : [...state.queue, { entry, snapshot }];
      return withState({ queue });
    },
    addQueueItems: async (items) => {
      for (const { workItemId } of items) await api.addQueueItem(workItemId);
      return currentState();
    },
    removeQueueItem: async (key) => withState({ queue: state.queue.filter(({ entry }) => entry.key !== key) }),
    moveQueueItem: async (key, direction) => {
      const index = state.queue.findIndex(({ entry }) => entry.key === key);
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (index >= 0 && targetIndex >= 0 && targetIndex < state.queue.length) {
        const queue = [...state.queue];
        [queue[index], queue[targetIndex]] = [queue[targetIndex]!, queue[index]!];
        return withState({ queue });
      }
      return currentState();
    },
    refreshQueue: async () => withState({ queue: state.queue.map((entry) => ({ ...entry, stale: false })) }),
    chooseRepository: async () => undefined,
    listGitRepositories: async () => [{ id: 'repo-portal', name: 'Portal Experience', defaultBranch: 'refs/heads/main' }],
    listGitRefs: async () => [{ name: 'refs/heads/main', objectId: 'c'.repeat(40) }],
    saveTarget: async (target: TargetConfig) => withState({ target }),
    listBrowserTestAccounts: async () => browserAccounts,
    saveBrowserTestAccount: async (input) => { const entry = { id: input.id ?? '66666666-6666-4666-8666-666666666666', label: input.label, origin: input.origin, hasUsername: true, hasPassword: true, revision: 1 }; browserAccounts = [...browserAccounts.filter(({ id }) => id !== entry.id), entry]; return browserAccounts; },
    deleteBrowserTestAccount: async (id) => { browserAccounts = browserAccounts.filter((entry) => entry.id !== id); return browserAccounts; },
    getRepositoryConfigDraft: async () => JSON.stringify({ schemaVersion: 1, project: { name: 'Portal' }, repository: { include: ['**/*'], exclude: [] }, setup: [], tests: [{ id: 'project-tests', label: 'Project tests', executable: 'npm', arguments: ['test'], workingDirectory: '.', timeoutSeconds: 600, network: 'none', resultFormat: 'none', resultPaths: [], scenarioMappings: [] }], limits: { browserActions: 100, runSeconds: 1800, artifactMiB: 500 } }, null, 2),
    saveRepositoryConfigDraft: async () => undefined,
    createDraftPlan: async () => ({ ...plan, envelopePreview: {
      providerId: state.modelProvider ?? 'openai', modelId: state.modelId ?? 'gpt-5.6-terra', sourceIds: [requirement.id, task.id],
      sourceRevisions: { [`${organization}:${project.id}:${requirement.id}`]: requirement.revision }, repositoryPaths: [],
      allowedOrigins: state.target?.allowedOrigins ?? [], commandIds: [], excludedContext: [],
      budget: { maxCostUsd: 1, maxInputTokens: 12_000, maxOutputTokens: 1_200, maxProviderCalls: 12, maxAgents: 6, maxParallelAgents: 2, maxRetries: 1, maxRunSeconds: 1800, maxBrowserActions: 100, maxArtifactMiB: 500 },
      ...(state.target?.runInstructions ? { runInstructions: state.target.runInstructions } : {}),
      testAccounts: browserAccounts.filter(({ id }) => state.target?.testAccountIds?.includes(id)), showBrowserWindow: state.target?.showBrowserWindow ?? false,
    } }),
    importProviderKey: async () => { providerConnected = true; return true; },
    connectClaudeAccount: async () => { providerConnected = true; withState({ modelProvider: 'claude-code', modelProviderConfigured: true }); return true; },
    listProviderModels: async (providerId) => providerId === 'claude-code'
      ? ['sonnet', 'opus', 'haiku'].map((modelId) => ({ providerId, modelId, displayName: `Claude ${modelId[0]!.toUpperCase()}${modelId.slice(1)} (subscription)`, capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } }))
      : [{ providerId, modelId: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 0.25, outputUsdPerMillionTokens: 2 } }],
    saveAgentModelSettings: async ({ providerId, modelId: selectedModel, maxOutputTokens }) => { const model = { id: '77777777-7777-4777-8777-777777777777', providerId, modelId: selectedModel, displayName: selectedModel, capabilities: { structuredOutput: true, toolUse: true }, maxOutputTokens, testStatus: 'untested' as const }; withState({ modelProvider: providerId, modelId: selectedModel, modelMaxOutputTokens: maxOutputTokens, modelProviderConfigured: true, savedModels: [model] }); return [model]; },
    selectSavedModel: async (id) => { const model = state.savedModels?.find(({ id: modelId }) => id === modelId); return withState({ modelProvider: model?.providerId ?? 'openai', modelId: model?.modelId ?? '', modelMaxOutputTokens: model?.maxOutputTokens ?? 1200, modelProviderConfigured: true }); },
    getSavedModels: async () => state.savedModels ?? [],
    testSavedModel: async () => ({ reachable: true, testStatus: 'reachable', message: 'Model is reachable and returned the required structured response.' }),
    removeSavedModel: async (id) => { const savedModels = state.savedModels?.filter(({ id: modelId }) => modelId !== id) ?? []; withState({ savedModels }); return savedModels; },
    importModelKey: async () => false,
    clearModelKey: async () => undefined,
    saveModelSettings: async () => undefined,
    previewModelRequest: async () => ({ previewId: 'preview-1', provider: 'OpenAI', model: 'gpt-5.6-terra', estimatedInputTokens: 200, maxOutputTokens: 1200, requestBody: { model: 'gpt-5.6-terra', store: false, max_output_tokens: 1200, input: [] } }),
    generateModelSuggestions: async () => plan,
    approvePlan: async () => { approved = true; },
    listRuns: async () => runs(),
    getRun: async () => executed ? { ...runDetail, report } : runDetail,
    getArtifactPreview: async () => 'data:image/png;base64,',
    getRunProgress: async () => [],
    exportReport: async () => true,
    exportArtifact: async () => true,
    classifyFinding: async (): Promise<QAReport> => report,
    deleteRun: async () => true,
    isBrowserInstalled: async () => true,
    installBrowser: async () => undefined,
    isRepoWorkerImageInstalled: async () => true,
    installRepoWorkerImage: async () => undefined,
    startRun: async () => { executed = true; return report; },
    cancelRun: async () => true,
  };

  return { api, state };
}

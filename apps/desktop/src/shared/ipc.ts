import type { AdoGitRef, AdoGitRepository, AdoProject, WorkItemSearchPage } from '@agentic-qa/ado/client';
import type { AccountSummary } from '@agentic-qa/ado/auth';
import type { QueueEntry } from '@agentic-qa/domain/queue';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { Finding, Observation, QAReport, RunManifest } from '@agentic-qa/domain/run';
import type { WorkItemKind, WorkItemTypeMappings } from '@agentic-qa/domain/work-item';

export type AppScreen = 'connections' | 'project' | 'work-items' | 'queue' | 'run-setup' | 'plan' | 'history';

export interface TargetConfig {
  targetKind: 'repository' | 'site' | 'both';
  repositorySource?: 'local' | 'ado-git';
  repositoryPath?: string;
  adoRepository?: { organization: string; projectId: string; id: string; name: string; refName: string; commit: string };
  siteBaseUrl?: string;
  allowedOrigins: string[];
}

export interface DraftPlan {
  manifest: RunManifest;
  contract: QAContract;
  notes: string[];
  repositoryCommands?: Array<{ id: string; label: string; executable: string; arguments: string[]; workingDirectory: string; timeoutSeconds: number; resultFormat?: 'junit' | 'none'; resultPaths: string[]; scenarioMappings: Array<{ scenarioId: string; testCaseIds: string[] }> }>;
}

export interface QueueItemView {
  entry: QueueEntry;
  snapshot?: WorkItemSnapshot;
}

export interface DesktopState {
  clientIdConfigured: boolean;
  clientId?: string;
  accounts: AccountSummary[];
  selectedAccountId?: string;
  selectedOrganization?: string;
  selectedProject?: AdoProject;
  customTypeMappings?: WorkItemTypeMappings;
  queue: QueueItemView[];
  target?: TargetConfig;
  modelProviderConfigured?: boolean;
  modelId?: string;
  modelMaxOutputTokens?: number;
}

export interface ModelPayloadPreview {
  previewId: string;
  provider: 'OpenAI';
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  requestBody: { model: string; store: false; max_output_tokens: number; input: Array<{ role: 'system' | 'user'; content: string }> };
}

export interface SearchItemsInput {
  term: string;
  types: string[];
  states: string[];
  afterId?: number;
}

export interface SearchItemsInput {
  term: string;
  types: string[];
  states: string[];
}

export interface DesktopApi {
  getState(): Promise<DesktopState>;
  saveClientId(clientId: string): Promise<DesktopState>;
  signIn(): Promise<DesktopState>;
  signOut(homeAccountId: string): Promise<DesktopState>;
  selectOrganization(organization: string): Promise<DesktopState>;
  listProjects(): Promise<AdoProject[]>;
  selectProject(project: AdoProject): Promise<DesktopState>;
  listWorkItemTypes(): Promise<string[]>;
  saveWorkItemTypeMapping(type: string, kind: WorkItemKind): Promise<DesktopState>;
  searchItems(input: SearchItemsInput): Promise<WorkItemSearchPage>;
  getChildren(parentWorkItemId: number): Promise<WorkItemSnapshot[]>;
  addQueueItem(workItemId: number): Promise<DesktopState>;
  removeQueueItem(key: string): Promise<DesktopState>;
  moveQueueItem(key: string, direction: 'up' | 'down'): Promise<DesktopState>;
  refreshQueue(): Promise<DesktopState>;
  chooseRepository(): Promise<string | undefined>;
  listGitRepositories(): Promise<AdoGitRepository[]>;
  listGitRefs(repositoryId: string): Promise<AdoGitRef[]>;
  saveTarget(target: TargetConfig): Promise<DesktopState>;
  createDraftPlan(previousRunId?: string): Promise<DraftPlan>;
  importModelKey(): Promise<boolean>;
  clearModelKey(): Promise<void>;
  saveModelSettings(input: { model: string; maxOutputTokens: number }): Promise<void>;
  previewModelRequest(runId: string, includedCriterionIds: string[]): Promise<ModelPayloadPreview>;
  generateModelSuggestions(previewId: string): Promise<DraftPlan>;
  approvePlan(plan: DraftPlan): Promise<void>;
  listRuns(): Promise<Array<{ manifest: RunManifest; report?: QAReport }>>;
  getRun(runId: string): Promise<{ manifest: RunManifest; contract: QAContract; observations: Observation[]; findings: Finding[]; artifacts: Array<{ id: string; kind: string; sha256: string; bytes: number; redactionState: string }>; report?: QAReport; reviewedReport?: QAReport } | undefined>;
  exportReport(runId: string, format: 'html' | 'markdown' | 'json'): Promise<boolean>;
  exportArtifact(runId: string, artifactId: string): Promise<boolean>;
  classifyFinding(input: { runId: string; findingId: string; kind: 'PRODUCT_FAILURE' | 'TEST_FAILURE' | 'ENVIRONMENT_FAILURE' | 'FLAKY_TEST' | 'AMBIGUOUS_REQUIREMENT'; author: string; reason: string }): Promise<QAReport>;
  deleteRun(runId: string): Promise<boolean>;
  isBrowserInstalled(): Promise<boolean>;
  installBrowser(): Promise<void>;
  isRepoWorkerImageInstalled(): Promise<boolean>;
  installRepoWorkerImage(): Promise<void>;
  startRun(runId: string): Promise<QAReport>;
  cancelRun(runId: string): Promise<boolean>;
}

declare global {
  interface Window {
    qa: DesktopApi;
  }
}

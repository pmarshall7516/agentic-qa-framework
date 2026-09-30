import type { AdoGitRef, AdoGitRepository, AdoIteration, AdoOrganization, AdoProject, AdoTaskboardItem, AdoTeam, WorkItemSearchPage } from '@agentic-qa/ado/client';
import type { AccountSummary } from '@agentic-qa/ado/auth';
import type { QueueEntry } from '@agentic-qa/domain/queue';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { Finding, Observation, QAReport, RunManifest, RunProgressEvent } from '@agentic-qa/domain/run';
import type { WorkItemKind, WorkItemTypeMappings } from '@agentic-qa/domain/work-item';
import type { RepositoryConfig } from '@agentic-qa/repo-worker/config';
import type { ProviderModel, SavedModelView } from '@agentic-qa/domain/agent';
import type { DelegationDiagram, DelegationPlan, RunBudget } from '@agentic-qa/domain/agent';

export type AppScreen = 'connections' | 'project' | 'work-items' | 'queue' | 'run-setup' | 'plan' | 'history' | 'settings';

export interface TargetConfig {
  targetKind: 'repository' | 'site' | 'both';
  repositorySource?: 'local' | 'ado-git';
  repositoryPath?: string;
  adoRepository?: { organization: string; projectId: string; id: string; name: string; refName: string; commit: string };
  siteBaseUrl?: string;
  allowedOrigins: string[];
  runInstructions?: string;
  testAccountIds?: string[];
  testAccountVersions?: Record<string, number>;
  showBrowserWindow?: boolean;
}

export interface BrowserTestAccountSummary {
  id: string;
  label: string;
  origin: string;
  hasUsername: boolean;
  hasPassword: boolean;
  revision: number;
}

export interface BrowserTestAccountInput {
  id?: string;
  label: string;
  origin: string;
  username: string;
  password: string;
}

export interface DraftPlan {
  manifest: RunManifest;
  contract: QAContract;
  notes: string[];
  repositoryCommands?: Array<{ id: string; label: string; executable: string; arguments: string[]; workingDirectory: string; timeoutSeconds: number; resultFormat?: 'junit' | 'trx' | 'none'; resultPaths: string[]; scenarioMappings: Array<{ scenarioId: string; testCaseIds: string[] }> }>;
  envelopePreview?: { providerId: 'openai' | 'anthropic' | 'openrouter' | 'claude-code'; modelId: string; sourceIds: number[]; sourceRevisions: Record<string, number>; repositoryPaths: string[]; allowedOrigins: string[]; commandIds: string[]; excludedContext: string[]; budget: RunBudget; runInstructions?: string; testAccounts: BrowserTestAccountSummary[]; showBrowserWindow: boolean };
}

export type ModelStreamEvent =
  | { type: 'text'; streamId: string; scope: 'planning' | 'run'; phase: string; chunk: string; at: string }
  | { type: 'status'; streamId: string; scope: 'planning' | 'run'; phase: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; message: string; at: string };

export interface QueueItemView {
  entry: QueueEntry;
  snapshot?: WorkItemSnapshot;
}

export interface QueueWorkItemSelection {
  workItemId: number;
  parentId?: number;
}

export interface AdoRunProfile {
  id: string;
  name: string;
  organization: string;
  project: AdoProject;
  team: string;
  boardColumn: string;
  storyIds: number[];
}

export type AdoRunProfileInput = Omit<AdoRunProfile, 'id' | 'project'> & { id?: string; project: { id?: string; name: string; state?: string } };

export interface ProfileWorkItemsResult {
  iterationName: string;
  stories: WorkItemSnapshot[];
  tasksByStory: Record<number, WorkItemSnapshot[]>;
}

export interface DesktopState {
  azureCliAvailable?: boolean;
  accounts: AccountSummary[];
  selectedAccountId?: string;
  selectedOrganization?: string;
  savedOrganizations?: string[];
  adoProfiles?: AdoRunProfile[];
  activeAdoProfileId?: string;
  selectedProject?: AdoProject;
  customTypeMappings?: WorkItemTypeMappings;
  queue: QueueItemView[];
  target?: TargetConfig;
  browserTestAccounts?: BrowserTestAccountSummary[];
  modelProviderConfigured?: boolean;
  modelProvider?: 'openai' | 'anthropic' | 'openrouter' | 'claude-code';
  modelProviderAccountEmail?: string;
  modelId?: string;
  modelMaxOutputTokens?: number;
  savedModels?: SavedModelView[];
}

export interface ModelPayloadPreview {
  previewId: string;
  provider: 'OpenAI' | 'Anthropic' | 'Claude Code';
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

export interface DesktopApi {
  getState(): Promise<DesktopState>;
  signIn(): Promise<DesktopState>;
  signOut(homeAccountId: string): Promise<DesktopState>;
  selectAccount(homeAccountId: string): Promise<DesktopState>;
  listOrganizations(): Promise<AdoOrganization[]>;
  selectOrganization(organization: string): Promise<DesktopState>;
  listProjects(): Promise<AdoProject[]>;
  selectProject(project: AdoProject): Promise<DesktopState>;
  saveAdoProfile(profile: AdoRunProfileInput): Promise<DesktopState>;
  activateAdoProfile(profileId: string): Promise<DesktopState>;
  deleteAdoProfile(profileId: string): Promise<DesktopState>;
  importAdoProfilesConfig(): Promise<DesktopState>;
  exportAdoProfilesConfig(): Promise<boolean>;
  loadActiveProfileWorkItems(): Promise<ProfileWorkItemsResult>;
  listProfileIterations(): Promise<AdoIteration[]>;
  listSprintTaskboard(iterationId: string): Promise<AdoTaskboardItem[]>;
  listAdoTeams(input: { organization: string; project: { id?: string; name: string } }): Promise<AdoTeam[]>;
  searchActiveStories(iterationId: string, afterId?: number): Promise<WorkItemSearchPage>;
  listWorkItemTypes(): Promise<string[]>;
  saveWorkItemTypeMapping(type: string, kind: WorkItemKind): Promise<DesktopState>;
  searchItems(input: SearchItemsInput): Promise<WorkItemSearchPage>;
  getChildren(parentWorkItemId: number): Promise<WorkItemSnapshot[]>;
  addQueueItem(workItemId: number): Promise<DesktopState>;
  addQueueItems(items: QueueWorkItemSelection[]): Promise<DesktopState>;
  removeQueueItem(key: string): Promise<DesktopState>;
  moveQueueItem(key: string, direction: 'up' | 'down'): Promise<DesktopState>;
  refreshQueue(): Promise<DesktopState>;
  chooseRepository(): Promise<string | undefined>;
  listGitRepositories(): Promise<AdoGitRepository[]>;
  listGitRefs(repositoryId: string): Promise<AdoGitRef[]>;
  saveTarget(target: TargetConfig): Promise<DesktopState>;
  listBrowserTestAccounts(): Promise<BrowserTestAccountSummary[]>;
  saveBrowserTestAccount(input: BrowserTestAccountInput): Promise<BrowserTestAccountSummary[]>;
  deleteBrowserTestAccount(id: string): Promise<BrowserTestAccountSummary[]>;
  getRepositoryConfigDraft(target: TargetConfig): Promise<string>;
  saveRepositoryConfigDraft(input: { target: TargetConfig; content: string }): Promise<void>;
  createDraftPlan(previousRunId?: string, streamId?: string): Promise<DraftPlan>;
  openPlanProgressWindow(streamId: string): Promise<void>;
  readyPlanProgressWindow(streamId: string): Promise<void>;
  onModelStream(listener: (event: ModelStreamEvent) => void): () => void;
  importProviderKey(providerId: 'openai' | 'anthropic' | 'openrouter'): Promise<boolean>;
  connectClaudeAccount(): Promise<boolean>;
  listProviderModels(providerId: 'openai' | 'anthropic' | 'openrouter' | 'claude-code'): Promise<ProviderModel[]>;
  saveAgentModelSettings(input: { providerId: 'openai' | 'anthropic' | 'openrouter' | 'claude-code'; modelId: string; maxOutputTokens: number }): Promise<SavedModelView[]>;
  selectSavedModel(modelId: string): Promise<DesktopState>;
  getSavedModels(): Promise<SavedModelView[]>;
  testSavedModel(modelId: string): Promise<{ reachable: boolean; testStatus: 'reachable' | 'unreachable'; message: string }>;
  removeSavedModel(modelId: string): Promise<SavedModelView[]>;
  importModelKey(): Promise<boolean>;
  clearModelKey(): Promise<void>;
  saveModelSettings(input: { model: string; maxOutputTokens: number }): Promise<void>;
  previewModelRequest(runId: string, includedCriterionIds: string[]): Promise<ModelPayloadPreview>;
  generateModelSuggestions(previewId: string): Promise<DraftPlan>;
  approvePlan(plan: DraftPlan): Promise<void>;
  listRuns(): Promise<Array<{ manifest: RunManifest; report?: QAReport }>>;
  getRun(runId: string): Promise<{ manifest: RunManifest; contract: QAContract; observations: Observation[]; findings: Finding[]; artifacts: Array<{ id: string; kind: string; sha256: string; bytes: number; redactionState: string; scenarioId?: string; stepId?: string; sequence?: number }>; report?: QAReport; reviewedReport?: QAReport; delegationPlan?: DelegationPlan; delegationDiagram?: DelegationDiagram; repositoryTests?: Array<{ commandId: string; path: string; content: string; scenarioIds: string[]; testCaseIds: string[] }>; reviewerReport?: { summary: string; criteria: Array<{ criterionId: string; assessment: 'supported' | 'contradicted' | 'inconclusive'; summary: string; observationIds: string[] }>; codeReview: Array<{ path: string; line: number; severity: 'low' | 'medium' | 'high'; comment: string; recommendation: string }> }; agentSummary?: string; agentUsage?: { inputTokens: number; outputTokens: number; providerCalls: number; costUsd: number } } | undefined>;
  getArtifactPreview(runId: string, artifactId: string): Promise<string>;
  getRunProgress(runId: string): Promise<RunProgressEvent[]>;
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

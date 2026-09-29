import type { AdoGitRef, AdoGitRepository, AdoIteration, AdoOrganization, AdoProject, AdoTaskboardItem, AdoTeam, WorkItemSearchPage } from '@agentic-qa/ado/client';
import type { AccountSummary } from '@agentic-qa/ado/auth';
import type { QueueEntry } from '@agentic-qa/domain/queue';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { Finding, Observation, QAReport, RunManifest, RunProgressEvent } from '@agentic-qa/domain/run';
import type { WorkItemKind, WorkItemTypeMappings } from '@agentic-qa/domain/work-item';
import type { RepositoryConfig } from '@agentic-qa/repo-worker/config';

export type AppScreen = 'connections' | 'project' | 'work-items' | 'queue' | 'run-setup' | 'plan' | 'history' | 'settings';

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
  getRepositoryConfigDraft(target: TargetConfig): Promise<string>;
  saveRepositoryConfigDraft(input: { target: TargetConfig; content: string }): Promise<void>;
  createDraftPlan(previousRunId?: string): Promise<DraftPlan>;
  importModelKey(): Promise<boolean>;
  clearModelKey(): Promise<void>;
  saveModelSettings(input: { model: string; maxOutputTokens: number }): Promise<void>;
  previewModelRequest(runId: string, includedCriterionIds: string[]): Promise<ModelPayloadPreview>;
  generateModelSuggestions(previewId: string): Promise<DraftPlan>;
  approvePlan(plan: DraftPlan): Promise<void>;
  listRuns(): Promise<Array<{ manifest: RunManifest; report?: QAReport }>>;
  getRun(runId: string): Promise<{ manifest: RunManifest; contract: QAContract; observations: Observation[]; findings: Finding[]; artifacts: Array<{ id: string; kind: string; sha256: string; bytes: number; redactionState: string; scenarioId?: string; stepId?: string; sequence?: number }>; report?: QAReport; reviewedReport?: QAReport } | undefined>;
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

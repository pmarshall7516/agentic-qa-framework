import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import type { AccountSummary, EntraAdoAuthService } from '@agentic-qa/ado/auth';
import { AdoClient, resolveOrganization, type AdoProject, type WorkItemSearchPage } from '@agentic-qa/ado/client';
import type { QueueEntry } from '@agentic-qa/domain/queue';
import type { WorkItemKind, WorkItemSnapshot, WorkItemTypeMappings } from '@agentic-qa/domain/work-item';
import { QAContractSchema, validateReadyContract, type QAContract } from '@agentic-qa/domain/qa-contract';
import { buildReport, computeVerdict, FindingSchema, ObservationSchema, RunManifestSchema, type CriterionResult, type Finding, type Observation, type QAReport, type RunManifest } from '@agentic-qa/domain/run';
import type { QaStore } from '@agentic-qa/storage/database';
import { renderReport, type ReportFormat } from '@agentic-qa/reporting/render';
import { runBrowserScenario, type BrowserScenarioResult } from '@agentic-qa/browser-worker/runner';
import { decryptArtifact, deleteRunEvidence, encryptArtifact } from '@agentic-qa/storage/artifacts';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { readRepositoryConfig } from '@agentic-qa/repo-worker/config';
import { createRepositorySnapshot } from '@agentic-qa/repo-worker/snapshot';
import { runRepositoryChecks } from '@agentic-qa/repo-worker/runner';
import { isExcludedRepositoryPath } from '@agentic-qa/repo-worker/snapshot';
import micromatch from 'micromatch';
import { buildModelPayload, requestScenarioSuggestions } from '@agentic-qa/model-adapters/openai';
import type { DesktopState, DraftPlan, QueueItemView, SearchItemsInput, TargetConfig } from '../shared/ipc.js';

const SETTING = {
  clientId: 'entra.clientId',
  accountId: 'entra.selectedAccountId',
  organization: 'ado.organization',
  project: 'ado.project',
} as const;

const ClientIdSchema = z.string().uuid();
const ModelSettingsSchema = z.object({ model: z.string().regex(/^[a-zA-Z0-9._:-]{1,80}$/), maxOutputTokens: z.number().int().min(256).max(4096) }).strict();
const WorkItemTypeMappingsSchema = z.record(z.string().min(1).max(120), z.enum(['REQUIREMENT', 'TASK', 'OTHER']));
const execFile = promisify(execFileCallback);
const ProjectSchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), state: z.string().max(80).optional() }).strict();
const SearchSchema = z.object({
  term: z.string().max(120),
  types: z.array(z.string().max(120)).max(20),
  states: z.array(z.string().max(120)).max(20),
  afterId: z.number().int().positive().max(2_147_483_647).optional(),
}).strict();
const TargetSchema = z.object({
  targetKind: z.enum(['repository', 'site', 'both']),
  repositorySource: z.enum(['local', 'ado-git']).optional(),
  repositoryPath: z.string().min(1).max(2000).optional(),
  adoRepository: z.object({ organization: z.string().min(1).max(100), projectId: z.string().min(1).max(200), id: z.string().min(1).max(200), name: z.string().min(1).max(200), refName: z.string().min(1).max(300), commit: z.string().regex(/^[a-f0-9]{40,64}$/i) }).strict().optional(),
  siteBaseUrl: z.url().optional(),
  allowedOrigins: z.array(z.url()).max(10),
}).strict().superRefine((target, ctx) => {
  if (['repository', 'both'].includes(target.targetKind) && !(target.repositoryPath || target.adoRepository)) ctx.addIssue({ code: 'custom', message: 'Select a local folder or Azure DevOps Git repository and ref.', path: ['repositoryPath'] });
  if (target.repositoryPath && target.adoRepository) ctx.addIssue({ code: 'custom', message: 'Select one repository source.', path: ['repositoryPath'] });
  if (['site', 'both'].includes(target.targetKind) && !target.siteBaseUrl) ctx.addIssue({ code: 'custom', message: 'Enter a development or staging site URL.', path: ['siteBaseUrl'] });
  if (target.siteBaseUrl) {
    const url = new URL(target.siteBaseUrl);
    if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ctx.addIssue({ code: 'custom', message: 'Use an HTTPS site URL without credentials, query, or fragment, or HTTP on localhost.', path: ['siteBaseUrl'] });
    if (!target.allowedOrigins.includes(url.origin)) ctx.addIssue({ code: 'custom', message: 'The site origin must be explicitly approved.', path: ['allowedOrigins'] });
  }
  for (const origin of target.allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || parsed.search || parsed.hash || !['https:', 'http:'].includes(parsed.protocol)) ctx.addIssue({ code: 'custom', message: 'Approved origins must contain only an HTTPS origin (or HTTP localhost), without a path.', path: ['allowedOrigins'] });
  }
  if (target.siteBaseUrl && (target.allowedOrigins.length !== 1 || target.allowedOrigins[0] !== new URL(target.siteBaseUrl).origin)) ctx.addIssue({ code: 'custom', message: 'Only the configured site origin can be approved in this release.', path: ['allowedOrigins'] });
});

function sha256(text: string): string { return createHash('sha256').update(text).digest('hex'); }

export class DesktopController {
  private readonly store: QaStore;
  private readonly ado: AdoClient;
  private readonly authFactory: (clientId: string) => Promise<EntraAdoAuthService>;
  private auth?: EntraAdoAuthService;
  private authClientId?: string;
  private readonly chosenRepository: () => Promise<string | undefined>;
  private chosenRepositoryPath?: string;
  private readonly pendingPlans = new Map<string, DraftPlan>();
  private readonly saveReportFile: (filename: string, contents: string, format: ReportFormat) => Promise<boolean>;
  private readonly saveEvidenceFile: (filename: string, contents: Buffer, restricted: boolean) => Promise<boolean>;
  private readonly activeRuns = new Map<string, AbortController>();
  private runStarting = false;
  private readonly evidenceRoot?: string;
  private readonly scratchRoot: string;
  private readonly artifactKey?: () => Promise<Buffer>;
  private readonly browserScenarioRunner: typeof runBrowserScenario;
  private readonly sitePreflight: (url: string) => Promise<void>;
  private readonly browserInstaller?: () => Promise<void>;
  private readonly browserExecutablePath?: () => string;
  private readonly maxRunSeconds: number;
  private readonly confirmDeleteRun?: (runId: string) => Promise<boolean>;
  private readonly selectSignOutDataAction?: (username: string) => Promise<'keep' | 'delete' | 'cancel'>;
  private readonly repoWorkerImageProbe?: () => Promise<boolean>;
  private readonly repoWorkerImageInstaller?: () => Promise<void>;
  private readonly chooseModelKeyFile?: () => Promise<string | undefined>;
  private readonly pendingModelPreviews = new Map<string, { runId: string; draftHash: string; preview: ReturnType<typeof buildModelPayload>; includedCriterionIds: string[]; expiresAt: number }>();

  constructor(options: {
    store: QaStore;
    ado?: AdoClient;
    authFactory?: (clientId: string) => Promise<EntraAdoAuthService>;
    chooseRepository?: () => Promise<string | undefined>;
    saveReportFile?: (filename: string, contents: string, format: ReportFormat) => Promise<boolean>;
    saveEvidenceFile?: (filename: string, contents: Buffer, restricted: boolean) => Promise<boolean>;
    evidenceRoot?: string;
    scratchRoot?: string;
    artifactKey?: () => Promise<Buffer>;
    browserScenarioRunner?: typeof runBrowserScenario;
    sitePreflight?: (url: string) => Promise<void>;
    installBrowser?: () => Promise<void>;
    browserExecutablePath?: () => string;
    maxRunSeconds?: number;
    confirmDeleteRun?: (runId: string) => Promise<boolean>;
    selectSignOutDataAction?: (username: string) => Promise<'keep' | 'delete' | 'cancel'>;
    repoWorkerImageProbe?: () => Promise<boolean>;
    installRepoWorkerImage?: () => Promise<void>;
    chooseModelKeyFile?: () => Promise<string | undefined>;
  }) {
    this.store = options.store;
    this.ado = options.ado ?? new AdoClient();
    this.authFactory = options.authFactory ?? (() => Promise.reject(new Error('Entra sign-in is unavailable')));
    this.chosenRepository = options.chooseRepository ?? (async () => undefined);
    this.saveReportFile = options.saveReportFile ?? (async () => false);
    this.saveEvidenceFile = options.saveEvidenceFile ?? (async () => false);
    this.evidenceRoot = options.evidenceRoot;
    this.scratchRoot = options.scratchRoot ?? tmpdir();
    this.artifactKey = options.artifactKey;
    this.browserScenarioRunner = options.browserScenarioRunner ?? runBrowserScenario;
    this.sitePreflight = options.sitePreflight ?? (async (url) => {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      if (response.status >= 500) throw new Error(`The selected site returned HTTP ${response.status}.`);
      const location = response.headers.get('location');
      if (location && new URL(location, url).origin !== new URL(url).origin) throw new Error('The selected site redirected to an unapproved origin.');
    });
    this.browserInstaller = options.installBrowser;
    this.browserExecutablePath = options.browserExecutablePath;
    this.maxRunSeconds = options.maxRunSeconds ?? 1800;
    this.confirmDeleteRun = options.confirmDeleteRun;
    this.selectSignOutDataAction = options.selectSignOutDataAction;
    this.repoWorkerImageProbe = options.repoWorkerImageProbe;
    this.repoWorkerImageInstaller = options.installRepoWorkerImage;
    this.chooseModelKeyFile = options.chooseModelKeyFile;
  }

  async getState(): Promise<DesktopState> {
    const [clientId, selectedAccountId, organization, project, entries, target, modelKey, modelSettings] = await Promise.all([
      this.setting<string>(SETTING.clientId),
      this.setting<string>(SETTING.accountId),
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.store.getQueue(),
      this.setting<TargetConfig>('run.target'),
      this.setting<string>('model.apiKey'),
      this.setting<{ model: string; maxOutputTokens: number }>('model.settings'),
    ]);
    const auth = clientId ? await this.getAuth(clientId) : undefined;
    const accounts = auth ? await auth.getAccounts() : [];
    const customTypeMappings = organization && project ? await this.typeMappings(organization, project.id) : {};
    const queue: QueueItemView[] = await Promise.all(entries.map(async (entry: QueueEntry) => ({
      entry,
      snapshot: await this.store.getSnapshot(entry.key),
    })));
    return {
      clientIdConfigured: Boolean(clientId),
      ...(clientId ? { clientId } : {}),
      accounts,
      ...(selectedAccountId ? { selectedAccountId } : {}),
      ...(organization ? { selectedOrganization: organization } : {}),
      ...(project ? { selectedProject: project } : {}),
      customTypeMappings,
      queue,
      ...(target ? { target } : {}),
      modelProviderConfigured: Boolean(modelKey),
      modelId: modelSettings?.model ?? 'gpt-5.6-terra',
      modelMaxOutputTokens: modelSettings?.maxOutputTokens ?? 1200,
    };
  }

  async importModelKey(): Promise<boolean> {
    const path = await this.chooseModelKeyFile?.();
    if (!path) return false;
    if ((await stat(path)).size > 2048) throw new Error('The selected API key file is too large. Choose a text file containing only one key.');
    const apiKey = (await readFile(path, 'utf8')).trim();
    if (apiKey.length < 20 || apiKey.length > 500 || /[\r\n]/.test(apiKey)) throw new Error('The selected file must contain one OpenAI API key on a single line.');
    await this.store.setSetting('model.apiKey', apiKey);
    this.pendingModelPreviews.clear();
    return true;
  }

  async clearModelKey(): Promise<void> {
    await this.store.setSetting('model.apiKey', null);
    this.pendingModelPreviews.clear();
  }

  async saveModelSettings(input: { model: string; maxOutputTokens: number }): Promise<void> {
    const settings = ModelSettingsSchema.parse(input);
    await this.store.setSetting('model.settings', settings);
    this.pendingModelPreviews.clear();
  }

  async previewModelRequest(runIdInput: string, includedCriterionIdsInput: string[]) {
    const runId = z.string().uuid().parse(runIdInput);
    if (!(await this.setting<string>('model.apiKey'))) throw new Error('Import an OpenAI API key before requesting AI scenario suggestions.');
    const draft = this.pendingPlans.get(runId);
    if (!draft) throw new Error('This plan is no longer current. Create a fresh draft before previewing a provider request.');
    const eligibleIds = new Set(draft.contract.criteria.filter(({ requiredLayers }) => requiredLayers.includes('browser')).map(({ id }) => id));
    const includedCriterionIds = z.array(z.string().min(1).max(120)).min(1).max(50).parse(includedCriterionIdsInput);
    if (new Set(includedCriterionIds).size !== includedCriterionIds.length || includedCriterionIds.some((id) => !eligibleIds.has(id))) throw new Error('The provider preview may include only selected browser criteria from this plan.');
    const settings = ModelSettingsSchema.parse(await this.setting('model.settings') ?? { model: 'gpt-5.6-terra', maxOutputTokens: 1200 });
    const preview = buildModelPayload(draft, settings.model, settings.maxOutputTokens, includedCriterionIds);
    const previewId = randomUUID();
    for (const [id, pending] of this.pendingModelPreviews) if (pending.expiresAt <= Date.now() || pending.runId === runId) this.pendingModelPreviews.delete(id);
    while (this.pendingModelPreviews.size >= 20) this.pendingModelPreviews.delete(this.pendingModelPreviews.keys().next().value!);
    this.pendingModelPreviews.set(previewId, { runId, draftHash: sha256(JSON.stringify(draft)), preview, includedCriterionIds, expiresAt: Date.now() + 10 * 60_000 });
    return { previewId, ...preview };
  }

  async generateModelSuggestions(previewIdInput: string): Promise<DraftPlan> {
    const previewId = z.string().uuid().parse(previewIdInput);
    const pending = this.pendingModelPreviews.get(previewId);
    this.pendingModelPreviews.delete(previewId);
    if (!pending || pending.expiresAt <= Date.now()) throw new Error('This provider preview has expired or was already used. Review a fresh payload before sending.');
    const draft = this.pendingPlans.get(pending.runId);
    if (!draft || sha256(JSON.stringify(draft)) !== pending.draftHash) throw new Error('The plan changed after the provider preview. Review a fresh payload before sending.');
    const apiKey = await this.setting<string>('model.apiKey');
    if (!apiKey) throw new Error('The OpenAI API key was cleared. Import a key and review a fresh payload.');
    const { suggestions, usage } = await requestScenarioSuggestions(apiKey, pending.preview);
    const browserCriteria = new Set(pending.includedCriterionIds);
    const seen = new Set<string>();
    for (const suggestion of suggestions.suggestions) {
      if (!browserCriteria.has(suggestion.criterionId) || seen.has(suggestion.criterionId)) throw new Error('The provider returned an unknown, excluded or duplicate criterion. No suggestions were added.');
      seen.add(suggestion.criterionId);
    }
    const criteria = draft.contract.criteria.map((criterion) => ({ ...criterion, scenarioIds: [...criterion.scenarioIds] }));
    const scenarios = [...draft.contract.scenarios];
    for (const suggestion of suggestions.suggestions) {
      const scenarioId = `ai-${randomUUID()}`;
      const criterion = criteria.find(({ id }) => id === suggestion.criterionId)!;
      criterion.scenarioIds.push(scenarioId);
      scenarios.push({ id: scenarioId, criterionIds: [criterion.id], summary: suggestion.title, layer: 'browser', preconditions: [], steps: suggestion.steps, expectedObservations: suggestion.expectedObservations, risk: 'medium', approved: false });
    }
    const next = { ...draft, contract: QAContractSchema.parse({ ...draft.contract, criteria, scenarios }), manifest: RunManifestSchema.parse({ ...draft.manifest, modelId: pending.preview.model, limits: { ...draft.manifest.limits, modelInputTokens: 12_000, modelOutputTokens: pending.preview.maxOutputTokens, ...(usage ? { modelInputTokensUsed: usage.inputTokens, modelOutputTokensUsed: usage.outputTokens } : {}) } }), notes: [...draft.notes, 'AI-generated browser scenarios are untrusted suggestions. Review and approve each scenario; the model does not set criteria, execute actions or determine verdicts.'] };
    this.pendingPlans.set(pending.runId, next);
    return next;
  }

  async saveClientId(input: string): Promise<DesktopState> {
    const clientId = ClientIdSchema.parse(input.trim());
    const previous = await this.setting<string>(SETTING.clientId);
    if (previous !== clientId) {
      this.auth = undefined;
      this.authClientId = undefined;
      await this.store.setSetting(SETTING.accountId, null);
    }
    await this.store.setSetting(SETTING.clientId, clientId);
    return this.getState();
  }

  async signIn(): Promise<DesktopState> {
    const auth = await this.requireAuth();
    const account = await auth.signIn();
    await this.store.setSetting(SETTING.accountId, account.homeAccountId);
    return this.getState();
  }

  async signOut(homeAccountId: string): Promise<DesktopState> {
    const auth = await this.requireAuth();
    if (this.activeRuns.size || this.runStarting) throw new Error('Stop the active QA run before signing out.');
    const account = (await auth.getAccounts()).find(({ homeAccountId: id }) => id === homeAccountId);
    if (!account) throw new Error('The selected account is no longer signed in.');
    const action = await this.selectSignOutDataAction?.(account.username) ?? 'keep';
    if (action === 'cancel') return this.getState();
    if (action === 'delete') {
      const runs = await this.store.listRuns();
      if (this.evidenceRoot) for (const { manifest } of runs) await deleteRunEvidence(this.evidenceRoot, manifest.runId);
      await this.store.deleteLocalQaData();
      this.pendingPlans.clear();
      this.pendingModelPreviews.clear();
    }
    await auth.signOut(homeAccountId);
    if (await this.setting<string>(SETTING.accountId) === homeAccountId) {
      await this.store.setSetting(SETTING.accountId, null);
    }
    return this.getState();
  }

  async selectOrganization(input: string): Promise<DesktopState> {
    const organization = resolveOrganization(input);
    await this.requireAccount();
    await this.store.setSetting(SETTING.organization, organization);
    await this.store.setSetting(SETTING.project, null);
    return this.getState();
  }

  async listProjects(): Promise<AdoProject[]> {
    const [organization, token] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.accessToken(),
    ]);
    if (!organization) throw new Error('Choose an Azure DevOps organization first.');
    return this.ado.listProjects(token, organization);
  }

  async selectProject(input: AdoProject): Promise<DesktopState> {
    const project = ProjectSchema.parse(input);
    if (!(await this.setting<string>(SETTING.organization))) {
      throw new Error('Choose an Azure DevOps organization first.');
    }
    await this.store.setSetting(SETTING.project, project);
    return this.getState();
  }

  async listWorkItemTypes(): Promise<string[]> {
    const [organization, project, token] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.accessToken(),
    ]);
    if (!organization || !project) throw new Error('Choose an Azure DevOps project first.');
    return this.ado.getWorkItemTypes(token, organization, project.id);
  }

  async saveWorkItemTypeMapping(typeInput: string, kindInput: WorkItemKind): Promise<DesktopState> {
    const type = z.string().trim().min(1).max(120).parse(typeInput);
    const kind = z.enum(['REQUIREMENT', 'TASK', 'OTHER']).parse(kindInput);
    const organization = await this.setting<string>(SETTING.organization);
    const project = await this.setting<AdoProject>(SETTING.project);
    if (!organization || !project) throw new Error('Choose an Azure DevOps project before mapping work item types.');
    const types = await this.ado.getWorkItemTypes(await this.accessToken(), organization, project.id);
    const canonical = types.find((name) => name.toLocaleLowerCase('en-US') === type.toLocaleLowerCase('en-US'));
    if (!canonical) throw new Error('That work item type is not available in the selected project. Refresh the project types and try again.');
    const mappings = await this.typeMappings(organization, project.id);
    mappings[canonical] = kind;
    await this.store.setSetting(this.typeMappingsSettingKey(organization, project.id), mappings);
    return this.refreshQueue();
  }

  async searchItems(input: SearchItemsInput): Promise<WorkItemSearchPage> {
    const validated = SearchSchema.parse(input);
    const [organization, project, token] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.accessToken(),
    ]);
    if (!organization || !project) throw new Error('Choose an Azure DevOps project first.');
    return this.ado.search(token, {
      organization,
      projectId: project.id,
      projectName: project.name,
      ...validated,
      customTypeMappings: await this.typeMappings(organization, project.id),
    });
  }

  async addQueueItem(workItemId: number): Promise<DesktopState> {
    const id = z.number().int().positive().max(2_147_483_647).parse(workItemId);
    const [organization, project, token] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.accessToken(),
    ]);
    if (!organization || !project) throw new Error('Choose an Azure DevOps project first.');
    const [snapshot] = await this.ado.fetchWorkItems(token, {
      organization, projectId: project.id, projectName: project.name, ids: [id],
      customTypeMappings: await this.typeMappings(organization, project.id),
    });
    if (!snapshot) throw new Error('Azure DevOps did not return that work item. It may have been deleted or access may have changed.');
    await this.store.addToQueue(snapshot);
    return this.getState();
  }

  async getChildren(parentWorkItemId: number): Promise<WorkItemSnapshot[]> {
    const parentId = z.number().int().positive().max(2_147_483_647).parse(parentWorkItemId);
    const [organization, project, token] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.accessToken(),
    ]);
    if (!organization || !project) throw new Error('Choose an Azure DevOps project first.');
    return this.ado.getChildren(token, { organization, projectId: project.id, projectName: project.name, parentId, customTypeMappings: await this.typeMappings(organization, project.id) });
  }

  async removeQueueItem(key: string): Promise<DesktopState> {
    const validated = z.string().min(1).max(400).parse(key);
    await this.store.removeFromQueue(validated);
    return this.getState();
  }

  async moveQueueItem(key: string, direction: 'up' | 'down'): Promise<DesktopState> {
    const validatedKey = z.string().min(1).max(400).parse(key);
    const validatedDirection = z.enum(['up', 'down']).parse(direction);
    const entries = await this.store.getQueue();
    const index = entries.findIndex(({ key: entryKey }) => entryKey === validatedKey);
    if (index >= 0) {
      const destination = Math.max(0, Math.min(entries.length - 1, index + (validatedDirection === 'up' ? -1 : 1)));
      [entries[index], entries[destination]] = [entries[destination]!, entries[index]!];
      await this.store.reorderQueue(entries.map(({ key: entryKey }) => entryKey));
    }
    return this.getState();
  }

  async refreshQueue(): Promise<DesktopState> {
    const entries = await this.store.getQueue();
    for (const entry of entries) {
      try {
        const [token] = await Promise.all([
          this.accessToken(),
        ]);
        const snapshot = await this.store.getSnapshot(entry.key);
        if (!snapshot) {
          await this.store.markStale(entry.key, true);
          continue;
        }
        const [fresh] = await this.ado.fetchWorkItems(token, {
          organization: entry.organization,
          projectId: entry.projectId,
          projectName: snapshot.projectName,
          ids: [entry.workItemId],
          customTypeMappings: await this.typeMappings(entry.organization, entry.projectId),
        });
        if (!fresh) await this.store.markStale(entry.key, true);
        else {
          await this.store.addToQueue(fresh);
          await this.store.markStale(entry.key, false);
        }
      } catch {
        await this.store.markStale(entry.key, true);
      }
    }
    return this.getState();
  }

  async chooseRepository(): Promise<string | undefined> {
    this.chosenRepositoryPath = await this.chosenRepository();
    return this.chosenRepositoryPath;
  }

  async listGitRepositories() {
    const organization = await this.setting<string>(SETTING.organization);
    const project = await this.setting<AdoProject>(SETTING.project);
    if (!organization || !project) throw new Error('Select an Azure DevOps organization and project first.');
    return this.ado.listGitRepositories(await this.accessToken(), organization, project.id);
  }

  async listGitRefs(repositoryId: string) {
    return this.ado.listGitRefs(await this.accessToken(), await this.setting<string>(SETTING.organization) ?? '', z.string().min(1).max(200).parse(repositoryId));
  }

  async saveTarget(input: TargetConfig): Promise<DesktopState> {
    const target = TargetSchema.parse(input);
    if (target.repositoryPath) {
      const current = await this.setting<TargetConfig>('run.target');
      const chosen = this.chosenRepositoryPath;
      if (chosen !== target.repositoryPath && current?.repositoryPath !== target.repositoryPath) {
        throw new Error('Choose the repository using the folder picker before saving this target.');
      }
    }
    if (target.adoRepository) {
      const organization = await this.setting<string>(SETTING.organization);
      const project = await this.setting<AdoProject>(SETTING.project);
      const source = target.adoRepository;
      if (!organization || !project || source.organization.toLocaleLowerCase('en-US') !== organization.toLocaleLowerCase('en-US') || source.projectId !== project.id) throw new Error('Select the same Azure DevOps organization and project before saving this repository target.');
      const token = await this.accessToken();
      const repositories = await this.ado.listGitRepositories(token, organization, project.id);
      if (!repositories.some(({ id, name }) => id === source.id && name === source.name)) throw new Error('The selected Azure DevOps repository is no longer available in this project.');
      const refs = await this.ado.listGitRefs(token, organization, source.id);
      if (!refs.some(({ name, objectId }) => name === source.refName && objectId === source.commit)) throw new Error('The selected repository ref changed. Choose the current ref and review a fresh snapshot.');
    }
    await this.store.setSetting('run.target', target);
    return this.getState();
  }

  async createDraftPlan(previousRunId?: string): Promise<DraftPlan> {
    this.pendingPlans.clear();
    let target = TargetSchema.parse(await this.setting<TargetConfig>('run.target'));
    if (previousRunId) {
      const priorId = z.string().uuid().parse(previousRunId);
      const prior = await this.store.getRun(priorId);
      if (!prior?.report) throw new Error('Only a completed run can be rerun.');
      const priorTarget = TargetSchema.parse(await this.setting<TargetConfig>(`run.target.${priorId}`));
      if (prior.manifest.targetKind !== priorTarget.targetKind) throw new Error('The saved target no longer matches the prior run.');
      target = priorTarget;
      await this.store.setSetting('run.target', target);
    }
    const queue = await this.store.getQueue();
    if (!queue.length) throw new Error('Add at least one work item to the QA Queue before creating a plan.');
    const snapshots: WorkItemSnapshot[] = [];
    const notes: string[] = [];
    for (const entry of queue) {
      if (entry.stale) throw new Error(`Work item ${entry.workItemId} is stale. Refresh the QA Queue before planning.`);
      const snapshot = await this.store.getSnapshot(entry.key);
      if (!snapshot) throw new Error(`Work item ${entry.workItemId} has no saved source snapshot.`);
      snapshots.push(snapshot);
    }
    let repositoryConfig: Awaited<ReturnType<typeof readRepositoryConfig>>['config'] | undefined;
    const fingerprint = await this.configFingerprint(target);
    let repositorySnapshotHash: string | undefined;
    let localGitState: 'clean' | 'dirty' | 'not-a-git-repository' | 'unavailable' | undefined;
    if (target.targetKind !== 'site') {
      await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
      const probeSnapshot = await mkdtemp(join(this.scratchRoot, 'agentic-qa-preview-'));
      try {
        const sourcePath = await this.prepareRepositorySource(target, join(probeSnapshot, 'source'));
        const { config } = await readRepositoryConfig(sourcePath);
        repositoryConfig = config;
        const result = await createRepositorySnapshot({ sourcePath, destinationPath: join(probeSnapshot, 'snapshot'), config });
        repositorySnapshotHash = result.sha256;
        if (target.repositoryPath) localGitState = await this.inspectLocalGitState(target.repositoryPath);
      } finally { await rm(probeSnapshot, { recursive: true, force: true }).catch(() => undefined); }
    }
    const requiredLayers = target.targetKind === 'site' ? ['browser'] as const
      : target.targetKind === 'repository' ? ['repo'] as const
        : ['repo', 'browser'] as const;
    const criteria: QAContract['criteria'] = [];
    const scenarios: QAContract['scenarios'] = [];
    for (const snapshot of snapshots) {
      if (snapshot.kind !== 'REQUIREMENT') {
        notes.push(`Task #${snapshot.id} is retained as scope context. It does not prove parent acceptance criteria.`);
        continue;
      }
      const raw = snapshot.acceptanceCriteria?.trim() ?? '';
      if (!raw) {
        notes.push(`Requirement #${snapshot.id} has no acceptance criteria. No criterion was invented.`);
        continue;
      }
      const parts = raw.split(/\r?\n/).map((part) => part.trim().replace(/^(?:[-*•]\s*|\d+[.)]\s*)/, '').trim()).filter(Boolean);
      const lines = parts.length ? parts : [raw];
      for (const [index, text] of lines.entries()) {
        const excerptHash = sha256(text);
        const criterionId = `wi-${snapshot.id}-${index + 1}-${excerptHash.slice(0, 10)}`;
        const scenarioIds = requiredLayers.map((layer) => `${criterionId}-${layer}`);
        criteria.push({
          id: criterionId,
          source: { organization: snapshot.organization, projectId: snapshot.projectId, workItemId: snapshot.id, revision: snapshot.revision, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash },
          expectedBehavior: text,
          requiredLayers: [...requiredLayers],
          scenarioIds,
          ambiguityNotes: [],
        });
        for (const layer of requiredLayers) scenarios.push({
          id: `${criterionId}-${layer}`,
          criterionIds: [criterionId],
          layer,
          preconditions: [],
          steps: layer === 'browser' ? [{ action: 'expectText' as const, text }] : [],
          expectedObservations: [text],
          risk: 'medium',
          approved: false,
        });
      }
    }
    if (repositoryConfig) {
      const mapped = new Set(repositoryConfig.tests.flatMap(({ scenarioMappings }) => scenarioMappings.map(({ scenarioId }) => scenarioId)));
      const unmapped = scenarios.filter(({ layer }) => layer === 'repo').filter(({ id }) => !mapped.has(id)).map(({ id }) => id);
      if (unmapped.length) notes.push(`Map each Repository Scenario to exact JUnit testcase identities using scenarioMappings in .agentic-qa.yml, then refresh this plan: ${unmapped.join(', ')}`);
    }
    const contract: QAContract = QAContractSchema.parse({ schemaVersion: 1, id: randomUUID(), revision: 1, criteria, scenarios });
    const startedAt = new Date().toISOString();
    const sourceRefs = snapshots.map((snapshot) => ({
      organization: snapshot.organization, projectId: snapshot.projectId, workItemId: snapshot.id, revision: snapshot.revision,
      field: snapshot.acceptanceCriteria ? 'Microsoft.VSTS.Common.AcceptanceCriteria' : 'System.WorkItemType',
      excerptHash: sha256(snapshot.acceptanceCriteria ?? snapshot.type),
    }));
    const manifest: RunManifest = RunManifestSchema.parse({
      schemaVersion: 1, runId: randomUUID(), startedAt, sources: sourceRefs, targetKind: target.targetKind,
      ...(target.adoRepository ? { sourceCommit: target.adoRepository.commit } : {}),
      ...(target.targetKind !== 'site' ? { repositorySource: target.adoRepository ? { kind: 'ado-git' as const, repositoryId: target.adoRepository.id, refName: target.adoRepository.refName, commit: target.adoRepository.commit } : { kind: 'local' as const } } : {}),
      ...(localGitState ? { localGitState } : {}),
      ...(target.siteBaseUrl ? { siteBaseUrl: target.siteBaseUrl } : {}),
      sourceSnapshotHash: repositorySnapshotHash ?? sha256(JSON.stringify(snapshots)),
      contractId: contract.id, contractRevision: contract.revision,
      configHash: fingerprint.value,
      toolVersions: { app: '1.0.0', electron: process.versions.electron ?? 'unknown', playwright: '1.63.0', repositoryWorker: 'node:22-bookworm-slim', repositoryWorkerProtocol: '1' },
      limits: { runSeconds: 1800, browserActions: 100, artifactMiB: 500 },
      ...(previousRunId ? { previousRunId } : {}),
    });
    const repositoryCommands = repositoryConfig ? [...repositoryConfig.setup, ...repositoryConfig.tests].map(({ id, label, executable, arguments: args, workingDirectory, timeoutSeconds, resultFormat, resultPaths, scenarioMappings }) => ({ id, label, executable, arguments: args, workingDirectory, timeoutSeconds, ...(resultFormat ? { resultFormat } : {}), resultPaths, scenarioMappings })) : undefined;
    const draft = { manifest, contract, notes, ...(repositoryCommands ? { repositoryCommands } : {}) };
    this.pendingPlans.set(manifest.runId, draft);
    return draft;
  }

  async approvePlan(input: DraftPlan): Promise<void> {
    const original = this.pendingPlans.get(input.manifest.runId);
    if (!original || JSON.stringify(original.manifest) !== JSON.stringify(input.manifest) || JSON.stringify(original.repositoryCommands ?? []) !== JSON.stringify(input.repositoryCommands ?? [])) throw new Error('This plan is no longer current. Create a fresh draft and review it again.');
    const contract = validateReadyContract({ ...input.contract, approvedAt: new Date().toISOString() });
    if (contract.id !== original.contract.id || contract.revision !== original.contract.revision) throw new Error('Contract identity cannot change while approving a plan.');
    if (contract.criteria.length !== original.contract.criteria.length || contract.criteria.some((criterion) => {
      const source = original.contract.criteria.find(({ id }) => id === criterion.id)?.source;
      return !source || JSON.stringify(source) !== JSON.stringify(criterion.source);
    })) throw new Error('Requirement identity and source revisions cannot change during review. Create a fresh plan to update sources.');
    await this.validateCurrentSourceRevisions(original.manifest);
    const target = await this.setting<TargetConfig>('run.target');
    if (!target || (await this.configFingerprint(target)).value !== original.manifest.configHash) throw new Error('Run target or repository config changed after plan creation. Create a new plan.');
    if (target.targetKind !== 'site') {
      let temporary = '';
      try {
        let sourcePath = target.repositoryPath;
        if (!sourcePath) { await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 }); temporary = await mkdtemp(join(this.scratchRoot, 'agentic-qa-config-')); sourcePath = await this.prepareRepositorySource(target, temporary); }
        const { config } = await readRepositoryConfig(sourcePath);
        const mappings = new Set(config.tests.flatMap(({ scenarioMappings }) => scenarioMappings.map(({ scenarioId }) => scenarioId)));
        const missing = input.contract.scenarios.filter(({ layer }) => layer === 'repo').filter(({ id }) => !mappings.has(id)).map(({ id }) => id);
        if (missing.length) throw new Error(`Map all Repository Scenarios to JUnit tests in .agentic-qa.yml and refresh the plan before approval: ${missing.join(', ')}`);
      } finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
    }
    await this.store.createRun(original.manifest, contract);
    await this.store.setSetting(`run.target.${original.manifest.runId}`, target);
    this.pendingPlans.delete(input.manifest.runId);
  }

  private async validateCurrentSourceRevisions(manifest: RunManifest): Promise<void> {
    const entries = await this.store.getQueue();
    const snapshots = new Map<string, WorkItemSnapshot>();
    for (const source of manifest.sources) {
      const entry = entries.find((item) => item.organization.toLocaleLowerCase('en-US') === source.organization.toLocaleLowerCase('en-US') && item.projectId === source.projectId && item.workItemId === source.workItemId);
      if (!entry || entry.stale) throw new Error(`Source work item ${source.workItemId} is missing or stale. Refresh the QA Queue and create a fresh plan.`);
      const snapshot = await this.store.getSnapshot(entry.key);
      if (!snapshot) throw new Error(`Source work item ${source.workItemId} has no saved snapshot. Refresh the QA Queue and create a fresh plan.`);
      snapshots.set(entry.key, snapshot);
    }
    const groups = new Map<string, { organization: string; projectId: string; projectName: string; entries: QueueEntry[] }>();
    for (const entry of entries.filter(({ key }) => snapshots.has(key))) {
      const snapshot = snapshots.get(entry.key)!;
      const key = `${entry.organization.toLocaleLowerCase('en-US')}\0${entry.projectId}`;
      const group = groups.get(key) ?? { organization: entry.organization, projectId: entry.projectId, projectName: snapshot.projectName, entries: [] };
      group.entries.push(entry);
      groups.set(key, group);
    }
    const token = await this.accessToken();
    const changedIds: number[] = [];
    for (const group of groups.values()) {
      const current = await this.ado.fetchWorkItems(token, { organization: group.organization, projectId: group.projectId, projectName: group.projectName, ids: group.entries.map(({ workItemId }) => workItemId) });
      const currentById = new Map(current.map((snapshot) => [snapshot.id, snapshot]));
      for (const entry of group.entries) {
        const old = snapshots.get(entry.key)!;
        const fresh = currentById.get(entry.workItemId);
        if (!fresh || fresh.revision !== old.revision) {
          await this.store.markStale(entry.key, true);
          changedIds.push(entry.workItemId);
        }
      }
    }
    if (changedIds.length) throw new Error(`Azure DevOps source changed after this plan was created (work item${changedIds.length === 1 ? '' : 's'} ${[...new Set(changedIds)].join(', ')}). Refresh the QA Queue and create a fresh plan.`);
  }

  async listRuns() {
    const initial = await this.store.listRuns();
    if (this.runStarting || this.activeRuns.size) return initial;
    for (const { manifest, report } of initial) {
      if (report) continue;
      const partial = await this.store.getRun(manifest.runId);
      if (!partial || (!partial.observations.length && !partial.findings.length && !partial.artifacts.length)) continue;
      const findings = [...partial.findings];
      for (const observation of partial.observations.filter(({ status }) => status !== 'PASSED')) {
        if (!findings.some(({ observationIds }) => observationIds.includes(observation.id))) {
          const finding = FindingSchema.parse({ id: randomUUID(), kind: 'INSUFFICIENT_EVIDENCE', observationIds: [observation.id], rationale: 'The app stopped before this observation was included in a final report. Review it before relying on the result.', highRisk: false, unresolved: true });
          await this.store.appendFinding(manifest.runId, finding);
          findings.push(finding);
        }
      }
      const interruption = FindingSchema.parse({ id: randomUUID(), kind: 'ENVIRONMENT_FAILURE', observationIds: partial.observations.map(({ id }) => id), rationale: 'The app stopped before this run was finalized. This immutable run is marked interrupted; start a new run to retry.', highRisk: false, unresolved: true });
      await this.store.appendFinding(manifest.runId, interruption);
      findings.push(interruption);
      const criterionResults = partial.contract.criteria.map((criterion) => {
        const linked = partial.contract.scenarios.filter(({ id }) => criterion.scenarioIds.includes(id));
        const observations = partial.observations.filter(({ scenarioId }) => criterion.scenarioIds.includes(scenarioId));
        const complete = criterion.requiredLayers.every((layer) => {
          const scenarios = linked.filter(({ layer: scenarioLayer }) => scenarioLayer === layer);
          const layerObservations = observations.filter(({ scenarioId }) => scenarios.some(({ id }) => id === scenarioId));
          return scenarios.length > 0 && layerObservations.length === scenarios.length && layerObservations.every(({ status }) => status === 'PASSED');
        });
        return { criterionId: criterion.id, state: complete ? 'VERIFIED' as const : 'BLOCKED' as const, observationIds: observations.map(({ id }) => id), missingEvidence: complete ? [] : ['Run was interrupted before all required evidence was finalized.'], findingIds: findings.filter(({ observationIds }) => observationIds.some((id) => observations.some((item) => item.id === id))).map(({ id }) => id) };
      });
      await this.store.finalizeRun(buildReport({
        schemaVersion: 1, runId: manifest.runId, executionState: 'INTERRUPTED', criterionResults,
        findingIds: [], completedAt: new Date().toISOString(), explanation: 'The app stopped before this run completed. Its partial evidence is preserved; create a new run to retry.', findings,
      }));
    }
    return this.store.listRuns();
  }

  async isBrowserInstalled(): Promise<boolean> {
    if (!this.browserExecutablePath) return false;
    try { await access(this.browserExecutablePath()); return true; }
    catch { return false; }
  }

  async installBrowser(): Promise<void> {
    if (!this.browserInstaller) throw new Error('Browser installation is unavailable in this build.');
    await this.browserInstaller();
  }

  async isRepoWorkerImageInstalled(): Promise<boolean> {
    return this.repoWorkerImageProbe ? this.repoWorkerImageProbe().catch(() => false) : false;
  }

  async installRepoWorkerImage(): Promise<void> {
    if (!this.repoWorkerImageInstaller) throw new Error('Docker Desktop is unavailable. Install and start Docker Desktop, then retry.');
    await this.repoWorkerImageInstaller();
  }

  async getRun(runId: string) {
    const run = await this.store.getRun(z.string().uuid().parse(runId));
    if (!run) return undefined;
    return { ...run, artifacts: run.artifacts.map(({ id, kind, sha256, bytes, redactionState }) => ({ id, kind, sha256, bytes, redactionState })) };
  }

  async exportReport(runId: string, format: ReportFormat): Promise<boolean> {
    const run = await this.getRun(runId);
    if (!run?.report) throw new Error('This run has no finalized report to export yet.');
    const bundle = { ...run, report: run.reviewedReport ?? run.report };
    const content = renderReport(bundle, format);
    const safeRunId = runId.toLocaleLowerCase('en-US');
    return this.saveReportFile(`Agentic-QA-${safeRunId}.${format === 'markdown' ? 'md' : format}`, content, format);
  }

  async exportArtifact(runIdInput: string, artifactIdInput: string): Promise<boolean> {
    const runId = z.string().uuid().parse(runIdInput);
    const artifactId = z.string().uuid().parse(artifactIdInput);
    const run = await this.store.getRun(runId);
    const artifact = run?.artifacts.find(({ id }) => id === artifactId);
    if (!artifact || !this.evidenceRoot || !this.artifactKey) throw new Error('Encrypted evidence was not found or is unavailable.');
    const extensions = { trace: 'zip', screenshot: 'png', log: 'log', 'test-result': 'xml', network: 'json', report: 'json' } as const;
    const contents = await decryptArtifact({ artifact, evidenceRoot: this.evidenceRoot, key: await this.artifactKey() });
    try {
      return await this.saveEvidenceFile(`Agentic-QA-${runId}-${artifact.kind}.${extensions[artifact.kind]}`, contents, artifact.redactionState === 'restricted');
    } finally { contents.fill(0); }
  }

  async cancelRun(runIdInput: string): Promise<boolean> {
    const runId = z.string().uuid().parse(runIdInput);
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.abort();
    return true;
  }

  async classifyFinding(input: { runId: string; findingId: string; kind: Finding['kind']; author: string; reason: string }): Promise<QAReport> {
    const runId = z.string().uuid().parse(input.runId);
    const findingId = z.string().uuid().parse(input.findingId);
    const kind = z.enum(['PRODUCT_FAILURE', 'TEST_FAILURE', 'ENVIRONMENT_FAILURE', 'FLAKY_TEST', 'AMBIGUOUS_REQUIREMENT']).parse(input.kind);
    const author = z.string().trim().min(1).max(200).parse(input.author);
    const reason = z.string().trim().min(1).max(4000).parse(input.reason);
    const run = await this.store.getRun(runId);
    if (!run?.report) throw new Error('Only finalized runs can be reviewed.');
    const source = run.findings.find(({ id }) => id === findingId);
    if (!source) throw new Error('Finding was not found in this run.');
    if (source.humanOverride) throw new Error('Choose the original finding when recording a new reviewer classification.');
    const latestOverride = run.findings.filter(({ humanOverride, observationIds }) => humanOverride && observationIds.some((id) => source.observationIds.includes(id))).at(-1);
    const currentKind = latestOverride?.kind ?? source.kind;
    const finding = FindingSchema.parse({
      ...source,
      id: randomUUID(),
      kind,
      rationale: reason,
      unresolved: kind === 'AMBIGUOUS_REQUIREMENT',
      highRisk: kind === 'PRODUCT_FAILURE' || kind === 'AMBIGUOUS_REQUIREMENT',
      humanOverride: { author, reason, at: new Date().toISOString(), previousKind: currentKind },
    });
    await this.store.appendFinding(runId, finding);
    const observations = run.observations.filter(({ id }) => finding.observationIds.includes(id));
    const failedCriteria = new Set(run.contract.criteria.filter((criterion) => criterion.scenarioIds.some((scenarioId) => observations.some(({ scenarioId: id }) => id === scenarioId))).map(({ id }) => id));
    const findings = [...run.findings, finding];
    const baseReport = run.reviewedReport ?? run.report;
    const criterionResults = baseReport.criterionResults.map((result) => kind === 'PRODUCT_FAILURE' && failedCriteria.has(result.criterionId)
      ? { ...result, state: 'FAILED' as const, missingEvidence: [...result.missingEvidence, 'A reviewer confirmed a product failure.'], findingIds: [...result.findingIds, finding.id] }
      : failedCriteria.has(result.criterionId) ? { ...result, findingIds: [...result.findingIds, finding.id] } : result);
    const reviewed = buildReport({
      schemaVersion: 1, runId, executionState: baseReport.executionState, criterionResults,
      findingIds: [], completedAt: new Date().toISOString(),
      explanation: kind === 'PRODUCT_FAILURE'
        ? `A reviewer confirmed a product failure. ${reason}`
        : kind === 'AMBIGUOUS_REQUIREMENT'
          ? `A reviewer marked the requirement ambiguous. ${reason}`
          : `A reviewer classified the finding as ${kind.toLocaleLowerCase('en-US').replaceAll('_', ' ')}. Required evidence remains unchanged. ${reason}`,
      findings,
    });
    await this.store.finalizeReview(reviewed);
    return reviewed;
  }

  async deleteRun(runIdInput: string): Promise<boolean> {
    const runId = z.string().uuid().parse(runIdInput);
    if (this.activeRuns.has(runId)) throw new Error('Stop the active run before deleting it.');
    const run = await this.store.getRun(runId);
    if (!run) return false;
    if (!(await this.confirmDeleteRun?.(runId))) return false;
    if (this.evidenceRoot) await deleteRunEvidence(this.evidenceRoot, runId);
    await this.store.deleteRun(runId);
    await this.store.setSetting(`run.target.${runId}`, null);
    return true;
  }

  async startRun(runIdInput: string): Promise<QAReport> {
    if (this.runStarting || this.activeRuns.size) throw new Error('Another QA run is already active.');
    this.runStarting = true;
    try { return await this.executeRun(runIdInput); }
    finally { this.runStarting = false; }
  }

  private async executeRun(runIdInput: string): Promise<QAReport> {
    const runId = z.string().uuid().parse(runIdInput);
    const archived = await this.store.getRun(runId);
    if (!archived) throw new Error('Run manifest was not found.');
    if (archived.report) throw new Error('This immutable run already has a final report. Create a new run to retry.');
    if (archived.observations.length || archived.findings.length || archived.artifacts.length) throw new Error('This run contains partial evidence from a previous attempt. Its interrupted report is being recovered in History; create a new run to retry.');
    const manifest = archived.manifest;
    const target = TargetSchema.parse(await this.setting<TargetConfig>(`run.target.${runId}`));
    if ((await this.configFingerprint(target)).value !== manifest.configHash) throw new Error('Run configuration or repository config no longer matches its approved manifest.');
    if (target.targetKind !== 'repository' && !(await this.isBrowserInstalled())) throw new Error('Install the local Chromium browser from Run setup before starting this site run.');
    const abort = new AbortController();
    this.activeRuns.set(runId, abort);
    let scratch = '';
    const observations: Observation[] = [];
    const findings: Finding[] = [];
    let executionState: 'COMPLETED' | 'CANCELLED' | 'INTERRUPTED' | 'BLOCKED' = 'COMPLETED';
    let blockedReason = '';
    let siteBlocked = false;
    let timedOut = false;
    const runTimeoutMs = Math.min(manifest.limits.runSeconds ?? this.maxRunSeconds, this.maxRunSeconds) * 1000;
    const deadlineAt = Date.now() + runTimeoutMs;
    const deadline = setTimeout(() => { timedOut = true; abort.abort(); }, runTimeoutMs);
    deadline.unref();
    try {
      scratch = await mkdtemp(join(this.scratchRoot, `agentic-qa-${runId}-`));
      if (manifest.targetKind !== target.targetKind) throw new Error('Run target does not match the approved manifest.');
      if (manifest.siteBaseUrl) {
        const manifestSite = new URL(manifest.siteBaseUrl);
        if (!target.siteBaseUrl || new URL(target.siteBaseUrl).origin !== manifestSite.origin) throw new Error('Run site does not match the approved manifest.');
        try { await this.sitePreflight(manifest.siteBaseUrl); }
        catch (error) { executionState = 'BLOCKED'; siteBlocked = true; blockedReason = error instanceof Error ? error.message : 'Site preflight failed.'; }
      }
      if (target.targetKind !== 'site') {
        try {
          const repositorySourcePath = target.repositoryPath ?? await this.prepareRepositorySource(target, join(scratch, 'ado-source'));
          const { config } = await readRepositoryConfig(repositorySourcePath);
          const repositoryScenarios = archived.contract.scenarios.filter(({ layer }) => layer === 'repo');
          const mapped = new Set(config.tests.flatMap(({ scenarioMappings }) => scenarioMappings.map(({ scenarioId }) => scenarioId)));
          const unmapped = repositoryScenarios.filter(({ id }) => !mapped.has(id));
          if (unmapped.length) throw new Error(`Map the following approved repository scenarios to JUnit test commands in .agentic-qa.yml: ${unmapped.map(({ id }) => id).join(', ')}`);
          const result = await runRepositoryChecks({
            runId, repositoryPath: repositorySourcePath, config, snapshotPath: join(scratch, 'repository'),
            artifactDirectory: join(scratch, 'repository-artifacts'),
            maxArtifactBytes: (manifest.limits.artifactMiB ?? 500) * 1024 * 1024,
            timeoutMs: Math.max(1, deadlineAt - Date.now()), expectedSnapshotHash: manifest.sourceSnapshotHash, signal: abort.signal,
          });
          const artifactIdsByScenario = new Map<string, string[]>();
          for (const captured of result.artifacts) {
            if (!this.evidenceRoot || !this.artifactKey) throw new Error('Encrypted evidence storage is unavailable.');
            const metadata = await encryptArtifact({
              runId, kind: captured.kind, sourcePath: captured.path, evidenceRoot: this.evidenceRoot,
              key: await this.artifactKey(), maxBytes: (manifest.limits.artifactMiB ?? 500) * 1024 * 1024,
            });
            await this.store.recordArtifact(metadata);
            for (const scenarioId of captured.scenarioIds) artifactIdsByScenario.set(scenarioId, [...(artifactIdsByScenario.get(scenarioId) ?? []), metadata.id]);
          }
          const repositoryObservations = result.observations.map((observation) => ObservationSchema.parse({
            ...observation, artifactIds: [...observation.artifactIds, ...(artifactIdsByScenario.get(observation.scenarioId) ?? [])],
          }));
          observations.push(...repositoryObservations);
          for (const observation of repositoryObservations) await this.store.appendObservation(observation);
          if (abort.signal.aborted) { executionState = timedOut ? 'BLOCKED' : 'CANCELLED'; if (timedOut) blockedReason = 'The run exceeded its approved wall-clock limit.'; }
          if (result.blocked) throw new Error(result.blocked);
          if (result.observations.some(({ status }) => status === 'ERROR')) { executionState = 'BLOCKED'; blockedReason = 'A repository command timed out, was cancelled, or produced no mapped JUnit assertions.'; }
        } catch (error) {
          executionState = 'BLOCKED';
          blockedReason = error instanceof Error ? error.message : 'Repository worker could not start.';
        }
      }
      const browserScenarios = archived.contract.scenarios.filter(({ layer }) => layer === 'browser');
      let actionsUsed = 0;
      for (const scenario of browserScenarios) {
        if (abort.signal.aborted) { executionState = 'CANCELLED'; break; }
        if (siteBlocked) break;
        const actionLimit = manifest.limits.browserActions ?? 100;
        const remaining = actionLimit - actionsUsed;
        if (remaining <= 0) {
          executionState = 'BLOCKED'; blockedReason = 'Browser action budget was exhausted.'; break;
        }
        try {
          const result: BrowserScenarioResult = await this.browserScenarioRunner({
            runId,
            target: { siteBaseUrl: manifest.siteBaseUrl!, allowedOrigins: [new URL(manifest.siteBaseUrl!).origin] },
            scenario,
            artifactDirectory: scratch,
            timeoutMs: Math.max(100, Math.min(15_000, deadlineAt - Date.now())),
            actionLimit: remaining,
            signal: abort.signal,
          });
          const artifactIds: string[] = [];
          for (const artifact of result.artifacts) {
            if (!this.evidenceRoot || !this.artifactKey) throw new Error('Encrypted evidence storage is unavailable.');
            const metadata = await encryptArtifact({
              runId, kind: artifact.kind, sourcePath: artifact.path, evidenceRoot: this.evidenceRoot,
              key: await this.artifactKey(), maxBytes: (manifest.limits.artifactMiB ?? 500) * 1024 * 1024,
            });
            await this.store.recordArtifact(metadata);
            artifactIds.push(metadata.id);
          }
          const browserObservation = ObservationSchema.parse({ ...result.observation, artifactIds });
          observations.push(browserObservation);
          await this.store.appendObservation(browserObservation);
          actionsUsed += scenario.steps.length + 1;
          if (result.cancelled) { executionState = 'CANCELLED'; break; }
        } catch (error) {
          if (abort.signal.aborted) { executionState = 'CANCELLED'; break; }
          executionState = 'BLOCKED';
          blockedReason = error instanceof Error ? error.message : 'Browser worker could not start.';
          break;
        }
      }
      if (timedOut) { executionState = 'BLOCKED'; blockedReason = 'The run exceeded its approved wall-clock limit.'; }
      else if (abort.signal.aborted) executionState = 'CANCELLED';
      if (blockedReason) {
        findings.push(FindingSchema.parse({ id: randomUUID(), kind: 'ENVIRONMENT_FAILURE', observationIds: observations.map(({ id }) => id), rationale: blockedReason, highRisk: false, unresolved: true }));
      }
      for (const observation of observations.filter(({ status }) => status !== 'PASSED')) findings.push(FindingSchema.parse({
        id: randomUUID(), kind: 'INSUFFICIENT_EVIDENCE', observationIds: [observation.id], rationale: 'The check did not pass. A reviewer must classify the cause before this can be treated as a confirmed product failure.', highRisk: false, unresolved: true,
      }));
      for (const finding of findings) await this.store.appendFinding(runId, finding);

      const criterionResults = archived.contract.criteria.map((criterion) => {
        const linked = archived.contract.scenarios.filter(({ id }) => criterion.scenarioIds.includes(id));
        const linkedObservations = observations.filter(({ scenarioId }) => criterion.scenarioIds.includes(scenarioId));
        const missingEvidence: string[] = [];
        for (const layer of criterion.requiredLayers) {
          const layerScenarios = linked.filter(({ layer: candidate }) => candidate === layer);
          const layerObservations = linkedObservations.filter((observation) => layerScenarios.some(({ id }) => id === observation.scenarioId));
          if (!layerScenarios.length) missingEvidence.push(`No ${layer} scenario is linked.`);
          else if (layerObservations.length !== layerScenarios.length) missingEvidence.push(`${layer} evidence is missing because the check did not run.`);
          else if (layerObservations.some(({ status }) => status !== 'PASSED')) missingEvidence.push(`${layer} evidence contains a failed or errored observation.`);
        }
        const blocked = executionState !== 'COMPLETED' && missingEvidence.length > 0;
        const state: CriterionResult['state'] = !missingEvidence.length ? 'VERIFIED' : blocked ? 'BLOCKED' : 'UNVERIFIED';
        const findingIds = findings.filter((finding) => finding.observationIds.some((id) => linkedObservations.some((observation) => observation.id === id))).map(({ id }) => id);
        return { criterionId: criterion.id, state, observationIds: linkedObservations.map(({ id }) => id), missingEvidence, findingIds };
      });
      const verdict = computeVerdict({ executionState, criterionResults, findings });
      const explanation = verdict === 'PASS'
        ? 'Every acceptance criterion has passing direct evidence for each required layer.'
        : verdict === 'FAIL'
          ? 'At least one criterion has a reviewer-confirmed product failure.'
          : verdict === 'BLOCKED'
            ? `One or more required checks were blocked or did not execute. ${blockedReason}`.trim()
            : 'At least one acceptance criterion remains unverified or has an unresolved finding.';
      const report = buildReport({
        schemaVersion: 1, runId, executionState, criterionResults, findingIds: findings.map(({ id }) => id),
        completedAt: new Date().toISOString(), explanation, findings,
      });
      await this.store.finalizeRun(report);
      return report;
    } finally {
      this.activeRuns.delete(runId);
      clearTimeout(deadline);
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async setting<T>(key: string): Promise<T | undefined> {
    const value = await this.store.getSetting(key);
    return value === null || value === undefined ? undefined : value as T;
  }

  private typeMappingsSettingKey(organization: string, projectId: string): string {
    return `ado.customTypeMappings.${encodeURIComponent(organization.toLocaleLowerCase('en-US'))}.${encodeURIComponent(projectId)}`;
  }

  private async typeMappings(organization: string, projectId: string): Promise<WorkItemTypeMappings> {
    return WorkItemTypeMappingsSchema.parse(await this.setting<WorkItemTypeMappings>(this.typeMappingsSettingKey(organization, projectId)) ?? {});
  }

  private async configFingerprint(target: TargetConfig): Promise<{ value: string; repositoryConfigHash?: string }> {
    let repositoryConfigHash: string | undefined;
    if (target.targetKind !== 'site') {
      let temporary = '';
      try {
        let sourcePath = target.repositoryPath;
        if (!sourcePath) {
          await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
          temporary = await mkdtemp(join(this.scratchRoot, 'agentic-qa-config-'));
          sourcePath = await this.prepareRepositorySource(target, temporary);
        }
        const loaded = await readRepositoryConfig(sourcePath).catch(() => {
          throw new Error('This repository needs a valid .agentic-qa.yml configuration. Review docs/spec/07-repository-config.md and map its JUnit checks to the approved repository scenario IDs.');
        });
        repositoryConfigHash = loaded.sha256;
      } finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
    }
    return { value: sha256(JSON.stringify({ target, ...(repositoryConfigHash ? { repositoryConfigHash } : {}) })), ...(repositoryConfigHash ? { repositoryConfigHash } : {}) };
  }

  private async prepareRepositorySource(target: TargetConfig, destination: string): Promise<string> {
    if (target.repositoryPath) return target.repositoryPath;
    const source = target.adoRepository;
    if (!source) throw new Error('Select a repository source first.');
    const token = await this.accessToken();
    const items = await this.ado.listGitItems(token, source.organization, source.id, source.commit);
    const configItem = items.find((item) => !item.isFolder && item.path === '/.agentic-qa.yml');
    if (!configItem) throw new Error('The selected ADO Git commit must contain a root .agentic-qa.yml file.');
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const configText = await this.ado.getGitItemContent(token, source.organization, source.id, source.commit, configItem.path);
    if (Buffer.byteLength(configText, 'utf8') > 256 * 1024) throw new Error('The repository configuration exceeds the 256 KiB limit.');
    await writeFile(join(destination, '.agentic-qa.yml'), configText, { mode: 0o600, flag: 'wx' });
    const { config } = await readRepositoryConfig(destination);
    const paths = items.filter((item) => !item.isFolder).map((item) => item.path.slice(1)).filter((path) => path && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'));
    const included = new Set(config.repository.include.flatMap((pattern) => micromatch(paths, pattern, { dot: true })));
    for (const pattern of config.repository.exclude) for (const path of micromatch([...included], pattern, { dot: true })) included.delete(path);
    included.delete('.agentic-qa.yml');
    const selected = [...included].filter((path) => !isExcludedRepositoryPath(path)).sort();
    if (selected.length > 10000) throw new Error('The selected repository snapshot contains too many files (limit 10,000).');
    let totalBytes = 0;
    for (const path of selected) {
      const content = await this.ado.getGitItemContent(token, source.organization, source.id, source.commit, `/${path}`);
      const buffer = Buffer.from(content, 'utf8');
      totalBytes += buffer.byteLength;
      if (buffer.byteLength > 100 * 1024 * 1024 || totalBytes > 1_000_000_000) { buffer.fill(0); throw new Error('The selected ADO repository snapshot exceeds its configured size limit.'); }
      const filePath = resolve(destination, ...path.split('/'));
      const inside = relative(destination, filePath);
      if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) { buffer.fill(0); throw new Error(`ADO Git item escaped its snapshot root: ${path}`); }
      await mkdir(join(filePath, '..'), { recursive: true, mode: 0o700 });
      await writeFile(filePath, buffer, { mode: 0o600, flag: 'wx' });
      buffer.fill(0);
    }
    return destination;
  }

  private async inspectLocalGitState(repositoryPath: string): Promise<'clean' | 'dirty' | 'not-a-git-repository' | 'unavailable'> {
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const environment = {
      PATH: process.env.PATH ?? '',
      ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
    };
    try {
      const { stdout } = await execFile('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${nullDevice}`, '-C', repositoryPath, 'status', '--porcelain=v1', '--untracked-files=normal'], { env: environment, timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true });
      return stdout.trim() ? 'dirty' : 'clean';
    } catch (error) {
      const code = (error as { code?: string | number }).code;
      if (code === 'ENOENT') return 'unavailable';
      if (code === 128 || code === '128') {
        try { await stat(join(repositoryPath, '.git')); return 'unavailable'; }
        catch { return 'not-a-git-repository'; }
      }
      return 'unavailable';
    }
  }

  private async requireAuth(): Promise<EntraAdoAuthService> {
    const clientId = await this.setting<string>(SETTING.clientId);
    if (!clientId) throw new Error('Configure an Entra public application client ID first.');
    return this.getAuth(clientId);
  }

  private async getAuth(clientId: string): Promise<EntraAdoAuthService> {
    if (!this.auth || this.authClientId !== clientId) {
      this.auth = await this.authFactory(clientId);
      this.authClientId = clientId;
    }
    return this.auth;
  }

  private async requireAccount(): Promise<AccountSummary> {
    const auth = await this.requireAuth();
    const accountId = await this.setting<string>(SETTING.accountId);
    const account = (await auth.getAccounts()).find(({ homeAccountId }) => homeAccountId === accountId);
    if (!account) throw new Error('Sign in to Azure DevOps first.');
    return account;
  }

  private async accessToken(): Promise<string> {
    const account = await this.requireAccount();
    return (await this.requireAuth()).getAccessToken(account.homeAccountId);
  }
}

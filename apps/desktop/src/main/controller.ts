import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep, basename } from 'node:path';
import type { AccountSummary, AdoAuthService } from '@agentic-qa/ado/auth';
import { AzureCliAdoAuthService } from '@agentic-qa/ado/azure-cli-auth';
import { AdoClient, resolveOrganization, type AdoIteration, type AdoProject, type AdoTaskboardItem, type WorkItemSearchPage } from '@agentic-qa/ado/client';
import type { QueueEntry } from '@agentic-qa/domain/queue';
import { classifyWorkItemType, type WorkItemKind, type WorkItemSnapshot, type WorkItemTypeMappings } from '@agentic-qa/domain/work-item';
import { QAContractSchema, type SourceRef, validateReadyContract, type QAContract } from '@agentic-qa/domain/qa-contract';
import { buildReport, computeVerdict, FindingSchema, ObservationSchema, RunManifestSchema, type CriterionResult, type Finding, type Observation, type QAReport, type RunManifest, type RunProgressEvent } from '@agentic-qa/domain/run';
import type { QaStore } from '@agentic-qa/storage/database';
import { renderReport, type ReportFormat } from '@agentic-qa/reporting/render';
import { runBrowserScenario, type BrowserScenarioResult } from '@agentic-qa/browser-worker/runner';
import { decryptArtifact, deleteRunEvidence, encryptArtifact } from '@agentic-qa/storage/artifacts';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { readRepositoryConfig, RepositoryConfigSchema, type RepositoryConfig } from '@agentic-qa/repo-worker/config';
import { createRepositorySnapshot, readRepositoryContext } from '@agentic-qa/repo-worker/snapshot';
import { runRepositoryChecks } from '@agentic-qa/repo-worker/runner';
import { isExcludedRepositoryPath } from '@agentic-qa/repo-worker/snapshot';
import micromatch from 'micromatch';
import { buildModelPayload, requestScenarioSuggestions } from '@agentic-qa/model-adapters/openai';
import { openAiAdapter } from '@agentic-qa/model-adapters/openai';
import { anthropicAdapter } from '@agentic-qa/model-adapters/anthropic';
import { openRouterAdapter } from '@agentic-qa/model-adapters/openrouter';
import { claudeCodeAdapter } from '@agentic-qa/model-adapters/claude-code';
import { validateApiKey } from '@agentic-qa/model-adapters/provider';
import type { ProviderModel, SavedModelView } from '@agentic-qa/domain/agent';
import { buildDelegationDiagram, DelegationDiagramSchema, DelegationPlanSchema, ProviderModelSchema, RunBudgetSchema, RunEnvelopeSchema, SavedModelSchema, SavedModelViewSchema } from '@agentic-qa/domain/agent';
import type { ModelProviderAdapter } from '@agentic-qa/model-adapters/provider';
import { EvidenceLinkedReviewSchema, planQaRun, RepositoryTestDraftSchema, reviewQaRun, synthesizeWorkItemPlan } from '@agentic-qa/agent-orchestrator';
import type { AdoRunProfile, AdoRunProfileInput, BrowserTestAccountInput, BrowserTestAccountSummary, DesktopState, DraftPlan, QueueItemView, SearchItemsInput, TargetConfig } from '../shared/ipc.js';

const SETTING = {
  accountId: 'entra.selectedAccountId',
  organization: 'ado.organization',
  project: 'ado.project',
  organizations: 'ado.organizations',
  profiles: 'ado.profiles',
  activeProfile: 'ado.activeProfile',
} as const;

type SupportedProviderId = 'openai' | 'anthropic' | 'openrouter' | 'claude-code';
type ApiKeyProviderId = Exclude<SupportedProviderId, 'claude-code'>;
const ProviderIdSchema = z.enum(['openai', 'anthropic', 'openrouter', 'claude-code']);
const providerAdapter = (providerId: SupportedProviderId) => providerId === 'openai' ? openAiAdapter : providerId === 'anthropic' ? anthropicAdapter : providerId === 'openrouter' ? openRouterAdapter : claudeCodeAdapter;
const ModelSettingsSchema = z.object({ providerId: ProviderIdSchema.default('openai'), modelId: z.string().regex(/^[a-zA-Z0-9._:-]{1,200}$/), maxOutputTokens: z.number().int().min(256).max(32_000) }).strict();
const WorkItemTypeMappingsSchema = z.record(z.string().min(1).max(120), z.enum(['REQUIREMENT', 'TASK', 'OTHER']));
const execFile = promisify(execFileCallback);
const ProjectSchema = z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), state: z.string().max(80).optional() }).strict();
const AdoRunProfileSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100),
  organization: z.string().min(1).max(500),
  project: ProjectSchema,
  team: z.string().trim().min(1).max(200),
  boardColumn: z.string().trim().max(120),
  storyIds: z.array(z.number().int().positive().max(2_147_483_647)).max(200),
}).strict();
const AdoRunProfileInputSchema = AdoRunProfileSchema.extend({ project: z.object({ id: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), state: z.string().max(80).optional() }).strict() }).omit({ id: true }).extend({ id: z.string().uuid().optional() });
const SearchSchema = z.object({
  term: z.string().max(120),
  types: z.array(z.string().max(120)).max(20),
  states: z.array(z.string().max(120)).max(20),
  afterId: z.number().int().positive().max(2_147_483_647).optional(),
}).strict();
const BrowserTestAccountSchema = z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(80), origin: z.url(), username: z.string().min(1).max(500), password: z.string().min(1).max(2000), revision: z.number().int().positive() }).strict();
type BrowserTestAccountSecret = z.infer<typeof BrowserTestAccountSchema>;
const TargetSchema = z.object({
  targetKind: z.enum(['repository', 'site', 'both']),
  repositorySource: z.enum(['local', 'ado-git']).optional(),
  repositoryPath: z.string().min(1).max(2000).optional(),
  adoRepository: z.object({ organization: z.string().min(1).max(100), projectId: z.string().min(1).max(200), id: z.string().min(1).max(200), name: z.string().min(1).max(200), refName: z.string().min(1).max(300), commit: z.string().regex(/^[a-f0-9]{40,64}$/i) }).strict().optional(),
  siteBaseUrl: z.url().optional(),
  allowedOrigins: z.array(z.url()).max(10),
  runInstructions: z.string().max(10_000).optional(),
  testAccountIds: z.array(z.string().uuid()).max(20).optional(),
  testAccountVersions: z.record(z.string().uuid(), z.number().int().positive()).optional(),
  showBrowserWindow: z.boolean().optional(),
}).strict().superRefine((target, ctx) => {
  if (['repository', 'both'].includes(target.targetKind) && !(target.repositoryPath || target.adoRepository)) ctx.addIssue({ code: 'custom', message: 'Select a local folder or Azure DevOps Git repository and ref.', path: ['repositoryPath'] });
  if (target.repositoryPath && target.adoRepository) ctx.addIssue({ code: 'custom', message: 'Select one repository source.', path: ['repositoryPath'] });
  if (target.targetKind === 'repository' && target.showBrowserWindow) ctx.addIssue({ code: 'custom', message: 'A visible browser window requires a site target.', path: ['showBrowserWindow'] });
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
  if (new Set(target.testAccountIds ?? []).size !== (target.testAccountIds ?? []).length) ctx.addIssue({ code: 'custom', message: 'Selected test accounts must be unique.', path: ['testAccountIds'] });
  if (Object.keys(target.testAccountVersions ?? {}).length > 20 || Object.keys(target.testAccountVersions ?? {}).some((id) => !(target.testAccountIds ?? []).includes(id))) ctx.addIssue({ code: 'custom', message: 'Account revision metadata must match at most 20 selected accounts.', path: ['testAccountVersions'] });
});

function sha256(text: string): string { return createHash('sha256').update(text).digest('hex'); }

function redactBrowserSecretText(value: string, accounts: Record<string, Partial<Record<'username' | 'password', string>>>): string {
  return Object.values(accounts).flatMap((fields) => Object.values(fields)).filter((secret): secret is string => Boolean(secret))
    .reduce((result, secret) => result.replaceAll(secret, '[REDACTED]'), value);
}

function scrubBrowserScenarioResult(result: BrowserScenarioResult, accounts: Record<string, Partial<Record<'username' | 'password', string>>>): BrowserScenarioResult {
  return {
    ...result,
    observation: {
      ...result.observation,
      assertion: redactBrowserSecretText(result.observation.assertion, accounts),
      ...(result.observation.diagnostic ? { diagnostic: { ...result.observation.diagnostic, detail: redactBrowserSecretText(result.observation.diagnostic.detail, accounts), nextAction: redactBrowserSecretText(result.observation.diagnostic.nextAction, accounts) } } : {}),
    },
    steps: (result.steps ?? []).map((step) => ({ ...step, assertion: redactBrowserSecretText(step.assertion, accounts) })),
  };
}

export class DesktopController {
  private readonly store: QaStore;
  private readonly ado: AdoClient;
  private readonly authFactory: (clientId?: string) => Promise<AdoAuthService>;
  private auth?: AdoAuthService;
  private readonly chosenRepository: () => Promise<string | undefined>;
  private chosenRepositoryPath?: string;
  private readonly pendingPlans = new Map<string, DraftPlan>();
  private readonly workItemTypeCategoryMappings = new Map<string, WorkItemTypeMappings>();
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
  private readonly isClaudeAccountConnected: () => Promise<boolean>;
  private readonly getClaudeAccountEmail: () => Promise<string | undefined>;
  private readonly startClaudeLogin: () => Promise<void>;
  private readonly readAdoProfilesConfig?: () => Promise<string | undefined>;
  private readonly saveAdoProfilesConfig?: (contents: string) => Promise<boolean>;
  private readonly providerFetch: typeof fetch;
  private readonly getProviderAdapter: (providerId: SupportedProviderId) => ModelProviderAdapter;
  private readonly pendingModelPreviews = new Map<string, { runId: string; draftHash: string; preview: ReturnType<typeof buildModelPayload>; includedCriterionIds: string[]; expiresAt: number }>();

  constructor(options: {
    store: QaStore;
    ado?: AdoClient;
    authFactory?: () => Promise<AdoAuthService>;
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
    isClaudeAccountConnected?: () => Promise<boolean>;
    getClaudeAccountEmail?: () => Promise<string | undefined>;
    startClaudeLogin?: () => Promise<void>;
    readAdoProfilesConfig?: () => Promise<string | undefined>;
    saveAdoProfilesConfig?: (contents: string) => Promise<boolean>;
    providerFetch?: typeof fetch;
    providerAdapterFactory?: (providerId: SupportedProviderId) => ModelProviderAdapter;
  }) {
    this.store = options.store;
    this.ado = options.ado ?? new AdoClient();
    this.authFactory = options.authFactory ?? (async () => new AzureCliAdoAuthService());
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
    this.isClaudeAccountConnected = options.isClaudeAccountConnected ?? (async () => false);
    this.getClaudeAccountEmail = options.getClaudeAccountEmail ?? (async () => undefined);
    this.startClaudeLogin = options.startClaudeLogin ?? (async () => { throw new Error('Claude Code CLI is not configured.'); });
    this.readAdoProfilesConfig = options.readAdoProfilesConfig;
    this.saveAdoProfilesConfig = options.saveAdoProfilesConfig;
    this.providerFetch = options.providerFetch ?? fetch;
    this.getProviderAdapter = options.providerAdapterFactory ?? providerAdapter;
  }

  async getState(): Promise<DesktopState> {
    const selectedAccountId = await this.setting<string>(SETTING.accountId);
    if (selectedAccountId) await this.migrateLegacySelections(selectedAccountId);
    const configuredProvider = await this.setting<SupportedProviderId>('model.provider') ?? 'openai';
    const [organization, project, entries, target, providerId, modelKey, modelSettings] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.store.getQueue(),
      this.setting<TargetConfig>('run.target'),
      this.setting<SupportedProviderId>('model.provider'),
      this.setting<string>(`model.apiKey.${configuredProvider}`),
      this.setting<{ providerId?: SupportedProviderId; modelId?: string; model?: string; maxOutputTokens: number }>('model.settings'),
    ]);
    const auth = await this.getAuth().catch(() => undefined);
    const accounts = auth ? await auth.getAccounts().catch(() => []) : [];
    const activeAccountId = selectedAccountId && accounts.some(({ homeAccountId }) => homeAccountId === selectedAccountId) ? selectedAccountId : undefined;
    if (activeAccountId && organization && project) await this.ensureDefaultAdoProfile(organization, project);
    const customTypeMappings = activeAccountId && organization && project ? await this.typeMappings(organization, project.id) : {};
    const queue: QueueItemView[] = await Promise.all(entries.map(async (entry: QueueEntry) => ({
      entry,
      snapshot: await this.store.getSnapshot(entry.key),
    })));
    const claudeAccountEmail = configuredProvider === 'claude-code'
      ? await this.getClaudeAccountEmail().catch(() => undefined)
      : undefined;
    return {
      azureCliAvailable: Boolean(auth),
      accounts,
      ...(activeAccountId ? { selectedAccountId: activeAccountId } : {}),
      ...(activeAccountId && organization ? { selectedOrganization: organization } : {}),
      ...(activeAccountId && project ? { selectedProject: project } : {}),
      customTypeMappings,
      savedOrganizations: activeAccountId ? await this.setting<string[]>(SETTING.organizations) ?? [] : [],
      adoProfiles: activeAccountId ? await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [] : [],
      ...(activeAccountId && await this.setting<string>(SETTING.activeProfile) ? { activeAdoProfileId: await this.setting<string>(SETTING.activeProfile) } : {}),
      queue,
      ...(target ? { target } : {}),
      modelProviderConfigured: configuredProvider === 'claude-code' ? await this.isClaudeAccountConnected().catch(() => false) : Boolean(modelKey),
      modelProvider: providerId ?? modelSettings?.providerId ?? 'openai',
      ...(claudeAccountEmail ? { modelProviderAccountEmail: claudeAccountEmail } : {}),
      modelId: modelSettings?.modelId ?? modelSettings?.model ?? '',
      modelMaxOutputTokens: modelSettings?.maxOutputTokens ?? 1200,
      savedModels: await this.getSavedModels(),
    };
  }

  async importModelKey(): Promise<boolean> {
    return this.importProviderKey('openai');
  }

  async importProviderKey(providerIdInput: ApiKeyProviderId): Promise<boolean> {
    const providerId = ProviderIdSchema.parse(providerIdInput);
    const path = await this.chooseModelKeyFile?.();
    if (!path) return false;
    if ((await stat(path)).size > 2048) throw new Error('The selected API key file is too large. Choose a text file containing only one key.');
    const apiKey = (await readFile(path, 'utf8')).trim();
    if (apiKey.length < 20 || apiKey.length > 500 || /[\r\n]/.test(apiKey)) throw new Error('The selected file must contain one provider API key on a single line.');
    validateApiKey(apiKey);
    await this.store.setSetting(`model.apiKey.${providerId}`, apiKey);
    await this.store.setSetting(`model.credentialGeneration.${providerId}`, randomUUID());
    await this.store.setSetting('model.provider', providerId);
    this.pendingModelPreviews.clear();
    return true;
  }

  async connectClaudeAccount(): Promise<boolean> {
    if (!await this.isClaudeAccountConnected().catch(() => false)) await this.startClaudeLogin();
    if (!await this.isClaudeAccountConnected().catch(() => false)) throw new Error('Claude Code sign-in did not complete. Finish sign-in in the browser and try again.');
    await this.store.setSetting('model.provider', 'claude-code');
    await this.store.setSetting('model.credentialGeneration.claude-code', randomUUID());
    this.pendingModelPreviews.clear();
    return true;
  }

  async listProviderModels(providerIdInput: SupportedProviderId): Promise<ProviderModel[]> {
    const providerId = ProviderIdSchema.parse(providerIdInput);
    if (providerId === 'claude-code') {
      if (!await this.isClaudeAccountConnected()) throw new Error('Connect a Claude plan account through Claude Code before discovering models.');
      return this.getProviderAdapter(providerId).discoverModels?.() ?? claudeCodeAdapter.listModels('');
    }
    const apiKey = await this.setting<string>(`model.apiKey.${providerId}`);
    if (!apiKey) throw new Error(`Connect an ${providerId === 'openai' ? 'OpenAI' : 'Anthropic'} API key before discovering models.`);
    return this.getProviderAdapter(providerId).listModels(apiKey, this.providerFetch);
  }

  async saveAgentModelSettings(input: { providerId: SupportedProviderId; modelId: string; maxOutputTokens: number }): Promise<SavedModelView[]> {
    const settings = ModelSettingsSchema.parse(input);
    const key = settings.providerId === 'claude-code' ? '' : await this.setting<string>(`model.apiKey.${settings.providerId}`);
    if (settings.providerId === 'claude-code' ? !await this.isClaudeAccountConnected() : !key) throw new Error('Connect the selected provider before saving its model.');
    const models = await this.getProviderAdapter(settings.providerId).listModels(key ?? '', this.providerFetch);
    const model = models.find((item) => item.modelId === settings.modelId && item.capabilities.structuredOutput && item.capabilities.toolUse);
    if (!model) throw new Error('Choose a discovered model that supports structured output and tool use.');
    const generation = await this.credentialGeneration(settings.providerId);
    const catalog = await this.savedModelCatalog();
    const prior = catalog.find((item) => item.providerId === model.providerId && item.modelId === model.modelId);
    const savedModel = SavedModelSchema.parse({
      ...model,
      id: prior?.id ?? randomUUID(),
      maxOutputTokens: settings.maxOutputTokens,
      credentialGeneration: generation,
      testStatus: prior?.credentialGeneration === generation ? prior.testStatus : 'untested',
      ...(prior?.credentialGeneration === generation && prior.testedAt ? { testedAt: prior.testedAt, testedCredentialGeneration: prior.testedCredentialGeneration } : {}),
      ...(prior?.credentialGeneration === generation && prior?.testMessage ? { testMessage: prior.testMessage } : {}),
    });
    await this.saveModelCatalog([...catalog.filter((item) => item.id !== savedModel.id), savedModel]);
    await this.store.setSetting('model.provider', settings.providerId);
    await this.store.setSetting('model.settings', settings);
    this.pendingModelPreviews.clear();
    await this.testSavedModel(savedModel.id);
    return this.getSavedModels();
  }

  async selectSavedModel(modelIdInput: string): Promise<DesktopState> {
    const modelId = z.string().uuid().parse(modelIdInput);
    const catalog = await this.savedModelCatalog();
    const model = catalog.find(({ id }) => id === modelId);
    if (!model) throw new Error('Choose a saved model from Settings.');
    const generation = await this.credentialGeneration(model.providerId);
    if (model.testStatus !== 'reachable' || model.testedCredentialGeneration !== generation) throw new Error('Test this saved model successfully after the most recent credential change before using it for planning.');
    await this.store.setSetting('model.provider', model.providerId);
    await this.store.setSetting('model.settings', { providerId: model.providerId, modelId: model.modelId, maxOutputTokens: model.maxOutputTokens });
    this.pendingModelPreviews.clear();
    return this.getState();
  }

  async getSavedModels(): Promise<SavedModelView[]> {
    const catalog = await this.savedModelCatalog();
    const views = await Promise.all(catalog.map(async (model) => {
      const generation = await this.credentialGeneration(model.providerId);
      const stale = model.testStatus !== 'untested' && model.testedCredentialGeneration !== generation;
      return SavedModelViewSchema.parse({
        providerId: model.providerId, modelId: model.modelId, displayName: model.displayName,
        capabilities: model.capabilities, id: model.id, maxOutputTokens: model.maxOutputTokens,
        testStatus: stale ? 'stale' : model.testStatus,
        ...(model.testedAt ? { testedAt: model.testedAt } : {}),
        ...(!stale && model.testMessage ? { testMessage: model.testMessage } : {}),
      });
    }));
    return views;
  }

  async testSavedModel(modelIdInput: string): Promise<{ reachable: boolean; testStatus: 'reachable' | 'unreachable'; message: string }> {
    const modelId = z.string().uuid().parse(modelIdInput);
    const catalog = await this.savedModelCatalog();
    const index = catalog.findIndex((item) => item.id === modelId);
    if (index < 0) throw new Error('Saved model was not found.');
    const model = catalog[index]!;
    const generation = await this.credentialGeneration(model.providerId);
    const apiKey = model.providerId === 'claude-code' ? '' : await this.setting<string>(`model.apiKey.${model.providerId}`);
    if (model.providerId === 'claude-code' ? !await this.isClaudeAccountConnected() : !apiKey) throw new Error('Reconnect this provider before testing the saved model.');
    let reachable = false;
    try {
      const adapter = this.getProviderAdapter(model.providerId);
      await adapter.probe(apiKey ?? '', model.modelId, this.providerFetch);
      reachable = true;
    } catch {
      reachable = false;
    }
    const testedAt = new Date().toISOString();
    const { testMessage: _previousTestMessage, ...modelWithoutTestMessage } = model;
    catalog[index] = SavedModelSchema.parse({
      ...modelWithoutTestMessage,
      credentialGeneration: generation,
      testStatus: reachable ? 'reachable' : 'unreachable',
      testedAt,
      testedCredentialGeneration: generation,
      ...(reachable ? {} : { testMessage: 'The provider did not complete the reachability prompt. Verify model access, credentials, and account limits.' }),
    });
    await this.saveModelCatalog(catalog);
    return {
      reachable,
      testStatus: reachable ? 'reachable' : 'unreachable',
      message: reachable ? 'Model is reachable and completed a prompt.' : 'Model did not complete the reachability prompt. Verify model access, credentials, and account limits.',
    };
  }

  async removeSavedModel(modelIdInput: string): Promise<SavedModelView[]> {
    const modelId = z.string().uuid().parse(modelIdInput);
    const catalog = await this.savedModelCatalog();
    const removed = catalog.find(({ id }) => id === modelId);
    await this.saveModelCatalog(catalog.filter(({ id }) => id !== modelId));
    if (removed) {
      const active = await this.setting<{ providerId?: SupportedProviderId; modelId?: string }>('model.settings');
      if (active?.providerId === removed.providerId && active.modelId === removed.modelId) await this.store.setSetting('model.settings', null);
    }
    return this.getSavedModels();
  }

  private async savedModelCatalog() {
    const raw = await this.setting<unknown>('model.catalog');
    return raw === undefined || raw === null ? [] : z.array(SavedModelSchema).max(100).parse(raw);
  }

  private async saveModelCatalog(catalog: unknown): Promise<void> {
    await this.store.setSetting('model.catalog', z.array(SavedModelSchema).max(100).parse(catalog));
  }

  private async credentialGeneration(providerId: SupportedProviderId): Promise<string> {
    const settingKey = `model.credentialGeneration.${providerId}`;
    const existing = await this.setting<string>(settingKey);
    if (existing && z.string().uuid().safeParse(existing).success) return existing;
    const generation = randomUUID();
    await this.store.setSetting(settingKey, generation);
    return generation;
  }

  async clearModelKey(): Promise<void> {
    const providerId = await this.setting<SupportedProviderId>('model.provider') ?? 'openai';
    if (providerId !== 'claude-code') await this.store.setSetting(`model.apiKey.${providerId}`, null);
    await this.store.setSetting(`model.credentialGeneration.${providerId}`, randomUUID());
    await this.store.setSetting('model.settings', null);
    this.pendingModelPreviews.clear();
  }

  async saveModelSettings(input: { model: string; maxOutputTokens: number }): Promise<void> {
    const settings = ModelSettingsSchema.parse(input);
    await this.store.setSetting('model.settings', settings);
    this.pendingModelPreviews.clear();
  }

  async previewModelRequest(runIdInput: string, includedCriterionIdsInput: string[]) {
    const runId = z.string().uuid().parse(runIdInput);
    if (!(await this.setting<string>('model.apiKey.openai') ?? await this.setting<string>('model.apiKey'))) throw new Error('Import an OpenAI API key before requesting AI scenario suggestions.');
    const draft = this.pendingPlans.get(runId);
    if (!draft) throw new Error('This plan is no longer current. Create a fresh draft before previewing a provider request.');
    const eligibleIds = new Set(draft.contract.criteria.filter(({ requiredLayers }) => requiredLayers.includes('browser')).map(({ id }) => id));
    const includedCriterionIds = z.array(z.string().min(1).max(120)).min(1).max(50).parse(includedCriterionIdsInput);
    if (new Set(includedCriterionIds).size !== includedCriterionIds.length || includedCriterionIds.some((id) => !eligibleIds.has(id))) throw new Error('The provider preview may include only selected browser criteria from this plan.');
    const saved = await this.setting<{ modelId?: string; model?: string; maxOutputTokens: number }>('model.settings');
    const model = saved?.modelId ?? saved?.model ?? '';
    if (!model) throw new Error('Select a supported provider model before requesting suggestions.');
    const preview = buildModelPayload(draft, model, saved?.maxOutputTokens ?? 1200, includedCriterionIds);
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
    const apiKey = await this.setting<string>('model.apiKey.openai') ?? await this.setting<string>('model.apiKey');
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

  async signIn(): Promise<DesktopState> {
    const auth = await this.requireAuth();
    const account = await auth.signIn();
    await this.store.setSetting(SETTING.accountId, account.homeAccountId);
    await this.migrateLegacySelections(account.homeAccountId);
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

  async selectAccount(homeAccountIdInput: string): Promise<DesktopState> {
    const homeAccountId = z.string().min(1).max(500).parse(homeAccountIdInput);
    const account = (await (await this.requireAuth()).getAccounts()).find(({ homeAccountId: id }) => id === homeAccountId);
    if (!account) throw new Error('That Azure CLI account is no longer signed in. Run `az login` and try again.');
    await this.store.setSetting(SETTING.accountId, account.homeAccountId);
    await this.migrateLegacySelections(account.homeAccountId);
    return this.getState();
  }

  async selectOrganization(input: string): Promise<DesktopState> {
    const organization = resolveOrganization(input);
    const account = await this.requireAccount();
    const token = await this.requireAuth().then((auth) => auth.getAccessToken(account.homeAccountId));
    await this.ado.listProjects(token, organization);
    const saved = await this.setting<string[]>(SETTING.organizations) ?? [];
    if (!saved.some((item) => item.toLocaleLowerCase('en-US') === organization.toLocaleLowerCase('en-US'))) {
      await this.setSetting(SETTING.organizations, [...saved, organization]);
    }
    await this.setSetting(SETTING.organization, organization);
    await this.setSetting(SETTING.project, null);
    await this.setSetting(SETTING.activeProfile, null);
    return this.getState();
  }

  async listOrganizations() {
    const account = await this.requireAccount();
    const token = await this.requireAuth().then((auth) => auth.getAccessToken(account.homeAccountId));
    const profile = await this.ado.getProfile(token);
    const memberId = z.string().uuid().parse(profile.id);
    return this.ado.listOrganizations(token, memberId);
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
    const organization = await this.setting<string>(SETTING.organization);
    if (!organization) {
      throw new Error('Choose an Azure DevOps organization first.');
    }
    await this.setSetting(SETTING.project, project);
    await this.setSetting(SETTING.activeProfile, null);
    await this.ensureDefaultAdoProfile(organization, project);
    return this.getState();
  }

  private async ensureDefaultAdoProfile(organization: string, project: AdoProject): Promise<void> {
    const profiles = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    const activeId = await this.setting<string>(SETTING.activeProfile);
    const current = profiles.find(({ id }) => id === activeId);
    if (current && current.organization.toLocaleLowerCase('en-US') === organization.toLocaleLowerCase('en-US') && current.project.id === project.id) return;

    const matching = profiles.find((profile) => profile.organization.toLocaleLowerCase('en-US') === organization.toLocaleLowerCase('en-US') && profile.project.id === project.id);
    if (matching) {
      await this.setSetting(SETTING.activeProfile, matching.id);
      return;
    }

    const teams = await this.ado.listTeams(await this.accessToken(), organization, project.id);
    const team = teams.find(({ name }) => name.toLocaleLowerCase('en-US') === project.name.toLocaleLowerCase('en-US')) ?? teams[0];
    if (!team) throw new Error(`No teams were returned for project ${project.name}. Check that the signed-in account can read this project's teams.`);

    const profile: AdoRunProfile = {
      id: randomUUID(),
      name: `${project.name.slice(0, 92)} default`,
      organization,
      project,
      team: team.name,
      boardColumn: '',
      storyIds: [],
    };
    await this.setSetting(SETTING.profiles, [...profiles, profile]);
    await this.setSetting(SETTING.activeProfile, profile.id);
  }

  async saveAdoProfile(input: AdoRunProfileInput): Promise<DesktopState> {
    await this.requireAccount();
    const parsed = AdoRunProfileInputSchema.parse(input);
    const organization = resolveOrganization(parsed.organization);
    const token = await this.accessToken();
    const projects = await this.ado.listProjects(token, organization);
    const project = projects.find(({ id, name }) => parsed.project.id ? id === parsed.project.id : name.toLocaleLowerCase('en-US') === parsed.project.name.toLocaleLowerCase('en-US'));
    if (!project) throw new Error('The selected project is not available in this organization for the signed-in Azure CLI account.');
    const teams = await this.ado.listTeams(token, organization, project.id);
    if (!teams.some(({ name }) => name.toLocaleLowerCase('en-US') === parsed.team.toLocaleLowerCase('en-US'))) throw new Error('The selected team is not available in this Azure DevOps project.');
    const current = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    const existing = current.find((item) => item.name.toLocaleLowerCase('en-US') === parsed.name.toLocaleLowerCase('en-US') && item.organization.toLocaleLowerCase('en-US') === organization.toLocaleLowerCase('en-US') && item.project.id === project.id && item.team.toLocaleLowerCase('en-US') === parsed.team.toLocaleLowerCase('en-US'));
    const profile: AdoRunProfile = { ...parsed, id: parsed.id ?? existing?.id ?? randomUUID(), organization, project };
    const next = current.some(({ id }) => id === profile.id)
      ? current.map((item) => item.id === profile.id ? profile : item)
      : [...current, profile];
    await this.setSetting(SETTING.profiles, next);
    if (!await this.setting<string>(SETTING.activeProfile)) await this.activateAdoProfile(profile.id);
    return this.getState();
  }

  async activateAdoProfile(profileIdInput: string): Promise<DesktopState> {
    await this.requireAccount();
    const profileId = z.string().uuid().parse(profileIdInput);
    const profiles = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    const profile = profiles.find(({ id }) => id === profileId);
    if (!profile) throw new Error('That Azure DevOps configuration profile no longer exists.');
    const projectsInOrganization = await this.ado.listProjects(await this.accessToken(), profile.organization);
    const project = projectsInOrganization.find(({ id }) => id === profile.project.id);
    if (!project) throw new Error('The saved project is no longer available to the signed-in Azure CLI account.');
    const teams = await this.ado.listTeams(await this.accessToken(), profile.organization, project.id);
    if (!teams.some(({ name }) => name.toLocaleLowerCase('en-US') === profile.team.toLocaleLowerCase('en-US'))) throw new Error(`The saved team “${profile.team}” is no longer available in project ${project.name}.`);
    await this.setSetting(SETTING.organization, profile.organization);
    await this.setSetting(SETTING.project, profile.project);
    await this.setSetting(SETTING.activeProfile, profile.id);
    const saved = await this.setting<string[]>(SETTING.organizations) ?? [];
    if (!saved.some((item) => item.toLocaleLowerCase('en-US') === profile.organization.toLocaleLowerCase('en-US'))) {
      await this.setSetting(SETTING.organizations, [...saved, profile.organization]);
    }
    return this.getState();
  }

  async deleteAdoProfile(profileIdInput: string): Promise<DesktopState> {
    await this.requireAccount();
    const profileId = z.string().uuid().parse(profileIdInput);
    const profiles = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    await this.setSetting(SETTING.profiles, profiles.filter(({ id }) => id !== profileId));
    if (await this.setting<string>(SETTING.activeProfile) === profileId) await this.setSetting(SETTING.activeProfile, null);
    return this.getState();
  }

  async importAdoProfilesConfig(): Promise<DesktopState> {
    const content = await this.readAdoProfilesConfig?.();
    if (!content) return this.getState();
    if (Buffer.byteLength(content, 'utf8') > 128 * 1024) throw new Error('The Azure DevOps profile config file is too large.');
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error('The Azure DevOps profile config is not valid JSON.'); }
    const config = z.object({ schemaVersion: z.literal(1), profiles: z.array(AdoRunProfileInputSchema.omit({ id: true })).min(1).max(50) }).strict().parse(parsed);
    await this.requireAccount();
    const token = await this.accessToken();
    const current = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    const imported: AdoRunProfile[] = [];
    for (const entry of config.profiles) {
      const organization = resolveOrganization(entry.organization);
      const projects = await this.ado.listProjects(token, organization);
      const project = projects.find(({ id, name }) => entry.project.id ? id === entry.project.id : name.toLocaleLowerCase('en-US') === entry.project.name.toLocaleLowerCase('en-US'));
      if (!project) throw new Error(`Project “${entry.project.name}” was not found in ${organization} for the signed-in account.`);
      const teams = await this.ado.listTeams(token, organization, project.id);
      const team = teams.find(({ name }) => name.toLocaleLowerCase('en-US') === entry.team.toLocaleLowerCase('en-US'));
      if (!team) throw new Error(`Team “${entry.team}” was not found in project ${project.name}.`);
      const existing = current.find((item) => item.name.toLocaleLowerCase('en-US') === entry.name.toLocaleLowerCase('en-US') && item.organization.toLocaleLowerCase('en-US') === organization.toLocaleLowerCase('en-US') && item.project.id === project.id && item.team.toLocaleLowerCase('en-US') === team.name.toLocaleLowerCase('en-US'));
      imported.push({ ...entry, id: existing?.id ?? randomUUID(), organization, project, team: team.name });
    }
    const next = [...current];
    for (const profile of imported) {
      const index = next.findIndex(({ id }) => id === profile.id);
      if (index < 0) next.push(profile); else next[index] = profile;
    }
    await this.setSetting(SETTING.profiles, next);
    if (!await this.setting<string>(SETTING.activeProfile) && imported[0]) await this.activateAdoProfile(imported[0].id);
    return this.getState();
  }

  async exportAdoProfilesConfig(): Promise<boolean> {
    await this.requireAccount();
    const profiles = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    if (!profiles.length) throw new Error('Save an Azure DevOps configuration profile before exporting it.');
    if (!this.saveAdoProfilesConfig) throw new Error('Configuration file export is unavailable in this desktop build.');
    const contents = `${JSON.stringify({
      schemaVersion: 1,
      profiles: profiles.map(({ name, organization, project, team, boardColumn, storyIds }) => ({
        name,
        organization,
        project: { id: project.id, name: project.name, ...(project.state ? { state: project.state } : {}) },
        team,
        boardColumn,
        storyIds,
      })),
    }, null, 2)}\n`;
    return this.saveAdoProfilesConfig(contents);
  }


  async loadActiveProfileWorkItems() {
    const profileId = await this.setting<string>(SETTING.activeProfile);
    const profiles = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    const profile = profiles.find(({ id }) => id === profileId);
    if (!profile) throw new Error('Choose an Azure DevOps configuration profile in Settings first.');
    const token = await this.accessToken();
    const iteration = await this.ado.getCurrentIteration(token, profile.organization, profile.project.id, profile.team);
    if (!iteration) throw new Error(`No current sprint was found for ${profile.team}. Check the team's iteration settings in Azure DevOps.`);
    const taskboard = await this.ado.getTaskboardItems(token, profile.organization, profile.project.id, profile.team, iteration.id);
    const targetIds = new Set(taskboard.filter(({ column }) => !profile.boardColumn.trim() || column.trim().toLocaleLowerCase('en-US') === profile.boardColumn.trim().toLocaleLowerCase('en-US')).map(({ workItemId }) => workItemId));
    const context = { organization: profile.organization, projectId: profile.project.id, projectName: profile.project.name, customTypeMappings: await this.typeMappings(profile.organization, profile.project.id) };
    const childIdsByStory: Record<number, number[]> = {};
    for (const storyId of profile.storyIds) {
      const childIds = await this.ado.getChildIds(token, { organization: profile.organization, parentId: storyId });
      childIdsByStory[storyId] = childIds.filter((id) => targetIds.has(id));
    }
    const selectedIds = [...new Set([...profile.storyIds, ...Object.values(childIdsByStory).flat()])];
    const allItems = await this.ado.fetchWorkItems(token, { ...context, ids: selectedIds });
    const withComments: WorkItemSnapshot[] = [];
    for (let index = 0; index < allItems.length; index += 8) {
      const batch = await Promise.all(allItems.slice(index, index + 8).map(async (item) => {
        const comments = await this.ado.getWorkItemComments(token, profile.organization, profile.project.id, item.id).catch(() => []);
        return { ...item, ...(comments.length ? { comments } : {}) };
      }));
      withComments.push(...batch);
    }
    const byId = new Map(withComments.map((item) => [item.id, item]));
    const stories = profile.storyIds.map((id) => byId.get(id)).filter((item): item is WorkItemSnapshot => Boolean(item && item.kind === 'REQUIREMENT'));
    return {
      iterationName: iteration.name,
      stories,
      tasksByStory: Object.fromEntries(Object.entries(childIdsByStory).map(([id, children]) => [id, children.map((childId) => byId.get(childId)).filter((item): item is WorkItemSnapshot => Boolean(item && item.kind === 'TASK'))])),
    };
  }

  async listProfileIterations(): Promise<AdoIteration[]> {
    const profile = await this.activeAdoProfile();
    return this.ado.listTeamIterations(await this.accessToken(), profile.organization, profile.project.id, profile.team);
  }

  async listSprintTaskboard(iterationIdInput: string): Promise<AdoTaskboardItem[]> {
    const iterationId = z.string().uuid().parse(iterationIdInput);
    const profile = await this.activeAdoProfile();
    const token = await this.accessToken();
    const iterations = await this.ado.listTeamIterations(token, profile.organization, profile.project.id, profile.team);
    if (!iterations.some(({ id }) => id === iterationId)) throw new Error('That sprint is not available to the active profile team. Refresh the sprint list and try again.');
    return this.ado.getTaskboardItems(token, profile.organization, profile.project.id, profile.team, iterationId);
  }

  async listAdoTeams(input: { organization: string; project: { id?: string; name: string } }) {
    const { organization, project: requestedProject } = z.object({
      organization: z.string().trim().min(1).max(500),
      project: z.object({ id: z.string().trim().min(1).max(200).optional(), name: z.string().trim().min(1).max(200) }).strict(),
    }).strict().parse(input);
    const token = await this.accessToken();
    const projects = await this.ado.listProjects(token, organization);
    const project = projects.find(({ id, name }) => requestedProject.id ? id === requestedProject.id : name.toLocaleLowerCase('en-US') === requestedProject.name.toLocaleLowerCase('en-US'));
    if (!project) throw new Error('That project is not available in the selected organization. Refresh project access and try again.');
    return this.ado.listTeams(token, organization, project.id);
  }

  async searchActiveStories(iterationIdInput: string, afterId?: number): Promise<WorkItemSearchPage> {
    const iterationId = z.string().uuid().parse(iterationIdInput);
    const profile = await this.activeAdoProfile();
    const token = await this.accessToken();
    const iterations = await this.ado.listTeamIterations(token, profile.organization, profile.project.id, profile.team);
    const iteration = iterations.find(({ id }) => id === iterationId);
    if (!iteration?.path) throw new Error('That sprint is not available to the active profile team. Refresh the sprint list and try again.');

    const customTypeMappings = await this.typeMappings(profile.organization, profile.project.id);
    const types = await this.ado.getWorkItemTypes(token, profile.organization, profile.project.id);
    const requirementTypes = types.filter((type) => classifyWorkItemType(type, customTypeMappings) === 'REQUIREMENT');
    if (!requirementTypes.length) throw new Error('No work item types are mapped as Requirements for this project. Map a Story type in Settings, then refresh.');

    const stateEntries = await Promise.all(requirementTypes.map(async (type) => {
      const states = await this.ado.getWorkItemTypeStates(token, profile.organization, profile.project.id, type);
      const activeStates = states.filter(({ category }) => category === 'Proposed' || category === 'InProgress').map(({ name }) => name);
      return [type, activeStates] as const;
    }));
    const statesByType = Object.fromEntries(stateEntries.filter(([, states]) => states.length > 0));
    if (!Object.keys(statesByType).length) throw new Error('Azure DevOps returned no active state categories for the mapped Requirement types. Check the project process configuration.');
    return this.ado.search(token, {
      organization: profile.organization,
      projectId: profile.project.id,
      projectName: profile.project.name,
      term: '',
      iterationPath: iteration.path,
      statesByType,
      afterId,
      customTypeMappings,
    });
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
    if (snapshot.kind !== 'REQUIREMENT' && snapshot.kind !== 'TASK') throw new Error('Only Requirements and Tasks can be added to the QA Queue.');
    await this.store.addToQueue(snapshot);
    return this.getState();
  }

  async addQueueItems(selectionsInput: Array<{ workItemId: number; parentId?: number }>): Promise<DesktopState> {
    const selections = z.array(z.object({
      workItemId: z.number().int().positive().max(2_147_483_647),
      parentId: z.number().int().positive().max(2_147_483_647).optional(),
    }).strict()).min(1).max(200).parse(selectionsInput);
    const bySelectedId = new Map<number, { workItemId: number; parentId?: number }>();
    for (const selection of selections) {
      const current = bySelectedId.get(selection.workItemId);
      if (current?.parentId && selection.parentId && current.parentId !== selection.parentId) throw new Error(`Task #${selection.workItemId} was associated with more than one Story.`);
      bySelectedId.set(selection.workItemId, { ...selection, parentId: selection.parentId ?? current?.parentId });
    }
    const uniqueSelections = [...bySelectedId.values()];
    const uniqueIds = uniqueSelections.map(({ workItemId }) => workItemId);
    const parentIds = [...new Set(uniqueSelections.flatMap(({ parentId }) => parentId ? [parentId] : []))];
    const [organization, project, token] = await Promise.all([
      this.setting<string>(SETTING.organization),
      this.setting<AdoProject>(SETTING.project),
      this.accessToken(),
    ]);
    if (!organization || !project) throw new Error('Choose an Azure DevOps project before adding work items to the queue.');
    const fetchedItems = await this.ado.fetchWorkItems(token, {
      organization,
      projectId: project.id,
      projectName: project.name,
      ids: [...new Set([...uniqueIds, ...parentIds])],
      customTypeMappings: await this.typeMappings(organization, project.id),
    });
    const byId = new Map(fetchedItems.map((snapshot) => [snapshot.id, snapshot]));
    const missingIds = uniqueIds.filter((id) => !byId.has(id));
    if (missingIds.length) throw new Error(`Azure DevOps could not load selected work item${missingIds.length === 1 ? '' : 's'} ${missingIds.join(', ')}. Refresh the sprint results and try again.`);
    if (uniqueIds.some((id) => byId.get(id)!.kind !== 'REQUIREMENT' && byId.get(id)!.kind !== 'TASK')) throw new Error('Only Requirements and Tasks can be added to the QA Queue. No selected items were added.');
    if (parentIds.some((id) => !byId.has(id) || byId.get(id)!.kind !== 'REQUIREMENT')) throw new Error('A selected Task references a Story that Azure DevOps could not validate. No selected items were added.');
    const verifiedParentByTaskId = new Map<number, number>();
    for (const selection of uniqueSelections) {
      if (!selection.parentId) continue;
      if (byId.get(selection.workItemId)!.kind !== 'TASK') throw new Error(`Only a Task can be nested under Story #${selection.parentId}. No selected items were added.`);
      if (!verifiedParentByTaskId.has(selection.workItemId)) {
        const childIds = await this.ado.getChildIds(token, { organization, parentId: selection.parentId });
        if (!childIds.includes(selection.workItemId)) throw new Error(`Task #${selection.workItemId} is no longer linked to Story #${selection.parentId}. Refresh the sprint results and try again.`);
        verifiedParentByTaskId.set(selection.workItemId, selection.parentId);
      }
    }
    for (const id of uniqueIds) {
      const parentId = verifiedParentByTaskId.get(id);
      const snapshot = byId.get(id)!;
      await this.store.addToQueue(parentId && snapshot.parentId !== parentId ? { ...snapshot, parentId } : snapshot);
    }
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
    const snapshots = new Map(await Promise.all(entries.map(async (entry) => [entry.key, await this.store.getSnapshot(entry.key)] as const)));
    const parentByTaskKey = new Map<string, number>();
    const stories = entries.filter((entry) => snapshots.get(entry.key)?.kind === 'REQUIREMENT');
    const tasks = entries.filter((entry) => snapshots.get(entry.key)?.kind === 'TASK');
    for (const story of stories) {
      const relatedTasks = tasks.filter((task) => task.organization === story.organization && task.projectId === story.projectId);
      if (!relatedTasks.length) continue;
      try {
        const childIds = await this.ado.getChildIds(await this.accessToken(), {
          organization: story.organization,
          parentId: story.workItemId,
        });
        for (const task of relatedTasks) {
          if (childIds.includes(task.workItemId)) parentByTaskKey.set(task.key, story.workItemId);
        }
      } catch {
        // A relationship lookup is only needed to group existing queue entries.
        // Continue refreshing the actual work items if that optional lookup fails.
      }
    }
    for (const entry of entries) {
      try {
        const [token] = await Promise.all([
          this.accessToken(),
        ]);
        const snapshot = snapshots.get(entry.key);
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
          const parentId = parentByTaskKey.get(entry.key) ?? snapshot.parentId ?? fresh.parentId;
          await this.store.addToQueue(parentId && fresh.parentId !== parentId ? { ...fresh, parentId } : fresh);
          await this.store.markStale(entry.key, false);
        }
      } catch {
        await this.store.markStale(entry.key, true);
      }
    }
    return this.getState();
  }

  private async refreshPlanningQueue(): Promise<QueueEntry[]> {
    const entries = await this.store.getQueue();
    if (!entries.length) return entries;
    const token = await this.accessToken();
    const snapshots = new Map<string, WorkItemSnapshot>();
    const groups = new Map<string, QueueEntry[]>();
    for (const entry of entries) {
      const groupKey = `${entry.organization.toLocaleLowerCase('en-US')}\0${entry.projectId}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), entry]);
    }
    for (const group of groups.values()) {
      const originals = await Promise.all(group.map(async (entry) => ({ entry, snapshot: await this.store.getSnapshot(entry.key) })));
      if (originals.some(({ snapshot }) => !snapshot)) throw new Error('A queued work item has no saved source snapshot. Refresh the QA Queue before planning.');
      const first = originals[0]!.snapshot!;
      const freshItems = await this.ado.fetchWorkItems(token, {
        organization: first.organization, projectId: first.projectId, projectName: first.projectName,
        ids: group.map(({ workItemId }) => workItemId), customTypeMappings: await this.typeMappings(first.organization, first.projectId),
      });
      const byId = new Map(freshItems.map((snapshot) => [snapshot.id, snapshot]));
      for (const { entry, snapshot: old } of originals) {
        const fresh = byId.get(entry.workItemId);
        if (!fresh) {
          await this.store.markStale(entry.key, true);
          throw new Error(`Azure DevOps no longer returns queued work item ${entry.workItemId}. Remove it from the QA Queue or choose a current item.`);
        }
        await this.store.addToQueue(old?.parentId && !fresh.parentId ? { ...fresh, parentId: old.parentId } : fresh);
        await this.store.markStale(entry.key, false);
        snapshots.set(entry.key, fresh);
      }
    }
    return this.store.getQueue();
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

  async listBrowserTestAccounts(): Promise<BrowserTestAccountSummary[]> {
    return (await this.rawSetting<BrowserTestAccountSecret[]>('browser.testAccounts') ?? []).map(({ id, label, origin, username, password, revision }) => ({ id, label, origin, hasUsername: Boolean(username), hasPassword: Boolean(password), revision }));
  }

  async saveBrowserTestAccount(input: BrowserTestAccountInput): Promise<BrowserTestAccountSummary[]> {
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
      throw new Error('Test account origin must be an HTTPS origin, or HTTP localhost, without a path or credentials.');
    }
    const id = input.id ? z.string().uuid().parse(input.id) : randomUUID();
    const stored = await this.rawSetting<BrowserTestAccountSecret[]>('browser.testAccounts') ?? [];
    const current = stored.find(({ id: currentId }) => currentId === id);
    if (input.id && !current) throw new Error('That saved browser test account no longer exists.');
    if (!current && stored.length >= 20) throw new Error('You can save up to 20 browser test accounts.');
    const account = BrowserTestAccountSchema.parse({ ...input, id, origin: origin.origin, revision: (current?.revision ?? 0) + 1 });
    const next = current ? stored.map((entry) => entry.id === id ? account : entry) : [...stored, account];
    await this.store.setSetting('browser.testAccounts', next);
    return this.listBrowserTestAccounts();
  }

  async deleteBrowserTestAccount(idInput: string): Promise<BrowserTestAccountSummary[]> {
    const id = z.string().uuid().parse(idInput);
    const stored = await this.rawSetting<BrowserTestAccountSecret[]>('browser.testAccounts') ?? [];
    await this.store.setSetting('browser.testAccounts', stored.filter((entry) => entry.id !== id));
    return this.listBrowserTestAccounts();
  }

  async saveTarget(input: TargetConfig): Promise<DesktopState> {
    const target = TargetSchema.parse(input);
    const selectedAccountIds = target.testAccountIds ?? [];
    let targetToSave: TargetConfig = { ...target, testAccountVersions: undefined };
    if (selectedAccountIds.length && target.targetKind === 'repository') throw new Error('Browser test accounts can only be selected for a site target.');
    if (selectedAccountIds.length) {
      const profiles = await this.rawSetting<BrowserTestAccountSecret[]>('browser.testAccounts') ?? [];
      const expectedOrigin = target.siteBaseUrl ? new URL(target.siteBaseUrl).origin : '';
      const versions: Record<string, number> = {};
      for (const id of selectedAccountIds) {
        const profile = profiles.find((entry) => entry.id === id);
        if (!profile) throw new Error('A selected browser test account no longer exists. Refresh the account list and choose an available account.');
        if (profile.origin !== expectedOrigin) throw new Error(`Test account “${profile.label}” is saved for ${profile.origin}; it does not match the selected site origin ${expectedOrigin}.`);
        versions[id] = profile.revision;
      }
      targetToSave = { ...target, testAccountVersions: versions };
    }
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
    await this.store.setSetting('run.target', targetToSave);
    return this.getState();
  }

  async getRepositoryConfigDraft(input: TargetConfig): Promise<string> {
    const target = TargetSchema.parse(input);
    if (target.targetKind === 'site') throw new Error('A site-only run does not need repository configuration.');
    const saved = await this.rawSetting<RepositoryConfig>(this.repositoryConfigSettingKey(target));
    if (saved) return JSON.stringify(RepositoryConfigSchema.parse(saved), null, 2);
    if (target.repositoryPath) {
      try { return JSON.stringify((await readRepositoryConfig(target.repositoryPath)).config, null, 2); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const projectName = target.adoRepository?.name ?? (target.repositoryPath ? basename(target.repositoryPath) : 'QA project');
    const template: RepositoryConfig = RepositoryConfigSchema.parse({
      schemaVersion: 1, project: { name: projectName }, repository: { include: ['**/*'], exclude: [] },
      setup: [], tests: [{ id: 'project-tests', label: 'Project test command', executable: 'npm', arguments: ['test'], workingDirectory: '.', timeoutSeconds: 600, network: 'none', resultFormat: 'none', resultPaths: [], scenarioMappings: [] }],
      ...(target.siteBaseUrl ? { site: { baseUrl: target.siteBaseUrl, allowedOrigins: target.allowedOrigins } } : {}),
      limits: { browserActions: 100, runSeconds: 1800, artifactMiB: 500 },
    });
    return JSON.stringify(template, null, 2);
  }

  async saveRepositoryConfigDraft(input: { target: TargetConfig; content: string }): Promise<void> {
    const target = TargetSchema.parse(input.target);
    if (target.targetKind === 'site') throw new Error('A site-only run does not need repository configuration.');
    let parsed: unknown;
    try { parsed = JSON.parse(input.content); }
    catch { throw new Error('Repository configuration must be valid JSON. You can start from the generated example and edit the exact command, result paths, and JUnit mappings.'); }
    const config = RepositoryConfigSchema.parse(parsed);
    await this.setSetting(this.repositoryConfigSettingKey(target), config);
  }

  async createDraftPlan(previousRunId?: string): Promise<DraftPlan> {
    const configuredAgent = await this.requireConfiguredAgent();
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
    const selectedAccounts = (await this.listBrowserTestAccounts()).filter(({ id }) => (target.testAccountIds ?? []).includes(id));
    if (selectedAccounts.length !== (target.testAccountIds ?? []).length) throw new Error('A selected browser test account is missing. Refresh Settings and select an available account.');
    if (selectedAccounts.some(({ origin }) => origin !== (target.siteBaseUrl ? new URL(target.siteBaseUrl).origin : ''))) throw new Error('A selected browser test account does not match the configured site origin.');
    if (selectedAccounts.some((account) => account.revision !== target.testAccountVersions?.[account.id])) throw new Error('A selected browser test account changed after this target was saved. Save the target again and create a fresh plan.');
    const queue = await this.refreshPlanningQueue();
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
    let repositoryConfigAutoDetected = false;
    const fingerprint = await this.configFingerprint(target);
    let repositorySnapshotHash: string | undefined;
    let localGitState: 'clean' | 'dirty' | 'not-a-git-repository' | 'unavailable' | undefined;
    if (target.targetKind !== 'site') {
      await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 });
      const probeSnapshot = await mkdtemp(join(this.scratchRoot, 'agentic-qa-preview-'));
      try {
        const sourcePath = await this.prepareRepositorySource(target, join(probeSnapshot, 'source'));
        const loadedConfig = await this.loadRepositoryConfig(target, sourcePath);
        const { config } = loadedConfig;
        repositoryConfig = config;
        repositoryConfigAutoDetected = loadedConfig.automatic;
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
    const sourceContext = snapshots.map(({ id, ...snapshot }) => ({ ...snapshot, workItemId: id }));
    const taskCandidates: QAContract['taskCandidates'] = [];
    const coverageGaps: QAContract['coverageGaps'] = [];
    for (const snapshot of snapshots) {
      if (snapshot.kind !== 'REQUIREMENT') {
        notes.push(`Task #${snapshot.id} is retained with its description as scope context. It does not prove parent acceptance criteria.`);
        continue;
      }
      const raw = snapshot.acceptanceCriteria?.trim() ?? '';
      if (!raw) {
        notes.push(`Requirement #${snapshot.id} has no acceptance criteria. No criterion was invented.`);
        coverageGaps.push({ id: `missing-ac-${snapshot.id}-${snapshot.revision}`, code: 'MISSING_REQUIREMENT_ACCEPTANCE_CRITERIA', source: { organization: snapshot.organization, projectId: snapshot.projectId, workItemId: snapshot.id, revision: snapshot.revision, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: sha256('') }, message: `Requirement #${snapshot.id} has no Acceptance Criteria.` });
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
    const synthesis = await synthesizeWorkItemPlan({
      provider: this.getProviderAdapter(configuredAgent.providerId), apiKey: configuredAgent.apiKey,
      modelId: configuredAgent.modelId,
      items: snapshots.map(({ id, parentId, kind, type, title, state, description, acceptanceCriteria, comments }) => ({ id, ...(parentId ? { parentId } : {}), kind, type, title, state, ...(description ? { description } : {}), ...(acceptanceCriteria ? { acceptanceCriteria } : {}), ...(comments?.length ? { comments } : {}) })),
      fetcher: this.providerFetch,
    });
    const sourceForItem = (workItemId: number): SourceRef => {
      const item = snapshots.find(({ id }) => id === workItemId)!;
      const field = item.acceptanceCriteria?.trim() ? 'Microsoft.VSTS.Common.AcceptanceCriteria' : item.description?.trim() ? 'System.Description' : 'System.Title';
      const text = field === 'Microsoft.VSTS.Common.AcceptanceCriteria' ? item.acceptanceCriteria! : field === 'System.Description' ? item.description! : item.title;
      return { organization: item.organization, projectId: item.projectId, workItemId: item.id, revision: item.revision, field, excerptHash: sha256(text) };
    };
    const proposals: QAContract['proposals'] = synthesis.proposals.map(({ id, text, sourceWorkItemIds, ambiguityNotes }) => ({ id, text, sourceRefs: sourceWorkItemIds.map(sourceForItem), ambiguityNotes, decision: 'PROPOSED' }));
    const taskPlans: QAContract['taskPlans'] = synthesis.taskPlans.map((plan) => {
      const item = snapshots.find(({ id }) => id === plan.taskId)!;
      const field = item.description?.trim() ? 'System.Description' : 'System.Title';
      const sourceText = field === 'System.Description' ? item.description! : item.title;
      return { ...plan, taskSource: { organization: item.organization, projectId: item.projectId, workItemId: item.id, revision: item.revision, field, excerptHash: sha256(sourceText) } };
    });
    if (repositoryConfig) {
      const mapped = new Set(repositoryConfig.tests.flatMap(({ scenarioMappings }) => scenarioMappings.map(({ scenarioId }) => scenarioId)));
      const unmapped = scenarios.filter(({ layer }) => layer === 'repo').filter(({ id }) => !mapped.has(id)).map(({ id }) => id);
      if (unmapped.length) notes.push(`Map each Repository Scenario to exact JUnit testcase identities using scenarioMappings in .agentic-qa.yml, then refresh this plan: ${unmapped.join(', ')}`);
    }
    if (repositoryConfigAutoDetected) notes.push('The app found a supported repository test entry point and added its exact command automatically. It will run in Docker with networking disabled; dependencies are not installed or restored automatically. Until exact JUnit/TRX testcase mappings exist, this command is diagnostic and does not prove an Acceptance Criterion.');
    const contract: QAContract = QAContractSchema.parse({ schemaVersion: 3, id: randomUUID(), revision: 1, sourceContext, taskCandidates, coverageGaps, featureSummary: synthesis.featureSummary, taskPlans, proposals, criteria, scenarios });
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
      toolVersions: { app: '1.0.0', electron: process.versions.electron ?? 'unknown', playwright: '1.63.0', repositoryWorker: 'agenticqa/repo-worker:node22-dotnet10-v1', repositoryWorkerProtocol: '1' },
      providerId: configuredAgent.providerId,
      modelId: configuredAgent.modelId,
      limits: { runSeconds: 1800, browserActions: 100, artifactMiB: 500, modelInputTokens: 12_000, modelOutputTokens: configuredAgent.maxOutputTokens, maxCostUsd: 1, maxProviderCalls: 12, maxAgents: 6, maxParallelAgents: 2 },
      ...(previousRunId ? { previousRunId } : {}),
    });
    const repositoryCommands = repositoryConfig ? [...repositoryConfig.setup, ...repositoryConfig.tests].map(({ id, label, executable, arguments: args, workingDirectory, timeoutSeconds, resultFormat, resultPaths, scenarioMappings }) => ({ id, label, executable, arguments: args, workingDirectory, timeoutSeconds, ...(resultFormat ? { resultFormat } : {}), resultPaths, scenarioMappings })) : undefined;
    const envelopePreview = {
      providerId: configuredAgent.providerId,
      modelId: configuredAgent.modelId,
      sourceIds: sourceContext.map(({ workItemId }) => workItemId),
      sourceRevisions: Object.fromEntries(sourceContext.map(({ organization, projectId, workItemId, revision }) => [`${organization}:${projectId}:${workItemId}`, revision])),
      repositoryPaths: repositoryConfig?.repository.include ?? [],
      allowedOrigins: target.allowedOrigins,
      commandIds: (repositoryCommands ?? []).map(({ id }) => id),
      excludedContext: [],
      ...(target.runInstructions ? { runInstructions: target.runInstructions } : {}),
      testAccounts: selectedAccounts,
      showBrowserWindow: target.showBrowserWindow ?? false,
      budget: RunBudgetSchema.parse({ maxCostUsd: 1, maxInputTokens: 12_000, maxOutputTokens: configuredAgent.maxOutputTokens, maxProviderCalls: 12, maxAgents: 6, maxParallelAgents: 2, maxRetries: 1, maxRunSeconds: 1800, maxBrowserActions: 100, maxArtifactMiB: 500 }),
    };
    const draft = { manifest, contract, notes, envelopePreview, ...(repositoryCommands ? { repositoryCommands } : {}) };
    this.pendingPlans.set(manifest.runId, draft);
    return draft;
  }

  async approvePlan(input: DraftPlan): Promise<void> {
    const configuredAgent = await this.requireConfiguredAgent();
    const original = this.pendingPlans.get(input.manifest.runId);
    if (!original || JSON.stringify(original.manifest) !== JSON.stringify(input.manifest) || JSON.stringify(original.repositoryCommands ?? []) !== JSON.stringify(input.repositoryCommands ?? [])) throw new Error('This plan is no longer current. Create a fresh draft and review it again.');
    if (configuredAgent.providerId !== original.manifest.providerId || configuredAgent.modelId !== original.manifest.modelId) throw new Error('The selected model changed after plan synthesis. Select the planned tested model again or create a fresh plan.');
    if (JSON.stringify(original.envelopePreview) !== JSON.stringify(input.envelopePreview)) throw new Error('The approved run envelope cannot be changed in the renderer. Create a fresh plan to change its scope.');
    const reviewedContract = QAContractSchema.parse(input.contract);
    if (JSON.stringify(reviewedContract.coverageGaps) !== JSON.stringify(original.contract.coverageGaps)) throw new Error('Coverage gaps are frozen during review. A source-grounded accepted proposal resolves a matching gap at approval.');
    const acceptedRequirementKeys = new Set(reviewedContract.proposals.filter(({ decision }) => decision === 'ACCEPTED' || decision === 'EDITED').flatMap(({ sourceRefs }) => sourceRefs.filter((ref) => original.contract.sourceContext.some((source) => source.kind === 'REQUIREMENT' && source.organization.toLocaleLowerCase('en-US') === ref.organization.toLocaleLowerCase('en-US') && source.projectId === ref.projectId && source.workItemId === ref.workItemId) && ['Microsoft.VSTS.Common.AcceptanceCriteria', 'System.Description', 'System.Title'].includes(ref.field)).map((ref) => `${ref.organization.toLocaleLowerCase('en-US')}:${ref.projectId}:${ref.workItemId}`)));
    const contract = validateReadyContract({ ...reviewedContract, coverageGaps: reviewedContract.coverageGaps.filter((gap) => !acceptedRequirementKeys.has(`${gap.source.organization.toLocaleLowerCase('en-US')}:${gap.source.projectId}:${gap.source.workItemId}`)), approvedAt: new Date().toISOString() });
    if (contract.id !== original.contract.id || contract.revision !== original.contract.revision) throw new Error('Contract identity cannot change while approving a plan.');
    if (JSON.stringify(contract.sourceContext) !== JSON.stringify(original.contract.sourceContext)) throw new Error('ADO source context is frozen. Refresh the source and create a new plan to change it.');
    const originalCriteria = new Map(original.contract.criteria.map((criterion) => [criterion.id, criterion]));
    if (original.contract.criteria.some((criterion) => {
      const reviewed = contract.criteria.find(({ id }) => id === criterion.id);
      return !reviewed || JSON.stringify(criterion.source) !== JSON.stringify(reviewed.source);
    })) throw new Error('Requirement identity and source revisions cannot change during review. Create a fresh plan to update sources.');
    if (contract.featureSummary !== original.contract.featureSummary || JSON.stringify(contract.taskPlans) !== JSON.stringify(original.contract.taskPlans)) throw new Error('The generated feature summary and Task verification plans are frozen during review. Create a fresh plan to regenerate them.');
    const proposalsById = new Map(original.contract.proposals.map((proposal) => [proposal.id, proposal]));
    if (contract.proposals.length !== original.contract.proposals.length || contract.proposals.some((proposal) => {
      const before = proposalsById.get(proposal.id);
      return !before || proposal.text !== before.text && proposal.decision !== 'EDITED' || JSON.stringify(proposal.sourceRefs) !== JSON.stringify(before.sourceRefs) || JSON.stringify(proposal.ambiguityNotes) !== JSON.stringify(before.ambiguityNotes);
    })) throw new Error('Proposal provenance is frozen. Only proposed criteria may be accepted, edited, or rejected.');
    const candidateById = new Map(original.contract.taskCandidates.map((candidate) => [candidate.id, candidate]));
    if (contract.taskCandidates.length !== original.contract.taskCandidates.length || contract.taskCandidates.some((candidate) => {
      const before = candidateById.get(candidate.id);
      return !before || before.text !== candidate.text || JSON.stringify(before.source) !== JSON.stringify(candidate.source) ||
        (before.disposition !== 'PROPOSED' && (before.disposition !== candidate.disposition || before.criterionId !== candidate.criterionId));
    })) throw new Error('Task candidate source text and provenance cannot change during review. Create a fresh plan to update sources.');
    for (const proposal of contract.proposals) {
      const criterion = proposal.criterionId ? contract.criteria.find(({ id }) => id === proposal.criterionId) : undefined;
      if ((proposal.decision === 'ACCEPTED' || proposal.decision === 'EDITED') !== Boolean(criterion)) throw new Error('Accept or edit each criterion proposal through its review controls before adding it to the QA Contract.');
      if (criterion && (!('agentProposed' in criterion.source) || criterion.source.proposalId !== proposal.id || criterion.source.decision !== proposal.decision || JSON.stringify(criterion.source.sourceRefs) !== JSON.stringify(proposal.sourceRefs))) throw new Error('Accepted criteria must preserve the selected proposal and its source provenance.');
      if (criterion && criterion.expectedBehavior !== proposal.text) throw new Error('The reviewed criterion text must match its accepted or edited proposal text.');
    }
    for (const criterion of contract.criteria.filter(({ id }) => !originalCriteria.has(id))) {
      if (!('agentProposed' in criterion.source)) throw new Error('New criteria must come from an explicitly accepted Orchestrator proposal.');
    }
    await this.validateCurrentSourceRevisions(original.manifest);
    const target = await this.setting<TargetConfig>('run.target');
    if (!target || (await this.configFingerprint(target)).value !== original.manifest.configHash) throw new Error('Run target or repository config changed after plan creation. Create a new plan.');
    let approvedRepositoryConfig: RepositoryConfig | undefined;
    let automaticRepositoryConfig = true;
    let approvedRepositoryContext: Array<{ path: string; content: string }> = [];
    if (target.targetKind !== 'site') {
      let temporary = '';
      try {
        let sourcePath = target.repositoryPath;
        if (!sourcePath) { await mkdir(this.scratchRoot, { recursive: true, mode: 0o700 }); temporary = await mkdtemp(join(this.scratchRoot, 'agentic-qa-config-')); sourcePath = await this.prepareRepositorySource(target, temporary); }
        const { config, automatic } = await this.loadRepositoryConfig(target, sourcePath);
        approvedRepositoryConfig = config;
        automaticRepositoryConfig = automatic;
        approvedRepositoryContext = await readRepositoryContext({ sourcePath, config, maxFiles: 24, maxBytes: 60_000 });
      } finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
    }
    if (!original.envelopePreview) throw new Error('This plan has no approved run envelope. Create a fresh agentic plan.');
    const { modelId: defaultModelId, runInstructions: _runInstructions, testAccounts: _testAccounts, showBrowserWindow: _showBrowserWindow, ...previewFields } = original.envelopePreview;
    const approvedEnvelope = RunEnvelopeSchema.parse({
      schemaVersion: 1,
      ...previewFields,
      runId: original.manifest.runId,
      defaultModelId,
      approvedAt: new Date().toISOString(),
      contextHash: sha256(JSON.stringify({ contract, envelopePreview: original.envelopePreview, configHash: original.manifest.configHash, sourceSnapshotHash: original.manifest.sourceSnapshotHash })),
    });
    const plannedAgents = await planQaRun({
      envelope: approvedEnvelope,
      contract,
      apiKey: configuredAgent.apiKey,
      provider: providerAdapter(configuredAgent.providerId),
      repositoryContext: approvedRepositoryContext,
      repositoryCommands: approvedRepositoryConfig?.tests.map(({ id, resultFormat, resultPaths }) => ({ id, resultFormat, resultPaths })) ?? [],
      runInstructions: target.runInstructions,
      testAccounts: original.envelopePreview.testAccounts,
      fetcher: this.providerFetch,
    });
    if (plannedAgents.plan.assignments.some(({ layer }) => layer === 'integration')) throw new Error('This app release does not yet execute integration-layer assignments. Refresh the plan and choose repository and/or browser coverage.');
    const selectedLayersByCriterion = new Map(plannedAgents.plan.coverage.map(({ criterionId, requiredLayers }) => [criterionId, requiredLayers]));
    const generatedBrowserScenarios = plannedAgents.browserScenarios.map((scenario) => ({
      id: `agent-${randomUUID()}`,
      criterionIds: [scenario.criterionId],
      summary: scenario.summary,
      layer: 'browser' as const,
      preconditions: scenario.preconditions,
      steps: scenario.steps,
      expectedObservations: scenario.expectedObservations,
      risk: scenario.risk,
      approved: true,
    }));
    const selectedAccountById = new Map(original.envelopePreview.testAccounts.map((account) => [account.id, account]));
    for (const scenario of generatedBrowserScenarios) for (const step of scenario.steps) {
      if (step.action !== 'fillSecret') continue;
      const account = selectedAccountById.get(step.accountId);
      if (!account || (step.field === 'username' && !account.hasUsername) || (step.field === 'password' && !account.hasPassword)) {
        throw new Error(`A generated browser step refers to an unavailable ${step.field} test-account field. Review selected accounts and regenerate the plan.`);
      }
    }
    for (const test of plannedAgents.repositoryTests) {
      if (!micromatch.isMatch(test.path, approvedRepositoryConfig?.repository.include ?? []) || (approvedRepositoryConfig?.repository.exclude.some((pattern) => micromatch.isMatch(test.path, pattern)))) {
        throw new Error('A generated backend test path is outside the approved repository include/exclude scope. Refresh the repository configuration before approving the plan.');
      }
    }
    const scenarios = [
      ...contract.scenarios.flatMap((scenario) => {
        if (scenario.layer !== 'repo') return [];
        const criterionIds = scenario.criterionIds.filter((id) => selectedLayersByCriterion.get(id)?.includes('repo'));
        return criterionIds.length ? [{ ...scenario, criterionIds }] : [];
      }),
      ...generatedBrowserScenarios,
    ];
    const finalContract = validateReadyContract(QAContractSchema.parse({
      ...contract,
      revision: contract.revision + 1,
      criteria: contract.criteria.map((criterion) => {
        const requiredLayers = selectedLayersByCriterion.get(criterion.id) ?? [];
        if (!requiredLayers.length) throw new Error(`The orchestrator did not select an evidence layer for criterion ${criterion.id}.`);
        return { ...criterion, requiredLayers, scenarioIds: scenarios.filter(({ criterionIds }) => criterionIds.includes(criterion.id)).map(({ id }) => id) };
      }),
      scenarios,
    }));
    if (approvedRepositoryConfig && !automaticRepositoryConfig) {
      const mappings = new Set(approvedRepositoryConfig.tests.flatMap(({ scenarioMappings }) => scenarioMappings.map(({ scenarioId }) => scenarioId)));
      const generatedScenarioIds = new Set(plannedAgents.repositoryTests.flatMap(({ scenarioIds }) => scenarioIds));
      const missing = finalContract.scenarios.filter(({ layer, id }) => layer === 'repo' && !generatedScenarioIds.has(id)).filter(({ id }) => !mappings.has(id)).map(({ id }) => id);
      if (missing.length) throw new Error(`Map the orchestrator-selected Repository Scenarios to JUnit tests in .agentic-qa.yml and refresh the plan: ${missing.join(', ')}`);
    }
    const finalManifest = RunManifestSchema.parse({
      ...original.manifest,
      providerId: configuredAgent.providerId,
      modelId: configuredAgent.modelId,
      contractRevision: finalContract.revision,
      limits: {
        ...original.manifest.limits,
        modelInputTokensUsed: plannedAgents.usage.inputTokens,
        modelOutputTokensUsed: plannedAgents.usage.outputTokens,
        modelProviderCallsUsed: plannedAgents.usage.providerCalls,
        estimatedCostUsd: plannedAgents.usage.costUsd,
      },
    });
    await this.store.createRun(finalManifest, finalContract);
    await this.store.setSetting(`run.target.${finalManifest.runId}`, target);
    await this.store.setSetting(`run.agent.${finalManifest.runId}`, {
      envelope: approvedEnvelope,
      delegationPlan: plannedAgents.plan,
      delegationDiagram: plannedAgents.diagram,
      agentUsage: plannedAgents.usage,
      selectedModels: plannedAgents.selectedModels,
      selectedModelDetails: plannedAgents.selectedModelDetails,
      repositoryTests: plannedAgents.repositoryTests,
      repositoryContext: approvedRepositoryContext,
    });
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
      if (!partial || (!partial.observations.length && !partial.findings.length && !partial.artifacts.length && !partial.progress.length)) continue;
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
      await this.progress(manifest.runId, 'orchestrator', 'FAILED', 'interrupted-recovery', 'The app stopped before this run finished. Partial evidence is preserved; create a new run to retry.');
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
    const agentData = await this.setting<{ delegationPlan?: unknown; delegationDiagram?: unknown; repositoryTests?: unknown; agentUsage?: { inputTokens: number; outputTokens: number; providerCalls: number; costUsd: number }; agentSummary?: string; reviewerReport?: unknown }>(`run.agent.${run.manifest.runId}`);
    return {
      ...run,
      ...(agentData?.delegationPlan ? { delegationPlan: DelegationPlanSchema.parse(agentData.delegationPlan) } : {}),
      ...(agentData?.delegationDiagram ? { delegationDiagram: DelegationDiagramSchema.parse(agentData.delegationDiagram) } : {}),
      ...(agentData?.repositoryTests ? { repositoryTests: z.array(RepositoryTestDraftSchema).max(40).parse(agentData.repositoryTests) } : {}),
      ...(agentData?.agentUsage ? { agentUsage: agentData.agentUsage } : {}),
      ...(agentData?.agentSummary ? { agentSummary: agentData.agentSummary } : {}),
      ...(agentData?.reviewerReport ? { reviewerReport: EvidenceLinkedReviewSchema.parse(agentData.reviewerReport) } : {}),
      artifacts: run.artifacts.map(({ id, kind, sha256, bytes, redactionState, scenarioId, stepId, sequence }) => ({ id, kind, sha256, bytes, redactionState, ...(scenarioId ? { scenarioId } : {}), ...(stepId ? { stepId } : {}), ...(sequence ? { sequence } : {}) })),
    };
  }

  async getArtifactPreview(runIdInput: string, artifactIdInput: string): Promise<string> {
    const runId = z.string().uuid().parse(runIdInput);
    const artifactId = z.string().uuid().parse(artifactIdInput);
    const run = await this.store.getRun(runId);
    const artifact = run?.artifacts.find(({ id }) => id === artifactId);
    if (!artifact || artifact.kind !== 'screenshot' || artifact.bytes > 8 * 1024 * 1024 || !this.evidenceRoot || !this.artifactKey) throw new Error('A previewable screenshot was not found or exceeds the preview limit.');
    const contents = await decryptArtifact({ artifact, evidenceRoot: this.evidenceRoot, key: await this.artifactKey() });
    try {
      if (contents.byteLength > 8 * 1024 * 1024 || contents.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Screenshot evidence is not a valid PNG or exceeds the preview limit.');
      return `data:image/png;base64,${contents.toString('base64')}`;
    } finally { contents.fill(0); }
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

  async getRunProgress(runIdInput: string): Promise<RunProgressEvent[]> {
    return this.store.getProgress(z.string().uuid().parse(runIdInput));
  }

  private async progress(runId: string, worker: RunProgressEvent['worker'], state: RunProgressEvent['state'], stage: string, message: string): Promise<void> {
    const event = { runId, worker, state, stage, message: message.slice(0, 500), at: new Date().toISOString() };
    await this.store.appendProgress(event);
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
      coverageGaps: run.contract.coverageGaps,
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
    await this.requireConfiguredAgent();
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
    const agentData = await this.setting<{ envelope?: unknown; delegationPlan?: unknown; delegationDiagram?: unknown; repositoryTests?: Array<{ commandId: string; path: string; content: string; scenarioIds: string[]; testCaseIds: string[] }>; repositoryContext?: Array<{ path: string; content: string }>; agentUsage?: { inputTokens: number; outputTokens: number; providerCalls: number; costUsd: number }; selectedModels?: Partial<Record<'backend' | 'frontend' | 'reviewer', string>>; selectedModelDetails?: Partial<Record<'backend' | 'frontend' | 'reviewer', unknown>>; reviewerReport?: unknown }>(`run.agent.${runId}`);
    if (!agentData?.delegationPlan) throw new Error('This run has no persisted Orchestrator plan. Recreate it after configuring a provider and model.');
    const delegationPlan = DelegationPlanSchema.parse(agentData.delegationPlan);
    if (delegationPlan.runId !== runId) throw new Error('The saved delegation plan does not match the run manifest.');
    const target = TargetSchema.parse(await this.setting<TargetConfig>(`run.target.${runId}`));
    if ((await this.configFingerprint(target)).value !== manifest.configHash) throw new Error('Run configuration or repository config no longer matches its approved manifest.');
    if (target.targetKind !== 'repository' && !(await this.isBrowserInstalled())) throw new Error('Install the local Chromium browser from Run setup before starting this site run.');
    const abort = new AbortController();
    this.activeRuns.set(runId, abort);
    await this.progress(runId, 'orchestrator', 'RUNNING', 'run-approved', `Orchestrator delegated ${delegationPlan.assignments.length} assignment(s) across ${new Set(delegationPlan.assignments.map(({ layer }) => layer)).size} selected evidence layer(s).`);
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
      await this.progress(runId, 'orchestrator', 'RUNNING', 'preflight', 'Checking the frozen target, configuration, time budget, and approved origins.');
      if (manifest.targetKind !== target.targetKind) throw new Error('Run target does not match the approved manifest.');
      if ((target.testAccountIds ?? []).length) {
        const latestAccounts = await this.rawSetting<BrowserTestAccountSecret[]>('browser.testAccounts') ?? [];
        for (const id of target.testAccountIds ?? []) {
          const savedRevision = target.testAccountVersions?.[id];
          const current = latestAccounts.find(({ id: currentId }) => currentId === id);
          if (!current) { executionState = 'BLOCKED'; siteBlocked = true; blockedReason = 'A selected browser test account was removed after plan approval. Add or select an account for this site origin, then create a fresh plan.'; break; }
          if (!savedRevision || current.revision !== savedRevision) { executionState = 'BLOCKED'; siteBlocked = true; blockedReason = `Selected browser test account “${current.label}” changed after plan approval. Review the current credentials and create a fresh plan before running.`; break; }
        }
      }
      if (manifest.siteBaseUrl) {
        const manifestSite = new URL(manifest.siteBaseUrl);
        if (!target.siteBaseUrl || new URL(target.siteBaseUrl).origin !== manifestSite.origin) throw new Error('Run site does not match the approved manifest.');
        try { await this.sitePreflight(manifest.siteBaseUrl); }
        catch (error) { executionState = 'BLOCKED'; siteBlocked = true; blockedReason = error instanceof Error ? error.message : 'Site preflight failed.'; }
      }
      const assignedRepositoryScenarioIds = new Set(delegationPlan.assignments
        .filter(({ layer }) => layer === 'repo')
        .flatMap((assignment) => archived.contract.scenarios
          .filter(({ layer, criterionIds }) => layer === 'repo' && criterionIds.some((id) => assignment.criterionIds.includes(id)))
          .map(({ id }) => id)));
      if (target.targetKind !== 'site') {
        await this.progress(runId, 'repo', 'RUNNING', 'repository-checks', 'Repository worker is snapshotting the configured files and running the approved command arrays.');
        try {
          const repositorySourcePath = target.repositoryPath ?? await this.prepareRepositorySource(target, join(scratch, 'ado-source'));
          const { config, automatic } = await this.loadRepositoryConfig(target, repositorySourcePath);
          const generatedRepositoryTests = agentData.repositoryTests ?? [];
          const generatedMappings = new Map<string, Map<string, Set<string>>>();
          for (const generatedTest of generatedRepositoryTests) {
            for (const scenarioId of generatedTest.scenarioIds) {
              const byScenario = generatedMappings.get(generatedTest.commandId) ?? new Map<string, Set<string>>();
              const cases = byScenario.get(scenarioId) ?? new Set<string>();
              generatedTest.testCaseIds.forEach((id) => cases.add(id));
              byScenario.set(scenarioId, cases);
              generatedMappings.set(generatedTest.commandId, byScenario);
            }
          }
          const executionConfig = RepositoryConfigSchema.parse({
            ...config,
            tests: config.tests.map((command) => {
              const generatedForCommand = generatedMappings.get(command.id);
              if (!generatedForCommand) return command;
              const scenarioMappings = [...command.scenarioMappings.filter(({ scenarioId }) => !generatedForCommand.has(scenarioId))];
              for (const [scenarioId, testCaseIds] of generatedForCommand) scenarioMappings.push({ scenarioId, testCaseIds: [...testCaseIds] });
              return { ...command, resultFormat: command.resultFormat === 'trx' ? 'trx' as const : 'junit' as const, scenarioMappings };
            }),
          });
          const repositoryScenarios = archived.contract.scenarios.filter(({ layer, id }) => layer === 'repo' && assignedRepositoryScenarioIds.has(id));
          const mapped = new Set(executionConfig.tests.flatMap(({ scenarioMappings }) => scenarioMappings.map(({ scenarioId }) => scenarioId)));
          const unmapped = repositoryScenarios.filter(({ id }) => !mapped.has(id));
          if (unmapped.length && !automatic) throw new Error(`Map the following approved repository scenarios to JUnit test commands in .agentic-qa.yml: ${unmapped.map(({ id }) => id).join(', ')}`);
          const result = await runRepositoryChecks({
            runId, repositoryPath: repositorySourcePath, config: executionConfig, snapshotPath: join(scratch, 'repository'), generatedTests: generatedRepositoryTests.map(({ path, content }) => ({ path, content })),
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
          await this.progress(runId, 'repo', 'COMPLETED', 'repository-checks', `Repository worker recorded ${repositoryObservations.length} observation(s) and ${result.artifacts.length} artifact(s).`);
        } catch (error) {
          executionState = 'BLOCKED';
          blockedReason = error instanceof Error ? error.message : 'Repository worker could not start.';
          await this.progress(runId, 'repo', 'FAILED', 'repository-checks', 'Repository worker could not complete the approved checks. Review the run report for the blocked reason.');
        }
      }
      const assignedBrowserScenarioIds = new Set(delegationPlan.assignments
        .filter(({ layer }) => layer === 'browser')
        .flatMap((assignment) => archived.contract.scenarios
          .filter(({ layer, criterionIds }) => layer === 'browser' && criterionIds.some((id) => assignment.criterionIds.includes(id)))
          .map(({ id }) => id)));
      const browserScenarios = archived.contract.scenarios.filter(({ layer, id }) => layer === 'browser' && assignedBrowserScenarioIds.has(id));
      let actionsUsed = 0;
      for (const scenario of browserScenarios) {
        if (abort.signal.aborted) { executionState = 'CANCELLED'; break; }
        if (siteBlocked) break;
        const actionLimit = manifest.limits.browserActions ?? 100;
        const remaining = actionLimit - actionsUsed;
        if (remaining <= 0) {
          executionState = 'BLOCKED'; blockedReason = 'Browser action budget was exhausted.'; break;
        }
        await this.progress(runId, 'browser', 'RUNNING', scenario.id, `Playwright worker started Scenario ${scenario.id} (${scenario.steps.length} bounded steps).`);
        try {
          const scenarioTestAccounts = await this.resolveScenarioTestAccounts(target, scenario);
          const workerResult: BrowserScenarioResult = await this.browserScenarioRunner({
            runId,
            target: { siteBaseUrl: manifest.siteBaseUrl!, allowedOrigins: [new URL(manifest.siteBaseUrl!).origin] },
            scenario,
            artifactDirectory: scratch,
            timeoutMs: Math.max(100, Math.min(15_000, deadlineAt - Date.now())),
            actionLimit: remaining,
            showBrowserWindow: target.showBrowserWindow ?? false,
            testAccounts: scenarioTestAccounts,
            signal: abort.signal,
            onStepProgress: async (step) => this.progress(runId, 'browser', step.status === 'PASSED' ? 'COMPLETED' : 'FAILED', step.stepId, `${step.status} · step ${step.order}/${scenario.steps.length} · ${step.action}`),
          });
          const result = scrubBrowserScenarioResult(workerResult, scenarioTestAccounts);
          const artifactIds: string[] = [];
          for (const artifact of result.artifacts) {
            if (!this.evidenceRoot || !this.artifactKey) throw new Error('Encrypted evidence storage is unavailable.');
            const metadata = await encryptArtifact({
              runId, kind: artifact.kind, sourcePath: artifact.path, evidenceRoot: this.evidenceRoot,
              key: await this.artifactKey(), maxBytes: (manifest.limits.artifactMiB ?? 500) * 1024 * 1024,
              ...(artifact.stepId ? { scenarioId: scenario.id, stepId: artifact.stepId, sequence: artifact.order } : {}),
            });
            await this.store.recordArtifact(metadata);
            artifactIds.push(metadata.id);
          }
          const browserObservation = ObservationSchema.parse({ ...result.observation, artifactIds });
          observations.push(browserObservation);
          await this.store.appendObservation(browserObservation);
          if (browserObservation.diagnostic && ['missing_test_account', 'authentication_required', 'manual_authentication_required', 'access_denied', 'target_unavailable', 'browser_unavailable', 'policy_blocked'].includes(browserObservation.diagnostic.category)) {
            executionState = 'BLOCKED';
            siteBlocked = true;
            blockedReason = `${browserObservation.diagnostic.detail} ${browserObservation.diagnostic.nextAction}`;
          }
          await this.progress(runId, 'browser', browserObservation.status === 'PASSED' ? 'COMPLETED' : 'FAILED', scenario.id, `Playwright recorded ${result.steps?.length ?? scenario.steps.length} step result(s) and ${result.artifacts.filter(({ kind }) => kind === 'screenshot').length} ordered screenshot(s).`);
          actionsUsed += scenario.steps.length + 1;
          if (result.cancelled) { executionState = 'CANCELLED'; break; }
          if (siteBlocked) break;
        } catch (error) {
          if (abort.signal.aborted) { executionState = 'CANCELLED'; break; }
          executionState = 'BLOCKED';
          blockedReason = error instanceof Error ? error.message : 'Browser worker could not start.';
          await this.progress(runId, 'browser', 'FAILED', scenario.id, 'Playwright worker could not complete this Scenario. Review the run report for the failure.');
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

      const updatedPlan = DelegationPlanSchema.parse({
        ...delegationPlan,
        assignments: delegationPlan.assignments.map((assignment) => {
          const scenarios = archived.contract.scenarios.filter(({ layer, criterionIds }) => layer === assignment.layer && criterionIds.some((id) => assignment.criterionIds.includes(id)));
          const assignedObservations = observations.filter(({ scenarioId }) => scenarios.some(({ id }) => id === scenarioId));
          const done = scenarios.length > 0 && assignedObservations.length >= scenarios.length;
          const status = done ? 'completed' : executionState === 'CANCELLED' || executionState === 'BLOCKED' ? 'blocked' : 'skipped';
          const artifactIds = assignedObservations.flatMap(({ artifactIds }) => artifactIds);
          return {
            ...assignment, status,
            summary: done ? `${assignedObservations.length} assigned scenario(s) produced direct observations.` : `${assignedObservations.length}/${scenarios.length} assigned scenario(s) produced observations; required evidence is incomplete.`,
            evidenceIds: [...new Set([...assignedObservations.map(({ id }) => id), ...artifactIds])],
          };
        }),
      });

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
        const hasBlockedObservation = linkedObservations.some(({ diagnostic }) => diagnostic && ['missing_test_account', 'authentication_required', 'manual_authentication_required', 'access_denied', 'target_unavailable', 'browser_unavailable', 'policy_blocked'].includes(diagnostic.category));
        const state: CriterionResult['state'] = !missingEvidence.length ? 'VERIFIED' : blocked || hasBlockedObservation ? 'BLOCKED' : 'UNVERIFIED';
        const findingIds = findings.filter((finding) => finding.observationIds.some((id) => linkedObservations.some((observation) => observation.id === id))).map(({ id }) => id);
        return { criterionId: criterion.id, state, observationIds: linkedObservations.map(({ id }) => id), missingEvidence, findingIds };
      });
      let reviewerStatus: 'completed' | 'blocked' = 'completed';
      let reviewerReport: unknown;
      let agentUsage = agentData.agentUsage ?? { inputTokens: 0, outputTokens: 0, providerCalls: 0, costUsd: 0 };
      let agentSummary = '';
      try {
        await this.progress(runId, 'orchestrator', 'RUNNING', 'evidence-review', 'Reviewer Agent is checking direct observations and bounded repository/test code.');
        const configuredAgent = await this.requireConfiguredAgent();
        const approvedEnvelope = RunEnvelopeSchema.parse(agentData.envelope);
        if (configuredAgent.providerId !== approvedEnvelope.providerId) throw new Error('The configured provider changed after this run was approved.');
        const reviewerModelId = agentData.selectedModels?.reviewer ?? approvedEnvelope.defaultModelId;
        const reviewerModel = ProviderModelSchema.parse(agentData.selectedModelDetails?.reviewer);
        const reviewed = await reviewQaRun({
          provider: providerAdapter(configuredAgent.providerId), apiKey: configuredAgent.apiKey, model: reviewerModel, modelId: reviewerModelId,
          runId, criteria: archived.contract.criteria.map(({ id, expectedBehavior, scenarioIds }) => ({ id, expectedBehavior, scenarioIds })),
          criterionResults, observations, findings, repositoryTests: (agentData.repositoryTests ?? []).map(({ path, content, scenarioIds, testCaseIds }) => ({ path, content, scenarioIds, testCaseIds })),
          repositoryContext: agentData.repositoryContext ?? [],
          remainingBudget: {
            inputTokens: Math.max(0, approvedEnvelope.budget.maxInputTokens - agentUsage.inputTokens),
            outputTokens: Math.max(0, approvedEnvelope.budget.maxOutputTokens - agentUsage.outputTokens),
            providerCalls: Math.max(0, approvedEnvelope.budget.maxProviderCalls - agentUsage.providerCalls),
            costUsd: Math.max(0, approvedEnvelope.budget.maxCostUsd - agentUsage.costUsd),
          },
          fetcher: this.providerFetch,
        });
        reviewerReport = reviewed.report;
        agentUsage = {
          inputTokens: agentUsage.inputTokens + reviewed.usage.inputTokens,
          outputTokens: agentUsage.outputTokens + reviewed.usage.outputTokens,
          providerCalls: agentUsage.providerCalls + reviewed.usage.providerCalls,
          costUsd: agentUsage.costUsd + reviewed.usage.costUsd,
        };
        agentSummary = [
          `AI Reviewer summary: ${reviewed.report.summary}`,
          ...reviewed.report.criteria.map(({ criterionId, assessment, summary, observationIds }) => `${criterionId} · ${assessment} · ${summary} · observations ${observationIds.join(', ') || 'none'}`),
          ...reviewed.report.codeReview.map(({ kind, path, line, severity, comment, recommendation, criterionIds }) => `Code review · ${kind} · ${severity} · ${path}:${line} · criteria ${criterionIds.join(', ')} · ${comment} Recommendation: ${recommendation}`),
        ].join('\n').slice(0, 4000);
        for (const note of reviewed.report.codeReview.filter(({ kind, severity }) => kind === 'test_coverage' && (severity === 'medium' || severity === 'high'))) {
          for (const criterionId of note.criterionIds) {
            const index = criterionResults.findIndex((result) => result.criterionId === criterionId);
            if (index < 0) continue;
            const result = criterionResults[index]!;
            const rationale = `AI Reviewer raised a ${note.severity} test-coverage concern at ${note.path}:${note.line}: ${note.comment} Recommendation: ${note.recommendation}`;
            const reviewerFinding = FindingSchema.parse({
              id: randomUUID(), kind: 'INSUFFICIENT_EVIDENCE', criterionId,
              observationIds: result.observationIds, rationale, highRisk: note.severity === 'high', unresolved: true,
            });
            findings.push(reviewerFinding);
            await this.store.appendFinding(runId, reviewerFinding);
            criterionResults[index] = {
              ...result,
              state: result.state === 'VERIFIED' ? 'UNVERIFIED' : result.state,
              missingEvidence: [...result.missingEvidence, rationale],
              findingIds: [...result.findingIds, reviewerFinding.id],
            };
          }
        }
        await this.progress(runId, 'orchestrator', 'COMPLETED', 'evidence-review', 'Reviewer Agent returned validated criterion links and repository code-review notes.');
      } catch (error) {
        reviewerStatus = 'blocked';
        executionState = 'BLOCKED';
        blockedReason = `Reviewer Agent could not complete: ${error instanceof Error ? error.message : 'provider review failed.'}`;
        agentSummary = blockedReason;
        const reviewerFinding = FindingSchema.parse({ id: randomUUID(), kind: 'ENVIRONMENT_FAILURE', observationIds: observations.map(({ id }) => id), rationale: blockedReason, highRisk: false, unresolved: true });
        findings.push(reviewerFinding);
        await this.store.appendFinding(runId, reviewerFinding);
        await this.progress(runId, 'orchestrator', 'FAILED', 'evidence-review', 'Reviewer Agent could not complete. The run report records the reason.');
      }
      const updatedDiagram = buildDelegationDiagram(updatedPlan, reviewerStatus);
      await this.store.setSetting(`run.agent.${runId}`, {
        ...agentData,
        delegationPlan: updatedPlan,
        delegationDiagram: updatedDiagram,
        agentUsage,
        agentSummary,
        ...(reviewerReport ? { reviewerReport } : {}),
      });
      const verdict = computeVerdict({ executionState, criterionResults, findings, coverageGaps: archived.contract.coverageGaps });
      let explanation = verdict === 'PASS'
        ? 'Every acceptance criterion has passing direct evidence for each required layer.'
        : verdict === 'FAIL'
          ? 'At least one criterion has a reviewer-confirmed product failure.'
          : verdict === 'BLOCKED'
            ? `One or more required checks were blocked or did not execute. ${blockedReason}`.trim()
            : 'At least one acceptance criterion remains unverified or has an unresolved finding.';
      if (archived.contract.coverageGaps.length) explanation += ` ${archived.contract.coverageGaps.map(({ message }) => message).join(' ')}`;
      const report = buildReport({
        schemaVersion: 1, runId, executionState, criterionResults, findingIds: findings.map(({ id }) => id),
        completedAt: new Date().toISOString(), explanation, findings, coverageGaps: archived.contract.coverageGaps,
      });
      await this.store.finalizeRun(report);
      await this.progress(runId, 'orchestrator', executionState === 'COMPLETED' ? 'COMPLETED' : executionState === 'CANCELLED' ? 'CANCELLED' : 'FAILED', 'run-finalized', `${report.executionState} · ${report.verdict}. Open the report for criterion evidence and findings.`);
      return report;
    } finally {
      this.activeRuns.delete(runId);
      clearTimeout(deadline);
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async setting<T>(key: string): Promise<T | undefined> {
    const scoped = key === SETTING.organization || key === SETTING.project || key === SETTING.organizations || key === SETTING.profiles || key === SETTING.activeProfile;
    const accountId = scoped ? await this.rawSetting<string>(SETTING.accountId) : undefined;
    if (scoped && !accountId) return undefined;
    const value = scoped ? await this.rawSetting<T>(this.accountSettingKey(key, accountId!)) : await this.rawSetting<T>(key);
    return value === null || value === undefined ? undefined : value as T;
  }

  private async rawSetting<T>(key: string): Promise<T | undefined> {
    const value = await this.store.getSetting(key);
    return value === null || value === undefined ? undefined : value as T;
  }

  private async requireConfiguredAgent(): Promise<{ providerId: SupportedProviderId; modelId: string; maxOutputTokens: number; apiKey: string }> {
    const providerId = await this.setting<SupportedProviderId>('model.provider');
    const saved = await this.setting<{ providerId?: SupportedProviderId; modelId?: string; model?: string; maxOutputTokens?: number }>('model.settings');
    const key = providerId ? await this.setting<string>(`model.apiKey.${providerId}`) : undefined;
    const modelId = saved?.modelId ?? saved?.model;
    const configured = providerId === 'claude-code' ? await this.isClaudeAccountConnected() : Boolean(key);
    if (!providerId || !configured || !modelId || saved?.providerId !== providerId) throw new Error('Connect an AI provider account and select a supported model in Settings before planning or running QA.');
    const generation = await this.credentialGeneration(providerId);
    const catalog = await this.savedModelCatalog();
    const selected = catalog.find((model) => model.providerId === providerId && model.modelId === modelId && model.testStatus === 'reachable' && model.testedCredentialGeneration === generation);
    if (!selected) throw new Error('Select a saved model that passed its reachability test after the latest credential change before planning or running QA.');
    return { providerId, modelId, maxOutputTokens: Math.max(256, Math.min(selected.maxOutputTokens, 32_000)), apiKey: key ?? '' };
  }

  private async setSetting(key: string, value: unknown): Promise<void> {
    const scoped = key === SETTING.organization || key === SETTING.project || key === SETTING.organizations || key === SETTING.profiles || key === SETTING.activeProfile;
    const accountId = scoped ? await this.rawSetting<string>(SETTING.accountId) : undefined;
    if (scoped && !accountId) throw new Error('Sign in to Azure DevOps before saving organization or project selections.');
    await this.store.setSetting(scoped ? this.accountSettingKey(key, accountId!) : key, value);
  }

  private accountSettingKey(key: string, accountId: string): string {
    const legacyKey = `${key}.${encodeURIComponent(accountId)}`;
    if (/^[A-Za-z][A-Za-z0-9._-]{0,100}$/.test(legacyKey)) return legacyKey;
    return `${key}.${sha256(accountId)}`;
  }

  private async migrateLegacySelections(accountId: string): Promise<void> {
    const organizationKey = this.accountSettingKey(SETTING.organization, accountId);
    const projectKey = this.accountSettingKey(SETTING.project, accountId);
    const organizationsKey = this.accountSettingKey(SETTING.organizations, accountId);
    const [savedOrganization, savedProject, savedOrganizations, legacyOrganization, legacyProject] = await Promise.all([
      this.rawSetting<string>(organizationKey),
      this.rawSetting<AdoProject>(projectKey),
      this.rawSetting<string[]>(organizationsKey),
      this.rawSetting<string>(SETTING.organization),
      this.rawSetting<AdoProject>(SETTING.project),
    ]);
    let migratedOrganization: string | undefined;
    if (!savedOrganization && legacyOrganization) {
      try { migratedOrganization = resolveOrganization(legacyOrganization); } catch { migratedOrganization = undefined; }
      if (migratedOrganization) await this.store.setSetting(organizationKey, migratedOrganization);
    }
    if (!savedProject && legacyProject && (savedOrganization || migratedOrganization)) {
      await this.store.setSetting(projectKey, legacyProject);
    }
    if (!savedOrganizations && (savedOrganization || migratedOrganization)) {
      await this.store.setSetting(organizationsKey, [savedOrganization ?? migratedOrganization]);
    }
    if (legacyOrganization !== undefined) await this.store.setSetting(SETTING.organization, null);
    if (legacyProject !== undefined) await this.store.setSetting(SETTING.project, null);
  }

  private typeMappingsSettingKey(organization: string, projectId: string): string {
    return `ado.customTypeMappings.${encodeURIComponent(organization.toLocaleLowerCase('en-US'))}.${encodeURIComponent(projectId)}`;
  }

  private async activeAdoProfile(): Promise<AdoRunProfile> {
    const profileId = await this.setting<string>(SETTING.activeProfile);
    const profiles = await this.setting<AdoRunProfile[]>(SETTING.profiles) ?? [];
    const profile = profiles.find(({ id }) => id === profileId);
    if (!profile) throw new Error('Choose an Azure DevOps configuration profile in Settings first.');
    return profile;
  }

  private async typeMappings(organization: string, projectId: string): Promise<WorkItemTypeMappings> {
    const key = `${organization.toLocaleLowerCase('en-US')}:${projectId}`;
    let categoryMappings = this.workItemTypeCategoryMappings.get(key);
    if (!categoryMappings) {
      try {
        categoryMappings = await this.ado.getWorkItemTypeCategoryMappings(await this.accessToken(), organization, projectId);
      } catch {
        // Older or restricted ADO projects may not expose categories; standard type names still classify normally.
        categoryMappings = {};
      }
      this.workItemTypeCategoryMappings.set(key, categoryMappings);
    }
    const savedMappings = WorkItemTypeMappingsSchema.parse(await this.setting<WorkItemTypeMappings>(this.typeMappingsSettingKey(organization, projectId)) ?? {});
    return { ...categoryMappings, ...savedMappings };
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
        const loaded = await this.loadRepositoryConfig(target, sourcePath);
        repositoryConfigHash = sha256(JSON.stringify(loaded.config));
      } finally { if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
    }
    return { value: sha256(JSON.stringify({ target, ...(repositoryConfigHash ? { repositoryConfigHash } : {}) })), ...(repositoryConfigHash ? { repositoryConfigHash } : {}) };
  }

  private async resolveScenarioTestAccounts(target: TargetConfig, scenario: QAContract['scenarios'][number]): Promise<Record<string, Partial<Record<'username' | 'password', string>>>> {
    const references = scenario.steps.filter((step) => step.action === 'fillSecret');
    if (!references.length) return {};
    const selected = new Set(target.testAccountIds ?? []);
    const stored = await this.rawSetting<BrowserTestAccountSecret[]>('browser.testAccounts') ?? [];
    const result: Record<string, Partial<Record<'username' | 'password', string>>> = {};
    for (const reference of references) {
      if (!selected.has(reference.accountId)) continue;
      const account = stored.find(({ id, origin }) => id === reference.accountId && origin === (target.siteBaseUrl ? new URL(target.siteBaseUrl).origin : ''));
      const value = account?.[reference.field];
      if (value) result[reference.accountId] = { ...result[reference.accountId], [reference.field]: value };
    }
    return result;
  }

  private repositoryConfigSettingKey(target: TargetConfig): string {
    const identity = target.adoRepository
      ? `ado:${target.adoRepository.organization.toLocaleLowerCase('en-US')}:${target.adoRepository.projectId}:${target.adoRepository.id}`
      : `local:${resolve(target.repositoryPath ?? '')}`;
    return `repository.config.${sha256(identity)}`;
  }

  private async loadRepositoryConfig(target: TargetConfig, sourcePath: string): Promise<{ config: RepositoryConfig; sha256: string; automatic: boolean }> {
    const saved = await this.rawSetting<unknown>(this.repositoryConfigSettingKey(target));
    if (saved !== undefined) {
      const config = RepositoryConfigSchema.parse(saved);
      return { config, sha256: sha256(JSON.stringify(config)), automatic: false };
    }
    try { return { ...(await readRepositoryConfig(sourcePath)), automatic: false }; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let packageManifest: { name?: unknown; scripts?: { test?: unknown } } | undefined;
      try { packageManifest = JSON.parse(await readFile(join(sourcePath, 'package.json'), 'utf8')); }
      catch (manifestError) {
        if ((manifestError as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('The root package.json could not be read for automatic test discovery. Fix the manifest or configure an exact repository command.');
      }
      const rootFiles = await readdir(sourcePath, { withFileTypes: true });
      const solution = rootFiles.filter((entry) => entry.isFile() && /\.slnx?$/i.test(entry.name)).map(({ name }) => name).sort()[0];
      const hasNpmTest = typeof packageManifest?.scripts?.test === 'string' && Boolean(packageManifest.scripts.test.trim());
      if (!hasNpmTest && !solution) throw new Error('No supported automatic test entry point was found. Configure an exact repository command or choose Browser-only in Run setup.');
      const test = solution && !hasNpmTest
        ? { id: 'auto-dotnet-test', label: `Discovered .NET solution test (${solution})`, executable: 'dotnet' as const, arguments: ['test', solution, '--no-restore'], workingDirectory: '.', timeoutSeconds: 1200, network: 'none' as const, resultFormat: 'none' as const, resultPaths: [], scenarioMappings: [] }
        : { id: 'auto-npm-test', label: 'Discovered npm test script', executable: 'npm' as const, arguments: ['test'], workingDirectory: '.', timeoutSeconds: 600, network: 'none' as const, resultFormat: 'none' as const, resultPaths: [], scenarioMappings: [] };
      const config = RepositoryConfigSchema.parse({
        schemaVersion: 1,
        project: { name: typeof packageManifest?.name === 'string' && packageManifest.name.trim() ? packageManifest.name.slice(0, 160) : basename(sourcePath) || 'QA project' },
        repository: { include: ['**/*'], exclude: [] },
        setup: [],
        tests: [test],
      });
      return { config, sha256: sha256(JSON.stringify(config)), automatic: true };
    }
  }

  private async prepareRepositorySource(target: TargetConfig, destination: string): Promise<string> {
    if (target.repositoryPath) return target.repositoryPath;
    const source = target.adoRepository;
    if (!source) throw new Error('Select a repository source first.');
    const token = await this.accessToken();
    const items = await this.ado.listGitItems(token, source.organization, source.id, source.commit);
    const configItem = items.find((item) => !item.isFolder && item.path === '/.agentic-qa.yml');
    await mkdir(destination, { recursive: true, mode: 0o700 });
    if (configItem) {
      const configText = await this.ado.getGitItemContent(token, source.organization, source.id, source.commit, configItem.path);
      if (Buffer.byteLength(configText, 'utf8') > 256 * 1024) throw new Error('The repository configuration exceeds the 256 KiB limit.');
      await writeFile(join(destination, '.agentic-qa.yml'), configText, { mode: 0o600, flag: 'wx' });
    } else {
      const packageItem = items.find((item) => !item.isFolder && item.path === '/package.json');
      const solutionItem = items.filter((item) => !item.isFolder && /^\/[^/]+\.slnx?$/i.test(item.path)).sort((a, b) => a.path.localeCompare(b.path))[0];
      if (packageItem) {
        const packageText = await this.ado.getGitItemContent(token, source.organization, source.id, source.commit, packageItem.path);
        if (Buffer.byteLength(packageText, 'utf8') > 1024 * 1024) throw new Error('The root package.json exceeds the automatic discovery size limit.');
        await writeFile(join(destination, 'package.json'), packageText, { mode: 0o600, flag: 'wx' });
      }
      if (solutionItem) await writeFile(join(destination, solutionItem.path.slice(1)), '', { mode: 0o600, flag: 'wx' });
    }
    const { config } = await this.loadRepositoryConfig(target, destination);
    const paths = items.filter((item) => !item.isFolder).map((item) => item.path.slice(1)).filter((path) => path && !path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'));
    const included = new Set(config.repository.include.flatMap((pattern) => micromatch(paths, pattern, { dot: true })));
    for (const pattern of config.repository.exclude) for (const path of micromatch([...included], pattern, { dot: true })) included.delete(path);
    included.delete('.agentic-qa.yml');
    const selected = [...included].filter((path) => !isExcludedRepositoryPath(path)).sort();
    if (selected.length > 10000) throw new Error('The selected repository snapshot contains too many files (limit 10,000).');
    let totalBytes = 0;
    for (const path of selected) {
      if (!configItem && path === 'package.json') {
        const preloaded = await readFile(join(destination, 'package.json')).catch(() => undefined);
        if (preloaded) { totalBytes += preloaded.byteLength; preloaded.fill(0); continue; }
      }
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

  private async requireAuth(): Promise<AdoAuthService> {
    return this.getAuth();
  }

  private async getAuth(): Promise<AdoAuthService> {
    if (!this.auth) this.auth = await this.authFactory();
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

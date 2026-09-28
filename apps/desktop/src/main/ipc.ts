import { z } from 'zod';
import { QAContractSchema } from '@agentic-qa/domain/qa-contract';
import { RunManifestSchema } from '@agentic-qa/domain/run';
import { isTrustedIpcSender } from './security.js';
import type { DesktopApi, DraftPlan } from '../shared/ipc.js';

interface IpcEventLike { senderFrame: { url: string } | null }
interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void;
  removeHandler?(channel: string): void;
}

const schemas = {
  'qa:get-state': z.tuple([]),
  'qa:save-client-id': z.tuple([z.string().max(100)]),
  'qa:sign-in': z.tuple([]),
  'qa:sign-out': z.tuple([z.string().min(1).max(500)]),
  'qa:select-organization': z.tuple([z.string().min(1).max(500)]),
  'qa:list-projects': z.tuple([]),
  'qa:select-project': z.tuple([z.object({ id: z.string().min(1).max(200), name: z.string().min(1).max(200), state: z.string().max(80).optional() }).strict()]),
  'qa:list-work-item-types': z.tuple([]),
  'qa:save-work-item-type-mapping': z.tuple([z.string().min(1).max(120), z.enum(['REQUIREMENT', 'TASK', 'OTHER'])]),
  'qa:search-items': z.tuple([z.object({ term: z.string().max(120), types: z.array(z.string().max(120)).max(20), states: z.array(z.string().max(120)).max(20), afterId: z.number().int().positive().max(2_147_483_647).optional() }).strict()]),
  'qa:add-queue-item': z.tuple([z.number().int().positive().max(2_147_483_647)]),
  'qa:remove-queue-item': z.tuple([z.string().min(1).max(400)]),
  'qa:move-queue-item': z.tuple([z.string().min(1).max(400), z.enum(['up', 'down'])]),
  'qa:refresh-queue': z.tuple([]),
  'qa:choose-repository': z.tuple([]),
  'qa:list-git-repositories': z.tuple([]),
  'qa:list-git-refs': z.tuple([z.string().min(1).max(200)]),
  'qa:save-target': z.tuple([z.object({ targetKind: z.enum(['repository', 'site', 'both']), repositorySource: z.enum(['local', 'ado-git']).optional(), repositoryPath: z.string().max(2000).optional(), adoRepository: z.object({ organization: z.string().max(100), projectId: z.string().max(200), id: z.string().max(200), name: z.string().max(200), refName: z.string().max(300), commit: z.string().regex(/^[a-f0-9]{40,64}$/i) }).strict().optional(), siteBaseUrl: z.string().max(2000).optional(), allowedOrigins: z.array(z.string().max(500)).max(10) }).strict()]),
  'qa:create-draft-plan': z.tuple([z.string().uuid().optional()]),
  'qa:import-model-key': z.tuple([]),
  'qa:clear-model-key': z.tuple([]),
  'qa:save-model-settings': z.tuple([z.object({ model: z.string().max(80), maxOutputTokens: z.number().int().min(256).max(4096) }).strict()]),
  'qa:preview-model-request': z.tuple([z.string().uuid(), z.array(z.string().min(1).max(120)).max(50)]),
  'qa:generate-model-suggestions': z.tuple([z.string().uuid()]),
  'qa:approve-plan': z.tuple([z.object({ manifest: RunManifestSchema, contract: QAContractSchema, notes: z.array(z.string().max(1000)).max(100), repositoryCommands: z.array(z.object({ id: z.string().max(80), label: z.string().max(160), executable: z.string().max(20), arguments: z.array(z.string().max(500)).max(100), workingDirectory: z.string().max(500), timeoutSeconds: z.number().int().positive().max(1800), resultFormat: z.enum(['junit', 'none']).optional(), resultPaths: z.array(z.string().max(500)).max(30), scenarioMappings: z.array(z.object({ scenarioId: z.string().max(120), testCaseIds: z.array(z.string().max(400)).max(100) }).strict()).max(100) }).strict()).max(120).optional() }).strict()]),
  'qa:list-runs': z.tuple([]),
  'qa:get-run': z.tuple([z.string().uuid()]),
  'qa:get-children': z.tuple([z.number().int().positive().max(2_147_483_647)]),
  'qa:export-report': z.tuple([z.string().uuid(), z.enum(['html', 'markdown', 'json'])]),
  'qa:export-artifact': z.tuple([z.string().uuid(), z.string().uuid()]),
  'qa:classify-finding': z.tuple([z.object({ runId: z.string().uuid(), findingId: z.string().uuid(), kind: z.enum(['PRODUCT_FAILURE', 'TEST_FAILURE', 'ENVIRONMENT_FAILURE', 'FLAKY_TEST', 'AMBIGUOUS_REQUIREMENT']), author: z.string().max(200), reason: z.string().max(4000) }).strict()]),
  'qa:delete-run': z.tuple([z.string().uuid()]),
  'qa:is-browser-installed': z.tuple([]),
  'qa:install-browser': z.tuple([]),
  'qa:is-repo-worker-installed': z.tuple([]),
  'qa:install-repo-worker': z.tuple([]),
  'qa:start-run': z.tuple([z.string().uuid()]),
  'qa:cancel-run': z.tuple([z.string().uuid()]),
} as const;

type MainApi = Omit<DesktopApi, 'getState'> & Pick<DesktopApi, 'getState'>;

const methods = {
  'qa:get-state': 'getState',
  'qa:save-client-id': 'saveClientId',
  'qa:sign-in': 'signIn',
  'qa:sign-out': 'signOut',
  'qa:select-organization': 'selectOrganization',
  'qa:list-projects': 'listProjects',
  'qa:select-project': 'selectProject',
  'qa:list-work-item-types': 'listWorkItemTypes',
  'qa:save-work-item-type-mapping': 'saveWorkItemTypeMapping',
  'qa:search-items': 'searchItems',
  'qa:add-queue-item': 'addQueueItem',
  'qa:remove-queue-item': 'removeQueueItem',
  'qa:move-queue-item': 'moveQueueItem',
  'qa:refresh-queue': 'refreshQueue',
  'qa:choose-repository': 'chooseRepository',
  'qa:list-git-repositories': 'listGitRepositories',
  'qa:list-git-refs': 'listGitRefs',
  'qa:save-target': 'saveTarget',
  'qa:create-draft-plan': 'createDraftPlan',
  'qa:import-model-key': 'importModelKey',
  'qa:clear-model-key': 'clearModelKey',
  'qa:save-model-settings': 'saveModelSettings',
  'qa:preview-model-request': 'previewModelRequest',
  'qa:generate-model-suggestions': 'generateModelSuggestions',
  'qa:approve-plan': 'approvePlan',
  'qa:list-runs': 'listRuns',
  'qa:get-run': 'getRun',
  'qa:get-children': 'getChildren',
  'qa:export-report': 'exportReport',
  'qa:export-artifact': 'exportArtifact',
  'qa:classify-finding': 'classifyFinding',
  'qa:delete-run': 'deleteRun',
  'qa:is-browser-installed': 'isBrowserInstalled',
  'qa:install-browser': 'installBrowser',
  'qa:is-repo-worker-installed': 'isRepoWorkerImageInstalled',
  'qa:install-repo-worker': 'installRepoWorkerImage',
  'qa:start-run': 'startRun',
  'qa:cancel-run': 'cancelRun',
} as const;

export function registerIpcHandlers(
  ipcMain: IpcMainLike,
  api: MainApi,
  options: { devServerUrl?: string; packagedAppUrl?: string },
): () => void {
  const channels = Object.keys(methods) as Array<keyof typeof methods>;
  for (const channel of channels) {
    const method = methods[channel];
    const schema = schemas[channel];
    ipcMain.handle(channel, async (event, ...args) => {
      if (!event.senderFrame || !isTrustedIpcSender(event.senderFrame.url, options.devServerUrl, options.packagedAppUrl)) {
        throw new Error('Untrusted desktop renderer.');
      }
      const parsed = schema.parse(args);
      const callable = api[method] as (...values: unknown[]) => unknown;
      return callable.apply(api, parsed);
    });
  }
  return () => channels.forEach((channel) => ipcMain.removeHandler?.(channel));
}

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openQaStore } from '../src/database.js';
import type { WorkItemSnapshot } from '@agentic-qa/domain/work-item';
import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { RunManifest } from '@agentic-qa/domain/run';

const snapshot: WorkItemSnapshot = {
  organization: 'contoso',
  projectId: 'p-1',
  projectName: 'Portal',
  id: 40,
  revision: 2,
  type: 'User Story',
  kind: 'REQUIREMENT',
  title: 'private acceptance criterion canary',
  state: 'Active',
  acceptanceCriteria: 'Never stored in plaintext',
  url: 'https://dev.azure.com/contoso/Portal/_workitems/edit/40',
  retrievedAt: '2026-09-27T12:00:00.000Z',
};

describe('encrypted QA store', () => {
  let directory = '';

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('encrypts snapshots and queue data and restores them after reopen', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentic-qa-store-'));
    const databasePath = path.join(directory, 'qa.db');
    const key = Buffer.alloc(32, 41);
    let store = await openQaStore({ databasePath, key: () => Buffer.from(key) });
    const entry = await store.addToQueue(snapshot);
    await store.close();

    const diskBytes = await readFile(databasePath);
    expect(diskBytes.subarray(0, 16).toString()).not.toBe('SQLite format 3\u0000');
    expect(diskBytes.includes(Buffer.from('private acceptance criterion canary'))).toBe(false);

    store = await openQaStore({ databasePath, key: () => Buffer.from(key) });
    await expect(store.getQueue()).resolves.toEqual([entry]);
    await expect(store.getSnapshot(entry.key)).resolves.toMatchObject({
      title: 'private acceptance criterion canary',
      revision: 2,
    });
    await store.close();
  });

  it('fails closed when an existing database is opened with a lost or wrong key', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentic-qa-store-'));
    const databasePath = path.join(directory, 'qa.db');
    const store = await openQaStore({
      databasePath,
      key: () => Buffer.alloc(32, 1),
    });
    await store.close();

    await expect(
      openQaStore({ databasePath, key: () => Buffer.alloc(32, 2) }),
    ).rejects.toThrow('Unable to unlock encrypted QA storage');
  });

  it('maintains queue order, stale state, and duplicate prevention', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentic-qa-store-'));
    const store = await openQaStore({
      databasePath: path.join(directory, 'qa.db'),
      key: () => Buffer.alloc(32, 3),
    });
    const first = await store.addToQueue(snapshot);
    const second = await store.addToQueue({ ...snapshot, id: 41, title: 'Second item' });
    await store.addToQueue({ ...snapshot, revision: 3 });
    await store.reorderQueue([second.key, first.key]);
    await store.markStale(first.key, true);

    await expect(store.getQueue()).resolves.toEqual([
      second,
      { ...first, stale: true },
    ]);
    await store.close();
  });

  it('persists selected account, organization, and project settings in the encrypted database', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentic-qa-store-'));
    const databasePath = path.join(directory, 'qa.db');
    const key = Buffer.alloc(32, 5);
    let store = await openQaStore({ databasePath, key: () => Buffer.from(key) });
    await store.setSetting('selectedAccountId', 'home-1');
    await store.setSetting('selectedOrganization', 'contoso');
    await store.setSetting('selectedProject', { id: 'p-1', name: 'Portal' });
    await store.close();

    store = await openQaStore({ databasePath, key: () => Buffer.from(key) });
    await expect(store.getSetting('selectedAccountId')).resolves.toBe('home-1');
    await expect(store.getSetting('selectedProject')).resolves.toEqual({ id: 'p-1', name: 'Portal' });
    await store.close();
  });

  it('deletes queued source data and run history while retaining app-level settings', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentic-qa-store-'));
    const store = await openQaStore({ databasePath: path.join(directory, 'qa.db'), key: () => Buffer.alloc(32, 9) });
    await store.addToQueue(snapshot);
    const contract: QAContract = {
      schemaVersion: 2, id: '11111111-1111-4111-8111-111111111111', revision: 1,
      sourceContext: [], taskCandidates: [], coverageGaps: [],
      criteria: [{ id: 'criterion-1', source: { organization: 'org', projectId: 'project', workItemId: 2, revision: 4, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: 'a'.repeat(64) }, expectedBehavior: 'Search results are shown.', requiredLayers: ['browser'], scenarioIds: ['scenario-1'], ambiguityNotes: [] }],
      scenarios: [{ id: 'scenario-1', criterionIds: ['criterion-1'], layer: 'browser', preconditions: [], steps: [{ action: 'expectVisible', role: 'heading', name: 'Results' }], expectedObservations: ['Results heading visible.'], risk: 'low', approved: true }],
      approvedAt: '2026-09-27T12:00:00.000Z',
    };
    const manifest: RunManifest = { schemaVersion: 1, runId: '22222222-2222-4222-8222-222222222222', startedAt: '2026-09-27T12:01:00.000Z', sources: [], targetKind: 'site', siteBaseUrl: 'https://example.test', contractId: contract.id, contractRevision: 1, configHash: 'b'.repeat(64), toolVersions: { app: '1.0.0' }, limits: { runSeconds: 300 } };
    await store.createRun(manifest, contract);
    await store.setSetting('entra.selectedAccountId', 'home-1');
    await store.setSetting('ado.organization', 'contoso');
    await store.setSetting('ado.organizations.account-1', ['contoso']);
    await store.setSetting('ado.organization.account-1', 'contoso');
    await store.setSetting('ado.project.account-1', { id: 'p-1', name: 'Project' });
    await store.setSetting('ado.customTypeMappings.contoso.p-1', { 'User Story': 'REQUIREMENT' });
    await store.setSetting('repository.config.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { schemaVersion: 1 });
    await store.setSetting('entra.clientId', 'legacy-client-id');
    await store.setSetting('model.apiKey', 'kept-model-key');

    await store.deleteLocalQaData();

    await expect(store.getQueue()).resolves.toEqual([]);
    await expect(store.getSnapshot('contoso:p-1:40')).resolves.toBeUndefined();
    await expect(store.listRuns()).resolves.toEqual([]);
    await expect(store.getSetting('entra.selectedAccountId')).resolves.toBeUndefined();
    await expect(store.getSetting('ado.organization')).resolves.toBeUndefined();
    await expect(store.getSetting('ado.organizations.account-1')).resolves.toBeUndefined();
    await expect(store.getSetting('ado.organization.account-1')).resolves.toBeUndefined();
    await expect(store.getSetting('ado.project.account-1')).resolves.toBeUndefined();
    await expect(store.getSetting('ado.customTypeMappings.contoso.p-1')).resolves.toBeUndefined();
    await expect(store.getSetting('repository.config.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toBeUndefined();
    await expect(store.getSetting('entra.clientId')).resolves.toBeUndefined();
    await expect(store.getSetting('model.apiKey')).resolves.toBe('kept-model-key');
    await store.close();
  });

  it('stores immutable versioned contracts, manifests, and reports', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentic-qa-store-'));
    const store = await openQaStore({ databasePath: path.join(directory, 'qa.db'), key: () => Buffer.alloc(32, 19) });
    const contract: QAContract = {
      schemaVersion: 2, id: '11111111-1111-4111-8111-111111111111', revision: 1,
      sourceContext: [], taskCandidates: [], coverageGaps: [],
      criteria: [{ id: 'criterion-1', source: { organization: 'org', projectId: 'project', workItemId: 2, revision: 4, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: 'a'.repeat(64) }, expectedBehavior: 'Search results are shown.', requiredLayers: ['browser'], scenarioIds: ['scenario-1'], ambiguityNotes: [] }],
      scenarios: [{ id: 'scenario-1', criterionIds: ['criterion-1'], layer: 'browser', preconditions: [], steps: [{ action: 'expectVisible', role: 'heading', name: 'Results' }], expectedObservations: ['Results heading visible.'], risk: 'low', approved: true }],
      approvedAt: '2026-09-27T12:00:00.000Z',
    };
    const manifest: RunManifest = {
      schemaVersion: 1, runId: '22222222-2222-4222-8222-222222222222', startedAt: '2026-09-27T12:01:00.000Z',
      sources: [], targetKind: 'site', siteBaseUrl: 'https://example.test', contractId: contract.id, contractRevision: 1,
      configHash: 'b'.repeat(64), toolVersions: { app: '1.0.0' }, limits: { runSeconds: 300 },
    };
    await store.createRun(manifest, contract);
    await store.appendProgress({ runId: manifest.runId, worker: 'orchestrator', state: 'RUNNING', stage: 'preflight', message: 'Checking the approved target.', at: '2026-09-27T12:01:30.000Z' });
    await store.appendProgress({ runId: manifest.runId, worker: 'browser', state: 'COMPLETED', stage: 'scenario-1', message: 'Playwright recorded two step screenshots.', at: '2026-09-27T12:01:45.000Z' });
    await expect(store.createRun(manifest, contract)).rejects.toThrow();
    await expect(store.saveContract({ ...contract, criteria: [{ ...contract.criteria[0]!, expectedBehavior: 'mutated' }] })).rejects.toThrow('immutable');
    expect((await store.getRun(manifest.runId))?.contract).toEqual(contract);
    await expect(store.getProgress(manifest.runId)).resolves.toMatchObject([{ worker: 'orchestrator', stage: 'preflight' }, { worker: 'browser', stage: 'scenario-1' }]);
    await expect(store.getRun(manifest.runId)).resolves.toMatchObject({ progress: [{ worker: 'orchestrator' }, { worker: 'browser' }] });
    await store.finalizeRun({
      schemaVersion: 1, runId: manifest.runId, executionState: 'COMPLETED', verdict: 'NEEDS_REVIEW',
      criterionResults: [{ criterionId: 'criterion-1', state: 'UNVERIFIED', observationIds: [], missingEvidence: ['No observations'], findingIds: [] }],
      findingIds: [], completedAt: '2026-09-27T12:02:00.000Z', explanation: 'Evidence is incomplete.',
    });
    await expect(store.finalizeRun({ schemaVersion: 1, runId: manifest.runId, executionState: 'COMPLETED', verdict: 'PASS', criterionResults: [], findingIds: [], completedAt: '2026-09-27T12:03:00.000Z', explanation: 'Changed report.' })).rejects.toThrow('already finalized');
    expect((await store.getRun(manifest.runId))?.report?.verdict).toBe('NEEDS_REVIEW');
    await store.finalizeReview({
      schemaVersion: 1, runId: manifest.runId, executionState: 'COMPLETED', verdict: 'FAIL',
      criterionResults: [{ criterionId: 'criterion-1', state: 'FAILED', observationIds: [], missingEvidence: ['Reviewer confirmed a product failure'], findingIds: [] }],
      findingIds: [], completedAt: '2026-09-27T12:04:00.000Z', explanation: 'Reviewer adjudication.',
    });
    await expect(store.getRun(manifest.runId)).resolves.toMatchObject({ report: { verdict: 'NEEDS_REVIEW' }, reviewedReport: { verdict: 'FAIL' } });
    await expect(store.listRuns()).resolves.toMatchObject([{ manifest, report: { verdict: 'FAIL' } }]);
    await store.close();
  });
});

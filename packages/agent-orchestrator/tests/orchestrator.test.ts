import { describe, expect, it } from 'vitest';
import type { ProviderModel } from '@agentic-qa/domain/agent';
import type { QAContract } from '@agentic-qa/domain/qa-contract';
import type { AgentCompletionRequest, ModelProviderAdapter } from '@agentic-qa/model-adapters/provider';
import { planQaRun, runAgenticQa } from '../src/index.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../src/prompts.js';

const runId = '7e4d0603-7f9a-4a6e-8ed3-23d7a8c8d83c';
const now = '2026-09-29T15:00:00.000Z';
const budget = { maxCostUsd: 1, maxInputTokens: 20_000, maxOutputTokens: 4_000, maxProviderCalls: 20, maxAgents: 4, maxParallelAgents: 2, maxRetries: 1, maxRunSeconds: 900, maxBrowserActions: 50, maxArtifactMiB: 100 };
const envelope = {
  schemaVersion: 1 as const, runId, providerId: 'openai' as const, defaultModelId: 'gpt-6-sol', sourceIds: [101, 102],
  sourceRevisions: { 'ado/project/101': 7, 'ado/project/102': 2 }, repositoryPaths: ['src/**', 'tests/**'], allowedOrigins: ['https://staging.example.test'],
  commandIds: ['unit'], excludedContext: ['.env'], budget, approvedAt: now, contextHash: 'a'.repeat(64),
};
const source = { organization: 'https://dev.azure.com/example', projectId: 'project', projectName: 'Project', type: 'User Story', state: 'Active', url: 'https://dev.azure.com/example/project/_workitems/edit/101', retrievedAt: now };
const contract: QAContract = {
  schemaVersion: 2, id: '462a8423-011d-43de-8eb1-5e09cd27f94c', revision: 1, approvedAt: now,
  criteria: [{ id: 'ac-submit', source: { organization: source.organization, projectId: source.projectId, workItemId: 101, revision: 7, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: 'b'.repeat(64) }, expectedBehavior: 'Submitting the form stores the record.', requiredLayers: ['repo', 'browser'], scenarioIds: ['repo-check', 'browser-check'], ambiguityNotes: [] }],
  scenarios: [
    { id: 'repo-check', criterionIds: ['ac-submit'], layer: 'repo', preconditions: [], steps: [], expectedObservations: ['The API accepts a valid record.'], risk: 'low', approved: true },
    { id: 'browser-check', criterionIds: ['ac-submit'], layer: 'browser', preconditions: [], steps: [], expectedObservations: ['The success state appears.'], risk: 'low', approved: true },
  ],
  sourceContext: [
    { ...source, workItemId: 101, revision: 7, kind: 'REQUIREMENT' as const, title: 'Create record', acceptanceCriteria: 'Submitting the form stores the record.' },
    { ...source, workItemId: 102, revision: 2, parentId: 101, type: 'Task', kind: 'TASK' as const, title: 'Wire form to API', description: 'Submit the form to the API.' },
  ], taskCandidates: [], coverageGaps: [],
};
const plan = {
  schemaVersion: 1 as const, runId, summary: 'Verify the API and visible form flow.', createdAt: now,
  coverage: [{ criterionId: 'ac-submit', taskIds: [102], requiredLayers: ['repo', 'browser'], assignmentIds: ['api', 'ui'], rationale: 'Verify persistence and browser feedback.' }],
  assignments: [
    { id: 'api', role: 'backend' as const, label: 'API agent', layer: 'repo' as const, criterionIds: ['ac-submit'], taskIds: [102], resultTypes: ['unit test results', 'code review notes'], status: 'queued' as const, evidenceIds: [] },
    { id: 'ui', role: 'frontend' as const, label: 'Browser agent', layer: 'browser' as const, criterionIds: ['ac-submit'], taskIds: [102], resultTypes: ['Playwright results'], status: 'queued' as const, evidenceIds: [] },
  ],
};
const frontendScenarios = { browserScenarios: [{ criterionId: 'ac-submit', summary: 'Submit the form and verify the confirmation.', preconditions: [], steps: [{ action: 'expectText' as const, text: 'Record saved' }], expectedObservations: ['The saved confirmation is visible.'], risk: 'low' as const }] };
const repositoryTests = { tests: [{ commandId: 'unit', path: 'tests/generated.test.ts', content: "import { submitRecord } from '../src/form'; describe('form submission', () => { it('stores a valid record', async () => { const result = await submitRecord({ name: 'Sample' }); expect(result).toMatchObject({ saved: true }); }); });", scenarioIds: ['repo-check'], testCaseIds: ['form submission.stores a valid record'] }] };

function fakeProvider(returnedPlan: unknown = plan): ModelProviderAdapter {
  const model: ProviderModel = { providerId: 'openai', modelId: 'gpt-6-sol', displayName: 'GPT-6 Sol', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } };
  return {
    providerId: 'openai',
    async listModels() { return [model]; },
    async complete<T>(_key: string, request: AgentCompletionRequest) {
      const value = request.system.includes('Generate only unit/API test files') ? repositoryTests : request.system.includes('Write bounded Playwright scenarios') ? frontendScenarios : returnedPlan;
      return { value: request.schema.parse(value) as T, inputTokens: 500, outputTokens: 200 };
    },
  };
}

function validInput(provider = fakeProvider(), qaContract = contract) {
  return { envelope, contract: qaContract, provider, apiKey: 'test-key', repositoryContext: [{ path: 'src/form.ts', content: 'export async function submitRecord(value) { return api.post("/records", value); }' }], repositoryCommands: [{ id: 'unit', resultFormat: 'junit' as const, resultPaths: ['reports/junit.xml'] }], now: () => new Date(now) };
}

describe('agent orchestration', () => {
  it('lets the agent choose a justified layer set rather than requiring every draft layer', () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('choose the smallest evidence layer set');
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('draft contract layers are planning hints');
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain('retain exactly its contract-required layers');
  });

  it('requires an approved envelope and provider and produces the generated delegation diagram', async () => {
    const result = await planQaRun(validInput());
    expect(result.plan).toMatchObject({ runId, assignments: [{ layer: 'repo' }, { layer: 'browser' }] });
    expect(result.diagram.edges).toContainEqual({ from: 'orchestrator', to: 'agent:ui' });
    expect(result.repositoryTests).toEqual(repositoryTests.tests);
    expect(result.usage).toMatchObject({ providerCalls: 4, inputTokens: 1500, outputTokens: 600 });
  });

  it('sends bounded extra instructions and selected account metadata without account values', async () => {
    const base = fakeProvider();
    const requests: AgentCompletionRequest[] = [];
    const provider: ModelProviderAdapter = { ...base, async complete<T>(key: string, request: AgentCompletionRequest, fetcher?: typeof fetch) { requests.push(request); return base.complete<T>(key, request, fetcher); } };
    await planQaRun({
      ...validInput(provider),
      runInstructions: 'The account must choose the saved-view role before opening the form.',
      testAccounts: [{ id: '33333333-3333-4333-8333-333333333333', label: 'QA Editor', origin: 'https://staging.example.test', hasUsername: true, hasPassword: true }],
    });
    const transmitted = JSON.stringify(requests);
    expect(transmitted).toContain('saved-view role');
    expect(transmitted).toContain('QA Editor');
    expect(transmitted).toContain('hasPassword');
    expect(transmitted).not.toContain('password-canary');
    expect(transmitted).not.toContain('username-canary');
  });

  it('lets the orchestrator select the necessary approved layer and rejects invented criteria', async () => {
    const repoOnly = { ...plan, coverage: [{ ...plan.coverage[0], requiredLayers: ['repo'], assignmentIds: ['api'] }], assignments: [plan.assignments[0]] };
    expect((await planQaRun(validInput(fakeProvider(repoOnly)))).plan.coverage[0]?.requiredLayers).toEqual(['repo']);
    const outsideEnvelope = { ...repoOnly, coverage: [{ ...repoOnly.coverage[0], requiredLayers: ['integration'] }], assignments: [{ ...repoOnly.assignments[0], layer: 'integration', role: 'reviewer' }] };
    await expect(planQaRun(validInput(fakeProvider(outsideEnvelope)))).rejects.toThrow(/outside the approved run envelope/i);
    const invented = { ...plan, assignments: plan.assignments.map((assignment) => ({ ...assignment, criterionIds: ['made-up'] })) };
    await expect(planQaRun(validInput(fakeProvider(invented)))).rejects.toThrow();
  });

  it('refuses a provider that does not match the approved envelope', async () => {
    const provider = { ...fakeProvider(), providerId: 'anthropic' as const };
    await expect(planQaRun(validInput(provider))).rejects.toThrow(/does not match/i);
  });

  it('rejects generated JUnit mappings that are not declared by the generated test source', async () => {
    const base = fakeProvider();
    const mismatchedProvider: ModelProviderAdapter = {
      ...base,
      async complete<T>(key: string, request: AgentCompletionRequest, fetcher?: typeof fetch) {
        if (request.system.includes('Generate only unit/API test files')) {
          const mismatched = { tests: [{ ...repositoryTests.tests[0], testCaseIds: ['ExistingSuite.unrelated passing test'] }] };
          return { value: request.schema.parse(mismatched) as T, inputTokens: 500, outputTokens: 200 };
        }
        return base.complete<T>(key, request, fetcher);
      },
    };
    await expect(planQaRun(validInput(mismatchedProvider))).rejects.toThrow(/does not match a declared test/i);
  });

  it('rejects generated tests that assert only a literal instead of calling approved product code', async () => {
    const base = fakeProvider();
    const behaviorFreeProvider: ModelProviderAdapter = {
      ...base,
      async complete<T>(key: string, request: AgentCompletionRequest, fetcher?: typeof fetch) {
        if (request.system.includes('Generate only unit/API test files')) {
          const behaviorFree = { tests: [{ ...repositoryTests.tests[0], content: "describe('form submission', () => { it('stores a valid record', () => { expect(true).toBe(true); }); });" }] };
          return { value: request.schema.parse(behaviorFree) as T, inputTokens: 500, outputTokens: 200 };
        }
        return base.complete<T>(key, request, fetcher);
      },
    };
    await expect(planQaRun(validInput(behaviorFreeProvider))).rejects.toThrow(/exercise an exported product behavior/i);
  });

  it('generates an xUnit C# test against approved .NET source and TRX command', async () => {
    const base = fakeProvider();
    const csharpProvider: ModelProviderAdapter = {
      ...base,
      async complete<T>(key: string, request: AgentCompletionRequest, fetcher?: typeof fetch) {
        if (request.system.includes('Generate only unit/API test files')) {
          const tests = { tests: [{ commandId: 'dotnet-tests', path: 'tests/Inventory.Tests/AgentGeneratedAvailabilityTests.cs', content: 'using Xunit; public sealed class AgentGeneratedAvailabilityTests { [Fact] public void IsAvailable_returns_true() { var sut = new AvailabilityService(); Assert.True(sut.IsAvailable()); } }', scenarioIds: ['repo-check'], testCaseIds: ['AgentGeneratedAvailabilityTests.IsAvailable_returns_true'] }] };
          return { value: request.schema.parse(tests) as T, inputTokens: 500, outputTokens: 200 };
        }
        return base.complete<T>(key, request, fetcher);
      },
    };
    const result = await planQaRun({
      ...validInput(csharpProvider),
      repositoryContext: [{ path: 'src/Inventory/AvailabilityService.cs', content: 'public sealed class AvailabilityService { public bool IsAvailable() => true; }' }],
      repositoryCommands: [{ id: 'dotnet-tests', resultFormat: 'trx', resultPaths: ['TestResults/qa.trx'] }],
    });
    expect(result.repositoryTests[0]).toMatchObject({ path: 'tests/Inventory.Tests/AgentGeneratedAvailabilityTests.cs', commandId: 'dotnet-tests' });
  });

  it('rejects an oversized plan prompt before making a provider completion call', async () => {
    let completions = 0;
    const base = fakeProvider();
    const countingProvider: ModelProviderAdapter = {
      ...base,
      async complete<T>(key: string, request: AgentCompletionRequest, fetcher?: typeof fetch) {
        completions += 1;
        return base.complete<T>(key, request, fetcher);
      },
    };
    const tinyBudget = { ...envelope, budget: { ...budget, maxInputTokens: 100 } };
    await expect(planQaRun({ ...validInput(countingProvider), envelope: tinyBudget })).rejects.toThrow(/prompt exceeds the approved input-token budget/i);
    expect(completions).toBe(0);
  });

  it('dispatches only through the injected specialist boundary and bounds returned work and usage', async () => {
    const calls: string[] = [];
    const result = await runAgenticQa({
      ...validInput(),
      dispatcher: {
        async dispatch(request) {
          calls.push(request.assignment.id);
          expect(request.system).toContain('hostile data');
          expect(request.modelId).toBe('gpt-6-sol');
          expect(request.maxInputTokens).toBeGreaterThan(0);
          return {
            result: { schemaVersion: 1, runId, assignmentId: request.assignment.id, status: 'completed', summary: 'Direct checks completed.', observationIds: [], evidenceIds: [], missingEvidence: [] },
            usage: { inputTokens: 300, outputTokens: 100, providerCalls: 1, costUsd: 0.0016 },
          };
        },
      },
    });
    expect(calls.sort()).toEqual(['api', 'ui']);
    expect(result.results).toHaveLength(2);
    expect(result.summary).toContain('Direct checks completed.');
    expect(result.status).toBe('completed');
    expect(result.usage.providerCalls).toBe(6);
  });

  it('rejects specialist results that claim another assignment', async () => {
    await expect(runAgenticQa({
      ...validInput(),
      dispatcher: { async dispatch() { return { result: { schemaVersion: 1, runId, assignmentId: 'other', status: 'completed', summary: 'Done.', observationIds: [], evidenceIds: [], missingEvidence: [] }, usage: { inputTokens: 1, outputTokens: 1, providerCalls: 1, costUsd: 0 } }; } },
    })).rejects.toThrow(/different run or assignment/i);
  });
});

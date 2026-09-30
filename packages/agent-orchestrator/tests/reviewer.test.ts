import { describe, expect, it } from 'vitest';
import type { ProviderModel } from '@agentic-qa/domain/agent';
import type { AgentCompletionRequest, ModelProviderAdapter } from '@agentic-qa/model-adapters/provider';
import { reviewQaRun } from '../src/reviewer.js';

const model: ProviderModel = { providerId: 'openai', modelId: 'gpt-6-sol', displayName: 'GPT-6 Sol', capabilities: { structuredOutput: true, toolUse: true, inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10 } };
const criterion = { id: 'ac-save', expectedBehavior: 'A valid record is saved.', scenarioIds: ['repo-save'] };
const observation = { id: '1b97c6ab-0d2f-4c50-bbac-c442e9952738', runId: '7e4d0603-7f9a-4a6e-8ed3-23d7a8c8d83c', scenarioId: 'repo-save', status: 'PASSED' as const, worker: 'repo' as const, startedAt: '2026-09-29T15:00:00.000Z', endedAt: '2026-09-29T15:00:01.000Z', assertion: 'JUnit testcase accepted behavior.saves a valid record passed.', artifactIds: ['f0208718-7c84-48a8-9be7-571212d8ea87'], sourceIdentity: 'snapshot:abc' };
const repositoryTests = [{ path: 'tests/form.test.ts', content: 'describe("form", () => {\n  it("saves a valid record", () => expect(save()).toBe(true));\n});', scenarioIds: ['repo-save'], testCaseIds: ['accepted behavior.saves a valid record'] }];

function provider(value: unknown): ModelProviderAdapter {
  return {
    providerId: 'openai',
    async listModels() { return [model]; },
    async complete<T>(_key: string, request: AgentCompletionRequest) { return { value: request.schema.parse(value) as T, inputTokens: 700, outputTokens: 120 }; },
  };
}

const review = {
  summary: 'The repository check passed its saved-record assertion.',
  criteria: [{ criterionId: 'ac-save', assessment: 'supported' as const, summary: 'The JUnit observation supports the criterion.', observationIds: [observation.id] }],
  codeReview: [{ kind: 'test_coverage' as const, criterionIds: ['ac-save'], path: 'tests/form.test.ts', line: 2, severity: 'low' as const, comment: 'The generated test uses a constant result rather than exercising the API behavior.', recommendation: 'Call the existing API client with a representative record.' }],
};

describe('evidence-linked reviewer', () => {
  it('returns bounded reviewer usage and validates criterion, observation, and test-code references', async () => {
    const result = await reviewQaRun({
      provider: provider(review), apiKey: 'test-key', model, modelId: model.modelId,
      runId: observation.runId, criteria: [criterion], criterionResults: [{ criterionId: 'ac-save', state: 'VERIFIED', observationIds: [observation.id], missingEvidence: [], findingIds: [] }],
      observations: [observation], findings: [], repositoryTests,
      remainingBudget: { inputTokens: 5000, outputTokens: 800, providerCalls: 1, costUsd: 1 },
    });
    expect(result.report.criteria[0]?.observationIds).toEqual([observation.id]);
    expect(result.report.codeReview[0]).toMatchObject({ path: 'tests/form.test.ts', line: 2 });
    expect(result.usage).toMatchObject({ inputTokens: 700, outputTokens: 120, providerCalls: 1 });
  });

  it('rejects invented evidence references and code locations outside generated tests', async () => {
    const inventedEvidence = { ...review, criteria: [{ ...review.criteria[0], observationIds: ['4f121f03-38ee-44c4-a982-34f120cd248d'] }] };
    await expect(reviewQaRun({ provider: provider(inventedEvidence), apiKey: 'test-key', model, modelId: model.modelId, runId: observation.runId, criteria: [criterion], criterionResults: [{ criterionId: 'ac-save', state: 'VERIFIED', observationIds: [observation.id], missingEvidence: [], findingIds: [] }], observations: [observation], findings: [], repositoryTests, remainingBudget: { inputTokens: 5000, outputTokens: 800, providerCalls: 1, costUsd: 1 } })).rejects.toThrow(/observation/i);
    const outsidePath = { ...review, codeReview: [{ ...review.codeReview[0], path: 'src/form.ts' }] };
    await expect(reviewQaRun({ provider: provider(outsidePath), apiKey: 'test-key', model, modelId: model.modelId, runId: observation.runId, criteria: [criterion], criterionResults: [{ criterionId: 'ac-save', state: 'VERIFIED', observationIds: [observation.id], missingEvidence: [], findingIds: [] }], observations: [observation], findings: [], repositoryTests, remainingBudget: { inputTokens: 5000, outputTokens: 800, providerCalls: 1, costUsd: 1 } })).rejects.toThrow(/unreviewed repository path/i);
  });

  it('rejects test coverage notes that cite a test unrelated to the named criterion', async () => {
    const unrelated = { ...review, codeReview: [{ ...review.codeReview[0], criterionIds: ['ac-other'] }] };
    await expect(reviewQaRun({ provider: provider(unrelated), apiKey: 'test-key', model, modelId: model.modelId, runId: observation.runId, criteria: [criterion], criterionResults: [{ criterionId: 'ac-save', state: 'VERIFIED', observationIds: [observation.id], missingEvidence: [], findingIds: [] }], observations: [observation], findings: [], repositoryTests, remainingBudget: { inputTokens: 5000, outputTokens: 800, providerCalls: 1, costUsd: 1 } })).rejects.toThrow(/unknown criterion/i);
    const wrongMapping = { ...review, codeReview: [{ ...review.codeReview[0], criterionIds: ['ac-save'] }], };
    const unmatchedTest = [{ ...repositoryTests[0]!, scenarioIds: ['different-scenario'] }];
    await expect(reviewQaRun({ provider: provider(wrongMapping), apiKey: 'test-key', model, modelId: model.modelId, runId: observation.runId, criteria: [criterion], criterionResults: [{ criterionId: 'ac-save', state: 'VERIFIED', observationIds: [observation.id], missingEvidence: [], findingIds: [] }], observations: [observation], findings: [], repositoryTests: unmatchedTest, remainingBudget: { inputTokens: 5000, outputTokens: 800, providerCalls: 1, costUsd: 1 } })).rejects.toThrow(/linked to each named criterion/i);
  });
});

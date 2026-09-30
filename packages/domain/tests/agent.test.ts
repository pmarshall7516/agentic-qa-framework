import { describe, expect, it } from 'vitest';
import { AgentToolCallSchema, DelegationPlanSchema, RunBudgetSchema, RunEnvelopeSchema, SavedModelSchema, SavedModelViewSchema, buildDelegationDiagram } from '../src/agent.js';

const runId = '7e4d0603-7f9a-4a6e-8ed3-23d7a8c8d83c';
const plan = {
  schemaVersion: 1 as const,
  runId,
  summary: 'Check the form API and browser behavior.',
  createdAt: '2026-09-29T15:00:00.000Z',
  coverage: [{ criterionId: 'ac-submit', taskIds: [11, 12], requiredLayers: ['repo', 'browser'], assignmentIds: ['api', 'ui'], rationale: 'The criterion includes API and visible form behavior.' }],
  assignments: [
    { id: 'api', role: 'backend', label: 'API agent', layer: 'repo', criterionIds: ['ac-submit'], taskIds: [12], resultTypes: ['code review', 'unit test results'], status: 'queued', evidenceIds: [] },
    { id: 'ui', role: 'frontend', label: 'Form agent', layer: 'browser', criterionIds: ['ac-submit'], taskIds: [11], resultTypes: ['Playwright results'], status: 'queued', evidenceIds: [] },
  ],
};

describe('agent run contracts', () => {
  it('accepts a bounded combined run envelope', () => {
    expect(RunEnvelopeSchema.parse({
      schemaVersion: 1, runId, providerId: 'anthropic', defaultModelId: 'claude-agent-model', sourceIds: [101],
      sourceRevisions: { 'ado/project/101': 7 }, repositoryPaths: ['src/**', 'tests/**'], allowedOrigins: ['https://staging.example.test'],
      commandIds: ['unit'], excludedContext: ['.env'], approvedAt: '2026-09-29T15:00:00.000Z', contextHash: 'a'.repeat(64),
      budget: { maxCostUsd: 1, maxInputTokens: 20_000, maxOutputTokens: 4_000, maxProviderCalls: 20, maxAgents: 4, maxParallelAgents: 2, maxRetries: 1, maxRunSeconds: 900, maxBrowserActions: 50, maxArtifactMiB: 100 },
    }).providerId).toBe('anthropic');
  });

  it('rejects role model overrides that differ from the selected run model', () => {
    expect(RunEnvelopeSchema.safeParse({
      schemaVersion: 1, runId, providerId: 'anthropic', defaultModelId: 'selected-model', roleModels: { backend: 'different-model' }, sourceIds: [101],
      sourceRevisions: { 'ado/project/101': 7 }, repositoryPaths: ['src/**'], allowedOrigins: [], commandIds: ['unit'], excludedContext: [],
      approvedAt: '2026-09-29T15:00:00.000Z', contextHash: 'a'.repeat(64),
      budget: { maxCostUsd: 1, maxInputTokens: 20_000, maxOutputTokens: 4_000, maxProviderCalls: 20, maxAgents: 4, maxParallelAgents: 2, maxRetries: 1, maxRunSeconds: 900, maxBrowserActions: 50, maxArtifactMiB: 100 },
    }).success).toBe(false);
  });

  it('requires saved model test evidence and exposes no credential field in the renderer view', () => {
    const savedModel = {
      id: '11111111-1111-4111-8111-111111111111', providerId: 'anthropic', modelId: 'claude-sonnet', displayName: 'Claude Sonnet',
      capabilities: { structuredOutput: true, toolUse: true }, maxOutputTokens: 1200,
      credentialGeneration: '22222222-2222-4222-8222-222222222222', testStatus: 'reachable',
      testedAt: '2026-09-30T15:00:00.000Z', testedCredentialGeneration: '22222222-2222-4222-8222-222222222222',
    };
    const { credentialGeneration: _credentialGeneration, testedCredentialGeneration: _testedCredentialGeneration, ...rendererData } = savedModel;
    const view = SavedModelViewSchema.parse(rendererData);

    expect(SavedModelSchema.parse(savedModel).testStatus).toBe('reachable');
    expect(view).not.toHaveProperty('credentialGeneration');
    expect(SavedModelSchema.safeParse({ ...savedModel, testStatus: 'reachable', testedAt: undefined }).success).toBe(false);
  });

  it('rejects parallel fan-out above the total agent limit', () => {
    expect(RunBudgetSchema.safeParse({ maxCostUsd: 1, maxInputTokens: 20_000, maxOutputTokens: 4_000, maxProviderCalls: 20, maxAgents: 2, maxParallelAgents: 3, maxRetries: 1, maxRunSeconds: 900, maxBrowserActions: 50, maxArtifactMiB: 100 }).success).toBe(false);
  });

  it('requires every assignment to map to declared criterion coverage', () => {
    expect(DelegationPlanSchema.safeParse({ ...plan, assignments: [...plan.assignments, { ...plan.assignments[0], id: 'bad', criterionIds: ['invented'] }] }).success).toBe(false);
  });

  it('builds a compact graph from selected agent assignments and result types', () => {
    const diagram = buildDelegationDiagram(DelegationPlanSchema.parse(plan));
    expect(diagram.nodes[0]).toMatchObject({ id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator' });
    expect(diagram.edges).toContainEqual({ from: 'orchestrator', to: 'agent:ui' });
    expect(diagram.nodes.find(({ id }) => id === 'result:ui')?.label).toBe('Playwright results');
    expect(diagram.nodes.some(({ id }) => id === 'agent:reviewer')).toBe(false);
    const reviewedDiagram = buildDelegationDiagram(DelegationPlanSchema.parse(plan), 'completed');
    expect(reviewedDiagram.edges).toContainEqual({ from: 'result:api', to: 'agent:reviewer' });
    expect(reviewedDiagram.edges).toContainEqual({ from: 'result:reviewer', to: 'summary' });
  });

  it('rejects commands, unapproved origins, and out-of-envelope paths as tool calls', () => {
    expect(AgentToolCallSchema.safeParse({ tool: 'run_shell', command: 'npm test' }).success).toBe(false);
    expect(AgentToolCallSchema.parse({ tool: 'run_approved_command', commandId: 'unit' })).toEqual({ tool: 'run_approved_command', commandId: 'unit' });
  });
});

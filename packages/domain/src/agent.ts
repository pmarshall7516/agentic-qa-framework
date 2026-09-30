import { z } from 'zod';

export const AgentRoleSchema = z.enum(['orchestrator', 'backend', 'frontend', 'reviewer']);
export const AgentLayerSchema = z.enum(['repo', 'browser', 'integration']);

export const ModelCapabilitySchema = z.object({
  structuredOutput: z.boolean(),
  toolUse: z.boolean(),
  contextTokens: z.number().int().positive().optional(),
  inputUsdPerMillionTokens: z.number().nonnegative().optional(),
  outputUsdPerMillionTokens: z.number().nonnegative().optional(),
}).strict();

export const ProviderModelSchema = z.object({
  providerId: z.enum(['openai', 'anthropic', 'openrouter', 'claude-code']),
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  capabilities: ModelCapabilitySchema,
}).strict();

export const SavedModelTestStatusSchema = z.enum(['untested', 'reachable', 'unreachable']);
export const SavedModelSchema = ProviderModelSchema.extend({
  id: z.string().uuid(),
  maxOutputTokens: z.number().int().min(256).max(32_000),
  credentialGeneration: z.string().uuid(),
  testStatus: SavedModelTestStatusSchema,
  testedAt: z.iso.datetime().optional(),
  testedCredentialGeneration: z.string().uuid().optional(),
  testMessage: z.string().max(500).optional(),
}).strict().superRefine((model, ctx) => {
  const hasTest = model.testStatus !== 'untested';
  if (hasTest !== Boolean(model.testedAt) || hasTest !== Boolean(model.testedCredentialGeneration)) {
    ctx.addIssue({ code: 'custom', message: 'Tested models must retain their timestamp and credential generation.', path: ['testedAt'] });
  }
  if (hasTest && model.testedCredentialGeneration !== model.credentialGeneration) {
    ctx.addIssue({ code: 'custom', message: 'A model test must match the saved credential generation.', path: ['testedCredentialGeneration'] });
  }
  if (model.testStatus === 'untested' && model.testMessage !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Untested models cannot have a test result message.', path: ['testMessage'] });
  }
});

export const SavedModelViewSchema = ProviderModelSchema.extend({
  id: z.string().uuid(),
  maxOutputTokens: z.number().int().min(256).max(32_000),
  testStatus: z.enum(['untested', 'reachable', 'unreachable', 'stale']),
  testedAt: z.iso.datetime().optional(),
  testMessage: z.string().max(500).optional(),
}).strict();

export const RunBudgetSchema = z.object({
  maxCostUsd: z.number().positive().max(1000),
  maxInputTokens: z.number().int().positive().max(2_000_000),
  maxOutputTokens: z.number().int().positive().max(500_000),
  maxProviderCalls: z.number().int().positive().max(500),
  maxAgents: z.number().int().positive().max(32),
  maxParallelAgents: z.number().int().positive().max(16),
  maxRetries: z.number().int().nonnegative().max(10),
  maxRunSeconds: z.number().int().positive().max(7200),
  maxBrowserActions: z.number().int().nonnegative().max(1000),
  maxArtifactMiB: z.number().int().positive().max(2048),
}).strict().superRefine((budget, ctx) => {
  if (budget.maxParallelAgents > budget.maxAgents) ctx.addIssue({ code: 'custom', message: 'Parallel agents cannot exceed the agent limit.', path: ['maxParallelAgents'] });
});

export const RunEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  providerId: z.enum(['openai', 'anthropic', 'openrouter', 'claude-code']),
  defaultModelId: z.string().min(1).max(200),
  roleModels: z.partialRecord(AgentRoleSchema, z.string().min(1).max(200)).optional(),
  sourceIds: z.array(z.number().int().positive()).min(1).max(200),
  sourceRevisions: z.record(z.string().min(1).max(400), z.number().int().positive()),
  repositoryPaths: z.array(z.string().min(1).max(1000)).max(2000),
  allowedOrigins: z.array(z.url()).max(10),
  commandIds: z.array(z.string().min(1).max(80)).max(120),
  excludedContext: z.array(z.string().min(1).max(1000)).max(500),
  budget: RunBudgetSchema,
  approvedAt: z.iso.datetime(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().superRefine((envelope, ctx) => {
  if (new Set(envelope.sourceIds).size !== envelope.sourceIds.length) ctx.addIssue({ code: 'custom', message: 'Source IDs must be unique.', path: ['sourceIds'] });
  if (new Set(envelope.allowedOrigins).size !== envelope.allowedOrigins.length) ctx.addIssue({ code: 'custom', message: 'Allowed origins must be unique.', path: ['allowedOrigins'] });
  if (new Set(envelope.commandIds).size !== envelope.commandIds.length) ctx.addIssue({ code: 'custom', message: 'Command IDs must be unique.', path: ['commandIds'] });
  for (const [role, modelId] of Object.entries(envelope.roleModels ?? {})) {
    if (modelId !== envelope.defaultModelId) ctx.addIssue({ code: 'custom', message: 'All agent roles must use the selected run model.', path: ['roleModels', role] });
  }
});

export const AgentAssignmentSchema = z.object({
  id: z.string().min(1).max(120),
  role: AgentRoleSchema.exclude(['orchestrator']),
  label: z.string().min(1).max(120),
  layer: AgentLayerSchema,
  criterionIds: z.array(z.string().min(1).max(120)).min(1).max(100),
  taskIds: z.array(z.number().int().positive()).max(200),
  resultTypes: z.array(z.string().min(1).max(120)).min(1).max(20),
  status: z.enum(['queued', 'running', 'completed', 'blocked', 'skipped']),
  summary: z.string().max(4000).optional(),
  evidenceIds: z.array(z.string().uuid()).max(500),
}).strict();

export const CriterionCoverageAssignmentSchema = z.object({
  criterionId: z.string().min(1).max(120),
  taskIds: z.array(z.number().int().positive()).max(200),
  requiredLayers: z.array(AgentLayerSchema).min(1).max(3),
  assignmentIds: z.array(z.string().min(1).max(120)).max(32),
  rationale: z.string().min(1).max(2000),
}).strict();

export const DelegationPlanSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  summary: z.string().min(1).max(4000),
  coverage: z.array(CriterionCoverageAssignmentSchema).max(500),
  assignments: z.array(AgentAssignmentSchema).max(32),
  createdAt: z.iso.datetime(),
}).strict().superRefine((plan, ctx) => {
  const assignments = new Map(plan.assignments.map((assignment) => [assignment.id, assignment]));
  if (assignments.size !== plan.assignments.length) ctx.addIssue({ code: 'custom', message: 'Assignment IDs must be unique.', path: ['assignments'] });
  const coverageIds = new Set<string>();
  plan.coverage.forEach((coverage, index) => {
    if (coverageIds.has(coverage.criterionId)) ctx.addIssue({ code: 'custom', message: 'Coverage criterion IDs must be unique.', path: ['coverage', index, 'criterionId'] });
    coverageIds.add(coverage.criterionId);
    for (const id of coverage.assignmentIds) {
      const assignment = assignments.get(id);
      if (!assignment || !assignment.criterionIds.includes(coverage.criterionId)) ctx.addIssue({ code: 'custom', message: 'Coverage must link to an assignment that includes its criterion.', path: ['coverage', index, 'assignmentIds'] });
    }
  });
  for (const assignment of plan.assignments) {
    if (assignment.criterionIds.some((id) => !coverageIds.has(id))) ctx.addIssue({ code: 'custom', message: 'Assignments may reference only covered criteria.', path: ['assignments'] });
  }
});

export const AgentToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('list_repository_files'), path: z.string().max(500).default('.') }).strict(),
  z.object({ tool: z.literal('read_repository_file'), path: z.string().min(1).max(1000) }).strict(),
  z.object({ tool: z.literal('write_generated_test'), path: z.string().min(1).max(1000), content: z.string().min(1).max(100_000), assignmentId: z.string().min(1).max(120) }).strict(),
  z.object({ tool: z.literal('run_approved_command'), commandId: z.string().min(1).max(80) }).strict(),
  z.object({ tool: z.literal('run_browser_scenario'), scenarioId: z.string().min(1).max(120) }).strict(),
]);

export const AgentWorkResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  assignmentId: z.string().min(1).max(120),
  status: z.enum(['completed', 'blocked', 'skipped']),
  summary: z.string().min(1).max(4000),
  observationIds: z.array(z.string().uuid()).max(1000),
  evidenceIds: z.array(z.string().uuid()).max(1000),
  missingEvidence: z.array(z.string().min(1).max(1000)).max(200),
}).strict();

export const DelegationDiagramSchema = z.object({
  nodes: z.array(z.object({ id: z.string().min(1).max(120), kind: z.enum(['orchestrator', 'agent', 'result', 'summary']), label: z.string().min(1).max(160), status: z.enum(['queued', 'running', 'completed', 'blocked', 'skipped']).optional() }).strict()).max(128),
  edges: z.array(z.object({ from: z.string().min(1).max(120), to: z.string().min(1).max(120) }).strict()).max(256),
}).strict().superRefine((diagram, ctx) => {
  const ids = new Set(diagram.nodes.map(({ id }) => id));
  if (ids.size !== diagram.nodes.length) ctx.addIssue({ code: 'custom', message: 'Diagram node IDs must be unique.', path: ['nodes'] });
  diagram.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) ctx.addIssue({ code: 'custom', message: 'Diagram edges must reference existing nodes.', path: ['edges', index] });
  });
});

export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export type SavedModel = z.infer<typeof SavedModelSchema>;
export type SavedModelView = z.infer<typeof SavedModelViewSchema>;
export type RunBudget = z.infer<typeof RunBudgetSchema>;
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;
export type AgentAssignment = z.infer<typeof AgentAssignmentSchema>;
export type DelegationPlan = z.infer<typeof DelegationPlanSchema>;
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;
export type AgentWorkResult = z.infer<typeof AgentWorkResultSchema>;
export type DelegationDiagram = z.infer<typeof DelegationDiagramSchema>;

export function buildDelegationDiagram(plan: DelegationPlan, reviewerStatus?: NonNullable<DelegationDiagram['nodes'][number]['status']>): DelegationDiagram {
  const nodes: DelegationDiagram['nodes'] = [{ id: 'orchestrator', kind: 'orchestrator', label: 'Orchestrator' }];
  const edges: DelegationDiagram['edges'] = [];
  for (const assignment of plan.assignments) {
    nodes.push({ id: `agent:${assignment.id}`, kind: 'agent', label: assignment.label, status: assignment.status });
    edges.push({ from: 'orchestrator', to: `agent:${assignment.id}` });
    const resultId = `result:${assignment.id}`;
    nodes.push({ id: resultId, kind: 'result', label: assignment.resultTypes.join(' · '), status: assignment.status });
    edges.push({ from: `agent:${assignment.id}`, to: resultId });
  }
  if (reviewerStatus) {
    nodes.push({ id: 'agent:reviewer', kind: 'agent', label: 'Evidence Reviewer', status: reviewerStatus });
    for (const assignment of plan.assignments) edges.push({ from: `result:${assignment.id}`, to: 'agent:reviewer' });
    nodes.push({ id: 'result:reviewer', kind: 'result', label: 'Evidence-linked review and test-code review', status: reviewerStatus });
    edges.push({ from: 'agent:reviewer', to: 'result:reviewer' });
  }
  nodes.push({ id: 'summary', kind: 'summary', label: 'Findings, proof and summary' });
  if (reviewerStatus) edges.push({ from: 'result:reviewer', to: 'summary' });
  else for (const assignment of plan.assignments) edges.push({ from: `result:${assignment.id}`, to: 'summary' });
  return DelegationDiagramSchema.parse({ nodes, edges });
}

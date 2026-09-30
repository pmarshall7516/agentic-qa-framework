import { z } from 'zod';
import { WorkItemSnapshotSchema } from './work-item.js';

export const SourceRefSchema = z.object({
  organization: z.string().min(1), projectId: z.string().min(1), workItemId: z.number().int().positive(),
  revision: z.number().int().positive(), field: z.string().min(1), excerptHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export const CriterionSourceSchema = z.union([
  SourceRefSchema,
  z.object({ userAdded: z.literal(true), author: z.string().min(1).max(200), derivedFrom: SourceRefSchema.optional() }).strict(),
  z.object({
    agentProposed: z.literal(true), proposalId: z.string().min(1).max(120),
    sourceRefs: z.array(SourceRefSchema).min(1).max(30), decision: z.enum(['ACCEPTED', 'EDITED']),
  }).strict(),
]);
export const RequiredLayerSchema = z.enum(['repo', 'browser']);
export const CriterionSchema = z.object({
  id: z.string().min(1).max(120), source: CriterionSourceSchema,
  expectedBehavior: z.string().trim().min(1).max(4000),
  requiredLayers: z.array(RequiredLayerSchema).min(1).max(2),
  scenarioIds: z.array(z.string().min(1).max(120)).min(1),
  ambiguityNotes: z.array(z.string().max(1000)).max(20),
}).strict().superRefine((criterion, ctx) => {
  if (new Set(criterion.requiredLayers).size !== criterion.requiredLayers.length) {
    ctx.addIssue({ code: 'custom', message: 'Required layers must be unique.', path: ['requiredLayers'] });
  }
});

const BrowserStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), path: z.string().startsWith('/').max(1000) }).strict(),
  z.object({ action: z.literal('click'), role: z.enum(['button', 'link', 'tab', 'checkbox']), name: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('fill'), role: z.enum(['textbox', 'searchbox']), name: z.string().min(1).max(200), value: z.string().max(2000) }).strict(),
  z.object({ action: z.literal('fillSecret'), accountId: z.string().uuid(), field: z.enum(['username', 'password']), role: z.enum(['textbox', 'searchbox']), name: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('press'), role: z.enum(['textbox', 'searchbox']), name: z.string().min(1).max(200), key: z.enum(['Enter', 'Escape', 'Tab']) }).strict(),
  z.object({ action: z.literal('expectVisible'), role: z.enum(['button', 'link', 'heading', 'textbox', 'status', 'alert']), name: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('expectText'), text: z.string().min(1).max(1000) }).strict(),
]);

export const ScenarioSchema = z.object({
  id: z.string().min(1).max(120), criterionIds: z.array(z.string().min(1).max(120)).min(1),
  summary: z.string().trim().min(1).max(200).optional(),
  layer: RequiredLayerSchema,
  preconditions: z.array(z.string().max(1000)).max(20),
  steps: z.array(BrowserStepSchema).max(100).default([]),
  expectedObservations: z.array(z.string().min(1).max(1000)).min(1).max(20),
  risk: z.enum(['low', 'medium', 'high']), approved: z.boolean(),
}).strict();

const ContractContentSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  criteria: z.array(CriterionSchema), scenarios: z.array(ScenarioSchema),
  approvedAt: z.iso.datetime().optional(),
});

function validateContractRelations(contract: { criteria: z.infer<typeof CriterionSchema>[]; scenarios: z.infer<typeof ScenarioSchema>[] }, ctx: z.RefinementCtx): void {
  const criteria = new Map(contract.criteria.map((criterion) => [criterion.id, criterion]));
  if (criteria.size !== contract.criteria.length) ctx.addIssue({ code: 'custom', message: 'Criterion IDs must be unique.', path: ['criteria'] });
  const scenarios = new Map(contract.scenarios.map((scenario) => [scenario.id, scenario]));
  if (scenarios.size !== contract.scenarios.length) ctx.addIssue({ code: 'custom', message: 'Scenario IDs must be unique.', path: ['scenarios'] });
  contract.criteria.forEach((criterion, criterionIndex) => {
    if (new Set(criterion.scenarioIds).size !== criterion.scenarioIds.length) ctx.addIssue({ code: 'custom', message: 'Scenario links must be unique.', path: ['criteria', criterionIndex, 'scenarioIds'] });
    for (const layer of criterion.requiredLayers) {
      const linked = criterion.scenarioIds.some((scenarioId) => scenarios.get(scenarioId)?.layer === layer);
      if (!linked) ctx.addIssue({ code: 'custom', message: `Required ${layer} layer has no linked scenario.`, path: ['criteria', criterionIndex, 'scenarioIds'] });
    }
    criterion.scenarioIds.forEach((scenarioId) => {
      const scenario = scenarios.get(scenarioId);
      if (!scenario || !scenario.criterionIds.includes(criterion.id)) ctx.addIssue({ code: 'custom', message: 'Criterion and scenario links must be reciprocal.', path: ['criteria', criterionIndex, 'scenarioIds'] });
    });
  });
  contract.scenarios.forEach((scenario, scenarioIndex) => {
    for (const criterionId of scenario.criterionIds) {
      const criterion = criteria.get(criterionId);
      if (!criterion || !criterion.scenarioIds.includes(scenario.id) || !criterion.requiredLayers.includes(scenario.layer)) {
        ctx.addIssue({ code: 'custom', message: 'Scenario must reference an existing criterion that requires its layer.', path: ['scenarios', scenarioIndex, 'criterionIds'] });
      }
    }
  });
}

export const QAContractV1Schema = ContractContentSchema.extend({ schemaVersion: z.literal(1) })
  .strict().superRefine(validateContractRelations);

export const TaskCandidateSchema = z.object({
  id: z.string().min(1).max(160),
  source: SourceRefSchema,
  text: z.string().trim().min(1).max(4000),
  disposition: z.enum(['PROPOSED', 'ACCEPTED', 'REJECTED']),
  criterionId: z.string().min(1).max(120).optional(),
}).strict().superRefine((candidate, ctx) => {
  if (candidate.source.field !== 'System.Description') {
    ctx.addIssue({ code: 'custom', message: 'Task candidates must cite System.Description.', path: ['source', 'field'] });
  }
  if ((candidate.disposition === 'ACCEPTED') !== Boolean(candidate.criterionId)) {
    ctx.addIssue({ code: 'custom', message: 'Only an accepted candidate may link to a promoted criterion.', path: ['criterionId'] });
  }
});

export const CoverageGapSchema = z.object({
  id: z.string().min(1).max(160),
  code: z.literal('MISSING_REQUIREMENT_ACCEPTANCE_CRITERIA'),
  source: SourceRefSchema,
  message: z.string().trim().min(1).max(1000),
}).strict().superRefine((gap, ctx) => {
  if (gap.source.field !== 'Microsoft.VSTS.Common.AcceptanceCriteria') {
    ctx.addIssue({ code: 'custom', message: 'Missing Acceptance Criteria gaps must cite the Acceptance Criteria field.', path: ['source', 'field'] });
  }
});

export const CriterionProposalSchema = z.object({
  id: z.string().min(1).max(120), text: z.string().trim().min(1).max(4000),
  sourceRefs: z.array(SourceRefSchema).min(1).max(30),
  ambiguityNotes: z.array(z.string().trim().min(1).max(1000)).max(20),
  decision: z.enum(['PROPOSED', 'ACCEPTED', 'EDITED', 'REJECTED']),
  criterionId: z.string().min(1).max(120).optional(),
}).strict().superRefine((proposal, ctx) => {
  if (new Set(proposal.sourceRefs.map((ref) => `${ref.organization.toLocaleLowerCase('en-US')}:${ref.projectId}:${ref.workItemId}:${ref.revision}:${ref.field}:${ref.excerptHash}`)).size !== proposal.sourceRefs.length) {
    ctx.addIssue({ code: 'custom', message: 'Criterion proposal source references must be unique.', path: ['sourceRefs'] });
  }
  if ((proposal.decision === 'ACCEPTED' || proposal.decision === 'EDITED') !== Boolean(proposal.criterionId)) {
    ctx.addIssue({ code: 'custom', message: 'Accepted or edited proposals must link to a criterion.', path: ['criterionId'] });
  }
});

export const TaskPlanSchema = z.object({
  taskId: z.number().int().positive(), taskSource: SourceRefSchema,
  summary: z.string().trim().min(1).max(1000),
  criterionProposalIds: z.array(z.string().min(1).max(120)).max(100),
  verificationIntent: z.array(z.string().trim().min(1).max(1000)).min(1).max(30),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(1000)).max(20),
}).strict().superRefine((taskPlan, ctx) => {
  if (taskPlan.taskSource.workItemId !== taskPlan.taskId || !['System.Description', 'System.Title'].includes(taskPlan.taskSource.field)) {
    ctx.addIssue({ code: 'custom', message: 'Task plans must cite the matching Task Description or Title.', path: ['taskSource'] });
  }
  if (new Set(taskPlan.criterionProposalIds).size !== taskPlan.criterionProposalIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Task plan proposal links must be unique.', path: ['criterionProposalIds'] });
  }
});

export const RunSourceContextSchema = WorkItemSnapshotSchema.omit({ id: true }).extend({
  workItemId: z.number().int().positive(),
}).strict();

export const QAContractV2Schema = ContractContentSchema.extend({
  schemaVersion: z.literal(2),
  sourceContext: z.array(RunSourceContextSchema).max(200),
  taskCandidates: z.array(TaskCandidateSchema).max(500),
  coverageGaps: z.array(CoverageGapSchema).max(200),
}).strict().superRefine((contract, ctx) => {
  validateContractRelations(contract, ctx);
  if (new Set(contract.sourceContext.map(({ organization, projectId, workItemId }) => `${organization.toLocaleLowerCase('en-US')}:${projectId}:${workItemId}`)).size !== contract.sourceContext.length) {
    ctx.addIssue({ code: 'custom', message: 'Source context work items must be unique.', path: ['sourceContext'] });
  }
  if (new Set(contract.taskCandidates.map(({ id }) => id)).size !== contract.taskCandidates.length) {
    ctx.addIssue({ code: 'custom', message: 'Task candidate IDs must be unique.', path: ['taskCandidates'] });
  }
  if (new Set(contract.coverageGaps.map(({ id }) => id)).size !== contract.coverageGaps.length) {
    ctx.addIssue({ code: 'custom', message: 'Coverage gap IDs must be unique.', path: ['coverageGaps'] });
  }
  for (const candidate of contract.taskCandidates) {
    const source = contract.sourceContext.find(({ organization, projectId, workItemId, revision }) =>
      organization.toLocaleLowerCase('en-US') === candidate.source.organization.toLocaleLowerCase('en-US') &&
      projectId === candidate.source.projectId && workItemId === candidate.source.workItemId && revision === candidate.source.revision);
    if (!source || source.kind !== 'TASK' || !source.description) {
      ctx.addIssue({ code: 'custom', message: 'Task candidate must cite a queued Task Description in this contract.', path: ['taskCandidates'] });
    }
    if (candidate.disposition === 'ACCEPTED') {
      const criterion = contract.criteria.find(({ id }) => id === candidate.criterionId);
      if (!criterion || !('userAdded' in criterion.source) || JSON.stringify(criterion.source.derivedFrom) !== JSON.stringify(candidate.source)) {
        ctx.addIssue({ code: 'custom', message: 'Accepted Task candidate must be promoted to a user-added criterion that retains its source.', path: ['taskCandidates'] });
      }
    }
  }
  for (const gap of contract.coverageGaps) {
    const source = contract.sourceContext.find(({ organization, projectId, workItemId, revision, kind }) =>
      organization.toLocaleLowerCase('en-US') === gap.source.organization.toLocaleLowerCase('en-US') &&
      projectId === gap.source.projectId && workItemId === gap.source.workItemId && revision === gap.source.revision && kind === 'REQUIREMENT');
    if (!source || source.acceptanceCriteria?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'A missing-criteria coverage gap must cite a Requirement without Acceptance Criteria.', path: ['coverageGaps'] });
    }
  }
});

export const QAContractSchema = ContractContentSchema.extend({
  schemaVersion: z.literal(3),
  sourceContext: z.array(RunSourceContextSchema).max(200),
  taskCandidates: z.array(TaskCandidateSchema).max(500),
  coverageGaps: z.array(CoverageGapSchema).max(200),
  featureSummary: z.string().trim().min(1).max(4000).optional(),
  taskPlans: z.array(TaskPlanSchema).max(200),
  proposals: z.array(CriterionProposalSchema).max(500),
}).strict().superRefine((contract, ctx) => {
  validateContractRelations(contract, ctx);
  const contextKey = (ref: z.infer<typeof SourceRefSchema>) => `${ref.organization.toLocaleLowerCase('en-US')}:${ref.projectId}:${ref.workItemId}:${ref.revision}`;
  const sourceIsFrozen = (ref: z.infer<typeof SourceRefSchema>) => contract.sourceContext.some((source) =>
    `${source.organization.toLocaleLowerCase('en-US')}:${source.projectId}:${source.workItemId}:${source.revision}` === contextKey(ref));
  const proposals = new Map(contract.proposals.map((proposal) => [proposal.id, proposal]));
  if (proposals.size !== contract.proposals.length) ctx.addIssue({ code: 'custom', message: 'Criterion proposal IDs must be unique.', path: ['proposals'] });
  const taskPlans = new Map(contract.taskPlans.map((taskPlan) => [taskPlan.taskId, taskPlan]));
  if (taskPlans.size !== contract.taskPlans.length) ctx.addIssue({ code: 'custom', message: 'Each selected Task may have only one verification plan.', path: ['taskPlans'] });
  for (const proposal of contract.proposals) {
    if (proposal.sourceRefs.some((ref) => !sourceIsFrozen(ref))) {
      ctx.addIssue({ code: 'custom', message: 'Criterion proposals must refer only to frozen source items and revisions.', path: ['proposals'] });
    }
    if (proposal.criterionId) {
      const criterion = contract.criteria.find(({ id }) => id === proposal.criterionId);
      if (!criterion || !('agentProposed' in criterion.source) || criterion.source.proposalId !== proposal.id || criterion.source.decision !== proposal.decision || JSON.stringify(criterion.source.sourceRefs) !== JSON.stringify(proposal.sourceRefs)) {
        ctx.addIssue({ code: 'custom', message: 'Accepted proposal and criterion provenance must match exactly.', path: ['proposals'] });
      }
    }
  }
  for (const criterion of contract.criteria) {
    if (!('agentProposed' in criterion.source)) continue;
    const proposal = proposals.get(criterion.source.proposalId);
    if (!proposal || proposal.criterionId !== criterion.id || (proposal.decision !== 'ACCEPTED' && proposal.decision !== 'EDITED')) {
      ctx.addIssue({ code: 'custom', message: 'Agent-proposed criteria require a matching accepted proposal.', path: ['criteria'] });
    }
  }
  for (const taskPlan of contract.taskPlans) {
    const task = contract.sourceContext.find((source) => source.workItemId === taskPlan.taskId && source.kind === 'TASK' && contextKey(taskPlan.taskSource) === `${source.organization.toLocaleLowerCase('en-US')}:${source.projectId}:${source.workItemId}:${source.revision}`);
    if (!task || !sourceIsFrozen(taskPlan.taskSource)) {
      ctx.addIssue({ code: 'custom', message: 'Task verification plans must cite a selected Task snapshot.', path: ['taskPlans'] });
    }
    if (taskPlan.criterionProposalIds.some((id) => !proposals.get(id)?.sourceRefs.some((ref) => ref.workItemId === taskPlan.taskId))) {
      ctx.addIssue({ code: 'custom', message: 'Task plans may link only proposals informed by that Task.', path: ['taskPlans'] });
    }
  }
  for (const candidate of contract.taskCandidates) {
    const source = contract.sourceContext.find(({ organization, projectId, workItemId, revision }) =>
      organization.toLocaleLowerCase('en-US') === candidate.source.organization.toLocaleLowerCase('en-US') && projectId === candidate.source.projectId && workItemId === candidate.source.workItemId && revision === candidate.source.revision);
    if (!source || source.kind !== 'TASK' || !source.description) ctx.addIssue({ code: 'custom', message: 'Task candidates must cite a queued Task Description in this contract.', path: ['taskCandidates'] });
    if (candidate.disposition === 'ACCEPTED') {
      const criterion = contract.criteria.find(({ id }) => id === candidate.criterionId);
      if (!criterion || !('userAdded' in criterion.source) || JSON.stringify(criterion.source.derivedFrom) !== JSON.stringify(candidate.source)) ctx.addIssue({ code: 'custom', message: 'Accepted Task candidate must be user-added and retain its source.', path: ['taskCandidates'] });
    }
  }
  for (const gap of contract.coverageGaps) {
    const source = contract.sourceContext.find(({ organization, projectId, workItemId, revision, kind }) => organization.toLocaleLowerCase('en-US') === gap.source.organization.toLocaleLowerCase('en-US') && projectId === gap.source.projectId && workItemId === gap.source.workItemId && revision === gap.source.revision && kind === 'REQUIREMENT');
    if (!source || source.acceptanceCriteria?.trim()) ctx.addIssue({ code: 'custom', message: 'A missing-criteria coverage gap must cite a Requirement without Acceptance Criteria.', path: ['coverageGaps'] });
  }
});

export function upgradeQAContract(input: unknown): QAContract {
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 1) {
    const previous = QAContractV1Schema.parse(input);
    return upgradeV2({ ...previous, schemaVersion: 2, sourceContext: [], taskCandidates: [], coverageGaps: [] });
  }
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 2) return upgradeV2(QAContractV2Schema.parse(input));
  return QAContractSchema.parse(input);
}

function upgradeV2(previous: z.infer<typeof QAContractV2Schema>): QAContract {
  return QAContractSchema.parse({ ...previous, schemaVersion: 3, featureSummary: undefined, taskPlans: [], proposals: [] });
}

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type CriterionProposal = z.infer<typeof CriterionProposalSchema>;
export type TaskPlan = z.infer<typeof TaskPlanSchema>;
export type QAContract = z.infer<typeof QAContractSchema>;

export function validateReadyContract(input: unknown): QAContract {
  if (input && typeof input === 'object' && 'criteria' in input && Array.isArray(input.criteria) && input.criteria.length === 0) {
    throw new Error('A contract without criteria cannot enter READY.');
  }
  const contract = upgradeQAContract(input);
  if (!contract.criteria.length) throw new Error('A contract without criteria cannot enter READY.');
  if (!contract.approvedAt) throw new Error('The contract must be approved before it can enter READY.');
  if (contract.scenarios.some((scenario) => !scenario.approved)) throw new Error('Every scenario must be approved before the contract can enter READY.');
  return contract;
}

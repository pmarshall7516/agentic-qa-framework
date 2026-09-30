import { z } from 'zod';
import { WorkItemSnapshotSchema } from './work-item.js';

export const SourceRefSchema = z.object({
  organization: z.string().min(1), projectId: z.string().min(1), workItemId: z.number().int().positive(),
  revision: z.number().int().positive(), field: z.string().min(1), excerptHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export const CriterionSourceSchema = z.union([
  SourceRefSchema,
  z.object({ userAdded: z.literal(true), author: z.string().min(1).max(200), derivedFrom: SourceRefSchema.optional() }).strict(),
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

export const RunSourceContextSchema = WorkItemSnapshotSchema.omit({ id: true }).extend({
  workItemId: z.number().int().positive(),
}).strict();

export const QAContractSchema = ContractContentSchema.extend({
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

export function upgradeQAContract(input: unknown): QAContract {
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 1) {
    const previous = QAContractV1Schema.parse(input);
    return QAContractSchema.parse({ ...previous, schemaVersion: 2, sourceContext: [], taskCandidates: [], coverageGaps: [] });
  }
  return QAContractSchema.parse(input);
}

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
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

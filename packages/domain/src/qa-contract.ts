import { z } from 'zod';

export const SourceRefSchema = z.object({
  organization: z.string().min(1), projectId: z.string().min(1), workItemId: z.number().int().positive(),
  revision: z.number().int().positive(), field: z.string().min(1), excerptHash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
export const CriterionSourceSchema = z.union([
  SourceRefSchema,
  z.object({ userAdded: z.literal(true), author: z.string().min(1).max(200) }).strict(),
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

export const QAContractSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), revision: z.number().int().positive(),
  criteria: z.array(CriterionSchema), scenarios: z.array(ScenarioSchema),
  approvedAt: z.iso.datetime().optional(),
}).strict().superRefine((contract, ctx) => {
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
});

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type QAContract = z.infer<typeof QAContractSchema>;

export function validateReadyContract(input: unknown): QAContract {
  if (input && typeof input === 'object' && 'criteria' in input && Array.isArray(input.criteria) && input.criteria.length === 0) {
    throw new Error('A contract without criteria cannot enter READY.');
  }
  const contract = QAContractSchema.parse(input);
  if (!contract.criteria.length) throw new Error('A contract without criteria cannot enter READY.');
  if (!contract.approvedAt) throw new Error('The contract must be approved before it can enter READY.');
  if (contract.scenarios.some((scenario) => !scenario.approved)) throw new Error('Every scenario must be approved before the contract can enter READY.');
  return contract;
}

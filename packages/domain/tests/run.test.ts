import { describe, expect, it } from 'vitest';
import { QAContractSchema, upgradeQAContract, validateReadyContract } from '../src/qa-contract.js';
import { computeVerdict } from '../src/run.js';

const emptyFindings: any[] = [];
const result = (state: string): any => ({ criterionId: 'criterion-1', state, observationIds: [], missingEvidence: [], findingIds: [] });

describe('run verdict policy', () => {
  it('applies FAIL before BLOCKED before NEEDS_REVIEW before PASS', () => {
    expect(computeVerdict({ executionState: 'CANCELLED', criterionResults: [result('FAILED'), result('BLOCKED')], findings: emptyFindings })).toBe('FAIL');
    expect(computeVerdict({ executionState: 'BLOCKED', criterionResults: [result('UNVERIFIED'), result('BLOCKED')], findings: emptyFindings })).toBe('BLOCKED');
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [result('UNVERIFIED')], findings: emptyFindings })).toBe('NEEDS_REVIEW');
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [result('VERIFIED')], findings: emptyFindings })).toBe('PASS');
  });

  it('never passes empty criteria, cancelled runs, or unresolved findings', () => {
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [], findings: emptyFindings })).toBe('NEEDS_REVIEW');
    expect(computeVerdict({ executionState: 'CANCELLED', criterionResults: [result('VERIFIED')], findings: emptyFindings })).toBe('BLOCKED');
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [result('VERIFIED')], findings: [{ highRisk: true, unresolved: true }] as any })).toBe('NEEDS_REVIEW');
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [result('VERIFIED')], findings: [{ highRisk: false, unresolved: true }] as any })).toBe('NEEDS_REVIEW');
  });

  it('keeps unresolved Requirement source coverage at NEEDS_REVIEW without changing verdict precedence', () => {
    const missingStoryCriteria = [{ code: 'MISSING_REQUIREMENT_ACCEPTANCE_CRITERIA' as const, source: { workItemId: 17 } }];
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [result('VERIFIED')], findings: emptyFindings, coverageGaps: missingStoryCriteria })).toBe('NEEDS_REVIEW');
    expect(computeVerdict({ executionState: 'COMPLETED', criterionResults: [result('FAILED')], findings: emptyFindings, coverageGaps: missingStoryCriteria })).toBe('FAIL');
    expect(computeVerdict({ executionState: 'BLOCKED', criterionResults: [result('BLOCKED')], findings: emptyFindings, coverageGaps: missingStoryCriteria })).toBe('BLOCKED');
  });
});

describe('QA contract', () => {
  const contract = {
    schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', revision: 1,
    criteria: [{
      id: 'criterion-1', source: { organization: 'contoso', projectId: 'project', workItemId: 4, revision: 2, field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: 'a'.repeat(64) },
      expectedBehavior: 'Search results show the selected project.', requiredLayers: ['browser'], scenarioIds: ['scenario-1'], ambiguityNotes: [],
    }],
    scenarios: [{ id: 'scenario-1', criterionIds: ['criterion-1'], layer: 'browser', preconditions: [], steps: [{ action: 'expectVisible', role: 'heading', name: 'Search results' }], expectedObservations: ['The Search results heading is visible.'], risk: 'low', approved: true }],
    approvedAt: '2026-09-27T12:00:00.000Z',
  };

  it('validates reciprocal criterion and scenario layers', () => {
    expect(QAContractSchema.safeParse(upgradeQAContract(contract)).success).toBe(true);
    expect(() => upgradeQAContract({ ...contract, scenarios: [] })).toThrow();
  });

  it('does not enter READY without criteria or review approval', () => {
    expect(validateReadyContract(contract).criteria).toHaveLength(1);
    expect(() => validateReadyContract({ ...contract, criteria: [] })).toThrow('without criteria');
    expect(() => validateReadyContract({ ...contract, approvedAt: undefined })).toThrow('must be approved');
  });
});

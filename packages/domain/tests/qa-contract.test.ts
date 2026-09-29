import { describe, expect, it } from 'vitest';
import { QAContractSchema, upgradeQAContract } from '../src/qa-contract.js';

const storySource = {
  organization: 'contoso', projectId: 'project-1', workItemId: 41, revision: 3,
  field: 'Microsoft.VSTS.Common.AcceptanceCriteria', excerptHash: 'a'.repeat(64),
};
const taskDescriptionSource = {
  organization: 'contoso', projectId: 'project-1', workItemId: 42, revision: 5,
  field: 'System.Description', excerptHash: 'b'.repeat(64),
};

const contractV2 = {
  schemaVersion: 2,
  id: '11111111-1111-4111-8111-111111111111',
  revision: 1,
  criteria: [{
    id: 'criterion-1', source: storySource, expectedBehavior: 'The saved sheet appears.',
    requiredLayers: ['browser'], scenarioIds: ['scenario-1'], ambiguityNotes: [],
  }],
  scenarios: [{
    id: 'scenario-1', criterionIds: ['criterion-1'], layer: 'browser', preconditions: [],
    steps: [{ action: 'expectText', text: 'The saved sheet appears.' }],
    expectedObservations: ['The saved sheet appears.'], risk: 'low', approved: false,
  }],
  sourceContext: [{
    organization: 'contoso', projectId: 'project-1', projectName: 'Portal', workItemId: 41,
    revision: 3, type: 'User Story', kind: 'REQUIREMENT', title: 'Save a sheet', state: 'Active',
    acceptanceCriteria: 'The saved sheet appears.', url: 'https://dev.azure.com/contoso/project-1/_workitems/edit/41',
    retrievedAt: '2026-09-29T12:00:00.000Z',
  }, {
    organization: 'contoso', projectId: 'project-1', projectName: 'Portal', workItemId: 42,
    revision: 5, type: 'Task', kind: 'TASK', title: 'Save sheet API', state: 'Active',
    description: 'POST /sheets saves the selected data.', parentId: 41,
    url: 'https://dev.azure.com/contoso/project-1/_workitems/edit/42', retrievedAt: '2026-09-29T12:00:00.000Z',
  }],
  taskCandidates: [{ id: 'task-42-1-bbbbbbbbbb', source: taskDescriptionSource, text: 'POST /sheets saves the selected data.', disposition: 'PROPOSED' }],
  coverageGaps: [],
};

describe('QA Contract v2 source context', () => {
  it('accepts a task candidate with exact source provenance alongside independent Requirement criteria', () => {
    const parsed = QAContractSchema.parse(contractV2);

    expect(parsed.taskCandidates[0]).toMatchObject({
      source: { workItemId: 42, revision: 5, field: 'System.Description' },
      disposition: 'PROPOSED',
    });
    expect(parsed.criteria[0]?.source).toMatchObject({ workItemId: 41, field: 'Microsoft.VSTS.Common.AcceptanceCriteria' });
    expect(parsed.sourceContext.map(({ workItemId }) => workItemId)).toEqual([41, 42]);
  });

  it('reads a v1 saved contract as v2 without inventing past source context', () => {
    const legacy = {
      schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', revision: 1,
      criteria: [{
        id: 'criterion-1', source: storySource, expectedBehavior: 'The saved sheet appears.',
        requiredLayers: ['browser'], scenarioIds: ['scenario-1'], ambiguityNotes: [],
      }],
      scenarios: [{
        id: 'scenario-1', criterionIds: ['criterion-1'], layer: 'browser', preconditions: [],
        steps: [{ action: 'expectText', text: 'The saved sheet appears.' }],
        expectedObservations: ['The saved sheet appears.'], risk: 'low', approved: false,
      }],
    };
    const upgraded = upgradeQAContract(legacy);

    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.sourceContext).toEqual([]);
    expect(upgraded.taskCandidates).toEqual([]);
    expect(upgraded.coverageGaps).toEqual([]);
  });

  it('requires promoted Task-derived criteria to remain explicitly user-added and linked to the Task source', () => {
    const promoted = {
      ...contractV2,
      criteria: [{
        id: 'task-criterion', source: { userAdded: true, author: 'Reviewer', derivedFrom: taskDescriptionSource },
        expectedBehavior: 'POST /sheets saves the selected data.', requiredLayers: ['repo'],
        scenarioIds: ['repo-scenario'], ambiguityNotes: [],
      }],
      scenarios: [{
        id: 'repo-scenario', criterionIds: ['task-criterion'], layer: 'repo', preconditions: [], steps: [],
        expectedObservations: ['JUnit assertion verifies the saved sheet.'], risk: 'low', approved: false,
      }],
      taskCandidates: [{ ...contractV2.taskCandidates[0], disposition: 'ACCEPTED', criterionId: 'task-criterion' }],
      coverageGaps: [],
    };

    expect(QAContractSchema.safeParse(promoted).success).toBe(true);
    expect(QAContractSchema.safeParse({
      ...promoted,
      criteria: [{ ...promoted.criteria[0], source: taskDescriptionSource }],
    }).success).toBe(false);
  });

  it('rejects candidate acceptance without a reciprocal user-added criterion', () => {
    expect(QAContractSchema.safeParse({
      ...contractV2,
      taskCandidates: [{ ...contractV2.taskCandidates[0], disposition: 'ACCEPTED', criterionId: 'absent' }],
    }).success).toBe(false);
  });

  it('requires a source coverage gap to cite a source field and revision', () => {
    const missingAcceptanceCriteria = {
      ...contractV2,
      criteria: [],
      scenarios: [],
      sourceContext: [
        { ...contractV2.sourceContext[0], acceptanceCriteria: undefined },
        contractV2.sourceContext[1],
      ],
      taskCandidates: [contractV2.taskCandidates[0]],
      coverageGaps: [{ id: 'missing-ac-41', code: 'MISSING_REQUIREMENT_ACCEPTANCE_CRITERIA', source: storySource, message: 'Requirement #41 has no Acceptance Criteria.' }],
    };
    expect(QAContractSchema.safeParse({
      ...missingAcceptanceCriteria,
      coverageGaps: [{ ...missingAcceptanceCriteria.coverageGaps[0], source: { ...storySource, revision: 0 } }],
    }).success).toBe(false);
    expect(QAContractSchema.safeParse(missingAcceptanceCriteria).success).toBe(true);
  });
});

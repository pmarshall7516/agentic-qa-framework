import { describe, expect, it } from 'vitest';
import { normalizeWorkItem } from '../src/normalize.js';

const context = {
  organization: 'contoso',
  projectId: 'project-1',
  projectName: 'Portal',
  now: () => '2026-09-27T12:30:00.000Z',
};

describe('ADO work-item normalization', () => {
  it('preserves id and revision, maps process types and extracts parent relation', () => {
    const normalized = normalizeWorkItem(
      {
        id: 48,
        rev: 7,
        url: 'https://dev.azure.com/contoso/Portal/_apis/wit/workItems/48',
        fields: {
          'System.TeamProject': 'Portal',
          'System.WorkItemType': 'Product Backlog Item',
          'System.Title': 'Remember filters',
          'System.State': 'Active',
          'System.Description': '<p>Keep filters after returning.</p>',
          'Microsoft.VSTS.Common.AcceptanceCriteria': '<ul><li>Filters remain selected.</li></ul>',
        },
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: 'https://dev.azure.com/contoso/Portal/_apis/wit/workItems/40',
          },
        ],
      },
      context,
    );

    expect(normalized).toMatchObject({
      id: 48,
      revision: 7,
      kind: 'REQUIREMENT',
      parentId: 40,
      title: 'Remember filters',
      acceptanceCriteria: 'Filters remain selected.',
      retrievedAt: context.now(),
    });
  });

  it('classifies the Basic Issue type as a Requirement and maps custom types explicitly', () => {
    expect(
      normalizeWorkItem(
        { id: 3, rev: 1, fields: { 'System.WorkItemType': 'Issue' } },
        context,
      ).kind,
    ).toBe('REQUIREMENT');

    expect(
      normalizeWorkItem(
        { id: 4, rev: 2, fields: { 'System.WorkItemType': 'Feature Request' } },
        { ...context, customTypeMappings: { 'Feature Request': 'REQUIREMENT' } },
      ).kind,
    ).toBe('REQUIREMENT');
  });

  it('removes executable HTML and exposes missing source fields as empty values', () => {
    const normalized = normalizeWorkItem(
      {
        id: 8,
        rev: 1,
        fields: {
          'System.WorkItemType': 'Task',
          'System.Title': '<img src=x onerror=alert(1)>Verify output',
          'System.Description': '<p>Safe text</p><script>steal()</script>',
        },
      },
      context,
    );

    expect(normalized.title).toBe('Verify output');
    expect(normalized.description).toContain('Safe text');
    expect(normalized.description).not.toContain('steal()');
    expect(normalized.acceptanceCriteria).toBeUndefined();
    expect(normalized.state).toBe('');
  });

  it('rejects malformed source identity instead of inventing a revision', () => {
    expect(() => normalizeWorkItem({ id: 9, fields: {} }, context)).toThrow(
      'ADO work item is missing a valid source ID or revision',
    );
  });

  it('replaces foreign tracker URLs instead of retaining attacker-controlled links', () => {
    const normalized = normalizeWorkItem(
      { id: 42, rev: 3, url: 'https://attacker.example/steal', fields: {} },
      context,
    );
    expect(normalized.url).toBe('https://dev.azure.com/contoso/project-1/_workitems/edit/42');
  });
});

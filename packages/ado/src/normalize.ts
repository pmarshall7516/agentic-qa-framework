import sanitizeHtml from 'sanitize-html';
import { classifyWorkItemType, WorkItemSnapshotSchema, type WorkItemSnapshot, type WorkItemTypeMappings } from '@agentic-qa/domain/work-item';

const DESCRIPTION_FIELD = 'System.Description';
const ACCEPTANCE_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';
const TYPE_FIELD = 'System.WorkItemType';

interface RawRelation {
  rel?: unknown;
  url?: unknown;
}

export interface RawAdoWorkItem {
  id?: unknown;
  rev?: unknown;
  url?: unknown;
  fields?: Record<string, unknown>;
  relations?: RawRelation[];
}

export interface NormalizeContext {
  organization: string;
  projectId: string;
  projectName: string;
  now?: () => string;
  customTypeMappings?: WorkItemTypeMappings;
}

export function normalizeHtmlText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return sanitizeHtml(value.slice(0, 128_000), {
    allowedTags: [],
    allowedAttributes: {},
    disallowedTagsMode: 'discard',
  }).trim();
}

function relatedWorkItemId(relations: RawRelation[] | undefined, relationType: string): number | undefined {
  for (const relation of relations ?? []) {
    if (relation.rel !== relationType || typeof relation.url !== 'string') continue;
    const match = relation.url.match(/\/workItems\/(\d+)(?:\?.*)?$/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function workItemUrl(rawUrl: unknown, context: NormalizeContext, id: number): string {
  if (typeof rawUrl === 'string') {
    try {
      const parsed = new URL(rawUrl);
      const expectedOrg = context.organization.toLocaleLowerCase('en-US');
      const devAzurePathOrg = parsed.hostname === 'dev.azure.com'
        ? decodeURIComponent(parsed.pathname.split('/').filter(Boolean)[0] ?? '').toLocaleLowerCase('en-US')
        : '';
      const legacyOrgHost = parsed.hostname === `${expectedOrg}.visualstudio.com`;
      if (
        parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port &&
        parsed.search === '' && parsed.hash === '' &&
        (devAzurePathOrg === expectedOrg || legacyOrgHost)
      ) return parsed.toString();
    } catch {
      // Untrusted tracker URLs fall back to a URL built from normalized source identity.
    }
  }
  const organization = encodeURIComponent(context.organization);
  const project = encodeURIComponent(context.projectId);
  return `https://dev.azure.com/${organization}/${project}/_workitems/edit/${id}`;
}

export function normalizeWorkItem(
  input: RawAdoWorkItem,
  context: NormalizeContext,
): WorkItemSnapshot {
  if (
    !Number.isInteger(input.id) ||
    Number(input.id) < 1 ||
    !Number.isInteger(input.rev) ||
    Number(input.rev) < 1
  ) {
    throw new Error('ADO work item is missing a valid source ID or revision');
  }

  const id = Number(input.id);
  const fields = input.fields ?? {};
  const type = typeof fields[TYPE_FIELD] === 'string' ? fields[TYPE_FIELD].trim() : '';
  const description = normalizeHtmlText(fields[DESCRIPTION_FIELD]);
  const acceptanceCriteria = normalizeHtmlText(fields[ACCEPTANCE_FIELD]);

  return WorkItemSnapshotSchema.parse({
    organization: context.organization,
    projectId: context.projectId,
    projectName: context.projectName,
    id,
    revision: Number(input.rev),
    type,
    kind: classifyWorkItemType(type, context.customTypeMappings),
    title: normalizeHtmlText(fields['System.Title']) ?? '',
    state: normalizeHtmlText(fields['System.State']) ?? '',
    ...(description !== undefined ? { description } : {}),
    ...(acceptanceCriteria !== undefined ? { acceptanceCriteria } : {}),
    ...(relatedWorkItemId(input.relations, 'System.LinkTypes.Hierarchy-Reverse')
      ? {
          parentId: relatedWorkItemId(
            input.relations,
            'System.LinkTypes.Hierarchy-Reverse',
          ),
        }
      : {}),
    url: workItemUrl(input.url, context, id),
    retrievedAt: (context.now ?? (() => new Date().toISOString()))(),
  });
}

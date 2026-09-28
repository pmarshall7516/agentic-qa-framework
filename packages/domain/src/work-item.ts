import { z } from 'zod';

export const WorkItemKindSchema = z.enum(['REQUIREMENT', 'TASK', 'OTHER']);
export type WorkItemKind = z.infer<typeof WorkItemKindSchema>;

export const WorkItemSnapshotSchema = z
  .object({
    organization: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    projectName: z.string().trim().min(1),
    id: z.number().int().positive(),
    revision: z.number().int().positive(),
    type: z.string(),
    kind: WorkItemKindSchema,
    title: z.string(),
    state: z.string(),
    description: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    parentId: z.number().int().positive().optional(),
    url: z.url(),
    retrievedAt: z.iso.datetime(),
  })
  .strict();

export type WorkItemSnapshot = z.infer<typeof WorkItemSnapshotSchema>;

export type WorkItemTypeMappings = Record<string, WorkItemKind>;

const defaultTypeMappings: WorkItemTypeMappings = {
  'User Story': 'REQUIREMENT',
  'Product Backlog Item': 'REQUIREMENT',
  Issue: 'REQUIREMENT',
  Requirement: 'REQUIREMENT',
  Task: 'TASK',
};

export function classifyWorkItemType(
  type: string,
  customMappings: WorkItemTypeMappings = {},
): WorkItemKind {
  const lookup = new Map<string, WorkItemKind>();
  for (const [name, kind] of Object.entries({
    ...defaultTypeMappings,
    ...customMappings,
  })) {
    lookup.set(name.trim().toLocaleLowerCase('en-US'), kind);
  }
  return lookup.get(type.trim().toLocaleLowerCase('en-US')) ?? 'OTHER';
}

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const CommandSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  label: z.string().min(1).max(160),
  executable: z.enum(['node', 'npm', 'npx', 'dotnet']),
  arguments: z.array(z.string().max(500)).max(100),
  workingDirectory: z.string().max(500).default('.'),
  timeoutSeconds: z.number().int().positive().max(1800).default(600),
  network: z.enum(['none', 'approved-registries']).default('none'),
  resultFormat: z.enum(['junit', 'trx', 'none']).optional(),
  resultPaths: z.array(z.string().max(500)).max(30).default([]),
  scenarioMappings: z.array(z.object({ scenarioId: z.string().min(1).max(120), testCaseIds: z.array(z.string().min(1).max(400)).min(1).max(100) }).strict()).max(100).default([]),
}).strict().superRefine((command, ctx) => {
  for (const [index, value] of command.arguments.entries()) {
    if (/\$\{?\w+\}?|%\w+%|`|\$\(|[\r\n\0]/.test(value)) ctx.addIssue({ code: 'custom', path: ['arguments', index], message: 'Command arguments cannot use expansion or shell syntax.' });
  }
  if (command.network !== 'none') ctx.addIssue({ code: 'custom', path: ['network'], message: 'Registry network access is not available until an egress boundary is implemented.' });
  for (const [pathName, path] of [['workingDirectory', command.workingDirectory] as const, ...command.resultPaths.map((path) => ['resultPaths', path] as const)]) {
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || /\0/.test(path)) ctx.addIssue({ code: 'custom', path: [pathName], message: 'Command paths must stay inside the disposable snapshot.' });
  }
  if (['junit', 'trx'].includes(command.resultFormat ?? 'none') && !command.resultPaths.length) ctx.addIssue({ code: 'custom', path: ['resultPaths'], message: 'Structured test-result commands must declare at least one result path.' });
  if (command.scenarioMappings.length && !['junit', 'trx'].includes(command.resultFormat ?? 'none')) ctx.addIssue({ code: 'custom', path: ['scenarioMappings'], message: 'A repository scenario can be verified only by parsed JUnit or TRX assertions.' });
  const scenarioIds = command.scenarioMappings.map(({ scenarioId }) => scenarioId);
  const caseIds = command.scenarioMappings.flatMap(({ testCaseIds }) => testCaseIds);
  if (new Set(scenarioIds).size !== scenarioIds.length) ctx.addIssue({ code: 'custom', path: ['scenarioMappings'], message: 'Scenario mappings must be unique.' });
  if (new Set(caseIds).size !== caseIds.length) ctx.addIssue({ code: 'custom', path: ['scenarioMappings'], message: 'A JUnit testcase can map to only one repository scenario per command.' });
});

export const RepositoryConfigSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({ name: z.string().min(1).max(160) }).strict(),
  repository: z.object({ include: z.array(z.string().min(1).max(500)).min(1).max(100), exclude: z.array(z.string().max(500)).default([]) }).strict(),
  setup: z.array(CommandSchema).max(20).default([]),
  tests: z.array(CommandSchema).min(1).max(100),
  site: z.object({ baseUrl: z.url(), allowedOrigins: z.array(z.url()).max(10), authRedirectOrigins: z.array(z.url()).max(10).default([]), accountSecretRef: z.string().max(200).optional() }).strict().optional(),
  limits: z.object({ browserActions: z.number().int().positive().max(100), runSeconds: z.number().int().positive().max(1800), artifactMiB: z.number().int().positive().max(500) }).strict().default({ browserActions: 100, runSeconds: 1800, artifactMiB: 500 }),
}).strict().superRefine((config, ctx) => {
  const seen = new Set<string>();
  [...config.setup, ...config.tests].forEach((command, index) => {
    if (seen.has(command.id)) ctx.addIssue({ code: 'custom', path: ['commands', index, 'id'], message: `Duplicate command id: ${command.id}` });
    seen.add(command.id);
  });
  for (const pattern of [...config.repository.include, ...config.repository.exclude]) {
    if (pattern.startsWith('/') || pattern.includes('\\') || pattern.split('/').includes('..') || /\0/.test(pattern)) ctx.addIssue({ code: 'custom', path: ['repository'], message: `Repository patterns must be relative paths: ${pattern}` });
  }
  if (config.site) {
    const base = new URL(config.site.baseUrl);
    if (base.username || base.password || base.hash || base.search || (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) ctx.addIssue({ code: 'custom', path: ['site', 'baseUrl'], message: 'Site URL must use HTTPS or loopback HTTP and contain no credentials, query, or fragment.' });
    if (!config.site.allowedOrigins.includes(base.origin) || config.site.allowedOrigins.some((origin) => new URL(origin).origin !== origin)) ctx.addIssue({ code: 'custom', path: ['site', 'allowedOrigins'], message: 'Allowed origins must contain the exact site origin.' });
  }
});

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>;
export async function readRepositoryConfig(repositoryPath: string): Promise<{ config: RepositoryConfig; sha256: string }> {
  const raw = await readFile(join(repositoryPath, '.agentic-qa.yml'), 'utf8');
  const config = RepositoryConfigSchema.parse(parse(raw, { uniqueKeys: true }));
  return { config, sha256: createHash('sha256').update(raw).digest('hex') };
}

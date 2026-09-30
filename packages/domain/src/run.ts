import { z } from 'zod';
import { SourceRefSchema } from './qa-contract.js';

export const TargetKindSchema = z.enum(['repository', 'site', 'both']);
export const ExecutionStateSchema = z.enum(['COMPLETED', 'CANCELLED', 'INTERRUPTED', 'BLOCKED']);
export const VerdictSchema = z.enum(['PASS', 'FAIL', 'NEEDS_REVIEW', 'BLOCKED']);
export const ObservationSchema = z.object({
  id: z.string().uuid(), runId: z.string().uuid(), scenarioId: z.string().min(1),
  status: z.enum(['PASSED', 'FAILED', 'SKIPPED', 'ERROR']), worker: z.enum(['repo', 'browser']),
  startedAt: z.iso.datetime(), endedAt: z.iso.datetime(), assertion: z.string().max(4000),
  artifactIds: z.array(z.string().uuid()), sourceIdentity: z.string().max(500),
}).strict();
export const ArtifactSchema = z.object({
  id: z.string().uuid(), runId: z.string().uuid(), kind: z.enum(['trace', 'screenshot', 'log', 'test-result', 'network', 'report']),
  relativePath: z.string().min(1).max(1000).refine((value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..')),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i), bytes: z.number().int().positive(), redactionState: z.enum(['redacted', 'restricted']),
  scenarioId: z.string().min(1).max(120).optional(), stepId: z.string().min(1).max(200).optional(), sequence: z.number().int().positive().optional(),
}).strict();
export const FindingSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['PRODUCT_FAILURE', 'TEST_FAILURE', 'ENVIRONMENT_FAILURE', 'FLAKY_TEST', 'AMBIGUOUS_REQUIREMENT', 'INSUFFICIENT_EVIDENCE']),
  criterionId: z.string().min(1).optional(), observationIds: z.array(z.string().uuid()),
  rationale: z.string().min(1).max(4000), highRisk: z.boolean(), unresolved: z.boolean(),
  humanOverride: z.object({ author: z.string().min(1), reason: z.string().min(1), at: z.iso.datetime(), previousKind: z.string() }).strict().optional(),
}).strict();
export const CriterionResultSchema = z.object({
  criterionId: z.string().min(1), state: z.enum(['VERIFIED', 'FAILED', 'UNVERIFIED', 'BLOCKED']),
  observationIds: z.array(z.string().uuid()), missingEvidence: z.array(z.string()), findingIds: z.array(z.string().uuid()),
}).strict();
export const RunManifestSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().uuid(), startedAt: z.iso.datetime(),
  sources: z.array(SourceRefSchema), targetKind: TargetKindSchema, sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/i).optional(),
  repositorySource: z.object({ kind: z.enum(['local', 'ado-git']), repositoryId: z.string().max(200).optional(), refName: z.string().max(300).optional(), commit: z.string().regex(/^[a-f0-9]{40,64}$/i).optional() }).strict().optional(),
  localGitState: z.enum(['clean', 'dirty', 'not-a-git-repository', 'unavailable']).optional(),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(), siteBaseUrl: z.url().optional(),
  contractId: z.string().uuid(), contractRevision: z.number().int().positive(), configHash: z.string().regex(/^[a-f0-9]{64}$/i),
  toolVersions: z.record(z.string(), z.string()), providerId: z.enum(['openai', 'anthropic', 'openrouter']).optional(), modelId: z.string().max(200).optional(),
  limits: z.record(z.string(), z.number().nonnegative()), previousRunId: z.string().uuid().optional(),
}).strict();
export const QAReportSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().uuid(), executionState: ExecutionStateSchema,
  verdict: VerdictSchema, criterionResults: z.array(CriterionResultSchema), findingIds: z.array(z.string().uuid()),
  completedAt: z.iso.datetime(), explanation: z.string().min(1).max(8000),
}).strict();
export const RunProgressEventSchema = z.object({
  runId: z.string().uuid(), worker: z.enum(['orchestrator', 'repo', 'browser']),
  state: z.enum(['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']), stage: z.string().min(1).max(160),
  message: z.string().min(1).max(500), at: z.iso.datetime(),
}).strict();

export type Observation = z.infer<typeof ObservationSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type QAReport = z.infer<typeof QAReportSchema>;
export type RunProgressEvent = z.infer<typeof RunProgressEventSchema>;

export interface VerdictInput {
  executionState: z.infer<typeof ExecutionStateSchema>;
  criterionResults: readonly CriterionResult[];
  findings: readonly Finding[];
  coverageGaps?: readonly { code: string }[];
}

export function computeVerdict(input: VerdictInput): z.infer<typeof VerdictSchema> {
  if (input.criterionResults.some(({ state }) => state === 'FAILED')) return 'FAIL';
  if (input.executionState !== 'COMPLETED' || input.criterionResults.some(({ state }) => state === 'BLOCKED')) return 'BLOCKED';
  if (!input.criterionResults.length || input.criterionResults.some(({ state }) => state !== 'VERIFIED') ||
    input.findings.some(({ unresolved }) => unresolved) || input.coverageGaps?.length) return 'NEEDS_REVIEW';
  return 'PASS';
}

export function buildReport(input: Omit<QAReport, 'verdict'> & { findings: Finding[]; coverageGaps?: readonly { code: string }[] }): QAReport {
  const verdict = computeVerdict(input);
  const explanation = input.explanation.trim() || `Run verdict: ${verdict}.`;
  return QAReportSchema.parse({
    schemaVersion: input.schemaVersion,
    runId: input.runId,
    executionState: input.executionState,
    verdict,
    criterionResults: input.criterionResults,
    findingIds: input.findings.map(({ id }) => id),
    completedAt: input.completedAt,
    explanation,
  });
}

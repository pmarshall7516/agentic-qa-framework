# QA engine and evidence model

**Status:** proposed implementable contract for the first useful release.

## Principle

LLMs may interpret requirements, propose scenarios, inspect bounded context and critique sufficiency. They do not determine truth by assertion. Deterministic tools execute checks and collect observations. A deterministic policy computes verdicts from reviewed criteria, evidence and explicit unknowns. Playwright's own planner/generator/healer shows a similar plan-to-test workflow, but this system owns the ADO criterion mapping and verdict policy. [Playwright test agents](https://playwright.dev/docs/test-agents).

## Versioned data contracts

The following is a conceptual schema; fields are normative even if serialization changes.

```ts
type TargetKind = 'repository' | 'site' | 'both';
type CriterionState = 'VERIFIED' | 'FAILED' | 'UNVERIFIED' | 'BLOCKED';
type FindingKind = 'PRODUCT_FAILURE' | 'TEST_FAILURE' | 'ENVIRONMENT_FAILURE'
  | 'FLAKY_TEST' | 'AMBIGUOUS_REQUIREMENT' | 'INSUFFICIENT_EVIDENCE';
type Verdict = 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'BLOCKED';
type ExecutionState = 'COMPLETED' | 'CANCELLED' | 'INTERRUPTED' | 'BLOCKED';

interface SourceRef {
  organization: string; projectId: string; workItemId: number; revision: number;
  field: string; excerptHash: string;
}
interface Criterion {
  id: string; source: SourceRef | { userAdded: true; author: string };
  proposalProvenance?: { proposalId: string; sourceRefs: SourceRef[]; decision: 'accepted' | 'edited' };
  expectedBehavior: string; requiredLayers: Array<'repo' | 'browser'>;
  scenarioIds: string[]; ambiguityNotes: string[];
}
interface Scenario {
  id: string; criterionIds: string[]; layer: 'repo' | 'browser';
  preconditions: string[]; actions: string[]; expectedObservations: string[];
  risk: 'low' | 'medium' | 'high'; approved: boolean;
}
interface TaskCandidate { id: string; source: SourceRef; text: string;
  disposition: 'PROPOSED' | 'ACCEPTED' | 'REJECTED'; criterionId?: string; }
interface CriterionProposal { id: string; text: string; sourceRefs: SourceRef[];
  ambiguityNotes: string[]; decision: 'PROPOSED' | 'ACCEPTED' | 'EDITED' | 'REJECTED'; }
interface TaskPlan { taskId: number; summary: string; criterionProposalIds: string[];
  verificationIntent: string[]; scenarioIds: string[]; unresolvedQuestions: string[]; }
interface CoverageGap { id: string; code: 'MISSING_REQUIREMENT_ACCEPTANCE_CRITERIA';
  source: SourceRef; message: string; }
interface QAContract { schemaVersion: number; id: string; revision: number;
  sourceContext: WorkItemSnapshot[]; taskCandidates: TaskCandidate[];
  coverageGaps: CoverageGap[]; featureSummary?: string; taskPlans?: TaskPlan[];
  proposals?: CriterionProposal[]; criteria: Criterion[]; scenarios: Scenario[]; approvedAt: string; }
interface RunManifest { schemaVersion: number; runId: string; startedAt: string;
  sources: SourceRef[]; targetKind: TargetKind; sourceCommit?: string;
  sourceSnapshotHash?: string; siteBaseUrl?: string; contractId: string;
  contractRevision: number; configHash: string; toolVersions: Record<string,string>;
  modelProvider?: string; modelId?: string; savedModelId?: string;
  modelCredentialGeneration?: string; limits: Record<string,number>; }
interface Observation { id: string; runId: string; scenarioId: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERROR'; worker: string;
  startedAt: string; endedAt: string; assertion: string;
  artifactIds: string[]; sourceIdentity: string; }
interface Artifact { id: string; runId: string; kind: 'trace' | 'screenshot'
  | 'log' | 'test-result' | 'network' | 'report'; relativePath: string;
  sha256: string; bytes: number; redactionState: 'redacted' | 'restricted';
  scenarioId?: string; stepId?: string; sequence?: number; }
interface RunProgressEvent { runId: string; worker: 'orchestrator' | 'repo' | 'browser';
  state: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'; stage: string;
  message: string; at: string; }
interface CriterionResult { criterionId: string; state: CriterionState;
  observationIds: string[]; missingEvidence: string[]; findingIds: string[]; }
interface QAReport { schemaVersion: number; runId: string; executionState: ExecutionState;
  verdict: Verdict; criterionResults: CriterionResult[]; findingIds: string[];
  completedAt: string; }
```

IDs remain stable within a contract revision. Editing expected behavior or required layers creates a new revision. A rerun always creates a new `runId` and manifest. Raw work-item content is captured as a source snapshot, not silently refetched while a run is active.

Contract validation rejects a criterion with no required layer, no linked scenario for a required layer, or no expected observation. Every scenario must reference at least one existing criterion and a layer required by that criterion. A contract with no criteria can be saved for review but cannot enter `READY`.

## Planning rules

1. Read each selected Requirement/Story and its selected child Tasks together. Treat the Story as feature context for the behavior built by those Tasks, not as a work item to test independently. Plan selected standalone Tasks as their own scope.
2. Preserve ADO-sourced acceptance criteria as source context and retain field/revision provenance. The Orchestrator may propose additional feature-level criteria from selected work-item context, but these must be labeled agent-generated and link every source item/field/revision used. Never represent a proposal as ADO text or write it to ADO.
3. The user must accept or edit a proposal before it becomes a QA Contract criterion. Rejected proposals remain distinguishable. Conflicting source criteria and Task context require an explicit ambiguity note and user resolution.
4. Map every selected Task to concrete verification intent and the accepted feature criteria it supports. Task state or description alone is never evidence.
5. For each accepted criterion, propose positive, negative, boundary, authorization and persistence checks where relevant. Users can remove irrelevant checks; removals and rationale are recorded in the contract revision.
6. Set required evidence **before** execution. A UI criterion needs an observable UI assertion; an API/data promise may need a repository integration test, network assertion or another direct proof. A command exit code alone may support a scenario but cannot prove a specific criterion without an assertion mapping.
7. Show the feature summary, source links, per-Task verification map, scenarios and estimated actions/cost for review. Generated executable code is validated against the accepted contract and staged in a disposable workspace.

## State machine

```text
DRAFT → PREFLIGHT → READY → RUNNING → REVIEWING → COMPLETED
                  ↘ BLOCKED    ↘ CANCELLED / INTERRUPTED
```

All terminal states produce a partial or complete report. Interrupted runs are resumed only as a new run. Preflight failures record a reason but do not create fictional test observations.

## Execution in the first release

**Repository:** import a selected commit or approved dirty-tree snapshot into a disposable workspace. Read a versioned `.agentic-qa.yml` or GUI config with explicit allowed commands, working directory, timeouts, result-file paths and optional environment variables. Config and commands are untrusted input. Show exact commands before execution. Run in a constrained container, capture process tree exit, output, structured test results and changed-files manifest; never write to the user's source tree. If the container runtime is absent, repository checks are blocked while site checks may proceed.

**Site:** create a fresh Playwright browser context per scenario, navigate only to the approved base origin and approved auth redirects, use named test credentials referenced by account ID and field outside prompt/model context, assert expected user-visible states, and capture failure traces and screenshots. The model sees only selected account labels and field availability. The user may opt to run Chromium visibly; headless remains the default and all worker policies stay active. Keep network bodies off by default; an explicit setting can enable restricted capture. Playwright traces include DOM snapshots, actions, screenshots and network information and therefore may contain secrets. [Trace Viewer](https://playwright.dev/docs/trace-viewer).

An executable browser step may use `fillSecret` with an approved account UUID, a field enum (`username` or `password`), and an accessible role/name. It contains no secret literal. The main process resolves the reference only for the selected run and gives values to the browser worker in memory. Worker result text is scrubbed before it can become an Observation or report. Do not persist browser storage state between scenarios.

The current v1 Browser worker captures a restricted PNG after each completed approved step, stores scenario/step/sequence provenance with encrypted artifact metadata, and retains a restricted failure screenshot and trace when available. Screenshot capture failure does not convert a passing assertion into a failed observation. Progress records are encrypted with the run and show Orchestrator, Repository, Browser Scenario and Browser step activity; repository commands run in manifest order and Browser scenarios run in plan order under one shared deadline.

**Both:** a repository result and browser result can support the same criterion, but one cannot stand in for a required layer without a reviewed contract change. Record whether site build/deployment corresponds to source commit; if unknown, report a provenance gap and mark affected cross-layer claims `UNVERIFIED`.

## Failure classification and verdict

An observation `FAILED` is not automatically a product defect. The reviewer proposes a `FindingKind` with evidence and rationale. A confirmed product failure requires an assertion against the approved contract with sufficient reproducibility. A broken locator, test fixture or assertion is `TEST_FAILURE`; a 503 staging service or missing container is `ENVIRONMENT_FAILURE`; inconsistent retries are `FLAKY_TEST`; absent proof is `INSUFFICIENT_EVIDENCE`. Missing selected credentials, a detected sign-in/MFA challenge, access denial, unavailable target/browser, and policy blocks carry a structured diagnostic with stage, category, safe detail, concrete next action and retryability; they block the affected criterion rather than claiming a product defect. A failure that contradicts an approved expected behavior remains a failed observation with the expected and actual assertion stated. A human can override classification, with identity and reason recorded, but cannot erase underlying observations.

Criterion rules:

- `VERIFIED`: all required scenario/layer checks have passing direct observations, provenance is sufficient, and no unresolved contradictory observation exists.
- `FAILED`: a reviewed, reproducible product failure contradicts the criterion.
- `BLOCKED`: a required check could not execute because of auth, target, environment, policy or unavailable worker.
- `UNVERIFIED`: ambiguity, missing proof, test failure, flaky result, or an unapproved/omitted scenario leaves the criterion unresolved.

Run verdict precedence: **`FAIL`** if any criterion is `FAILED`; otherwise **`BLOCKED`** if execution is cancelled, interrupted or blocked, or any criterion is `BLOCKED`; otherwise **`NEEDS_REVIEW`** if any criterion is `UNVERIFIED`, any proposal/source conflict remains unresolved, or an unresolved high-risk finding exists; otherwise **`PASS`** if execution completed and every accepted criterion is `VERIFIED`. This keeps `executionState` separate from `verdict`: if a confirmed product failure was observed before cancellation, the report is `CANCELLED` with verdict `FAIL`; without a confirmed failure, a cancelled run is `BLOCKED`. Reports show all secondary issues even when a higher-precedence status wins. No accepted criterion, unresolved proposal/source gap, or zero executed assertions can produce `PASS`.

## Report contents

Header: verdict, selected ADO items/revisions, target/source identity, run time, tools/model, run limits, and whether provider context was transmitted. Body: criterion coverage matrix with direct observations and artifact identities; test summary by layer; findings with expected/actual/reproduction/classification; blocked and unverified list; regression risks; accessibility scope if run; redaction/export status. The desktop app can decrypt and save an artifact only after an explicit restricted-evidence warning and native save dialog; report exports contain evidence identities and assertions, never restricted artifact bytes. Include a plain-language explanation of **why** the verdict followed policy. Reports are immutable; corrections are appended as a review annotation with local author identity and reason, or recorded in a new run.

## Deterministic verification suite

Build fixtures for every verdict precedence combination, unknown deployment identity, stale contract, missing acceptance criteria, broken test, flaky retry, cancelled run, model hallucinated pass, and empty observation set. Verify serialization migration and artifact hash integrity. Compare sample report against a human-adjudicated pilot set before expanding autonomous behavior.

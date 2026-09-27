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

interface SourceRef {
  organization: string; projectId: string; workItemId: number; revision: number;
  field: string; excerptHash: string;
}
interface Criterion {
  id: string; source: SourceRef | { userAdded: true; author: string };
  expectedBehavior: string; requiredLayers: Array<'repo' | 'browser'>;
  scenarioIds: string[]; ambiguityNotes: string[];
}
interface Scenario {
  id: string; criterionIds: string[]; layer: 'repo' | 'browser';
  preconditions: string[]; actions: string[]; expectedObservations: string[];
  risk: 'low' | 'medium' | 'high'; approved: boolean;
}
interface QAContract { schemaVersion: number; id: string; revision: number;
  criteria: Criterion[]; scenarios: Scenario[]; approvedAt: string; }
interface RunManifest { schemaVersion: number; runId: string; startedAt: string;
  sources: SourceRef[]; targetKind: TargetKind; sourceCommit?: string;
  sourceSnapshotHash?: string; siteBaseUrl?: string; contractId: string;
  contractRevision: number; configHash: string; toolVersions: Record<string,string>;
  modelId?: string; limits: Record<string,number>; }
interface Observation { id: string; runId: string; scenarioId: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERROR'; worker: string;
  startedAt: string; endedAt: string; assertion: string;
  artifactIds: string[]; sourceIdentity: string; }
interface Artifact { id: string; runId: string; kind: 'trace' | 'screenshot'
  | 'log' | 'test-result' | 'network' | 'report'; relativePath: string;
  sha256: string; bytes: number; redactionState: 'redacted' | 'restricted'; }
interface CriterionResult { criterionId: string; state: CriterionState;
  observationIds: string[]; missingEvidence: string[]; findingIds: string[]; }
```

IDs remain stable within a contract revision. Editing expected behavior or required layers creates a new revision. A rerun always creates a new `runId` and manifest. Raw work-item content is captured as a source snapshot, not silently refetched while a run is active.

## Planning rules

1. Split source acceptance criteria into atomic, testable behaviors while retaining field/section provenance. If source wording is ambiguous, preserve the wording and ask for clarification in the plan; do not invent product requirements.
2. Child tasks and PR diff inform candidate regression scenarios. Mark their origin separately from actual acceptance criteria.
3. For each criterion, propose positive, negative, boundary, authorization and persistence checks where relevant. Users can remove irrelevant checks; removals and rationale are recorded in the contract revision.
4. Set required evidence **before** execution. A UI criterion needs an observable UI assertion; an API/data promise may need a repository integration test, network assertion or another direct proof. A command exit code alone may support a scenario but cannot prove a specific criterion without an assertion mapping.
5. Show the plan and estimated actions/cost for approval. Generated executable code is validated against the contract and staged in a disposable workspace.

## State machine

```text
DRAFT → PREFLIGHT → READY → RUNNING → REVIEWING → COMPLETED
                  ↘ BLOCKED    ↘ CANCELLED / INTERRUPTED
```

All terminal states produce a partial or complete report. Interrupted runs are resumed only as a new run. Preflight failures record a reason but do not create fictional test observations.

## Execution in the first release

**Repository:** import a selected commit or approved dirty-tree snapshot into a disposable workspace. Read a versioned `.agentic-qa.yml` or GUI config with explicit allowed commands, working directory, timeouts, result-file paths and optional environment variables. Config and commands are untrusted input. Show exact commands before execution. Run in a constrained container, capture process tree exit, output, structured test results and changed-files manifest; never write to the user's source tree. If the container runtime is absent, repository checks are blocked while site checks may proceed.

**Site:** create a fresh Playwright browser context per scenario, navigate only to the approved base origin and approved auth redirects, use test credentials kept outside prompt/model context, assert expected user-visible states, and capture failure traces and screenshots. Keep network bodies off by default; an explicit setting can enable restricted capture. Playwright traces include DOM snapshots, actions, screenshots and network information and therefore may contain secrets. [Trace Viewer](https://playwright.dev/docs/trace-viewer).

**Both:** a repository result and browser result can support the same criterion, but one cannot stand in for a required layer without a reviewed contract change. Record whether site build/deployment corresponds to source commit; if unknown, report a provenance gap and mark affected cross-layer claims `UNVERIFIED`.

## Failure classification and verdict

An observation `FAILED` is not automatically a product defect. The reviewer proposes a `FindingKind` with evidence and rationale. A confirmed product failure requires an assertion against the approved contract with sufficient reproducibility. A broken locator, test fixture or assertion is `TEST_FAILURE`; a 503 staging service or missing container is `ENVIRONMENT_FAILURE`; inconsistent retries are `FLAKY_TEST`; absent proof is `INSUFFICIENT_EVIDENCE`. A human can override classification, with identity and reason recorded, but cannot erase underlying observations.

Criterion rules:

- `VERIFIED`: all required scenario/layer checks have passing direct observations, provenance is sufficient, and no unresolved contradictory observation exists.
- `FAILED`: a reviewed, reproducible product failure contradicts the criterion.
- `BLOCKED`: a required check could not execute because of auth, target, environment, policy or unavailable worker.
- `UNVERIFIED`: ambiguity, missing proof, test failure, flaky result, or an unapproved/omitted scenario leaves the criterion unresolved.

Run verdict precedence: **`FAIL`** if any criterion is `FAILED`; otherwise **`BLOCKED`** if any criterion is `BLOCKED`; otherwise **`NEEDS_REVIEW`** if any criterion is `UNVERIFIED` or an unresolved high-risk finding exists; otherwise **`PASS`** if every approved criterion is `VERIFIED` and at least one criterion exists. A cancelled or interrupted run is `BLOCKED`. Reports show all secondary issues even when a higher-precedence status wins. No criterion, empty source requirement, or zero executed assertions cannot produce `PASS`.

## Report contents

Header: verdict, selected ADO items/revisions, target/source identity, run time, tools/model, run limits, and whether provider context was transmitted. Body: criterion coverage matrix with scenario and artifact links; test summary by layer; findings with expected/actual/reproduction/classification; blocked and unverified list; regression risks; accessibility scope if run; redaction/export status. Include a plain-language explanation of **why** the verdict followed policy. Reports are immutable; corrections are appended as a review annotation with local author identity and reason, or recorded in a new run.

## Deterministic verification suite

Build fixtures for every verdict precedence combination, unknown deployment identity, stale contract, missing acceptance criteria, broken test, flaky retry, cancelled run, model hallucinated pass, and empty observation set. Verify serialization migration and artifact hash integrity. Compare sample report against a human-adjudicated pilot set before expanding autonomous behavior.

# Agentic QA Run Planning and Evidence Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ADO-backed plan review, bounded Browser/Repository execution, progress, and criterion-linked evidence usable end to end on Windows and macOS.

**Architecture:** The main process refreshes and freezes normalized ADO source context, drafts a versioned QA Contract with task-derived candidates kept separate, validates target preflight, and persists an immutable Run Manifest. A deterministic coordinator emits typed progress and dispatches only approved work to fixed Browser and Repository workers; the renderer presents source, plan, progress and report evidence through the existing secure IPC boundary.

**Tech Stack:** TypeScript, Electron IPC, React, Zod, Vitest, SQLCipher-backed SQLite, Playwright, Docker repository worker, existing OpenAI Responses adapter behind exact-payload approval.

**Spec:** `docs/superpowers/specs/2026-09-29-run-planning-execution-workflow-design.md`

## Global Constraints

- Azure DevOps Services stays read-only. Tokens stay in the main process and never reach renderer, workers, model prompts, logs or reports.
- Renderer Node integration stays disabled, context isolation and sandboxing stay enabled, CSP stays restrictive, and every IPC operation/event is runtime schema-validated and sender-checked.
- Repository code runs only against a disposable immutable snapshot in the existing constrained, network-disabled worker; never mount host home or Docker socket.
- The default planner is local and deterministic. Provider requests require a per-request exact-payload preview and separate approval; Task Description is excluded unless individually included in that preview.
- Task-derived checks never masquerade as parent Requirement Acceptance Criteria. Unresolved missing Requirement criteria force `NEEDS_REVIEW`.
- Only configured executable/argument arrays and approved Browser steps execute. Do not add generated code, auto-healing, new runtimes, arbitrary network access or ADO writes.
- Run manifests, contracts, observations, reports and encrypted artifacts remain immutable/append-only under the existing verdict precedence.
- Do not commit or push. Keep work in the current `develop` checkout and preserve unrelated user changes.

---

## File map

- `packages/domain/src/qa-contract.ts`: QA Contract v2, source context, Task candidates, provenance and compatibility parser.
- `packages/domain/src/run.ts`: safe run error codes, progress events, step observations and source-coverage verdict input.
- `packages/ado/src/client.ts`, `packages/ado/src/normalize.ts`: bounded queued-item refresh with source revisions and normalized descriptions; maintain ADO error taxonomy.
- `packages/storage/src/database.ts`: migration for progress and compatibility reading of prior contract/report JSON.
- `packages/model-adapters/src/openai.ts`: optionally selected Task Description excerpts in exact preview and request.
- `apps/desktop/src/main/controller.ts`: queued-source refresh, plan generation/preflight, approved coordinator progress and worker scheduling.
- `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`: typed progress subscription and safe error envelope.
- `apps/desktop/src/renderer/` and `apps/desktop/src/main/controller.ts`: encrypted local Repository test-config builder/preview/export, without writing into the selected source tree.
- `packages/browser-worker/src/runner.ts`: step progress and ordered successful/failing screenshots.
- `packages/repo-worker/src/runner.ts`: preserve exact mapped JUnit result detail and cancellation behavior needed by progress/report view.
- `apps/desktop/src/renderer/App.tsx`, renderer feature components/CSS: source context, candidate review, actionable preflight, execution timeline and result evidence.
- `packages/*/tests/**`, `apps/desktop/tests/**`: behavior tests for changed boundaries.
- `docs/spec/01-product-requirements.md`, `docs/spec/02-azure-devops-integration.md`, `docs/spec/03-qa-engine.md`, `docs/spec/04-security-privacy.md`, `docs/spec/05-desktop-experience.md`, `docs/spec/06-delivery-plan.md`: reflect the approved design, implementation evidence and remaining release gates.

## Frozen contracts

Implement and test these before parallel ownership:

```ts
interface RunSourceContext {
  organization: string;
  projectId: string;
  projectName: string;
  workItemId: number;
  revision: number;
  type: string;
  kind: 'REQUIREMENT' | 'TASK' | 'OTHER';
  title: string;
  state: string;
  description?: string;
  acceptanceCriteria?: string;
  parentId?: number;
  url: string;
  retrievedAt: string;
}

interface TaskCandidate {
  id: string;
  source: SourceRef; // Task ID/revision, field System.Description, excerpt hash
  text: string;
  disposition: 'PROPOSED' | 'ACCEPTED' | 'REJECTED';
  criterionId?: string;
}

interface CoverageGap {
  code: 'MISSING_REQUIREMENT_ACCEPTANCE_CRITERIA';
  source: SourceRef;
  message: string;
}

interface RunProgressEvent {
  schemaVersion: 1;
  runId: string;
  worker: 'orchestrator' | 'repository' | 'browser';
  state: string;
  stage: string;
  message: string;
  timestamp: string;
}
```

`QAContract` version 2 stores immutable `sourceContext`, `taskCandidates`, and `coverageGaps` alongside criteria/scenarios. A promoted Task candidate becomes an explicitly `userAdded` criterion carrying `derivedFrom: SourceRef`; it remains Task-derived and cannot clear its parent Requirement's `coverageGap`. Existing v1 contracts stay readable through an explicit migration/parser and preserve their existing behavior. Progress is persisted in an ordered `run_progress` table and read through validated `getRunProgress` IPC polling. Repository and Browser lanes run serially (Repository first when both are selected) to preserve deterministic worker/resource use. Browser scenario output carries ordered step results with screenshot artifacts; persisted artifact metadata links those images to scenario steps.

## Task 1: Version and test immutable source/coverage contracts — implemented

**Files:**
- Modify `packages/domain/src/qa-contract.ts`
- Modify `packages/domain/src/run.ts`
- Modify `packages/domain/src/work-item.ts` only if a shared provenance helper belongs there
- Test `packages/domain/tests/qa-contract.test.ts` (create)
- Test `packages/domain/tests/run.test.ts`

- [x] Add strict v2 schemas and explicit v1-to-v2 compatibility parsing; do not silently infer source context for old runs.
- [x] Add verdict coverage input so a missing Requirement Acceptance Criteria gap yields `NEEDS_REVIEW` even when every user-added Task-derived criterion is verified; preserve `FAIL` then `BLOCKED` precedence.
- [x] Add behavior tests for v1 compatibility, source context, task candidate provenance, invalid links and unresolved Requirement gaps.
- [x] Run focused domain tests, `npm test`, and `npm run typecheck`.

## Task 2: Refresh ADO source context and separate ADO errors from local failures — implemented

**Files:**
- Modify `packages/ado/src/client.ts`, `packages/ado/src/normalize.ts`
- Test `packages/ado/tests/client.test.ts`, `packages/ado/tests/normalize.test.ts`
- Modify `apps/desktop/src/renderer/error-message.ts`
- Test `apps/desktop/tests/error-message.test.ts`

- [ ] Write failing tests for batched refresh of selected Requirement and Task IDs, updated revisions/descriptions, missing/deleted items, 401/403/429/network outcomes and HTML-to-text normalization.
- [ ] Run the focused ADO tests and verify each new source-refresh expectation fails before implementation.
- [ ] Add a read-only `refreshWorkItems` adapter operation that reuses validated organization/project scope, batches no more than 200 IDs, returns normalized snapshots and explicitly identifies missing IDs.
- [ ] Add safe typed main-process operation errors with codes `ADO_AUTH`, `ADO_PERMISSION`, `ADO_RATE_LIMIT`, `ADO_NETWORK`, `ADO_MALFORMED`, `SOURCE_MISSING`, `REPOSITORY_CONFIG`, `REPOSITORY_SNAPSHOT`, `SITE_PREFLIGHT`, and `WORKER_UNAVAILABLE`; serialize only code and safe message across IPC.
- [x] Change renderer error handling so only ADO request errors use ADO copy; generic Electron IPC wrappers preserve safe local operation errors.
- [x] Add controller/storage coverage for encrypted local repository config retrieval keyed by repository identity and validated config behavior.
- [x] Run focused tests, full test suite and typecheck.

Implementation note: source refresh is performed by the existing ADO client for the queued IDs; missing, permission, rate-limit and network conditions retain their originating safe error. The app does not add ADO write operations.

## Task 3: Refresh and persist plan sources; create Task candidates and actionable preflight — implemented

**Files:**
- Modify `apps/desktop/src/main/controller.ts`
- Modify `apps/desktop/src/shared/ipc.ts` if draft display needs context
- Modify `packages/storage/src/database.ts` only for persisted QA Contract v2 compatibility if required by Task 1
- Test `apps/desktop/tests/controller.test.ts`, `packages/storage/tests/database.test.ts`

- [ ] Write failing controller tests proving draft creation refreshes every queued source, persists current snapshots only after successful complete fetch, builds source context, splits Requirement criteria, derives labeled candidates from Task descriptions and records missing Acceptance Criteria gaps.
- [ ] Add tests proving ADO refresh failures are ADO-coded, invalid/missing `.agentic-qa.yml` is repository-coded, site-only drafts do not probe Docker, and unmapped repo scenarios cannot be shown as covered.
- [ ] Run those tests and verify the expected pre-implementation failures.
- [ ] Implement atomic queue refresh/freeze and planner extraction. Use exact field/revision references; do not convert Task candidates to criteria without explicit reviewer action.
- [ ] Preserve source context inside the immutable Contract/Run record; generate source refs/hashes for every retained description/Acceptance Criteria field.
- [ ] Convert repository path/config/snapshot exceptions into actionable safe codes at their originating boundary. Never catch them as ADO failures.
- [ ] Resolve repository config from an existing validated `.agentic-qa.yml` or an encrypted GUI-created config linked to the repository identity; never require a source-tree write. If no config exists, return `REPOSITORY_CONFIG` with the builder action.
- [ ] Verify approval rejects changed source revisions, changed candidates' provenance and changed config/Target; reruns still produce a new manifest.
- [x] Run controller/storage tests, full test suite and typecheck.

## Task 4: Model-assisted planning disclosure — deferred behind the existing provider gate

**Files:**
- Modify `packages/model-adapters/src/openai.ts`
- Modify `apps/desktop/src/main/controller.ts`, `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/ipc.ts`
- Test `packages/model-adapters/tests/openai.test.ts`, `apps/desktop/tests/controller.test.ts`, `apps/desktop/tests/ipc.test.ts`

This implementation keeps the deterministic planner as the safe fallback. The current product slice does not add Task-description model disclosure or a provider payload preview. If enabled in a later milestone, it needs an explicit per-source selection and exact payload review before a separately approved provider call; model output must remain scenario-only. This feature is not represented as completed.

## Task 5: Persist and deliver orchestration progress — implemented with polling

**Files:**
- Modify `packages/domain/src/run.ts`
- Modify `packages/storage/src/database.ts`
- Modify `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`
- Modify `apps/desktop/src/main/controller.ts`
- Test `packages/storage/tests/database.test.ts`, `apps/desktop/tests/ipc.test.ts`, `apps/desktop/tests/controller.test.ts`

- [x] Add storage schema version 5 `run_progress` rows with cascade deletion and empty history for existing runs.
- [x] Persist safe orchestration, worker-lane, scenario and step events, and expose them through sender-validated IPC polling.
- [x] Store progress without task text, command output, credentials or exception stacks; recover progress-only interrupted runs.
- [x] Exercise persistence/recovery/IPC behavior in storage/controller/IPC tests.
- [x] Run focused tests, full test suite and typecheck.

Implementation note: the chosen delivery contract is typed polling (`getRunProgress`), not a push subscription. Worker lanes execute serially to keep the run deterministic and within the existing one-worker resource model.

## Task 6: Capture ordered screenshots and structured Browser step results — implemented

**Files:**
- Modify `packages/browser-worker/src/runner.ts`
- Modify `packages/domain/src/run.ts` only to store typed step observations if needed
- Modify `apps/desktop/src/main/controller.ts` to encrypt/store artifacts and emit per-step progress
- Test `packages/browser-worker/tests/runner.test.ts`, `apps/desktop/tests/controller.test.ts`, `packages/storage/tests/artifacts.test.ts`

- [x] Return ordered Browser step status/timing and capture per-step screenshots within existing limits; capture failure evidence when available.
- [x] Encrypt screenshots before local persistence and keep scenario/step/order metadata; screenshot capture failure does not change assertion status.
- [x] Add Browser runner/controller/artifact coverage and run focused tests, full suite and typecheck.

Limitation: a local image preview is supported for retained PNG evidence. Raw trace export remains subject to restricted artifact handling.

## Task 7: Repository command and JUnit evidence — existing path retained; richer presentation deferred

**Files:**
- Modify `packages/repo-worker/src/runner.ts` only if mapped result summaries are not retained
- Modify `packages/domain/src/run.ts` only for structured result fields
- Modify `apps/desktop/src/main/controller.ts`
- Test `packages/repo-worker/tests/repo-worker.test.ts`, `apps/desktop/tests/controller.test.ts`

Repository execution and configured JUnit-to-scenario mapping continue to use the existing constrained worker and verdict path. This slice does not add per-command duration/suite-count panels or richer testcase identity summaries. The user can see run-level Repository progress and final findings. Do not claim per-command/JUnit visualization complete until implemented and verified.

## Task 8: Build review, progress, and evidence renderer screens — implemented for current contracts

**Files:**
- Modify `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/run.css`, `apps/desktop/src/renderer/results.css`, `apps/desktop/src/renderer/styles.css`
- Add a focused repository-config editor component under `apps/desktop/src/renderer/`
- Modify `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/main/controller.ts` for config preview/save/export API
- Create focused renderer components under `apps/desktop/src/renderer/` for source context, task candidates, run timeline and screenshot gallery where each can stay independently understandable
- Test `apps/desktop/tests/App.test.tsx`, `apps/desktop/tests/App.keyboard.test.tsx`, add focused component tests

- [x] Implement Requirement/Task source context, field/revision labels, Task-derived candidate disposition, missing Acceptance Criteria gaps and promotion provenance.
- [x] Add the app-local JSON repository configuration editor, encrypted save/load and actionable plan/setup config workflow. It edits validated config rather than discovering package scripts.
- [x] Render persisted progress by polling and show ordered successful Browser screenshot evidence in run history; preview decrypts in the main process and does not export plaintext.
- [x] Maintain keyboard flow, shared renderer layout and the existing restricted export confirmation.
- [x] Run UI review, keyboard tests, build and typecheck.

Limitations: exact provider-request review, per-command JUnit summary visualization, and native config export are not part of this implementation slice.

Follow-up usability fix: a repository config file is no longer required for the common npm path. When neither a saved config nor root `.agentic-qa.yml` exists, a root `package.json` `scripts.test` creates an automatic `npm test` diagnostic command. The command is shown in the plan and still runs inside the no-network worker. It does not install dependencies or claim Acceptance Criteria coverage without exact JUnit mappings. Advanced JSON remains optional. This fallback is covered for local and ADO Git sources.

## Task 9: Document changed contracts and verify delivery evidence — implemented; platform gates remain

**Files:**
- Update `docs/spec/01-product-requirements.md`
- Update `docs/spec/02-azure-devops-integration.md`
- Update `docs/spec/03-qa-engine.md`
- Update `docs/spec/04-security-privacy.md`
- Update `docs/spec/05-desktop-experience.md`
- Update `docs/spec/06-delivery-plan.md`
- Update `AGENTS.md` only if approved implementation decisions change security, data handling, permissions, platform support or package ownership

- [x] Update product, ADO, QA engine, security, desktop UX and repository-config specs for source provenance, local configuration, progress and screenshot evidence.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run app:ui-review`, `npm run package:win`, and `git diff --check`.
- [ ] Run the packaged app on Windows, verify login and planning against the user's live ADO org/project, and exercise the prepared Docker worker there.
- [ ] Finish M0 platform evidence and any remaining M1–M4 exit gates before calling this release-ready. M5 autonomous agent delegation/code generation remains outside the first useful release and requires its own gate.

# Agentic Work-Item Planning and Tested Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a reviewable, provenance-linked feature QA proposal from selected Stories and Tasks, and require a saved, reachable model for planning and every QA agent role.

**Architecture:** Keep provider credentials, model catalog writes, model reachability calls, and plan synthesis in the Electron main process. Persist saved model identity/test state in encrypted app settings; pass only validated catalog metadata through typed IPC. Add versioned QA planning proposal data to domain contracts, call the Orchestrator on the explicit plan-preparation action, then require user acceptance of proposed criteria/scenarios before final run approval. Freeze one tested provider/model identity through the run and disallow role overrides for this flow.

**Tech Stack:** Electron main process, React/TypeScript renderer, Zod domain schemas, existing provider adapters, SQLCipher-backed encrypted settings, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-agentic-work-item-planning-and-tested-models-design.md`

## Global Constraints

- Keep Azure DevOps integration read-only and preserve source IDs, fields, revisions and hashes.
- Treat ADO text and model output as hostile data; validate all structured output and source links.
- Keep provider credentials in the main process and encrypted settings; never return them through renderer IPC or send them to QA workers.
- Make no provider request until the user explicitly chooses **Prepare agentic plan** after seeing provider/model and work-item scope disclosure.
- Use the same saved, tested model for the Orchestrator, all QA specialists and the Reviewer; never silently substitute a model.
- Require a separate final approval before any repository/browser worker executes.
- Preserve verdict precedence and ensure model output alone cannot prove a criterion or produce `PASS`.
- Work in the current checkout, preserve pre-existing user changes, and do not commit/push/merge.
- Do not claim platform/package gates pass without fresh checks; this change does not close M0.

---

### Task 1: Reconcile requirements and implementation documentation

**Files:**
- Modify: `docs/spec/01-product-requirements.md`
- Modify: `docs/spec/03-qa-engine.md`
- Modify: `docs/spec/04-security-privacy.md`
- Modify: `docs/spec/05-desktop-experience.md`
- Modify: `docs/spec/06-delivery-plan.md`
- Modify: `docs/CONTEXT.md`
- Modify: `docs/superpowers/specs/2026-09-29-run-planning-execution-workflow-design.md` (add superseded-design link/notice without erasing history)
- Test: documentation consistency via targeted `rg` scan

**Interfaces:**
- Consumes: approved design spec and existing requirements FR-20, FR-21, FR-23.
- Produces: canonical source/agent-proposed criterion terminology, model catalog/test requirements, explicit plan-generation disclosure action, and milestone implementation sequence.

- [x] Update FR-20/FR-21 acceptance criteria for synthesis, saved models and reachability tests.
- [x] Define source criteria versus accepted agent-proposed criteria and provenance in the QA engine/glossary.
- [x] Replace the old plan-flow text that prohibits criteria proposals or promises no provider call before plan preparation; retain final worker approval.
- [x] Add delivery dependencies for contract/migration, catalog test, synthesis and renderer handoff.
- [x] Search source-of-truth docs for contradictory claims and resolve before changing behavior.

Run: `rg -n "No criterion was invented|does not invent|provider-free|No provider request occurs before approval|role overrides|Task-derived checks remain" docs/spec docs/CONTEXT.md docs/superpowers/specs`
Expected: only explicitly historical/superseded references remain, with a nearby link to the replacement behavior.

### Task 2: Define versioned proposal and saved-model domain contracts

**Files:**
- Modify: `packages/domain/src/qa-contract.ts`
- Modify: `packages/domain/src/agent.ts`
- Test: `packages/domain/tests/qa-contract.test.ts`
- Test: `packages/domain/tests/agent.test.ts`

**Interfaces:**
- Consumes: `WorkItemSnapshotSchema`, current `QAContractSchema` v2, `ProviderModelSchema` and existing `RunEnvelopeSchema`.
- Produces: a versioned planning proposal schema with feature summary, source-linked criterion proposals, per-Task verification entries, ambiguity/gap records and user decisions; a saved-model entry/test-state schema; migration from existing QA Contract v1/v2.

- [x] Write schema tests for valid and invalid multi-source proposal provenance, task mapping, decisions, model/provider identity and test status.
- [x] Write upgrade tests proving v1/v2 contracts remain readable with no fabricated proposal data.
- [x] Add strict Zod schemas with size/count caps and relation checks; represent model test timestamps and credential generation without storing credential material.
- [x] Ensure the final run envelope cannot contain a role model that differs from the selected model for new runs.
- [x] Run the domain tests and typecheck.

Run: `npm test -- --run packages/domain/tests/qa-contract.test.ts packages/domain/tests/agent.test.ts`
Expected: new assertions pass; existing migration and relation coverage remains green.

### Task 3: Persist model catalog and add main-process reachability testing

**Files:**
- Modify: `apps/desktop/src/main/controller.ts`
- Modify: `apps/desktop/src/main/index.ts` only if an adapter dependency must be injected
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/tests/controller.test.ts`
- Test: `apps/desktop/tests/ipc.test.ts`

**Interfaces:**
- Consumes: `SavedModelSchema`, existing `ModelProviderAdapter`, encrypted `QaStore.getSetting/setSetting` and current provider credential settings.
- Produces: `getSavedModels(): Promise<SavedModelView[]>`, `saveAgentModelSettings(...): Promise<SavedModelView[]>` that upserts by provider/model, `testSavedModel(modelKey): Promise<ModelTestResult>`, and `removeSavedModel(modelKey): Promise<SavedModelView[]>`.

- [x] Add controller tests proving save upserts without duplicates, credentials never appear in view, test calls use a fixed minimal prompt, provider/model failures return safe status, credential replacement invalidates that provider's test, and Claude checks disclose allowance use in UI metadata.
- [x] Implement encrypted local catalog settings, credential generation invalidation, provider adapter reachability requests and validated IPC/preload endpoints.
- [x] Do not include ADO, repository, URL, account or run instruction context in the reachability request.
- [x] Return only provider/model metadata, capability metadata and safe test status to the renderer.
- [x] Run targeted controller and IPC tests.

Run: `npm test -- --run apps/desktop/tests/controller.test.ts apps/desktop/tests/ipc.test.ts`
Expected: saved model lifecycle and sender/schema boundaries pass.

### Task 4: Synthesize work-item proposals before displaying Plan Review

**Files:**
- Modify: `packages/agent-orchestrator/src/index.ts`
- Modify: `packages/agent-orchestrator/src/prompts.ts`
- Modify: `apps/desktop/src/main/controller.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Test: `packages/agent-orchestrator/tests/orchestrator.test.ts`
- Test: `apps/desktop/tests/controller.test.ts`

**Interfaces:**
- Consumes: refreshed frozen work-item snapshots, selected tested model identity, target/run envelope, versioned proposal schema and existing provider adapter.
- Produces: `prepareAgenticDraft(...)` returning a `DraftPlan` with proposal, source context, task mapping, validated scenarios and disclosure metadata; `approvePlan(...)` accepts only reviewed/accepted proposals and freezes the chosen model.

- [x] Add behavior tests for Story-without-AC plus selected Tasks, existing Story AC context, per-Task verification plans, malformed/unlinked criteria and explicit prepare action.
- [x] Change the Orchestrator prompt/schema to summarize the combined feature, generate proposals, map Tasks to feature criteria and surface ambiguities. Prohibit testing the Story record or treating Task state as evidence.
- [x] Validate source references against refreshed snapshots and frozen revisions.
- [x] Move synthesis to the explicit plan-preparation path after selected model and scope disclosure. Keep worker dispatch behind final run approval.
- [x] Apply accepted proposal decisions to the final QA Contract without writing to ADO; preserve rejected/edited proposal provenance.
- [x] Enforce the selected provider/model for Orchestrator, specialists and Reviewer; reject role overrides/substitution.
- [x] Run orchestrator and controller tests.

Run: `npm test -- --run packages/agent-orchestrator/tests/orchestrator.test.ts apps/desktop/tests/controller.test.ts`
Expected: proposal synthesis and frozen-source/model checks pass, including error paths.

### Task 5: Add Settings model catalog and Run Setup selection/disclosure

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Test: `apps/desktop/tests/App.test.tsx`
- Test: `apps/desktop/tests/App.keyboard.test.tsx`

**Interfaces:**
- Consumes: typed saved-model list, test/remove operations, selected run-model state and current queue/target.
- Produces: keyboard-accessible saved-model rows with per-entry **Test model**/status/removal controls, a Run Setup selector limited to latest-success entries, and an explicit prepare action with exact provider/model/source scope disclosure.

- [x] Add renderer coverage for saved-model Test action/status and preventing preparation without explicit tested-model selection.
- [x] Add keyboard-flow coverage for plan preparation and proposal acceptance.
- [x] Render provider/model entries with capability and latest test state; never render credential values.
- [x] On Run Setup, require one successful saved model, show selected work-item IDs/revisions/fields and provider before prepare, and call plan preparation only on the explicit action.
- [x] Show Claude allowance notices where appropriate and preserve the existing additional context disclosure.
- [x] Run renderer tests and keyboard-flow tests.

Run: `npm test -- --run apps/desktop/tests/App.test.tsx apps/desktop/tests/App.keyboard.test.tsx`
Expected: saved/tested selection and keyboard behavior pass.

### Task 6: Present proposal review and freeze accepted QA scope

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Test: `apps/desktop/tests/App.test.tsx`
- Test: `apps/desktop/tests/controller.test.ts`

**Interfaces:**
- Consumes: validated `DraftPlan` proposal, frozen source snapshots, selected model and existing scenario editor.
- Produces: editable feature summary and criterion proposals with source links, per-Task verification map, accept/edit/reject decisions and final run approval bound to the proposal hash/model identity.

- [x] Add controller/renderer coverage for proposal provenance, source-grounded acceptance and stale model/source checks.
- [x] Add plan review sections and preserve scenario/action editing safeguards.
- [x] Make final approval unavailable while there are no accepted criteria, unresolved high-risk actions, missing required scenarios, or stale source/model test identity.
- [x] Ensure model output alone never marks observations/evidence complete or changes verdict policy.
- [x] Run renderer/controller tests.

Run: `npm test -- --run apps/desktop/tests/App.test.tsx apps/desktop/tests/controller.test.ts`
Expected: proposal review and final-approval constraints pass.

### Task 7: Full verification and source-of-truth reconciliation

**Files:**
- Modify: documentation files from Task 1 as needed
- Test: repository test/typecheck/build commands

**Interfaces:**
- Consumes: all implemented contracts and UI behavior.
- Produces: verified implementation evidence and handoff notes, including unresolved OS-specific gates.

- [x] Re-read the approved spec and this plan; trace acceptance criteria to implementation and behavior tests.
- [x] Run `npm test`, `npm run typecheck`, and `npm run build` and record exact results below.
- [ ] Check `git diff --check`, inspect complete diffs, and verify all pre-existing user changes remain intact.
- [ ] Review shared renderer behavior for Windows/macOS parity at the current test viewport. Do not claim both platform packages were built unless both commands ran successfully.
- [x] Report delivered requirement IDs, changed paths, tests/builds, security implications, platform coverage and any incomplete M0 gate. Do not commit or publish.

#### Verification results

- `npm run typecheck`: passed (exit 0).
- Targeted implementation suite (`npm test -- --run apps/desktop/tests/controller.test.ts apps/desktop/tests/App.test.tsx apps/desktop/tests/App.keyboard.test.tsx apps/desktop/tests/ipc.test.ts packages/domain/tests/qa-contract.test.ts packages/domain/tests/agent.test.ts packages/agent-orchestrator/tests/orchestrator.test.ts packages/storage/tests/database.test.ts`): passed, 8 files / 100 tests (exit 0).
- `npm run build`: passed (exit 0; desktop UI and main process).
- Full `npm test`: 29 files passed, 1 skipped; 223 tests passed, 3 skipped, 1 failed. The failure is the existing SprintWorkPicker copy assertion in `apps/desktop/tests/SprintWorkPicker.test.tsx`; it expects older no-sprints wording while the already-modified `apps/desktop/src/renderer/SprintWorkPicker.tsx` displays the newer copy. This implementation did not modify either file.
- `git diff --check`: passed (exit 0).
- Windows/macOS packaged builds and visual parity review remain outside this verification; M0 remains open.

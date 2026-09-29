# ADO Sprint Selection and Configuration Implementation Plan

> **For agentic workers:** Execute task-by-task in this isolated worktree. Maintain test-first changes, preserve the read-only ADO boundary, and do not commit without an explicit request.

**Goal:** Make ADO failures actionable and let users find active Requirements by sprint, choose child Tasks, queue selected work, and export saved profile settings.

**Architecture:** Keep all ADO calls, credentials, profile reads, and queue mutations in the desktop main process. Add small typed adapter/IPC contracts, then expose sprint browsing and bulk selection in the renderer. Export only the non-secret profile schema through a native save dialog.

**Tech Stack:** Electron, React, TypeScript, Zod, Vitest, Azure DevOps Services REST API.

**Spec:** `docs/superpowers/specs/2026-09-29-ado-sprint-selection-and-configuration-design.md`

## Global Constraints

- ADO is read-only; do not write work items, board settings, comments, or relations.
- Treat work-item text and all server payloads as untrusted; never surface raw ADO payloads or stack traces in ordinary UI errors.
- Keep bearer tokens in the main process only and exclude credentials from exported JSON.
- Requirements use canonical domain term `Requirement`; child Tasks provide context, not proof of parent criteria.
- Use schema-validated, typed IPC; never expose filesystem or shell APIs to the renderer.
- Keep all changes uncommitted.

---

### Task 1: Make ADO errors operation-aware and fix iteration response parsing

**Files:**
- Modify: `packages/ado/src/client.ts`
- Test: `packages/ado/tests/client.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- ADO errors retain `kind`, HTTP status, and a fixed operation label.
- Iteration methods return normalized `AdoIteration[]` from the documented `values` payload, while tolerating `value` fixtures.
- Renderer error formatting preserves app-authored operation-aware ADO errors and masks untrusted remote details.

- [x] Add failing tests for documented `values` payloads and for user-visible, app-authored ADO errors.
- [x] Run only those tests and confirm they fail for the expected reasons.
- [x] Implement fixed operation labels, iteration payload normalization, and safe renderer preservation.
- [x] Rerun targeted tests and the ADO adapter tests.

### Task 2: Add sprint iteration and active Requirement APIs

**Files:**
- Modify: `packages/ado/src/client.ts`
- Test: `packages/ado/tests/client.test.ts`

**Interfaces:**
- `listTeamIterations(token, organization, projectId, team): Promise<AdoIteration[]>` lists the team's iterations with ID, name, path, and timeframe dates when present.
- `getWorkItemTypeStates(token, organization, projectId, type): Promise<AdoWorkItemState[]>` returns state name and category.
- `search` accepts optional `iterationPath` and per-type state constraints and composes them as an escaped OR-of-ANDs WIQL clause.

- [x] Add failing adapter tests for all iteration response shapes, per-type category query generation, apostrophe escaping, and bounded paging.
- [x] Run the focused tests and confirm expected failures.
- [x] Implement iteration/state methods and active sprint WIQL construction.
- [x] Run all `packages/ado` tests.

### Task 3: Expose sprint browsing and bulk queue IPC

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/controller.ts`
- Test: `apps/desktop/tests/ipc.test.ts`
- Test: `apps/desktop/tests/controller.test.ts`

**Interfaces:**
- `listProfileIterations(): Promise<AdoIteration[]>` resolves the active profile in the main process.
- `searchActiveStories(iterationId: string): Promise<WorkItemSearchPage>` validates the iteration against the active profile's team before querying.
- `addQueueItems(workItemIds: number[]): Promise<DesktopState>` validates a bounded unique ID list, fetches snapshots once in batches, and adds them through the existing store contract.

- [x] Add failing IPC/controller tests for iteration/profile scope, invalid iteration IDs, batch size/ID validation, deduplication, and queue snapshots.
- [x] Run focused tests and confirm expected failures.
- [x] Implement controller and IPC methods using strict Zod schemas.
- [x] Run desktop IPC/controller tests and typecheck.

### Task 4: Build a clear sprint work picker

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/tests/App.test.tsx`
- Test: `apps/desktop/tests/App.keyboard.test.tsx`

**Interfaces:**
- The renderer calls only `listProfileIterations`, `searchActiveStories`, `getChildren`, and `addQueueItems` through the typed `DesktopApi`.
- A selected ID set spans Requirements and loaded child Tasks; queue mutation occurs only through the single bulk add IPC call.

- [x] Add failing interaction tests for selecting a sprint, loading active Requirements, expanding Tasks, selecting/deselecting items, bulk add, loading/errors/empty state, and keyboard operation.
- [x] Run focused renderer tests and confirm expected failures.
- [x] Implement a labeled searchable sprint combobox and compact nested selectable work list; retain the existing free-text search mode.
- [x] Add local filtering by ADO ID/title for loaded Stories and expanded child Tasks; document that Tasks must be expanded to include them in filtering.
- [x] Run renderer and keyboard tests. (The live macOS app was smoke-tested; a dedicated 800px viewport check was not run.)

### Task 5: Export saved profile configuration

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/controller.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/tests/controller.test.ts`
- Test: `apps/desktop/tests/ipc.test.ts`
- Test: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- `exportAdoProfilesConfig(): Promise<boolean>` serializes settings in the existing `{ schemaVersion: 1, profiles: [...] }` format; the main process owns the save dialog and file write.
- Export profiles include no token, API key, cached comment, or work-item title/text.

- [x] Add failing tests for the exact profile fields, cancellation, empty settings, secret exclusion, and IPC sender/schema validation.
- [x] Run focused tests and confirm expected failures.
- [x] Implement native save dialog, private file permissions, and Settings action.
- [x] Run desktop tests and inspect the exported config output.

### Task 6: Verify app flow and resolve suite failures

**Files:**
- Modify only relevant failing tests/implementation paths found by the verification loop.

- [x] Run the full `npm test` suite; investigate and fix the stale JUnit evidence-budget boundary fixture/guard.
- [x] Run `npm run typecheck`, `npm run build`, and `git diff --check`.
- [x] Launch the desktop app and verify signed-in profile setup, live ADO sprint browse, child Task loading, exact-ID search, and config export without exposing tokens.
- [x] Export actual saved profile values through the app's local settings flow; do not substitute example values.
- [ ] Windows packaging and an 800px viewport check were not run on this macOS host.

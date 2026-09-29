# Dark Workbench UI Implementation Plan

> **For agentic workers:** Execute inline in the existing repository as requested. Do not create a worktree or commit. Follow each task and its verification before moving on.

**Goal:** Redesign every desktop screen as a polished, accessible, VS Code-inspired dark workbench while preserving current product behavior.

**Architecture:** Keep the existing React renderer and typed `DesktopApi` contract. Consolidate renderer styling into shared dark tokens and screen-level styles, make only focused JSX adjustments for hierarchy and accessibility, and add a fixture-backed Playwright page that exercises the real `App` component without calling ADO or launching QA workers.

**Tech Stack:** Electron, React 19, TypeScript, Vite, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-dark-workbench-ui-design.md`

## Global Constraints

- The first-run action is **Sign in with Azure DevOps**.
- Azure DevOps Services is the only first-release work tracker. The integration is read-only.
- At 800px, avoid horizontal page scrolling on first-run, organization/project, work-item and queue screens.
- Renderer code is untrusted relative to the main process. Keep Node integration disabled, context isolation and renderer sandboxing enabled, CSP restrictive, navigation constrained, IPC typed/schema-validated, and sender origin checked.
- Do not call ADO write APIs, create comments/bugs, change PRs, trigger deployments or publish user data in the first release.
- Preserve current IPC calls, persistence formats, account/profile switching, plan approval, run history, and verdict policy.
- No new runtime dependencies, worktree, commit, push, packaging, or real ADO/QA actions.

---

### Task 1: Add a local Playwright UI review harness

**Files:**
- Create: `apps/desktop/ui-review.html`
- Create: `apps/desktop/src/renderer/ui-review.tsx`
- Create: `apps/desktop/src/renderer/ui-review-api.ts`
- Create: `apps/desktop/scripts/ui-review.mjs`
- Modify: `package.json`

**Interfaces:** The review entry imports the production `App` and passes a fixture-backed `DesktopApi` plus `DesktopState`; the API implementation returns only local fixture values. The Playwright script serves Vite on loopback, opens Chromium at 1280px and 800px, records screenshots, checks console errors and overflow, and exercises screens without external services.

- [x] Define a deterministic fixture with one account, two organizations/projects, one Requirement with a child Task, a QA Queue entry, an approved-run manifest, and a report.
- [x] Implement every `DesktopApi` method reachable from tested UI paths with local data; make `startRun` return a canned result and make no network request.
- [x] Provide a connected workspace scenario and a first-run scenario selected by a local query parameter.
- [x] Add `npm run app:ui-review` to start the Vite fixture and Playwright loop.
- [x] Run the script before visual changes and save screenshots under an ignored temporary directory.

### Task 2: Establish the dark workbench shell and shared visual tokens

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` shell and shared message/header markup
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/reports.css` shared report selectors if needed
- Modify: `apps/desktop/tests/App.test.tsx`
- Modify: `apps/desktop/tests/App.keyboard.test.tsx` only if accessible names change

**Interfaces:** Preserve `App({ api, initialState })`, `DesktopApi`, and all navigation screen IDs. Define CSS custom properties for background, sidebar, panel, border, primary/muted text, accent, semantic statuses, spacing, radius, and focus ring in `:root`.

- [x] Add renderer assertions for the shared navigation landmark, active page, visible organization/project context, alert/status roles, and first-run copy.
- [x] Replace the light page shell with layered charcoal surfaces, readable contrast, one blue accent, and visible keyboard focus.
- [x] Give the navigation rail consistent active/hover/focus states and an uncluttered local-storage footer.
- [x] Align the top context bar and page heading rhythm across all non-first-run screens; remove contradictory numbered-step labels from primary navigation screens.
- [x] Run `npx vitest run apps/desktop/tests/App.test.tsx apps/desktop/tests/App.keyboard.test.tsx`.

### Task 3: Rework onboarding, work search, and Queue layouts

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` connection, project, work-item, and Queue screen markup
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/results.css`
- Modify: `apps/desktop/tests/App.keyboard.test.tsx`

**Interfaces:** Keep existing screen transitions and callbacks (`signIn`, `connectOrganization`, `selectProject`, `search`, `toggleChildren`, and queue mutations). Keep errors and notices in the existing `role="alert"` and `role="status"` channels.

- [x] Make first-run sign-in and organization/project setup read as guided steps with clear account context, concise read-only disclosure, and useful empty/loading states.
- [x] Group search, filters, and optional profile loading into a compact responsive toolbar; keep result title and metadata prominent and criteria/task detail secondary.
- [x] Make the Queue header summarize selected item count and make Start QA the main action; improve project grouping, source freshness, and empty-state guidance.
- [x] Ensure long project names, IDs, acceptance criteria, and button labels wrap or truncate without clipping at 800px.
- [x] Extend keyboard-flow coverage for organization selection, work-item search, child Tasks, and queue entry.
- [x] Run focused renderer tests and the Playwright flows for these screens.

### Task 4: Rework run setup, plan review, run history, and Settings

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` run setup, plan, history/report, and Settings markup
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/run.css`
- Modify: `apps/desktop/src/renderer/results.css`
- Modify: `apps/desktop/src/renderer/reports.css`
- Modify: `apps/desktop/tests/App.keyboard.test.tsx`

**Interfaces:** Keep target configuration, QA contract editing, model disclosure approval, plan approval, run start/cancel, report review, exports, profile management, and provider settings on their existing typed IPC calls.

- [x] Arrange target selection and preflight into a clear run setup sequence; distinguish repository and browser targets without changing their validation.
- [x] Structure plan review around work scope, acceptance-criteria coverage, required layers, scenarios, permissions, and approval. Keep Tasks as context rather than proof of parent criteria.
- [x] Style run history and report detail for execution state, verdict, coverage, direct observations, findings, evidence, review controls, and exports.
- [x] Divide Settings into account, run-profile, organization, and optional AI sections; use stacked or balanced fields that remain legible at 800px and never clip IDs or values.
- [x] Give loading, disconnected, validation, success, and error states clear dark-theme treatments; use concise actionable renderer messages when the error class is known.
- [x] Run focused renderer tests and the Playwright flows for plan, history, reports, and Settings.

### Task 5: Run the full Playwright visual and interaction review

**Files:**
- Modify: any renderer files with issues revealed by the review
- Modify: `apps/desktop/src/renderer/ui-review-api.ts` only if fixture coverage is missing
- Modify: `apps/desktop/scripts/ui-review.mjs` only if assertions are incomplete

**Interfaces:** The Playwright script continues to run against the local fixture page and the production `App`; no real account, ADO API, local credentials, or QA worker is used.

- [x] Exercise onboarding, organization/project setup, work search, Task expansion, queue additions, run setup, plan approval affordance, run history/detail, Settings, and primary keyboard paths.
- [x] Capture the same key screens at 800px and 1280px, inspect screenshots, and assert there is no horizontal overflow or clipped field content.
- [x] Fix each issue found, rerun the affected flow, then rerun the complete UI review.
- [x] Run `npm run typecheck`, `npm run app:build`, focused renderer tests, `git diff --check`, and `npm run app:ui-review`.
- [x] Report platform/build limitations and remaining UI gaps; do not launch a real QA run.

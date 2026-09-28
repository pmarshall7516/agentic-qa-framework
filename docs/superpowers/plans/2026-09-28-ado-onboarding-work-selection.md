# Azure DevOps Onboarding and Work Selection Implementation Plan

> **For agentic workers:** Execute this plan inline, task by task. Preserve existing user changes and do not commit unless explicitly requested.

**Goal:** Replace manual per-user Entra app setup with ADO-branded sign-in, support account-scoped organization choices, and simplify Story/Task selection and desktop navigation.

**Architecture:** Keep Microsoft Entra delegated authorization-code PKCE as the identity protocol, with a public client ID embedded in the main-process bundle at build time. Add read-only ADO organization discovery and validation, store organization/project selection per account, and retain the existing normalized work-item and local queue contracts. Reorganize the renderer around Work items, QA Queue, Runs and Settings without changing run/verdict behavior.

**Tech Stack:** Electron, React 19, TypeScript, MSAL Node, Azure DevOps REST API 7.1, SQLCipher-backed SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-ado-onboarding-work-selection-design.md`

## Global Constraints

- Azure DevOps Services is the only first-release tracker and integration stays read-only.
- Use Entra delegated sign-in with PKCE; never ship a client secret or certificate.
- Keep token acquisition in the main process and encrypted MSAL cache persistence through Electron `safeStorage`.
- Restrict renderer access to typed, schema-validated IPC and never expose credentials or general filesystem/shell APIs.
- Validate organization names/URLs and use only approved Azure DevOps hosts.
- A `Task` informs QA scope but does not prove its parent `Requirement` acceptance criteria.
- Preserve local queue identity by organization, project and work-item ID; retain source revision.
- Keep all existing QA run, report, privacy and verdict behavior available.
- Do not commit, push, publish or merge.

---

### Task 1: Update source-of-truth product and integration docs

**Files:**
- Modify: `docs/spec/01-product-requirements.md`
- Modify: `docs/spec/02-azure-devops-integration.md`
- Modify: `docs/spec/04-security-privacy.md`
- Modify: `docs/spec/05-desktop-experience.md`
- Modify: `docs/00-agentic-qa-system-architecture.md`
- Modify: `docs/entra-registration.md`
- Modify: `docs/spec/06-delivery-plan.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: approved design spec and existing FR-01 through FR-04, NFR-08, IPC and domain contracts.
- Produces: authoritative docs requiring an app-provided public client ID, organization discovery/addition/saved choices, queue-only Story/Task selection, and simplified accessible navigation.

- [ ] Update FR-01 to say the distributed app supplies a public client ID and the first-run button is **Sign in with Azure DevOps**; retain Entra system-browser PKCE and explicit account support limits.
- [ ] Update FR-02 to cover discovering, adding, validating, remembering and switching organizations per account.
- [ ] Update FR-03/FR-04 and critical scenarios to cover expandable child Tasks and adding the requirement, selected Tasks or both to a local-only queue.
- [ ] Update ADO identity/integration docs with the Accounts List endpoint and `vso.profile` requirement; keep strict input validation and read-only scope.
- [ ] Update security docs to classify the bundled client ID as public configuration, not a secret; retain no-secret and token isolation rules.
- [ ] Replace desktop navigation/onboarding requirements with the approved four primary areas and accessible 800px layout target.
- [ ] Update architecture, registration and M0/M1 delivery docs to assign public-client registration/build configuration and add organization discovery validation to the release gate.
- [ ] Re-read changed paragraphs and search for contradictory user-entered client-ID directions.

### Task 2: Add build-time public-client configuration and controller contract

**Files:**
- Create: `apps/desktop/src/main/public-config.ts`
- Create: `apps/desktop/scripts/build-main.mjs`
- Create: `apps/desktop/scripts/package-desktop.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/controller.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Test: `apps/desktop/tests/controller.test.ts`
- Test: `apps/desktop/tests/ipc.test.ts`

**Interfaces:**
- Consumes: `AGENTIC_QA_ENTRA_CLIENT_ID` build environment variable, validated as a UUID.
- Produces: main-process `PUBLIC_ENTRA_CLIENT_ID`; `DesktopState.clientIdConfigured`; no renderer-visible client ID and no `saveClientId` method/channel.

- [ ] Add a failing controller test that sign-in with no configured public client ID returns a clear app-configuration error before calling the auth factory.
- [ ] Run `npm test -- apps/desktop/tests/controller.test.ts -t "requires configured public client"` and confirm the expected failure.
- [ ] Build main/preload bundles with esbuild's JS API; embed only the validated public ID into the main bundle and use an empty value for unconfigured development builds.
- [ ] Add a package script that refuses Windows/macOS packaging unless `AGENTIC_QA_ENTRA_CLIENT_ID` is present and valid; document that this ID is public and no secret is required.
- [ ] Inject the build constant into `DesktopController`; remove persisted client-ID loading/saving and the renderer IPC save-client-ID surface.
- [ ] Keep `clientIdConfigured` as a boolean and ensure `signIn()` reports missing app configuration before any interactive operation.
- [ ] Update controller and IPC tests for removed save-client-ID channel and untrusted-sender checks.
- [ ] Run the focused controller and IPC tests.

### Task 3: Discover and save organizations per signed-in account

**Files:**
- Modify: `packages/ado/src/client.ts`
- Modify: `packages/ado/tests/client.test.ts`
- Modify: `apps/desktop/src/main/controller.ts`
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`
- Test: `apps/desktop/tests/controller.test.ts`
- Test: `apps/desktop/tests/ipc.test.ts`

**Interfaces:**
- Produces: `AdoOrganization { id: string; name: string }` and `AdoClient.listOrganizations(accessToken: string, memberId: string): Promise<AdoOrganization[]>`.
- Produces: `DesktopState.savedOrganizations: string[]`; `DesktopApi.listOrganizations(): Promise<AdoOrganization[]>`; existing `selectOrganization(nameOrUrl)` validates access with `listProjects` before saving and selecting.
- Setting keys are account-scoped (`ado.organizations.<account-id>`, `ado.organization.<account-id>`, `ado.project.<account-id>`); legacy global selection is migrated on first signed-in state read.

- [ ] Add failing ADO client tests for Accounts List URL, member ID encoding, organization normalization and malformed response handling.
- [ ] Run `npm test -- packages/ado/tests/client.test.ts -t "lists organizations"` and confirm the missing-method failure.
- [ ] Implement `GET https://app.vssps.visualstudio.com/_apis/accounts?memberId={memberId}&api-version=7.1`; accept only account records with string ID/name and normalize the account name through `resolveOrganization`.
- [ ] Add controller tests proving organizations are listed for the selected account; selecting an inaccessible organization does not persist it; valid organizations persist without duplicates and remain separated across accounts.
- [ ] Implement account-scoped organization and project settings using the existing generic encrypted `QaStore` settings API. Migrate legacy `ado.organization`/`ado.project` values for the currently selected account once, then clear the legacy keys.
- [ ] Make organization selection call the existing project-list endpoint before saving; preserve the current error mapping and do not accept an arbitrary host.
- [ ] Add typed IPC/preload methods for organization discovery, schemas and sender validation.
- [ ] Run ADO client, controller and IPC tests.

### Task 4: Replace connection/project/work-item navigation and first-run UI

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/tests/App.test.tsx`
- Test: `apps/desktop/tests/App.keyboard.test.tsx`

**Interfaces:**
- Consumes: configured-client boolean, account-scoped `savedOrganizations`, `listOrganizations`, validated `selectOrganization`, existing project/work-item/queue APIs.
- Produces: primary navigation **Work items**, **QA Queue**, **Runs**, **Settings**. Internal `run-setup`, `plan` and `history` states stay within Runs and remain reachable from the queue.

- [ ] Add a failing render/interaction test for a first-run screen showing **Sign in with Azure DevOps**, no client-ID input, no token, and a clear disabled/configuration message when the packaged public ID is missing.
- [ ] Run `npm test -- apps/desktop/tests/App.test.tsx -t "first-run Azure DevOps sign-in"` and confirm it fails because the current screen exposes manual client-ID entry.
- [ ] Replace the connection panel with the ADO-branded first-run welcome view and system-browser sign-in action. After success, load discoverable organizations and move to organization selection; discovery failure leaves manual add available.
- [ ] Replace the project screen with saved/discovered organization choices and a validated add-organization form; show accessible projects for the selected organization and retain selection context in the workspace header.
- [ ] Group requirement/story search results with expandable child Tasks; expose separate add/remove controls for the requirement and each Task; preserve existing actual type/state/custom-type mapping and paging behavior.
- [ ] Keep task parent context visible in results and queue; do not represent a Task as a verified parent criterion.
- [ ] Move run setup, plan review and run history under **Runs**; keep all existing report/run controls working. Place account, organizations and provider/local-data controls in **Settings**.
- [ ] Add interaction tests for signing in, choosing a discovered org, adding a valid org, rejecting an inaccessible org, selecting a project, expanding Tasks, adding Story plus Task, and switching to queue/settings/runs.
- [ ] Run renderer and keyboard tests, including existing run/review/report coverage.

### Task 5: Clean up responsive layout and app window constraints

**Files:**
- Modify: `apps/desktop/src/renderer/styles.css`
- Modify: `apps/desktop/src/renderer/run.css`
- Modify: `apps/desktop/src/renderer/results.css`
- Modify: `apps/desktop/src/renderer/reports.css`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/tests/App.test.tsx`
- Test: `apps/desktop/tests/App.keyboard.test.tsx`

**Interfaces:**
- Consumes: existing renderer screens and navigation from Task 4.
- Produces: usable 800px-wide desktop layout with readable type/control scale, visible focus, reduced visual clutter, and no horizontal page scrolling on approved first-run/selection/queue screens.

- [ ] Add responsive/accessibility assertions for labels, visible focus behavior, and main view state without depending on CSS implementation details.
- [ ] Replace `body { min-width: 980px }` and `BrowserWindow.minWidth: 980` with an 800px supported window width.
- [ ] Define shared CSS tokens for type, spacing, surfaces, borders, focus and breakpoints; apply the readable scale and consistent panels to onboarding, project selection, work-item results and queue.
- [ ] Add a narrow-window breakpoint that stacks headers, search controls, cards and queue actions without hiding controls or requiring horizontal page scroll.
- [ ] Align run, report and history styles with shared tokens without changing their behavior.
- [ ] Run renderer and keyboard tests and build the desktop app.

### Task 6: Full verification and handoff

**Files:**
- Verify: all changed files and relevant M1 docs.

- [ ] Run `npm test` and inspect full output.
- [ ] Run `npm run typecheck` and inspect full output.
- [ ] Run `npm run build` and inspect full output.
- [ ] Search the renderer/preload/shared IPC for remaining client-ID inputs or values and search the ADO adapter/controller for write endpoints.
- [ ] Review `git diff` and `git status`; confirm no unrelated or previously existing changes were overwritten.
- [ ] Report FR-01 through FR-04 and NFR-08 coverage, exact commands/results, Windows/macOS platform limits, the missing production client-ID dependency, and the still-open M0 gate.

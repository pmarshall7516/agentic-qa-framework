# V1 readiness and Story 5.1 end-to-end plan

> **Execution note:** This plan was created from the repository requirements, the current implementation audit, primary-source research, the authenticated ADO work item view, and the visible Figma canvas. Execute it in the current checkout; preserve all pre-existing changes. The separate Derse Vista repository is a test target and must remain unchanged.

**Goal:** Close the code-level gaps that prevent a usable local-first v1 QA workflow, demonstrate the complete desktop flow with Playwright, and prepare a safely bounded read-only pilot for Story 5.1 (ADO 19959) and its five tasks currently in the `QA / Dev Env` board column.

**Product outcome:** A user can configure a supported provider API key and searchable model, select an ADO story/tasks, inspect criterion-to-task provenance, approve bounded agentic work, receive frontend/backend/integration delegation, run reviewed repository checks in an isolated disposable snapshot and browser checks at an approved origin, and inspect evidence-linked results, report, and a small delegation diagram. The agent decides how to test each acceptance criterion. App-owned code enforces capability, origin, command, resource, privacy, evidence, and verdict boundaries.

**Stack:** Electron, React, TypeScript, Zod, SQLCipher, Azure CLI + read-only ADO, provider adapters, Docker repository worker, Playwright browser/desktop automation, Vitest.

## Fixed scope and rulings

- Story 19959 describes 21 acceptance criteria and links its Figma frame, repository requirements, validation rules, and Excel mockup. The five tasks in `QA / Dev Env` are 22375, 22529, 22564, 22604, and 22605. Freeze their source revisions and selected-column membership at run time; never infer live scope from this plan alone.
- The story's task column is rendered `QA / Dev Env` in the current taskboard UI. Task text informs coverage, but is not an acceptance criterion or proof of its parent story.
- The Figma canvas is visible, but its comment threads require sign-in; comments are unavailable and are not inferred. The current page of `dev.dersevista.xorbix.com` presents a login screen. This plan authorizes read-only inspection only; no staging data writes or credentials are assumed.
- Claude API-key access is in scope through the supported Anthropic API adapter. Anthropic also officially documents Claude Code CLI/SDK sign-in through a Claude Pro/Max plan and non-interactive print mode. This is a possible separate local-CLI adapter, not an API credential; it must not extract CLI tokens or inherit arbitrary tools/MCP config. The current product supports API keys only. Before adding subscription support, verify a no-tools invocation, account/model discovery, usage/cost accounting, and how to isolate the CLI process from project/user files. Arbitrary OpenAI-compatible custom endpoints also remain out of v1 unless they can be safely pinned and threat-reviewed.
- Provider agents plan and review; they do not receive a shell, verdict, origin, or permission authority. A general autonomous tool loop is not required for this bounded v1; generated scenarios/tests are structured outputs that pass app-owned validators and run through existing workers.
- The requested site pilot must stop at read-only checks unless the owner explicitly approves specific records/actions. No app or repo may bypass this boundary.
- M0/M1/M4 external exit gates are not passed by code or mocks. Windows host execution, live provider/billing review, site-account access, adversarial host validation, and human adjudication remain explicit evidence gates.

## Verified Story 5.1 input

Story 19959, “5.1 New Pull Sheet Screen,” contains criteria spanning: access from Client Homebase; existing versus temporary projects; default/override dates; prior-event selection and confirmation; Add Existing filtering and sorting; properties and availability; package/component availability; sold-state conflicts; Not Returning/Sold quantities and history; Client Leaving bulk selection; Do Not Use visibility on Movement Prep/report; transshipping source/destination behavior; ad-hoc lines; graphic expiry; release; CPQ CSV; PDF; multiple sheets; and STO exclusion.

Current five selected tasks:

| ID | Task | Planning implication |
|---|---|---|
| 22375 | Client Leaving Derse Button | Check checkbox confirmation and bulk selection/state behavior; correlate to the Client Leaving criterion. |
| 22529 | Containers Don't Show up on Add existing or pull sheet | Check container filtering/rendering and the clarification of empty container versus all items in a container; ambiguity must surface for review. |
| 22564 | Properties List - Do Not Use | Check DNU metadata propagation to Movement Prep/Check-In/report; task points to story 7.8 and must not silently expand the selected story's criteria. |
| 22604 | Add Existing Image | Check that the Add Existing view displays the item's image and remains usable while filtering. |
| 22605 | Remove checks on Sold for availability | Check transshipping availability without a Sold prerequisite and relevant state transitions. |

The ADO acceptance text and task descriptions are captured from the live UI during planning; the app must fetch current revisions and fields via its read-only adapter before an actual run. The exact UI labels and task mapping are pilot assertions, not hard-coded product logic.

## Implementation tasks

### 1. Baseline, research and evidence ledger

- [x] Inspect both repositories, applicable instructions, dirty state, delivery gates, research sources, user-provided ADO item and visible Figma frame.
- [x] Add the authoritative ADO UI findings and the Figma-comment limitation to `docs/research/2026-09-29-v1-readiness-research.md`; separate verified facts from recommendations.
- [x] Record exact baseline commands and outcomes before the next implementation phase. Do not reset, checkout, commit, or overwrite prior changes. Baseline: `npm test` (188 passed, 3 skipped), `npm run typecheck` and `npm run build` passed; old UI review failed on an obsolete button label.
- [x] Keep this plan's execution notes with precise implementation/verification status and preserve M0-M4 gate truth. M0/M1/M4 remain open; M3 still needs built-Electron and live pilot evidence.

### 2. Reconcile the agent plan contract and acceptance behavior (M2/M3)

- [ ] Write regression tests for the plan/layer contract conflict: each acceptance criterion gets an agent-chosen layer set from currently enabled capabilities; repo-only, site-only, and combined targets remain valid; task text can inform but never create parent ACs; every selected AC has a justified assignment and evidence path.
- [ ] Define the fail-closed behavior for an ambiguous task, missing AC, disabled worker, unavailable origin, unavailable test command, or provider output that omits coverage: no run/NEEDS_REVIEW/BLOCKED as appropriate, never silent inferred PASS.
- [x] Reconcile `packages/agent-orchestrator/src/prompts.ts`, plan validation in `packages/agent-orchestrator/src/index.ts`, domain schemas and the renderer copy. Remove language implying deterministic layer selection; retain deterministic schema validation and verdict computation.
- [ ] Add adversarial tests for malicious ADO text, model-supplied shell/origin/permission, cross-task and cross-criterion linking, missing tests/assertions, and stale source revisions.
- [ ] Verify evidence links and diagram branches derive only from the validated selected plan/outcomes.

### 3. Make the repository worker usable for the requested .NET + React repo (M3)

- [x] Inventory Derse Vista's committed project/solution files, Node scripts, target frameworks, lock files, test command(s), existing locally restored assets, and ignore rules. Read-only only. The repository uses .NET 10 + React and Vitest, but has no local package/restore caches and this host has no `dotnet` CLI.
- [x] Extend snapshot source selection and caps to safely include C#, project/solution/props/targets, Razor/config and lock files needed for planning/review. Preserve symlink/path escape denial, secret exclusions, deterministic hashing and bounded file/context limits; add path/type/size/adversarial tests.
- [x] Add a pinned, digest-identified worker image/runtime profile for the repository's required .NET 10 + Node toolchain, with command IDs for the existing build/test scripts. The model can select only command IDs; it cannot construct CLI arguments. Keep non-root, read-only root, network disabled, bounded resources, no host home/socket/token mounts and disposable workspace semantics.
- [ ] Define a secure dependency availability path. No command may perform restore/install over the network inside the test sandbox. Fail clearly when required assets are absent; never imply code coverage from a skipped/unrestored suite. If the worker image/dependency cache cannot be built safely in this environment, preserve the validated fail-closed implementation and report the exact host/image prerequisite.
- [x] Extend config validation, IPC/run-manifest command identity and result parsing to cover .NET/Vitest JUnit or other structured output. Map each result back to scenario/criterion; command exit code alone does not prove an AC.
- [ ] Add integration tests for the actual approved argument arrays, timeout, cancellation, process cleanup, disabled network, non-root identity, output truncation, results parsing and generated-test scope. Keep target repo untouched.

### 4. Add an actual desktop Playwright acceptance harness (M3/M4)

- [ ] Replace reliance on the mocked `app:ui-review` script as end-to-end evidence with a repeatable `app:e2e` command that builds and launches the Electron app through Playwright's Electron support. Current Playwright coverage is a browser-based React/UI fixture, not built-Electron E2E.
- [ ] Create isolated temporary profile/database/artifact directories, fake ADO/provider adapters with test-only credentials, and a local fixture web target. Prevent real provider, ADO, development-site, external origin, and data writes in this suite.
- [ ] Exercise first launch, mandatory provider/model discovery and search, ADO profile/iteration/task-column selection, Story 19959 fixture with its five selected tasks, criterion/source provenance, one-time envelope approval, AI plan/delegation diagram, repo/site/combined specialist choices, progress/cancellation, evidence-linked criterion results, reviewer summary, deterministic verdict, exports, restart/history, and deletion.
- [ ] Assert important failure paths: no provider configured, provider/model unavailable, stale source, rejected prompt output, forbidden origin/command, missing required layer/assertion/evidence, timeout/cancel, redacted artifacts, and no accidental external request.
- [ ] Capture a Playwright trace and screenshots to a disposable ignored results folder; avoid placing real credentials or production-like data in test outputs. Verify repeatability and document runtime prerequisites.

### 5. Story 5.1 planning fixture and coverage proof

- [ ] Build a sanitized fixture from the real 19959 criteria and exactly the five IDs above, retaining source field/revision provenance without personal data/secrets.
- [ ] Add plan acceptance tests that require the agent to choose sensible browser, repository, or combined coverage by criterion. For example: Add Existing image/filter UI gets browser assertions; service/API persistence or availability rules get repository/integration coverage where source and command support it; Client Leaving behavior gets UI state coverage plus backend verification only when available; DNU and transshipping receive their distinct mapped checks; 22529 clarification is flagged for human review.
- [ ] Ensure requirements from unrelated children (including linked 7.8) are context only unless an explicit story AC links them; do not force a test into layers that cannot produce direct evidence.
- [ ] Render and test the user-requested small circular Orchestrator → selected specialist(s) → result/evidence summary diagram from the validated plan. Include a text equivalent for accessibility.

### 6. Complete provider/model configuration within approved v1 scope

- [ ] Verify provider-key storage stays in the main process, never renderer state/logs/worker/test artifact; discovery uses fixed provider HTTPS destinations, bounded timeout/body/pagination and redirect rejection.
- [ ] Verify the searchable model picker reflects live account model IDs and capability/pricing constraints, including graceful stale/empty catalogs, API auth/rate/timeout errors, structured-output capability, budget reservation and selected-role overrides.
- [ ] Confirm Anthropic API key connection works from the supported API. Evaluate a separate official Claude Code CLI adapter for Pro/Max sign-in; official authentication/print-mode support exists, but tool isolation, searchable account model catalog, and usage accounting remain unimplemented and unverified. Do not access or persist CLI credentials directly.
- [ ] Add tests proving no provider/network call begins without an approved envelope, unknown price/capability blocks before disclosure, cost/call/token/action limits are enforced and provider-reported usage is reflected accurately.

### 7. Update user-facing product and operational documentation

- [ ] Update requirements, repository config, architecture, security, desktop workflow, delivery plan and M0 record only where implementation evidence supports the change.
- [ ] Document worker profile, required image digest, required local runtimes/dependencies, network policy, approved command IDs, Playwright browser provisioning, supported targets, limitations and recovery behavior.
- [ ] Document the Story 5.1 fixture/pilot recipe and sanitized report/evidence path. Keep live account setup and local secrets out of docs.
- [ ] Distinguish code-complete from M0/M1/M4 evidence-complete; list exact residual host/account/reviewer gates.

### 8. Verification and final report

- [ ] Use test-first implementation per changed contract: add failing focused tests, run and record red, implement the smallest slice, rerun targeted suite, typecheck/build at phase boundaries.
- [x] Run the full unit/integration/typecheck/build suites after all implementation changes. `npm test` (193 passed, 3 skipped), `npm run typecheck`, and `npm run build` pass; final rerun remains required after the last docs/test-only edits.
- [ ] Run the new full desktop Playwright E2E last against built Electron + local fixtures, save output, inspect trace/screenshots, and fix regressions before reporting. The current `npm run app:ui-review` Playwright journey passes but does not launch Electron and does not use the Story 5.1 fixture.
- [ ] Run package/security checks available on this macOS host. Do not state Windows, live provider, ADO, site-write, clean-install, or two-reviewer gate as complete without fresh evidence from those environments.
- [ ] Report changed paths, exact command outcomes, Story 5.1 IDs/criteria coverage evidence, diagram location, environment limitations, and each remaining external gate.

## Completion criteria

1. The app makes all run decisions agent-led where behavior/spec interpretation is involved, without making security boundaries or verdicts model-controlled.
2. Story 19959 + its five selected tasks can be imported, frozen, planned and reviewed with source provenance and an accessible delegation diagram.
3. The approved Derse Vista repository can be inspected and its supported tests can execute in an appropriately provisioned no-egress isolated worker, or the app blocks with a precise dependency/setup reason.
4. The development site remains read-only unless explicit test-data write authorization is later given; unauthenticated access is reported as blocked.
5. Full built-app Playwright E2E passes with no real credentials/provider calls/site writes and proves the complete user workflow and key failure guards.
6. All documented milestone gates remain honest. “Near-ready” does not mean release-ready while M0/M1/M4 evidence is missing.

## Research basis

See [`docs/research/2026-09-29-v1-readiness-research.md`](../../research/2026-09-29-v1-readiness-research.md). Primary-source checks added for this plan include Microsoft's official .NET 10 container/restore guidance and Playwright's official Electron automation API. Docker flags do not by themselves prove host isolation; dependency resolution is not permitted during sandbox execution.

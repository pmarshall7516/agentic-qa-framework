# Run context, browser accounts, diagnostics, and branding implementation plan

**Goal:** Deliver the accepted design in `docs/superpowers/specs/2026-09-29-run-context-browser-accounts-branding-design.md` as a usable, secure local-first v1 slice.

**Architecture:** Keep run setup and credentials in renderer-facing typed IPC, validate and persist them in the main process using encrypted `QaStore` settings, pass only selected secret values to the isolated Playwright worker in memory, and return value-scrubbed observations with structured diagnostics. Keep deterministic schemas, evidence policy, and verdict calculation authoritative. Use the provided PNG for packaged and in-app branding.

**Tech Stack:** Electron, React, TypeScript, Zod, SQLCipher-backed settings, Playwright, Vitest, Electron Builder, Vite.

**Spec:** `docs/superpowers/specs/2026-09-29-run-context-browser-accounts-branding-design.md`; requirements FR-23–FR-27 and NFR-03/NFR-04/NFR-08.

**Global Constraints:** Work in the current `develop` checkout and preserve existing user edits. Do not create a worktree, commit, push, change ADO, or touch the Derse Vista target repository. Never place account values in prompts, IPC return data, reports, logs, environment variables, CLI args, or repository workers. Browser artifacts stay restricted and encrypted. Keep site actions on the explicitly approved origin. No test success claims without fresh command output. M0 cross-platform packaging/sign-in/worker gates remain external.

**Implementation status (2026-09-29):** The feature plan is implemented and locally verified. Full tests pass (30 files, 211 passed, 3 skipped, 1 file skipped), typecheck and production build pass, Playwright UI review passes, and macOS ARM64 plus Windows x64 packages build. The Windows artifact was cross-packaged on macOS and still needs a launch/runtime check on Windows. Story 5.1 live execution remains gated on local Azure CLI sign-in, Claude/provider setup, current ADO snapshots and an authorized staging test account. The design comments in Figma remained unavailable by user choice. These external gates are not represented as passed by this implementation plan.

## 1. Freeze product requirements and compatibility boundaries

- [x] Add FR-23 run-specific instructions and explicit plan disclosure, FR-24 encrypted named browser test accounts, FR-25 optional visible Playwright browser, FR-26 detailed blocked/failure diagnostics, FR-27 supplied icon and Agentic QA branding to `docs/spec/01-product-requirements.md`.
- [x] Amend `docs/spec/04-security-privacy.md` for account secret IPC/save/list semantics, secret references, ephemeral worker injection, trace restrictions, scrubbed diagnostic output, and the rule that run instructions grant no capabilities.
- [x] Amend `docs/spec/03-qa-engine.md` for account-referenced `fillSecret`, headless/headed execution, structured diagnostic categories, and BLOCKED versus FAILED classification while preserving verdict precedence.
- [x] Amend `docs/spec/05-desktop-experience.md` for named test-account management, run instructions, visible browser control, diagnostics, and icon/name behavior.
- [x] Record the icon source (`apps/desktop/build/icon.png`, 1024x1024 RGBA) and host-gate limits in `docs/spec/06-delivery-plan.md` and README.

## 2. Extend typed domain contracts with tests first

- [x] Add Zod tests for target run fields: bounded instruction, selected UUID list, default headless behavior, and invalid settings.
- [x] Add a `fillSecret` browser step containing account ID and field reference only; test accepted and rejected references without any secret-bearing schema field.
- [x] Extend Observation with safe structured diagnostic fields and add tests for category/stage validation, length bounds, omission compatibility, and rejecting secret-bearing data where applicable.
- [x] Add tests that blocked authentication/credential scenarios cannot resolve criteria as VERIFIED or produce PASS; preserve FAIL > BLOCKED > NEEDS_REVIEW > PASS.
- [x] Add typed safe account metadata and target-scoped profile input validation; keep the secret-bearing profile schema inside the main-process controller boundary.

## 3. Implement encrypted account profile lifecycle and IPC

- [x] Add controller methods to save/update, list metadata, and delete accounts in `QaStore` settings, with UUID, bounded strings, exact origin matching, max profile count, and no secret readback.
- [x] Add typed IPC channels and preload methods with strict request validation; tests prove IPC sender validation remains enabled and replies contain metadata only.
- [x] Verify settings encryption in storage tests and add controller canary tests ensuring usernames/passwords are absent from DesktopState, run history, progress and reports.
- [x] Ensure updates/deletes do not mutate prior run records; selected but deleted or wrong-origin accounts block plan approval/run start with actionable messages.

## 4. Wire run setup and approved agent context

- [x] Extend `TargetConfig`, target Zod schema, save/load, config fingerprint, rerun copying, and immutable run-target storage with bounded instructions, account IDs and headed-browser preference.
- [x] Build run setup controls: instructions textarea with explicit no-secrets warning, profile multiselect scoped to site origin, and visible-browser checkbox defaulted off.
- [x] Add Settings controls for create/update/delete named account profiles; clear username/password inputs immediately after successful save and never hydrate values from `getState`.
- [x] Include only run instructions plus safe account metadata (ID, label, origin, field availability) in the approved plan context; disclose selected accounts, headed mode, and instruction length/content in plan review.
- [x] Validate generated scenarios' `fillSecret` references against selected account IDs before approval and persist only selected account IDs, metadata snapshot and normal target configuration with the run.
- [x] Add controller/UI tests covering save/reload, rerun, fingerprint drift, model-context metadata, plan disclosure, disabled site target controls, and not exposing secret values.

## 5. Implement Playwright secret filling, headed mode and diagnostics

- [x] Add runner tests using local fixture pages for username/password fill references, empty/unknown account, headless default, headed launch option, origin escape, cancellation, sign-in form detection, access denied, unavailable target and assertion failure.
- [x] Resolve selected account values only in the main process immediately before browser execution and pass a strict account-key map to `runBrowserScenario`; do not add environment/process args or persistent browser storage.
- [x] Set `chromium.launch({ headless: !showBrowserWindow, ... })`; preserve fresh context and every existing route, websocket, download, popup, service-worker, timeout and action restriction.
- [x] Implement `fillSecret`, redact all resolved values from failure and step text, and detect missing credentials before browser launch as an actionable blocked diagnostic.
- [x] Classify observed auth/login/MFA/access-denied pages and navigation/environment errors into structured diagnostics; capture sanitized origin/path and restricted screenshot/trace where available.
- [x] Map authentication/policy/environment blocking to criterion BLOCKED; keep actual expected-behavior assertion contradictions as FAILED; tests prove verdict behavior.

## 6. Make failure and blocked reporting as informative as success

- [x] Update reviewer system/prompt/schema validation to summarize direct evidence for every result, cite observation IDs, explain uncertainty, propose a concrete next action for blocks, and never independently set verdict.
- [x] Extend report renderer JSON/HTML/Markdown, desktop report view and observation cards to show stage/category/detail/next action/failed step and restricted artifact links safely.
- [x] Add report tests for successful, assertion-failed, missing-credential, auth/MFA/access-denied and target-unavailable outcomes; seed secret canaries and assert they never serialize.
- [x] Ensure progress messages remain generic and do not include account values, entered text, query strings, fragments, tokens or page payloads.

## 7. Apply official app branding and icon

- [x] Configure Electron Builder macOS and Windows icon handling from `build/icon.png`; verify platform icon conversion with macOS and Windows package builds.
- [x] Copy/expose `build/icon.png` in Vite output for favicon and renderer logo; add `<link rel="icon">` and replace the AQ text-only logo with the actual icon while retaining accessible brand text.
- [x] Set Electron runtime name with `app.setName('Agentic QA')` and native window icon path where supported; keep `productName`, bundle/app ID, installer names and HTML title consistent.
- [x] Add UI/build checks for icon rendering, verify the icon is present in packaged macOS resources and scan product surfaces for an unintended visible “Electron” label.

## 8. Integrate, verify, and report remaining host gates

- [x] Run focused domain, browser worker, controller, IPC, renderer, and reporting tests after each matching slice; update plan checkboxes only with fresh outputs.
- [x] Run full `npm test`, `npm run typecheck`, `npm run build`, and the Playwright UI review; extend coverage to account selection, context disclosure, visible-window setting, blocked diagnostic report, and icon rendering.
- [x] Inspect final diff, generated build output, secret-canary paths, and current working-tree status; preserve prior user changes and leave the tree uncommitted.
- [x] Report exact changed paths, commands/results, macOS build coverage, cross-packaged Windows limitation, external ADO/provider/login blockers, and open M0/M1/M4 release gates.

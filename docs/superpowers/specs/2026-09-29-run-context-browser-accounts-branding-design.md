# Run context, browser accounts, diagnostics, and desktop branding

**Status:** approved for implementation by the user's instruction to plan and then build.

## Goal

Make a local QA run practical for authenticated development sites while preserving the framework's agentic planning model and its security boundaries. A user can attach bounded run instructions, choose encrypted named test accounts, optionally watch Playwright in a visible Chromium window, and receive actionable, evidence-linked failure and blocked results. The desktop app uses the supplied icon and consistent Agentic QA naming.

## Existing foundations

- The main process stores app settings in SQLCipher-backed `QaStore` settings.
- `TargetConfig` is persisted and fingerprinted when a plan is created; an immutable run target is saved by run ID.
- The QA plan and browser scenarios are Zod-validated before execution. Browser navigation and requests are restricted to one approved origin.
- Browser evidence is encrypted before retention and marked restricted. Reports exclude evidence bytes.
- Electron Builder consumes platform icon assets and the renderer is a Vite application.

## Product decisions and contracts

### Run instructions and visible browser

Extend `TargetConfig` with optional `runInstructions` (maximum 10,000 characters), `testAccountIds` (maximum 20 UUIDs), and `showBrowserWindow` (boolean, default false). Validate on save and again at use. The instructions are run-specific, persisted encrypted with the target and frozen by its configuration fingerprint. They are included in the approved plan context, visibly disclosed in plan review, and cannot expand origins, commands, budgets, or capabilities. Show a clear warning that passwords and keys belong in named test accounts, never the instruction field.

When enabled, the browser worker launches Chromium with `headless: false`; otherwise it remains headless. A headed run is still a separate Playwright-controlled browser window, uses a fresh browser context, and keeps the existing origin, route, action, timeout, download, popup, service-worker, and cancellation restrictions. It is opt-in per run and included in the immutable run configuration.

### Named test accounts and secret flow

Add an encrypted local credential profile with UUID, label, exact approved origin, username, and password. Main-process validation bounds fields, disallows URL credentials, and requires the origin to match the selected site's approved origin. Persist profiles only through the encrypted settings store. `listTestAccounts` returns metadata only: ID, label, origin, and booleans indicating which fields exist. Renderer input fields are cleared after save. Remove/replace operations are explicit.

The Orchestrator sees selected profile IDs, labels, origin, and available field names only. Extend browser scenarios with `fillSecret` (`accountId`, `field: username|password`, accessible role and field name); model output never includes secret values. Validate every reference against the run's selected profile IDs before a plan can be approved. At execution, the main process resolves selected secrets and passes only the selected account values as a typed in-memory browser-worker argument. Values are not placed in process arguments/environment, logs, progress, observations, prompt context, repository workers, report fields, or renderer readback. Browser-worker failure text is scrubbed against all resolved values before storing observations or step results. Traces and screenshots may contain page data; they remain encrypted, restricted evidence and export requires the existing explicit warning.

Account profile metadata is shown in run setup and frozen for audit by IDs/labels/origin in the run target; secret values are excluded from manifests and reports. Deleting a profile does not rewrite historic run configuration. A run cannot start if a selected profile was deleted or its origin no longer matches.

### Blocked and failed diagnostics

Add optional structured diagnostics to `Observation`: stage (`launch`, `navigation`, `authentication`, `interaction`, `assertion`, `environment`), category (`missing_test_account`, `authentication_required`, `manual_authentication_required`, `access_denied`, `target_unavailable`, `browser_unavailable`, `selector_or_action_failed`, `assertion_failed`, `policy_blocked`, `unknown`), a bounded safe detail, a concrete next action, and `retryable`. Diagnostics are produced by ordinary worker code from selected-account state, actual page URL/title/visible auth affordances, HTTP/network errors, and the failed operation; model output cannot set them or upgrade a result.

Missing credentials and detectable sign-in/MFA/access-denied blocks classify required browser criteria as `BLOCKED`, not product `FAILED`. An assertion contradiction remains `FAILED` and identifies expected behavior and the exact failed assertion. Locator/setup/environment problems remain unresolved test/environment findings and cannot produce `PASS`. Existing run verdict precedence is unchanged. UI and HTML/Markdown reports display stage, category, detail, next action, failed step, origin/path (without query or fragment), and restricted artifact references. Agent reviewer prompts require equal care for success and failure: cite observation IDs, summarize only supported evidence, identify uncertainty, and give the next action for blocks. They cannot invent evidence or alter verdicts.

### Branding

Use `apps/desktop/build/icon.png` (the user's 1024x1024 RGBA image) as the single source icon. Configure Electron Builder's platform icon handling; include the PNG as a Vite public asset for the sidebar mark and favicon, and use it for native BrowserWindow/window identity where supported. Set `app.setName('Agentic QA')` alongside the already configured `productName` and HTML title. Preserve the supplied asset and do not create alternate artwork.

## Security and privacy invariants

- ADO remains read-only and uses the existing Azure CLI token boundary.
- Run instructions are untrusted user context and bounded; they do not grant capabilities.
- Account secret values never enter provider requests or renderer-facing API results.
- Browser workers receive only selected secrets in memory and never give them to repo workers.
- No browser storage state, cookies, or auth profile is persisted between scenarios.
- Restricted Playwright artifacts remain encrypted at rest; ordinary report text is value-scrubbed.
- Every browser action continues to use the approved origin and bounded validated scenario schema.
- Deterministic evidence processing and verdict policy remain authoritative; agents plan and explain.

## Acceptance checks

1. Run instructions, account IDs, and headed-browser choice survive target save/load, are frozen into the run configuration, and appear in plan review without secret values.
2. Test accounts are stored encrypted; list/read IPC returns metadata only; invalid/oversized/mismatched origins fail closed; delete and update work.
3. `fillSecret` schema/UI/orchestrator support exposes references and field names only; worker fills correct values; secrets do not appear in observations, progress, renderer output, reports, or worker environment/arguments.
4. Headless is default; headed option opens a visible browser window while preserving all existing origin and action controls.
5. Missing credentials and sign-in/access failures yield a structured BLOCKED result with concrete next action and evidence refs; failed assertions remain detailed FAIL results; neither agent review nor report rendering can turn either into PASS.
6. UI, HTML, Markdown, and JSON report paths render diagnostics safely and never serialize stored account values.
7. User-provided icon appears in packaged configuration, window identity, Vite output, and sidebar brand; app surfaces read Agentic QA rather than Electron.
8. Behavior-focused tests cover valid and hostile inputs, secret canaries, cancellation and normal success/failure, and cross-platform build configuration. Local-host tests do not claim the external Windows/macOS M0 gate.

# Delivery plan and implementation gates

**Status:** sequenced engineering plan for the local-first product. This is a roadmap with independently reviewable milestones; implementation code and exact task-level commits are intentionally left for the first milestone's engineering plan.

## Architecture validation before committing to the stack

Build two short throwaway packaging probes: Electron/TypeScript with Playwright and Entra auth, and Tauri with a Node/Playwright sidecar. Test clean-install size, signed macOS and Windows builds, browser install, auth callback, update behavior, idle/runtime memory, antivirus friction, crash cleanup, and developer build complexity. Choose Electron if the single-language integration advantage holds and its size/security budget is acceptable; otherwise revise [the architecture](../00-agentic-qa-system-architecture.md) before product implementation. This makes the current selection a falsifiable decision, not a permanent assumption.

## Proposed repository layout

```text
apps/desktop/                Electron main, preload, renderer and packaging
packages/domain/             Versioned QA contracts and pure verdict policy
packages/ado/                Entra token adapter and ADO REST normalization
packages/coordinator/        Run state machine, limits and worker dispatch
packages/browser-worker/     Playwright runner and browser evidence
packages/repo-worker/        Container command manifest and result parser
packages/model-adapters/     Provider interface, disclosure and redaction
packages/storage/            SQLite migrations and artifact index
packages/reporting/          HTML, Markdown and JSON renderers
fixtures/                   Fake ADO, app and malicious repo fixtures
docs/                       Product and architecture source of truth
```

Each package depends inward on `domain` contracts, never on desktop UI or raw ADO payloads. Workers communicate through versioned JSON messages. The actual layout may be revised after the packaging probe; record that in an ADR.

## Milestones

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0: feasibility and threat model | Packaging/auth/worker probes, pilot repo and staging app, confirmed ADO account types and permissions | Signed app launches on Windows/macOS; Entra sign-in and one ADO read work; untrusted repo fixture cannot access host secrets; exact supported OS/runtime matrix documented |
| M1: ADO queue | Desktop shell, account/org/project selection, process-aware work-item/task search, persistent queue | FR-01 to FR-04 demo on Agile, Scrum and custom-type fake data plus one live tenant; 401/403/429 and restart covered |
| M2: run contract | Target setup, source snapshots, criterion extraction/editing, disclosure preview, run manifest/preflight | FR-05 to FR-08; no model call before preview approval; stale ADO/source warning; immutable manifest verified |
| M3: execution | Repo worker, browser worker, existing test import, assertions, evidence, cancellation | FR-09/FR-10; container and origin protections tested; one repo-only, one site-only, one both-target story yield traceable observations |
| M4: report and beta | Reviewer classification, verdict, export, history, deletion, signed installers | FR-11 to FR-13 and all NFR gates; human adjudication pilot on at least 20 varied stories/tasks; known gaps published |
| M5: depth | Generated tests, exploratory QA, axe, comparison | FR-14/FR-15 with separate acceptance gates; no automatic test healing changes a pass criterion |
| M6: hosted/team option | Shared data, unattended triggers and ADO writeback | Separate product approval, tenant/RBAC threat model and reliability evidence; FR-16 |

## M0 experiment details

1. **ADO identity and storage:** test Entra public-client PKCE with system browser using `@azure/msal-node` and its encrypted persistence extension in at least two tenants, including a Conditional Access case. Verify actual Azure DevOps resource scopes and organization discovery. Test one MSA-only organization to establish the unsupported-path copy. Package an encrypted SQLCipher database and encrypted evidence files on both OSes; verify migration and key-loss behavior. [Microsoft Electron MSAL sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp/README.md), [MSAL Node cache guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching), [SQLCipher](https://www.zetetic.net/sqlcipher/).
2. **Repository boundary:** attempt home-directory read, Docker socket access, outbound network, CPU/memory overuse and child-process persistence from a fixture test. Record behavior on Docker Desktop for both platforms. If isolation is inadequate, do not ship repository execution until an alternative worker boundary passes.
3. **Browser boundary:** test redirect to foreign origin, authentication redirect allowlist, downloads, WebSockets, service worker requests, file chooser and state-changing action gating. Define which controls are app-level and which require OS/network isolation.
4. **Evidence:** create a real story with one code criterion and one UI criterion. Capture exact ADO revision, commit, site deployment identity, assertion, trace, screenshot, failure classification and export. Have two human reviewers assess whether the report justifies its verdict.

## Pilot configuration contract

The initial `.agentic-qa.yml` is versioned and reviewable. Its exact proposed v1 fields, example, validation rules and execution semantics are in [the repository configuration contract](07-repository-config.md). Secret names are references to local credential storage, not values in the file. The GUI can create this configuration locally; saving it into the repository is a separate user action. M0 may revise the schema only through a documented versioned decision before M3 implementation.

## Verification matrix

| Area | Automated tests | Human release check |
|---|---|---|
| Domain/verdict | Pure fixtures for all criterion/verdict combinations, migrations, artifact hashes | Review sample PASS/FAIL/BLOCKED/NEEDS_REVIEW reports |
| ADO | Fake API contract fixtures for process types, relations, paging, auth/rate failures | Live tenant with restricted account and multi-org membership |
| Desktop | IPC validation, keyboard navigation, migration/restart | Clean install, upgrade, sign-in/out and crash restart on macOS/Windows |
| Repo worker | Malicious fixture, timeout/cancel/process tree, result parsing | Verify container limits on target OS runtimes |
| Browser worker | Redirect, action cap, assertion/trace, secret redaction | Test against staging app with test account and known bug |
| Privacy | Secret canaries in input/artifacts; no transmission before approval | Inspect actual provider payload and exported trace/report |
| Local storage | Encryption, key rotation/loss, permissions and crash-scratch cleanup | Attempt offline read of DB/artifacts without OS key on Windows/macOS |

## Decision log and unresolved pilot inputs

| Decision | Current direction | Needed evidence / owner |
|---|---|---|
| Local vs hosted | Local-first desktop chosen by product owner | Revisit only for team sync/CI phase |
| AI provider | User-configured provider with per-run disclosure preview chosen by product owner | Which providers are allowed in the first beta; provider data-handling review |
| Shell/engine | Electron/TypeScript preferred | M0 packaging and security probe |
| Repo execution | Container runtime required; site-only works without it | Windows/macOS isolation probe and runtime support policy |
| Account coverage | Entra-backed ADO Services first | MSA-only customer demand and Microsoft support status |
| Language/framework breadth | Reuse each project's existing tests; pilot one JS/TS web repo first | Select pilot project and later adapter backlog |
| Distribution | Signed installers, update channel | Decide internal vs public distribution and certificate ownership |

## Definition of ready for implementation

M0 begins after a pilot ADO tenant/repository/site and test accounts are available. M1 begins when the identity and packaging probes pass and exact permissions/OS matrix are recorded. M2/M3 require a frozen version of the domain schemas and worker security policy. M4 requires a human-adjudicated pilot dataset and completed release security tests. Any gate failure changes the implementation plan or scope rather than being hidden by an AI-generated report.

# Delivery plan and implementation gates

**Status:** sequenced engineering plan for the local-first product. This remains the source of milestone exit gates; implementation evidence and open gates are recorded in [the M0 feasibility record](08-m0-feasibility-record.md).

## Architecture validation before committing to the stack

Build two short throwaway packaging probes: Electron/TypeScript with Playwright and Azure CLI authentication, and Tauri with a Node/Playwright sidecar. Test clean-install size, launchable unsigned macOS and Windows builds, browser install, CLI login/token flow, update behavior, idle/runtime memory, antivirus friction, crash cleanup, and developer build complexity. Code signing/notarization is outside v1 local-testing scope; revisit it before broad public distribution. Choose Electron if the single-language integration advantage holds and its size/security budget is acceptable; otherwise revise [the architecture](../00-agentic-qa-system-architecture.md) before product implementation. This makes the current selection a falsifiable decision, not a permanent assumption.

## Proposed repository layout

```text
apps/desktop/                Electron main, preload, renderer and packaging
packages/domain/             Versioned QA contracts and pure verdict policy
packages/ado/                Azure CLI token adapter and ADO REST normalization
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
| M0: feasibility and threat model | Packaging/auth/worker probes, Azure CLI prerequisite, pilot repo and staging app, confirmed ADO account types and permissions | Launchable app builds on Windows/macOS with Azure CLI detected; CLI sign-in, ADO token acquisition, one read, encrypted profile persistence and worker isolation work; untrusted repo fixture cannot access host secrets; exact supported OS/runtime matrix documented. Code signing/notarization is not required for v1 local testing. |
| M1: ADO queue | Desktop shell, account/org/project selection, process-aware work-item/task search, persistent queue | FR-01 to FR-04 demo on Agile, Scrum and custom-type fake data plus one live tenant; 401/403/429 and restart covered |
| M2: agent contract and approval | Mandatory provider/model setup; encrypted saved provider/model catalog with per-entry reachability tests; source/task/criterion mapping; agent-proposed feature QA plan; structured delegation plan; separate planning-context disclosure and final worker approval; uniform selected model; model/cost budgets; run manifest | FR-05 to FR-08, FR-17, FR-20, FR-21; only explicit model-test and disclosed plan-preparation actions may send provider requests before worker approval; unknown price/capability blocks; immutable plan/manifest and source revisions verified |
| M3: agentic execution | Orchestrator and specialist delegation; code review; generated repo/unit/API tests in disposable copy; bounded Playwright generation/execution; encrypted named test accounts, optional visible browser, bounded run instructions, actionable browser diagnostics; progress, evidence and cancellation | FR-09, FR-10, FR-14, FR-19, FR-23 to FR-26, NFR-11; malicious prompt/tool-call and secret-canary tests; only reviewed command IDs and approved origins execute; one repo-only, site-only and both-target case yield traceable observations |
| M4: evidence report and beta | Evidence reviewer, agent summaries, selected-agent delegation diagram, verdict, export, history, deletion, supplied app branding, launchable Windows/macOS packages | FR-11 to FR-13, FR-27 and all applicable NFR gates; each summary claim links to direct evidence or is unverified; human adjudication pilot on at least 20 varied stories/tasks; known gaps published. Signing/notarization remains a future distribution gate. |
| M5: depth | Bounded exploratory QA, axe, comparison, additional language/result adapters | FR-15 and later expansions with separate acceptance gates; no automatic test healing changes a pass criterion |
| M6: hosted/team option | Shared data, unattended triggers and ADO writeback | Separate product approval, tenant/RBAC threat model and reliability evidence; FR-16 |

## Current implementation status

| Milestone | Engineering implementation | Exit-gate status |
|---|---|---|
| M0 | macOS arm64 and Windows x64 unsigned packages build (Windows NSIS installer and portable executable); packaged macOS app opens; SQLCipher-backed profile storage and main-process Azure CLI token adapter are implemented; digest-pinned Node 22/.NET 10 worker image is built and its Node/.NET versions run under no-network, read-only, dropped-capability flags. | **Open.** No Windows host, live CLI/ADO account, cross-platform encrypted-store proof, or full worker exhaustion/adversarial suite. |
| M1 | Azure CLI sign-in, ADO-branded onboarding, account-scoped organization/project/team/board/Story profiles, JSON profile import, current-sprint taskboard filtering, comments, work-item search and encrypted persistent queue are implemented. | **Open.** Live ADO tenant, multi-account CLI context, cross-platform profile encryption and API pagination/failure behavior need pilot verification. |
| M2 | Mandatory provider/model setup; encrypted saved-model catalog with per-entry reachability tests and credential-generation invalidation; explicit tested-model selection for plan synthesis and all QA roles; Story/Requirement feature summaries, source-linked feature criterion proposals and per-Task verification plans; proposal review, acceptance and provenance; structured delegation plan; separate planning-context disclosure and final worker approval. | **Implementation delivered; milestone gate open.** Automated behavior checks cover catalog persistence, safe reachability requests/results, stale tests after credential changes, agent synthesis/source validation, proposal review and same-model pinning. Live provider/account data handling, billing interpretation and Windows/macOS package/provider checks remain outstanding; this does not close M0. |
| M3 | Browser and repository workers, JUnit/TRX scenario mapping, bounded stdout/stderr and structured-result capture, encrypted restricted evidence linked to observations, cancellation, combined targets, run limits and interrupted-run recovery are implemented. Orchestrator-selected browser scenarios and generated TypeScript/C# tests run through the existing Playwright/repository workers. | **Open.** Generated tests and bounded approved source are reviewed by a post-run Reviewer Agent, and its criterion claims are validated against computed states and direct observations. A deterministic UI Playwright fixture passes; no built-Electron ADO/provider/site pilot or Windows worker run has been adjudicated. .NET target test assets are unavailable without restore, which is blocked by the no-egress policy. |
| M4 | Findings/reviewer overrides, deterministic verdicts, encrypted history, deletion, direct per-criterion observation display, warning-gated restricted artifact save, HTML/Markdown/JSON export, immutable rerun plans linked with `previousRunId`, evidence-linked AI summaries, reviewer output and the selected-agent delegation diagram are implemented. | **Open.** No 20-story two-reviewer pilot, clean Windows installation, manual keyboard review in packaged builds, or full release security review. |

This status separates implementation availability from milestone completion. Do not treat generated packages or passing automated tests as evidence that an external exit gate passed.

## M0 experiment details

1. **ADO identity and storage:** validate Azure CLI installation detection, system-browser `az login`, token acquisition for the ADO resource, tenant/account switching, and safe failure when the CLI is missing or signed out. Verify organization discovery, profile import/validation, team/project reads and read-only ADO access. Package an encrypted SQLCipher database and encrypted evidence files on both OSes; verify migration and key-loss behavior. Azure CLI owns the credential cache; Agentic QA never persists its tokens.
2. **Repository boundary:** attempt home-directory read, Docker socket access, outbound network, CPU/memory overuse and child-process persistence from a fixture test. Record behavior on Docker Desktop for both platforms. If isolation is inadequate, do not enable repository execution until an alternative worker boundary passes.
3. **Browser boundary:** test redirect to foreign origin, authentication redirect allowlist, downloads, WebSockets, service worker requests, file chooser and state-changing action gating. Define which controls are app-level and which require OS/network isolation.
4. **Evidence:** create a real story with one code criterion and one UI criterion. Capture exact ADO revision, commit, site deployment identity, assertion, trace, screenshot, failure classification and export. Have two human reviewers assess whether the report justifies its verdict.
5. **AI provider:** provider-backed agentic orchestration is mandatory under [ADR-0004](../decisions/ADR-0004-mandatory-agentic-provider-adapters.md). The user reviews a run-level context/permission envelope and cost ceiling once. The main process enforces typed tool capabilities, token/call/fan-out/time/action budgets, and conservative cost reservation; unknown rate data blocks the provider call. Fake-provider tests verify the boundary. Live provider/account data-handling, pricing and billing checks remain release gates.

## Pilot configuration contract

The initial `.agentic-qa.yml` is versioned and reviewable. Its exact proposed v1 fields, example, validation rules and execution semantics are in [the repository configuration contract](07-repository-config.md). Secret names are references to local credential storage, not values in the file. The GUI can create this configuration locally; saving it into the repository is a separate user action. ADO connection/run profiles use the separate versioned JSON schema in [the profile example](../../config/ado-profiles.example.json); imported values are validated and stored in encrypted local settings. No token or credential value is stored in either file.

## Verification matrix

| Area | Automated tests | Human release check |
|---|---|---|
| Domain/verdict | Pure fixtures for all criterion/verdict combinations, migrations, artifact hashes | Review sample PASS/FAIL/BLOCKED/NEEDS_REVIEW reports |
| ADO | Fake API contract fixtures for process types, relations, paging, auth/rate failures | Live tenant with restricted account and multi-org membership |
| Desktop | IPC validation, keyboard navigation, migration/restart | Clean install, upgrade, sign-in/out and crash restart on macOS/Windows |
| Repo worker | Malicious fixture, timeout/cancel/process tree, result parsing | Verify container limits on target OS runtimes |
| Browser worker | Redirect, action cap, assertion/trace, secret redaction | Test against staging app with test account and known bug |
| Privacy | Secret canaries in input/artifacts; no project data in model reachability checks; planning transmission only after exact scope disclosure and explicit plan-preparation action | Inspect actual provider payload and exported trace/report |
| Local storage | Encryption, key rotation/loss, permissions and crash-scratch cleanup | Attempt offline read of DB/artifacts without OS key on Windows/macOS |

## Decision log and unresolved pilot inputs

| Decision | Current direction | Needed evidence / owner |
|---|---|---|
| Local vs hosted | Local-first desktop chosen by product owner | Revisit only for team sync/CI phase |
| AI provider | Mandatory provider-backed Orchestrator with supported adapters, saved/tested provider/model catalog, one selected model across agent roles and run-level budget | Verify provider models, pricing/account billing, data handling and rate limits; unknown capabilities/rates block use |
| Shell/engine | Electron/TypeScript preferred | M0 packaging and security probe |
| Repo execution | Container runtime required; site-only works without it | Windows/macOS isolation probe and runtime support policy |
| Account coverage | Entra-backed ADO Services first | MSA-only customer demand and Microsoft support status |
| Language/framework breadth | Reuse each project's existing tests; pilot one JS/TS web repo first | Select pilot project and later adapter backlog |
| Distribution | Launchable unsigned Windows `.exe` and macOS app for v1 local testing | Code signing/notarization and update channel are future distribution decisions |

## Definition of ready for implementation

M0 begins after a pilot ADO tenant/repository/site and test accounts are available. The product owner has directed implementation to continue through M1–M4 while live M0 checks are being arranged. This allows feature development but does not waive release gates: the identity/OS matrix must be recorded before claiming M1 complete; M2/M3 require frozen domain schemas, wired specialist execution and a validated worker security policy before claiming those milestones complete; M4 requires the human-adjudicated pilot dataset and completed release security tests before beta readiness. Record every gate failure or missing external input rather than inferring success.

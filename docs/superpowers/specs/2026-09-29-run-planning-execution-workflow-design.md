# Agentic QA run planning and evidence workflow

**Status:** approved for implementation, 2026-09-29. This design extends the existing M2–M4 local-first workflow. It does not close any M0 or M1–M4 release gate by itself.

## Purpose

Make the end-to-end path from a read-only Azure DevOps (ADO) QA Queue to a reviewed plan, bounded worker execution, visible progress and criterion-linked evidence work reliably on Windows and macOS. The Orchestrator must explain what it plans to run, why each check exists, which worker owns it, what permissions it needs and what evidence it will retain.

The live Windows reproduction found that ADO sign-in, project selection and queue reads worked. A site-only local draft opened, but the selected Requirement `5.1 New Pull Sheet Screen` had no acceptance criteria, so it had no contract criteria. The five queued Tasks were presented as context without using their descriptions. The combined Repository and site draft failed during the local repository preparation path but displayed an ADO outage message. Plan creation reads the locally saved queue and repository; the misleading ADO wording comes from broad renderer handling of Electron IPC rejections. Repository planning requires a valid root `.agentic-qa.yml`, and the current renderer hides that class of local failure.

## Goals

1. Refresh and freeze the selected ADO Requirement and Task snapshots, retaining each work item's ID, revision, type, title, description and acceptance-criteria field where present.
2. Make Requirement acceptance criteria the authoritative source for Requirement coverage. Show selected Task descriptions as scoped implementation context and create explicitly labeled candidate checks from them without treating Tasks as proof of the parent Requirement.
3. Make incomplete ADO source criteria, stale sources, repository configuration errors, site errors and worker readiness failures visible before approval, with a next action tied to the failed operation.
4. Present an editable execution plan with per-criterion scenarios, test command/JUnit mappings, worker assignment, origin and command permissions, expected evidence, dependencies and limits.
5. After the user approves the frozen plan, dispatch only its schema-validated work to the existing Browser and Repository workers. Show the Orchestrator's stage and worker progress while preserving cancellation and partial reports.
6. Retain successful Playwright screenshots in step order and link them, traces, JUnit results and observations to the Scenario and Acceptance Criterion they support.
7. Keep all retained source, contract, observations and evidence local and encrypted; keep ADO read-only and keep AI use optional and separately approved.

## Non-goals and scope boundary

- No ADO writes, work-item comments, bug creation, PR changes, deployment or hosted service.
- No automatic code edits, generated test code, test healing or unsupervised agent access to shell/files/network. Those remain a separately gated M5 product decision.
- No claim that Task descriptions replace missing Requirement acceptance criteria. If Requirement coverage remains incomplete, a run with otherwise passing Task-derived checks is `NEEDS_REVIEW`, never `PASS`.
- No increase to the current first-release repository worker runtime/command allowlist or network permissions in this work. Repository execution remains the currently supported configured command/JUnit path; unsupported runtimes or result formats are blocked with an actionable message.
- No default provider transmission. Deterministic local planning works with no provider configured.

## User flow

### 1. Refresh source and prepare the Target

On **Review local plan**, the main process reads the current QA Queue and refreshes the queued work items in bounded ADO batches. It stores normalized current snapshots under the same organization/project/item keys and retains source revisions. If an item was deleted, permission was lost, or ADO is unavailable, plan review stops with an ADO-specific error that names the read operation and whether retry, sign-in, access correction or saved-snapshot review is available. It must never label a local repository or browser error as an ADO failure.

Refreshing a source updates the local queue snapshot only; it performs no ADO write. Plan creation uses one consistent refreshed snapshot set. Approval validates that these same item revisions are still current. A changed revision requires a refresh and a new plan; the old draft is not silently rewritten.

Target preflight then checks only applicable layers:

- A local repository path can be read and safely snapshotted; an existing validated repository config is honored, otherwise a root npm test script is auto-detected as a diagnostic command.
- ADO Git remains pinned to the selected commit. When no repo config exists, root `package.json` is read at that commit to discover the same diagnostic command.
- A site URL is valid and its exact origin is approved. Site-only planning does not require Docker.
- Chromium, repository worker image and encrypted artifact storage readiness are shown as individual checks, not conflated with source loading.

Each failed check has a stable code, operation, safe user-facing message and relevant settings action. Low-level stacks, response bodies, file contents, secrets and access tokens are not rendered. Diagnostics may log only safe codes and operation names; never include ADO tokens, provider keys, source text or raw provider/ADO payloads.

If `.agentic-qa.yml` is absent, the app checks the root `package.json` for `scripts.test` and adds a bounded `npm test` diagnostic command automatically. It does not execute the script during discovery. The exact command and the network-disabled/no-install limitation are shown in the reviewed plan. Automatic output is diagnostic only: it cannot verify an Acceptance Criterion without an exact JUnit testcase mapping. Unsupported runtimes or missing mappings remain visible as uncovered Repository scenarios. Advanced users may still edit a validated custom config, stored encrypted in app settings and linked to the repository identity; it does not write into the working tree.

### 2. Review the plan and source context

The review screen presents one source card per selected Requirement and Task. Each card identifies the work item type, title, ID, revision, source fields and normalized Description/Acceptance Criteria separately. Task context is nested under its Requirement when a validated parent relation exists. Standalone Tasks remain separate scope. Every statement in the plan can be traced to a source item and field or is marked user-added.

Requirement Acceptance Criteria are split into stable, source-linked atomic criteria. The planner does not invent a missing criterion. For a Task Description, the deterministic local draft may extract bullet/list paragraphs as **Task-derived candidate checks**. Candidate text retains its Task ID, revision and `System.Description` field and is visually distinct from Requirement criteria. A user may edit or promote a candidate into an explicitly user-added criterion while keeping its derived-from source. This does not clear the missing-Requirement-criteria gap. A standalone Task may have task-sourced criteria, but reports continue to identify it as a Task scope.

Each plan scenario contains:

- linked criterion/candidate IDs and source provenance;
- target layer (`repo` or `browser`), worker lane and reason for that assignment;
- exact browser actions/assertions or exact configured repository executable/argument list and JUnit identities;
- expected observation and evidence items;
- dependencies, risk/data effects, origin, timeout, action and artifact budgets.

No zero-assertion, unmapped repository scenario, missing required layer, missing Requirement criteria or unresolved high-risk action may be represented as complete coverage. The user can edit/reject candidate checks and scenarios. Approval binds the source revisions, Target, repository config hash, contract revision, worker protocol/tool versions, command arguments, browser steps, origins, budgets and execution graph into an immutable Run Manifest.

### 3. Optional AI planning disclosure

Local planning is the default and never calls a provider. When OpenAI is configured, a separate action may request bounded scenario suggestions. The preview shows the exact request body, selected criterion text, provider/model, output limit and exclusions. Raw Task Description text is excluded; if a user promotes a Task candidate into a criterion, that copied text can be sent only when its criterion is selected and the exact payload is separately previewed and approved. Model output is untrusted, schema-validated, marked unapproved and cannot change source identity, worker assignment, commands, origins, permissions, budgets or verdict. Suggestions do not enter the approved execution graph until the user reviews them.

### 4. Approve, orchestrate and execute

Approval saves a new immutable local run. The Orchestrator builds a deterministic execution graph from the approved scenarios and configured tests, then dispatches work to fixed workers:

- **Repository worker:** executes only approved configured commands against a disposable immutable snapshot, with the existing network-disabled container boundary and resource limits; parses only configured JUnit output and maps exact testcase identities to exact approved Scenario IDs.
- **Browser worker:** executes only approved Playwright steps on the approved origin, with the configured action/time limit; it does not receive ADO/provider credentials or source files.

There is no free-form model-generated executable command and no worker can broaden the approved graph. Repository commands execute in manifest order; Browser scenarios execute in plan order. v1 runs the Repository lane before the Browser lane when both are present. This conservative order keeps one shared cancellation signal and Run Manifest wall-clock deadline straightforward; parallel lanes can be added after dependency modeling is implemented. The scheduler is deterministic and makes no retry that could repeat a state-changing browser action.

The Orchestrator emits versioned progress records containing run ID, stage/lane/scenario/step IDs, status, safe detail and timestamp. The records are encrypted with the run in SQLCipher and read through a typed, sender-validated IPC method; the renderer polls while the run is active and reloads the durable timeline from history. The UI renders source validation, Repository lane, Browser Scenario and step activity, evidence/report assembly and final status. Active work exposes worker messages and Cancel. Cancellation aborts the active worker, kills repository descendants, saves captured observations/evidence and leaves a partial report. Crash recovery treats a run with progress but no observations as interrupted and requires a new manifest for retry.

### 5. Inspect results and evidence

The report links each Acceptance Criterion to its required scenarios, direct observations, worker results, missing evidence and source references. Task-derived checks remain a separate group and cannot satisfy the parent's Acceptance Criteria by implication.

For each completed Browser step, capture a screenshot and retain its ordered step ID, timestamp, action status and scenario/criterion links. Preserve a failure screenshot and restricted Playwright trace when available. Show local ordered screenshot previews in the report; downloading/exporting restricted raw artifacts still uses the warning and native file picker. Browser artifacts stay encrypted at rest and are omitted from report exports except for safe IDs/hashes and redaction state. Screenshot capture is best effort and does not turn a passing assertion into a failed check.

For Repository results, show configured commands and criterion-linked observations; the user can open the encrypted JUnit and log artifacts through the restricted export flow. Exact testcase identities are mapped by the Repository worker. A zero exit code without a parsed mapped assertion remains insufficient evidence. No output line or artifact can override verdict policy.

Reports remain immutable; human classification/annotation remains append-only. Verdict precedence remains `FAIL`, `BLOCKED`, `NEEDS_REVIEW`, `PASS`. Missing Requirement criteria or unresolved source coverage adds an explicit unresolved coverage finding so even a run of passing Task-derived checks cannot yield `PASS`.

## Contracts and persistence

- Extend the domain contract with versioned immutable source-context records and Task-derived candidate provenance; keep the distinction between source Requirement criteria, task-sourced candidates and user-added criteria explicit in the schema.
- Extend the run record/report to preserve that source context and an unresolved source-coverage reason after the mutable QA Queue changes.
- Define a versioned `RunProgressEvent` schema, durable ordered storage and a typed polling API. Reject malformed, wrong-run and untrusted-sender requests.
- Persist worker and step identity on observations/artifacts. Artifact paths stay run-relative, hashes are verified, and successful screenshots are classified as restricted evidence.
- Migrate prior local records without changing their manifest/report meanings. Old runs remain readable and use the current history presentation without fabricated source context or progress.

Exact names and serialization shapes are frozen by the implementation plan. Any worker or persisted contract version change must have an explicit migration/rejection policy.

## Error handling and recovery

Errors are categorized by boundary: ADO authentication/permission/rate/network/malformed response; source revision change; repository path/config/snapshot policy; site URL/reachability/redirect; worker unavailable/timeout/cancel; invalid plan/schema; encrypted storage/artifact failure. Safe errors name the failed operation and next action. Only ADO boundary failures use ADO-branded messages.

Before approval, errors leave no Run Manifest. During execution, environment and worker errors generate blocked/unverified observations/report state without fictional passing results. Partial evidence is retained under the same encrypted artifact rules. Recovery never resumes an old manifest in place.

## Security constraints

- ADO remains read-only; tokens remain in the main process and never reach renderer, Browser/Repository workers, reports, model prompts or logs.
- Renderer remains sandboxed with Node disabled, context isolation, restrictive CSP, typed/schema-validated IPC and sender checks.
- Work item text, repository files/config, sites, artifacts and model output remain untrusted data. Text does not grant permissions.
- No model-generated shell string is executed. Commands remain reviewed executable/argument arrays with shell expansion disabled.
- Repository code runs only in the existing disposable snapshot/container boundary without home, Docker socket, credentials or unapproved egress.
- Browser origins, actions, test-data effects, time, action and artifact budgets are frozen and displayed before approval. Destructive or externally visible actions require explicit approval and remain disabled by default.
- All retained ADO context and artifacts remain encrypted at rest; plaintext scratch is bounded and cleaned.

## Acceptance criteria

1. On Windows and macOS, a site-only plan works without Docker. A repository with root npm `scripts.test` and no custom config can produce a plan without JSON/file setup. Unsupported repository stacks receive a clear local error; no such failure is labelled ADO.
2. Plan review refreshes all selected ADO sources and shows Requirement Acceptance Criteria and every selected Task Description with correct source ID/revision/field. Network/auth/permission/stale failures are operation-specific and no stale plan can be approved.
3. Missing Requirement criteria create visible Task-derived candidates and a source-coverage gap. Task-derived observations cannot yield a `PASS` while Requirement criteria remain unresolved.
4. Plan review displays exact commands, mappings, Browser actions, approved origin, worker assignment, dependencies and budgets before the user approves.
5. No ADO write occurs. No provider request occurs before exact-payload preview and separate approval. Task descriptions are transmitted only when individually included in that preview.
6. An approved both-target run shows timely Orchestrator and worker progress and can be cancelled. Repository processes are killed, browser contexts close, and partial reports retain only evidence actually captured.
7. Passing and failing Browser checks retain ordered screenshots linked to step, Scenario and criterion. Failures retain trace when available. Evidence remains encrypted at rest and warning-gated for export.
8. Repository output maps exact parsed JUnit test identities to the frozen Scenario IDs; exit code alone cannot verify a criterion.
9. Verdict tests cover empty criteria, unresolved source coverage, missing required layers, no/missing assertions, mixed worker/product/environment failures, cancellation and the existing precedence rules.
10. Keyboard navigation and renderer appearance/behavior remain shared across Windows and macOS at equivalent viewport and scaling.

## Delivery sequence

1. Freeze domain source context, candidate and progress event schemas plus migration policy.
2. Add test-first ADO refresh/normalization and actionable per-boundary error envelopes; reproduce and correct the Windows local repository-preflight failure.
3. Add Task-derived candidate planning and immutable source context persistence, then complete plan UI and preflight.
4. Add structured coordinator progress and bounded worker-lane scheduling.
5. Capture per-step successful Browser screenshots and improve per-Scenario result/evidence views; expose mapped Repository/JUnit details.
6. Update product, ADO, engine, security, UX and delivery documents; execute automated and platform verification available in this environment. Record all missing live Windows/ADO/release gates without representing them as passed.

# Product requirements

**Status:** proposed first-release requirements. **Owner:** product. **Date:** 2026-09-27.

## Users and jobs

| User | Job |
|---|---|
| Developer / QA engineer | Select a requirement and implementation target; run repeatable QA; inspect failures and evidence |
| Tech lead | Check criterion coverage and known gaps before accepting work |
| Project administrator | Control approved sign-in, AI provider, staging targets and local security settings |

## Product goal and limits

The app must establish **which promised behaviors have evidence**, which failed, which were not verified, and why. It must not imply that AI-generated scenarios exhaust the space of possible bugs. The report is a decision aid, not an automatic release approval. A story and its child tasks are related inputs: tasks suggest implementation scope, but task completion does not prove acceptance criteria.

## First-release scope

**In scope:** Azure DevOps Services sign-in; organization/project selection; requirement and child-task search; queue; local or ADO Git repository selection; staging/dev URL selection; source snapshot; human-reviewed QA contract; existing repo test execution in a constrained worker; Playwright browser checks; evidence; local history; export; rerun; cancellation; provider configuration; privacy preview.

**Out of scope:** Azure DevOps Server; Jira/GitHub issue ingestion; unattended triggers; CI/PR status publishing; ADO bug creation/comments; deployment or environment provisioning; production-target testing by default; automatic code fixes or PR edits; multi-user sync; claims of complete security or accessibility certification; native mobile app automation.

## Functional requirements

Each requirement ID is stable for planning and verification. `M` is required for the first useful release; `L` is later.

| ID | Priority | Requirement | Acceptance test |
|---|---|---|---|
| FR-01 | M | On first launch, sign in to ADO Services through the user's Azure CLI account, then disconnect from the app | User can use **Sign in with Azure DevOps** to complete `az login` in the system browser without an app registration or client ID; an Entra-backed ADO token is used only in the main process; disconnect does not run `az logout` |
| FR-02 | M | Discover, add, validate and switch among accessible organizations for the signed-in account; select a project | App lists organizations where membership discovery succeeds, validates a manually added organization before saving, remembers choices per account, and lists accessible projects; forbidden org/project yields an actionable error without leaking data |
| FR-03 | M | Search and filter requirement/Story work items by ID, title, state and type; browse child Tasks and filter sprint Tasks by taskboard column | Results include actual ADO type/state/ID and revision; child Tasks are shown under their parent with sprint-board columns; ID/title and multi-select column filters narrow Tasks without hiding a matching parent Story; paging and empty/error states work |
| FR-04 | M | Add/remove a Requirement/Story and selected child Tasks to a persistent local QA Queue | Selection survives restart; each queued Story is the main row with associated queued Tasks nested as separate rows; standalone Tasks remain visible; duplicates are prevented by org/project/work-item ID; inaccessible items are marked stale; no ADO write occurs |
| FR-13 | M | Save, edit, validate and switch among account-scoped Azure DevOps run profiles | Settings supports multiple org/project/team/taskboard-column/Story-ID profiles; selecting one loads configured Stories and current-sprint Tasks from the chosen board column; metadata remains encrypted locally |
| FR-05 | M | Choose repository, site URL, or both per run | Preflight requires at least one reachable/configured target; report states what was and was not exercised |
| FR-06 | M | Select local repository folder or ADO Git repository/ref and freeze source identity | Run records commit SHA or immutable copied snapshot hash; dirty local tree is identified; original working tree is not modified |
| FR-07 | M | Extract acceptance criteria and task context into a reviewable QA contract | Each criterion has stable ID, source reference, expected behavior, scenarios and evidence requirements; user can edit before run |
| FR-08 | M | Show provider disclosure preview and enforce configured model budget | User sees fields/files/snippets to be sent, can exclude them, and can stop before transmission; over-budget preflight blocks or asks for new user-set limit |
| FR-09 | M | Run configured existing repository tests in constrained disposable workspace | Only allowlisted commands from reviewed config execute; exit, stdout/stderr excerpts and test result files are captured; timeout/cancel kill descendants |
| FR-10 | M | Execute criterion-linked browser checks using Playwright | Browser worker performs repeatable steps and assertions against allowlisted origin; failed checks keep trace/screenshot and assertion output |
| FR-11 | M | Map observations to criteria and distinguish failure causes | Each criterion shows its direct observations and allows restricted encrypted artifacts to be saved through a warning and native file picker; `VERIFIED`, `FAILED`, `UNVERIFIED`, or `BLOCKED` is explicit; product/test/environment/ambiguous classifications are explicit |
| FR-12 | M | Compute auditable run verdict and export report | `PASS`, `FAIL`, `NEEDS_REVIEW`, `BLOCKED` policy matches [engine spec](03-qa-engine.md); HTML/Markdown/JSON export excludes secrets |
| FR-13 | M | Cancel/retry runs and inspect history | Cancellation leaves a partial report; retry creates a new manifest linked to prior run; user can delete run and artifacts |
| FR-14 | L | Generate new tests and bounded exploratory flows | Generated tests stay in disposable workspace until user explicitly exports; no healer silently changes assertions |
| FR-15 | L | Run automated accessibility checks | axe findings identify scanned pages and rule IDs; report does not call automated scan a full accessibility audit |
| FR-16 | L | Publish report/bugs/status to ADO | Separate write scope and confirmation; idempotent publishing; exact destination preview |
| FR-17 | M | Refresh queued ADO sources before planning and preserve Requirement criteria and Task descriptions with field/revision provenance | ADO access failure stops planning with the actual actionable category; Task candidates remain separate; missing Requirement criteria creates an explicit coverage gap and can never produce `PASS` |
| FR-18 | M | Configure repository checks from a validated app-local editor when the repository has no config file | Config is encrypted locally, command argument arrays and JUnit mappings are reviewed, config hash is frozen in the manifest, and the source tree is not modified |
| FR-19 | M | Show durable Orchestrator/worker/Scenario/Browser-step progress and criterion-linked results | Progress survives app restart, cancellation and partial runs are retained; successful Playwright steps have ordered encrypted screenshots previewable in the local report |

## Nonfunctional requirements and release gates

| ID | Requirement | Verification gate |
|---|---|---|
| NFR-01 | Windows 11 and supported macOS versions for current Electron release; x64 and arm64 where build chain permits | Launchable Windows `.exe` and macOS app smoke tests on clean hosts; record OS/architecture matrix. Code signing/notarization is outside v1; show users the OS trust warning where applicable. |
| NFR-02 | No first-party hosted storage or telemetry by default | Network test shows only Microsoft identity/ADO, approved AI provider, approved site, explicitly approved dependency registries and update endpoint traffic; telemetry opt-in only if later added |
| NFR-03 | Credentials never appear in renderer, prompts, logs, reports or worker environments | Automated secret-canary tests across all outputs plus manual trace inspection |
| NFR-04 | Runs are reproducible enough to audit | Manifest contains ADO revision, source identity, URL, contract/config/tool/model versions and time; report references manifest |
| NFR-05 | Runs respect user-set limits | Tests prove wall-time, action, token, artifact-size and child-process cancellation limits |
| NFR-06 | A failed or uncertain check cannot turn into pass through test regeneration | Fault-injection cases in verdict test suite; changed assertion invalidates prior observation |
| NFR-07 | Local data is recoverable and deletable | Schema migration/backup and delete-run tests; interrupted run leaves readable partial report |
| NFR-08 | Accessibility and responsive desktop workflow | Keyboard-only completion of sign-in, organization/project selection, search, queue, run and report; labeled controls and visible focus reviewed; first-run and work-selection screens fit an 800px-wide window without horizontal scrolling |
| NFR-09 | Useful performance on ordinary developer hardware | Pilot target: search results within 3 seconds after ADO response; app UI stays responsive during 30-minute run; exact hardware and measurements published with release |
| NFR-10 | Confidential local work-item and evidence storage | Database and retained artifacts are encrypted at rest with OS-protected keys; file permissions are private; temporary plaintext lifetime is bounded and disclosed |

## Critical scenarios

1. **Both targets:** a story with five criteria and two tasks is queued; a repository test and site test each verify relevant behavior; report names the source commit, site URL and proof for each criterion.
2. **Site only:** no repository is configured; UI checks run, code-level coverage is explicitly absent, and the verdict may pass only if the contract required no code-level evidence.
3. **Repo only:** no site is configured; existing tests run, UI promises remain unverified if the contract requires browser evidence.
4. **Missing criterion:** ADO item has vague or absent acceptance criteria; planner suggests candidates, but no invented criterion is represented as source truth; run is `NEEDS_REVIEW` until user resolves it.
5. **Disputed failure:** a generated UI locator breaks while the product works; classify test failure, preserve trace and prior assertion, and avoid a product-failure claim.
6. **Unsafe target:** URL redirects to a new origin or the selected repo config contains an unapproved command; worker stops and reports `BLOCKED` with the reason.
7. **Stale source:** ADO item revision or repository ref changes between selection and run; app warns and freezes the latest user-approved snapshot.
8. **First-run onboarding and queue:** user signs in with the ADO-branded action, chooses a discovered organization or adds a validated one, selects a project, expands a Story's child Tasks and adds the Story, selected Tasks or both to the local queue. The parent acceptance criteria remain distinct from Task context.

## Success measures for pilot

- At least 90% of pilot runs have a report where every source criterion is either linked to evidence or explicitly marked unverified/blocked.
- Zero observed credential leaks in canary tests and pilot exports.
- Users can reproduce a reported failure from recorded steps and target identity in at least 80% of sampled actionable findings.
- False product-failure and false-pass rates are measured by human adjudication, not inferred from agent confidence. Release thresholds are chosen after a representative pilot dataset exists.

These are validation targets, not claims about current performance.

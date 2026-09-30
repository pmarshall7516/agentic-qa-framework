# V1 readiness research: external gates for end-to-end QA

**Checked:** 2026-09-29  
**Scope:** Evidence needed to move the documented M0–M4 gates from implemented or partially verified to a usable local v1, with particular attention to a live Azure DevOps story → agent plan → repository/browser execution → evidence report workflow. This memo records external-source facts and engineering recommendations; it does not claim that any open gate has passed.

## Executive assessment

The repository's delivery plan correctly distinguishes code availability from release evidence. Its open blockers are chiefly live identity and tenant access, clean-host Windows execution, cross-platform encrypted storage, worker isolation under adversarial/resource pressure, a staging-backed story run, and human adjudication. Official documentation supports the main design choices but also exposes practical qualifications that release checks must test: Azure CLI ADO access tokens are short-lived; Electron safeStorage protection varies by OS and unsigned macOS app identity can cause repeated Keychain prompts; Docker flags do not establish the host/runtime's effective isolation by themselves; and Playwright browser binaries/system dependencies must match the installed Playwright version.

For the requested Story 5.1 pilot, the supplied ADO link identifies work item 19959. The authenticated Chrome session was used for read-only inspection on 2026-09-29. Its AC field contains 21 criteria; its description links a Figma frame and two repository requirement sources. The current taskboard column contains five selected tasks (22375, 22529, 22564, 22604, 22605). The Figma canvas is visible, but its comment threads are hidden behind sign-in and were explicitly marked unavailable by the user. The development site presents a login page; no site account is configured and no write permission was granted. Item revisions were not visible in the browser inspection, so the app must fetch and freeze current revisions through the authenticated ADO adapter before a live plan is approved. The app must not infer missing ACs or treat task text as proof.

## Source-verified facts

### Azure DevOps access and task selection

- Microsoft documents az account get-access-token with Azure DevOps resource ID 499b84ac-1321-427f-aa17-267ca6975798; its article states Entra access tokens last one hour. The example uses az login and sends the returned token as a Bearer token to a read API. [Issue Entra tokens with Azure CLI](https://learn.microsoft.com/en-us/azure/devops/cli/entra-tokens?view=azure-devops)
- Microsoft recommends Entra ID OAuth for new ADO applications and says older Azure DevOps OAuth is deprecated; new registrations stopped in April 2025 and full deprecation is scheduled in 2026. [OAuth 2.0 authentication for Azure DevOps REST APIs](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops)
- ADO REST API 7.1 exposes a team iteration list and taskboard-work-items list. The taskboard response includes work item ID and column, which supports selecting tasks in a specified team iteration/column rather than assuming all children belong in scope. [Iterations – List](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1), [Taskboard Work Items – List](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/taskboard-work-items/list?view=azure-devops-rest-7.1)
- ADO's work item batch API has a maximum of 200 IDs. Work-item records expose revisions/history through the Work Item Tracking API; the exact batch response and source revision can therefore be captured before plan approval. [Work Items REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items?view=azure-devops-rest-7.1), [Work item tracking overview](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/?view=azure-devops-rest-7.1)

### Desktop credential and renderer boundary

- Electron's security checklist recommends context isolation, process sandboxing, restrictive CSP, limiting navigation/new windows, validating IPC senders, avoiding exposure of Electron APIs, and using a current Electron release. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- Electron documents safeStorage as a main-process API. macOS stores app encryption keys in Keychain and the docs recommend code signing for consistent behavior; Windows uses DPAPI and protects against other local users but not other applications running as the same user. Electron's async API supports key rotation and temporary unavailability. [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- Playwright requires browser binaries corresponding to the Playwright version and documents separate installation of OS dependencies. A version update may require reinstalling browsers. [Playwright browser installation](https://playwright.dev/docs/browsers)
- Playwright authentication state can contain cookies and headers that impersonate an account; Playwright advises against checking it into source control. [Playwright authentication](https://playwright.dev/docs/auth)
- Playwright can intercept/abort HTTP(S) requests and supports WebSocket inspection/routing. These are browser automation controls; the cited API describes request routing, not a host-level network firewall. [Playwright network](https://playwright.dev/docs/network), [Playwright WebSocketRoute](https://playwright.dev/docs/api/class-websocketroute)
- Playwright traces can contain DOM snapshots, actions, screenshots and network data; the trace API documentation says tracing captures browser operations/network but does not record expect assertions. [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer), [Tracing API](https://playwright.dev/docs/api/class-tracing)

### Repository worker isolation

- Docker identifies namespaces/cgroups, daemon attack surface, and container configuration as distinct security areas. Docker warns that the daemon can grant a container broad host filesystem access through mounts; only trusted users should control the daemon. [Docker Engine security](https://docs.docker.com/engine/security/)
- Docker provides controls relevant to this worker: read-only root filesystem, memory/CPU/PID limits, network mode, capability and security options, and no-new-privileges. The run reference documents that Windows container memory reporting/behavior differs by isolation mode. [Docker container run](https://docs.docker.com/reference/cli/docker/container/run)
- Docker's default seccomp profile blocks syscalls using an allowlist-style policy and Docker advises against changing it casually. Rootless mode reduces daemon/runtime privilege, but its cgroup resource limits depend on host configuration; Docker notes some configurations can ignore resource flags. [Docker seccomp](https://docs.docker.com/engine/security/seccomp/), [Docker rootless mode](https://docs.docker.com/engine/security/rootless/), [Rootless resource-limit notes](https://docs.docker.com/engine/security/rootless/tips/)

### Provider/model readiness and cost limits

- OpenAI exposes a model-list API for models currently available to an API key, while its pricing page is a separate source for per-model pricing. [OpenAI List Models](https://platform.openai.com/docs/api-reference/models/object), [OpenAI API pricing](https://platform.openai.com/pricing)
- Anthropic's Models API returns API-available model IDs, display names, context limits and capability metadata, and paginates with after_id/has_more. This can support a searchable, capability-aware model catalog, but the app must not assume every catalog model supports every required structured output. [Anthropic List Models](https://platform.claude.com/docs/en/api/models/list)
- OpenRouter documents a list-models endpoint/catalog and model metadata including supported parameters and pricing. As a routed platform, upstream model availability/pricing still needs a fresh pre-run check or conservative reservation. [OpenRouter models API quickstart](https://openrouter.ai/docs/quickstart), [OpenRouter model detail response](https://openrouter.ai/docs/api/api-reference/models/get-model)

## Recommendations for closing the remaining gates

These are engineering recommendations derived from the repository contracts and the source facts above; they are not claims that upstream documentation requires these exact test procedures.

### Gate 1 — Obtain a frozen, correct Story 5.1 QA input

1. Use a dedicated Entra-backed test account to sign in through the documented Azure CLI path. Validate the organization, project, team, selected iteration, and exact QA / Dev column using read-only APIs.
2. Retrieve work item 19959 and its child tasks, then compare task IDs/column membership to the five tasks expected by the user. Fetch full selected fields/relations in bounded batches. Record each item ID, revision, source field, retrieval time and content hash in the run contract.
3. Confirm the Story's AC field and five Task descriptions as separate provenance. Require an explicit plan mapping: every Story AC → required testing layer(s) → scenario(s) → direct evidence; task descriptions can inform coverage but cannot silently become Story ACs.
4. Refresh/recheck source revisions immediately before approval. If any item moved, changed, disappeared or cannot be read, stop plan approval and show which exact source is stale or inaccessible.

**Closure evidence:** sanitized fixture of the API sequence; live read-only pilot log with secrets omitted; frozen 19959/task IDs and revisions; human comparison against ADO; tests for empty AC, missing children, wrong column, stale revision, 401/403/429 and paged/batched responses.

### Gate 2 — Demonstrate real account and model operation within bounded cost

1. Configure one supported API-key provider and select a model discovered from that account's live model endpoint. Test invalid key, revoked key, rate limit, network timeout, unsupported structured output and malformed output.
2. Before each call, reconcile the selected model's current capability/rate metadata with the operation required (structured plan, specialist generation, reviewer); unknown cost/capability must block before sending data. Use an explicit per-run ceiling plus total call/token/fan-out/time limits and reservation accounting; compare the final estimate to provider-reported usage.
3. Execute one fully approved run against provider accounts with modest limits. Inspect the actual payload (including source scope, exact ADO fields and redaction), and verify no credentials, browser auth state, unselected repo paths or raw prompts are persisted/exported.
4. Treat consumer-plan sign-in as separate from API-key auth. Anthropic documents Claude Code CLI/SDK sign-in through Claude App Pro/Max; evaluate that official route as its own adapter and do not infer subscription entitlement from an API key or provider model list.

**Closure evidence:** live provider request/response metadata scrubbed of secret values; recorded model ID, capability/rate snapshot, input/output usage and cost bound; failed-call tests prove no tool execution or PASS verdict is produced.

### Gate 3 — Prove packaged desktop and local data behavior on supported hosts

1. Run fresh install, first launch, update/relaunch and uninstall/reinstall on a clean supported macOS host and a clean Windows 11 host. Exercise CLI missing/signed-out/expired/multi-tenant cases and confirm expired ADO access triggers safe reauthentication rather than stale data acceptance.
2. Verify encrypted profile/database/evidence reopen after restart, wrong-key/corrupt-key fail-closed behavior, deletion, key rotation/unavailability, temp-file cleanup and no plaintext secret canaries at rest. Test Windows DPAPI same-user threat limitations and macOS Keychain prompt behavior; choose and document the release signing decision needed for consistent macOS identity.
3. Check the packaged Electron build—not only development mode—for secure web preferences, CSP, allowed navigation, new-window denial, permission denial, sender/origin IPC validation and minimal preload API.
4. Record an explicit support matrix. Generated installers or cross-packaging success alone do not prove Windows runtime behavior.

**Closure evidence:** host/OS/runtime/version and package hashes; launch/restart/auth/storage records; IPC/navigation negative tests on packaged app; exact known OS limits and signing choice.

### Gate 4 — Prove repository and browser isolation on actual target OSes

1. On each supported Docker Desktop host/runtime, inspect effective—not just requested—container settings: image digest, user, mounts, capabilities, seccomp, no-new-privileges, network mode, cgroup values and cleanup. Test home/secret canaries, Docker socket, symlink/path escape, external egress, CPU/memory/PID exhaustion, timeout/cancellation, descendants and forced cleanup.
2. Test both default and documented supported Docker modes. If a mode does not actually enforce a configured limit, fail closed or clearly mark that configuration unsupported. Keep dependency installation and registry access outside the test container's default network policy unless separately approved.
3. For Playwright, install the pinned browser during first-run or package it according to Playwright's documented version pairing. Test the packaged app with a clean browser cache on each supported OS.
4. Use a staging test account and explicit approved origin. Verify off-origin navigation, redirect chains, auth redirects, service workers, WebSockets, downloads, file chooser/upload, DNS-rebinding cases, cancellation and data-changing actions. Pair Playwright route tests with OS/runtime egress controls where actual network containment is claimed.
5. Treat auth state, screenshots, traces, DOM/network captures and logs as potentially secret-bearing. Check evidence encryption at rest, retention/deletion, redaction, restricted export warnings and artifact provenance.

**Closure evidence:** adversarial fixture source and exact host/runtime matrix; effective limit/config inspection; no-host-canary/no-egress assertions; process-tree cleanup; packaged Playwright startup proof; traces reviewed for leakage.

### Gate 5 — Run and adjudicate the real end-to-end story

1. First perform a staging-only dry run using the five selected tasks and frozen Story ACs. Require the agent diagram to show selected layers/delegation and the plan to explain criterion-to-scenario coverage before user approval.
2. Run repository-only, site-only and combined smoke cases as applicable to this story. Repository code executes only from the approved immutable snapshot in the worker; site checks only against the approved development origin/test account. Verify generated tests call actual product behavior, Playwright scripts assert UI outcomes and API behavior when the plan says those layers are required, and no test can claim unsupported coverage.
3. After execution, inspect criterion-level observations and trace/screenshot/JUnit/repository evidence. Ensure every summary statement links to observations; contradictions, failed fixtures, missing provenance, no assertion, flaky evidence or reviewer quality concern cannot yield PASS.
4. Have two reviewers independently adjudicate the same 19959 report. Capture disagreement, correct the contract/reviewer prompts/policy where appropriate, and rerun. Then complete the delivery-plan minimum 20-story/two-reviewer pilot before calling M4/beta ready.
5. Use the desktop app's own Playwright acceptance suite against the built app for the full flow: provider config/model search, ADO sign-in/profile/iteration/column selection, queue and provenance, approval disclosure, plan/diagram, generated code, run progress/cancel, evidence, review/override, exports, restart/history and deletion. Keep mock mode for repeatable UI tests, but count the live 19959 pilot separately as external integration evidence.

**Closure evidence:** redacted run manifest and immutable report; Story/task revisions; commit/snapshot hash and staging deployment identity; raw evidence hashes; full desktop Playwright output/screenshots; two adjudications and final resolution; open-risk list. No live success is assumed in this memo.

## Suggested release sequencing

1. **Unblock inputs:** obtain pilot ADO tenant/account, staging test account/data, supported provider credentials with a small explicit spend cap, macOS/Windows hosts, and two reviewers.
2. **Close M0 first on each supported host:** install/launch, Entra CLI token use and read-only ADO call, encrypted storage/key semantics, actual worker isolation and browser installation. Do not label a host supported until its own checks pass.
3. **Close M1/M2 live integration:** Story 19959 snapshot correctness, provider discovery/capability/budget behavior, user-visible disclosure and approval.
4. **Close M3 with one slice at a time:** repo-only, site-only, then both; assert generated checks/evidence link correctly; run hostile input/cancellation/security suite.
5. **Close M4:** full built-app Playwright workflow, exports/history/delete and two-person adjudication; finish the 20-story pilot; publish known gaps and supported-host matrix.

## Repository state observed during research

The working tree was already dirty before this memo. The delivery plan and M0 record describe M0 and M1–M4 as open. docs/spec/08-m0-feasibility-record.md records partial macOS package launch, cross-packaged Windows binaries, automated local storage checks, and a Docker isolation run on macOS-hosted Linux engine; it explicitly records no Windows host run, no live ADO run, and no 20-story adjudication. This memo does not re-run those tests or alter their status.

## Story 5.1 and target-repository inspection (2026-09-29)

- ADO UI showed Story 19959, “5.1 New Pull Sheet Screen,” in iteration `Derse\\9.16.26 to 9.29.26`, with 21 criteria in `Microsoft.VSTS.Common.AcceptanceCriteria`. The criteria cover entry/CRM behavior, calculated date defaults, prior-event replacement, inventory search/sort, property fields/filtering, availability/conflicts, package component availability, Sold transition, Not Returning, Client Leaving bulk confirmation, Do Not Use downstream visibility, transshipping assignment and cross-event behavior, ad-hoc lines, graphics expiry, release, CPQ CSV, PDF, multiple sheets, and STO exclusion. The ADO Description links the Figma frame `25-4945`, repo requirements, detailed validation rules, and Excel mockup. The visible frame contains the pull-sheet and transship-assignment screens; comment content was not accessible.
- The five tasks in the selected board column are 22375 “Client Leaving Derse Button,” 22529 “Containers Don't Show up on Add existing or pull sheet,” 22564 “Properties List - Do Not Use,” 22604 “Add Existing Image,” and 22605 “Remove checks on Sold for availability.” Task 22529 includes an explicit clarification question about empty containers versus all contents. Task 22564 references Story 7.8; that linked work remains context unless Story 5.1 criteria explicitly require it.
- The ADO UI also showed other children outside the requested column. In particular, 22613 “Graphically Display Item Availability and Conflicts” was not one of the five selected tasks at inspection time. The app must use current taskboard membership and must not broaden scope to all 47 children.
- The separate Derse Vista repository is .NET 10 + React. It contains `DerseVista.slnx`, multiple `.csproj` files, a client `package-lock.json`, and Node scripts. No application `.agentic-qa.yml` appeared in the inspected file inventory; its own guidance requires existing test commands and disallows unapproved dependencies. The QA framework must not modify that repository. It may run only against a disposable filtered snapshot with its no-egress command policy; restore/install requiring absent packages must block with a clear prerequisite instead of reaching the network.
- The development URL redirected to `/login` and rendered an email/password form. Without an authenticated test account and approved test-data scope, only unauthenticated/read-only site checks are available. No login, form submission, record creation, status transition, or cleanup action was attempted.

These are point-in-time UI observations, not a replacement for adapter-sourced revisions, a site deployment identity, or a live QA run manifest. Story/task revisions, source commit, and site deployment must be captured by the product before live execution.

## Claude subscription integration research (2026-09-29)

Anthropic's official Claude Code setup documentation lists Claude App Pro/Max sign-in as a supported authentication method. Its CLI reference documents non-interactive `claude -p`, JSON output, model selection, and a maximum-turns limit; the SDK reference documents local CLI execution and response usage fields. Therefore, subscription-backed use is technically possible through Anthropic's official Claude Code CLI/SDK, separate from Anthropic API-key billing. The current app only implements API-key adapters. An app-owned Claude Code adapter still needs security validation: prevent project filesystem/tool/MCP access, identify installed/signed CLI versions, enumerate models supported by the local account, expose subscription usage limits, and keep credentials owned by the CLI. No credential extraction or unofficial API use is justified. [Claude Code setup](https://docs.anthropic.com/en/docs/claude-code/getting-started), [CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage), [SDK docs](https://docs.anthropic.com/en/docs/claude-code/sdk).

## Primary references

- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Azure CLI Entra tokens for Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/cli/entra-tokens?view=azure-devops)
- [Azure DevOps OAuth guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops)
- [Azure DevOps team Iterations API](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1)
- [Azure DevOps taskboard work items API](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/taskboard-work-items/list?view=azure-devops-rest-7.1)
- [Azure DevOps Work Items API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items?view=azure-devops-rest-7.1)
- [Docker Engine security](https://docs.docker.com/engine/security/)
- [Docker container run controls](https://docs.docker.com/reference/cli/docker/container/run)
- [Docker seccomp](https://docs.docker.com/engine/security/seccomp/)
- [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [Playwright authentication](https://playwright.dev/docs/auth)
- [Playwright network routing](https://playwright.dev/docs/network)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Playwright tracing API](https://playwright.dev/docs/api/class-tracing)
- [OpenAI Models API](https://platform.openai.com/docs/api-reference/models/object)
- [OpenAI API pricing](https://platform.openai.com/pricing)
- [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list)
- [OpenRouter model catalog API](https://openrouter.ai/docs/quickstart)
- [OpenRouter model metadata](https://openrouter.ai/docs/api/api-reference/models/get-model)

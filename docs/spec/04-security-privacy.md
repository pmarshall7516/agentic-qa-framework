# Security, privacy and trust boundaries

**Status:** first-release security requirements. This is a design and verification checklist, not a certification.

## Assets and adversaries

Protect ADO delegated tokens, AI provider credentials, staging test credentials, source code, work-item text, run artifacts, local files outside the chosen project, and integrity of the verdict. Treat ADO descriptions, repository files/config/scripts, web pages, model output and test artifacts as **untrusted input**, including instructions embedded in them. A signed desktop app does not make repository code or a visited page trustworthy. OWASP documents prompt injection as a risk when external text influences LLM behavior. [OWASP LLM01](https://genai.owasp.org/download/46133/?tmstv=1741814631).

## Trust boundaries

| Boundary | Allowed | Denied by default |
|---|---|---|
| Renderer → main process | Typed, schema-validated UI commands for account/project/queue/run/report | Arbitrary IPC channel, shell, filesystem, token access |
| Main process → ADO | Delegated read requests to validated Microsoft ADO hosts | User-supplied API host, token in URL, write endpoints |
| Main process → AI provider | User-previewed, redacted, size-limited context over HTTPS | Tokens, raw env files, unselected files, browser auth state, blanket repo upload |
| Coordinator → repository worker | Approved snapshot and reviewed command manifest | Original working tree write access, OS home, Docker socket, ADO/provider credentials |
| Coordinator → browser worker | Approved origin, scenario, action cap, test-account secret reference | Open-ended navigation, host filesystem, arbitrary downloads/uploads, provider/ADO credentials |
| App → local disk | Versioned run metadata and scoped evidence | Plaintext credentials, silent export or sync |

## Identity and credential handling

- Reuse the user's Azure CLI session. The app obtains an Entra-backed Azure DevOps token with the documented Azure CLI resource ID; there is no app-owned client ID or secret. Azure CLI owns the credential cache and its platform security boundary.
- Invoke the fixed CLI executable with fixed argument arrays, no shell interpolation, bounded output and timeouts. Never log stdout from token commands. Token output stays in main-process memory for ADO requests and is never sent to renderer, report, prompt, or worker.
- Credentials are scoped by account, organization and target. No token is passed to test subprocesses. Browser test credentials are injected only into the browser worker at use time, not into prompts, command line, environment dumps or network logs.
- Disconnecting clears the app's selected CLI account and offers a native choice to keep or delete local QA data. It does not call `az logout`; other CLI workflows retain their sign-in. Delete removes local queues, retained snapshots, history/contracts, encrypted evidence, saved ADO profiles and run targets. Token expiration/401 asks the user to sign in again.
- PATs are not the default sign-in path. An enterprise exception needs separate design, limited scope, expiration and user-facing risk disclosure; it is outside first release.

## Local data and AI disclosure

An AI provider and compatible model are required for every QA run; there is no provider-free deterministic planning path. Provider-specific API keys are imported through a native file picker into SQLCipher-backed local settings. Credentials are retrieved only in the main process and are not returned to renderer IPC, prompts, reports, logs or repository/browser workers. The user should delete the source key file after import. Anthropic documents Claude Code CLI/SDK sign-in through Claude App Pro/Max; this app does not yet implement that separate provider adapter. Any implementation must leave credentials CLI-owned, disable CLI tools/MCP and project-file access, and account for plan usage without claiming API spend. Never reuse browser cookies or extract a CLI credential cache.

Before a run-level approval, display provider/model choices and the context/permission envelope: exact ADO source IDs/revisions/fields, repository paths or bounded file scope, target origin, tools/commands, role models, token/call/agent/time/action/artifact limits and conservative cost estimate. Users can exclude context. After approval, provider calls and tool actions proceed autonomously only within this envelope; any request for new files, origins, tools, commands or budget pauses the run. The main process records a hash/metadata manifest of transmitted context and usage. Keep raw prompts out of reports/logs unless the user explicitly retains them locally. Provider retention and data-handling terms apply to approved transmitted data.

Repository files and selected Task/Requirement fields may be provider context because code review, test planning and generation require them. Exclude credentials, environment files, private keys, ADO/provider tokens, browser credentials and unrelated files. Redaction is best effort; users can exclude files. Browser secrets are resolved by reference and injected only into the browser worker at use time. Provider-specific adapters use fixed HTTPS endpoints, bounded requests/responses and redirect rejection. A custom endpoint must be an explicit supported protocol and user-approved destination. Record provider-reported input/output usage, cost estimates, limits and model identity in the run manifest; reserve worst-case estimated usage before calls and block if rate data is unavailable or the remaining budget is insufficient. Provider billing remains authoritative. Provide retention and deletion controls; never upload telemetry by default.

Retained work-item metadata, app-local repository configs, run progress and reports use an encrypted SQLCipher database. Retained artifacts, including successful ordered Playwright screenshots, use authenticated encryption with per-artifact nonces and keys derived from an OS-protected random master key. Screenshot previews are decrypted in main-process memory for the local UI with an 8 MiB limit; the temporary plaintext buffer is cleared after conversion. Keep the master key out of the renderer and workers. Restrict app data directory permissions. Plaintext can exist briefly in worker scratch and memory during a run, so document the need for a trusted workstation and full-disk encryption; app-level encryption does not protect against malware executing as the same signed-in user. [SQLCipher](https://www.zetetic.net/sqlcipher/), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Repository execution

The user chooses a local repository or an ADO repository/ref. The app creates a disposable snapshot; it never runs `npm install`, hooks, test scripts or generated commands in the original working tree. The container runs without `--privileged`, host networking, Docker socket, or extra capabilities; use non-root user, seccomp/default confinement, no-new-privileges, CPU/memory/process/wall-time quotas, read-only base filesystem, and only scoped writable scratch/artifact mounts. Dependency installation requires a separate network approval and registry policy. These controls reduce exposure; container runtimes and mounted files remain part of the trusted computing base. [Docker security](https://docs.docker.com/engine/security/), [container run controls](https://docs.docker.com/reference/cli/docker/container/run).

The command manifest is validated against a schema and explicitly included in the run envelope. No model-proposed shell string or executable/argument array is executed directly. A specialist may generate tests in a disposable copy and invoke only reviewed command IDs from the approved manifest. The worker reports every modified file; accepting/exporting any generated test into the real repo is a separate user action. A test that needs privileged containers, host mounts or access to production secrets is unsupported until an explicit security review defines a dedicated worker.

## Site execution

Default to nonproduction HTTPS origins. A localhost HTTP URL is permitted for local development after a specific user choice; arbitrary insecure remote HTTP is blocked. Require an explicit site origin allowlist, test account and test-data scope. Never assume browser-only actions are read-only: form submission, deletion, payment and outbound email can have real effects. The run plan labels data-changing scenarios and asks for explicit approval; destructive actions are disabled by default. Browser navigation/requests to new origins are blocked by worker policy unless approved for a known auth flow. This is application-level control, not a network firewall; pilot security testing must verify redirects, service workers, WebSockets, downloads and DNS behavior. Strong egress isolation requires a network boundary outside Playwright.

Capture a screenshot after each completed approved step and retain failure traces by default. Mark screenshots and traces restricted because page content, DOM snapshots, request URLs and payloads can contain personal or secret data. Raw artifact export still requires the warning and native save dialog. Playwright documents the data available in traces. [Trace Viewer](https://playwright.dev/docs/trace-viewer).

## Agent and report integrity

Untrusted source text is presented to agents as data, never as system/developer instructions. Agent tool access comes from a fixed typed catalog; a capability broker validates every call against the approved envelope. Agents cannot add capabilities, origins, commands, permissions, budgets, ADO scopes or verdict status. Validate structured plans/results against schemas and source provenance. Generated tests cannot weaken source criteria or retroactively change prior observations. Reports link each conclusion to immutable observations/evidence; human overrides are append-only with reason and author. Artifact hashes detect accidental mutation. The delegation diagram is rendered from validated assignments, never model-provided executable markup. An export contains a manifest and evidence hash list.

## Release security tests

1. Seed canary secrets in ADO description, repo `.env`, site cookie, HTTP response and test logs. Confirm none appear in model payload, UI renderer state, ordinary logs or exported reports.
2. Place prompt-injection text in a work item, README and page. Confirm it cannot trigger shell, extra network destination, credential access or verdict override.
3. Run a malicious repo fixture that tries to read home directory, Docker socket and host network; verify it fails within worker boundary on Windows/macOS pilot hosts.
4. Try cross-origin redirects, download URLs, data-changing action without approval, expired token and interruption. Confirm explicit block/partial report.
5. Inspect signed installer, update channel, dependency scan and Electron security settings. [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
6. Verify encrypted database/artifacts cannot be read from disk without the OS-protected key, and that crash recovery removes stale plaintext scratch on both platforms.

Security sign-off for a public release must include review of these test results and an incident/update response process.

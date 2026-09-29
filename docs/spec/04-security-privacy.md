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

The deterministic local planner works without an AI provider. Optional v1 OpenAI scenario suggestions use the fixed Responses API endpoint. The API key is imported through a native file picker into SQLCipher-backed local settings; it is not returned to renderer IPC, logs, prompts, reports or repository workers. The user should delete the source key file after import.

Before each provider request, display the exact request body, provider/model, selected acceptance-criteria snippets, exclusions, conservative input-token estimate, and maximum output-token budget. The user can exclude criteria or cancel. Known credential patterns are redacted before preview; secret-like model output is rejected. Approval is a separate per-request action; preview generation itself makes no network request. Do not send work-item descriptions/tasks, repository files, test artifacts, ADO credentials or browser credentials. Use `store: false`. Record provider-reported input/output token usage in the run manifest and exports. Token ceilings are enforced; exact dollar cost is not guaranteed because model/account prices vary. Provider retention and data-handling terms apply after explicit approval.

Redact likely secrets before preview and again before transmission and artifact export: bearer tokens, PATs, passwords, cookies, `.env` values, private keys, connection strings and configured patterns. Redaction is best effort; a user must be able to exclude sensitive files entirely. Do not send full repository trees by default. Record a hash/metadata manifest of transmitted context, not the raw prompt, unless the user explicitly saves it locally. Provide retention and deletion controls; never upload telemetry by default.

Retained work-item metadata and reports use an encrypted SQLCipher database. Retained artifacts use authenticated encryption with per-artifact nonces and keys derived from an OS-protected random master key. Keep the master key out of the renderer and workers. Restrict app data directory permissions. Plaintext can exist briefly in worker scratch and memory during a run, so document the need for a trusted workstation and full-disk encryption; app-level encryption does not protect against malware executing as the same signed-in user. [SQLCipher](https://www.zetetic.net/sqlcipher/), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Repository execution

The user chooses a local repository or an ADO repository/ref. The app creates a disposable snapshot; it never runs `npm install`, hooks, test scripts or generated commands in the original working tree. The container runs without `--privileged`, host networking, Docker socket, or extra capabilities; use non-root user, seccomp/default confinement, no-new-privileges, CPU/memory/process/wall-time quotas, read-only base filesystem, and only scoped writable scratch/artifact mounts. Dependency installation requires a separate network approval and registry policy. These controls reduce exposure; container runtimes and mounted files remain part of the trusted computing base. [Docker security](https://docs.docker.com/engine/security/), [container run controls](https://docs.docker.com/reference/cli/docker/container/run).

The command manifest is validated against a schema and explicitly previewed. No model-proposed shell string is executed directly. Generated tests, if enabled later, run only after review in the same disposable boundary. The worker reports every modified file; accepting any generated test into the real repo is a separate user action. A test that needs privileged containers, host mounts or access to production secrets is unsupported until an explicit security review defines a dedicated worker.

## Site execution

Default to nonproduction HTTPS origins. A localhost HTTP URL is permitted for local development after a specific user choice; arbitrary insecure remote HTTP is blocked. Require an explicit site origin allowlist, test account and test-data scope. Never assume browser-only actions are read-only: form submission, deletion, payment and outbound email can have real effects. The run plan labels data-changing scenarios and asks for explicit approval; destructive actions are disabled by default. Browser navigation/requests to new origins are blocked by worker policy unless approved for a known auth flow. This is application-level control, not a network firewall; pilot security testing must verify redirects, service workers, WebSockets, downloads and DNS behavior. Strong egress isolation requires a network boundary outside Playwright.

Capture traces on failure by default and mark them restricted because DOM snapshots, request URLs and payloads can contain personal or secret data. Strip auth headers/cookies and sensitive response bodies before report/export; if safe redaction is impossible, exclude the trace from ordinary export and state why. Playwright documents the data available in traces. [Trace Viewer](https://playwright.dev/docs/trace-viewer).

## Agent and report integrity

Untrusted source text is presented to the model as data, never as system/developer instructions. Tool access is fixed by code; the model cannot add capabilities, origins, commands, budgets or ADO scopes. Validate structured model output against schemas and contract provenance. Test generation/healing cannot weaken expected assertions or mark a failed product behavior as passing. Report verdict is computed from immutable observations; human overrides are append-only with reason and author. Artifact hashes detect accidental mutation. An export contains a manifest and hash list.

## Release security tests

1. Seed canary secrets in ADO description, repo `.env`, site cookie, HTTP response and test logs. Confirm none appear in model payload, UI renderer state, ordinary logs or exported reports.
2. Place prompt-injection text in a work item, README and page. Confirm it cannot trigger shell, extra network destination, credential access or verdict override.
3. Run a malicious repo fixture that tries to read home directory, Docker socket and host network; verify it fails within worker boundary on Windows/macOS pilot hosts.
4. Try cross-origin redirects, download URLs, data-changing action without approval, expired token and interruption. Confirm explicit block/partial report.
5. Inspect signed installer, update channel, dependency scan and Electron security settings. [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
6. Verify encrypted database/artifacts cannot be read from disk without the OS-protected key, and that crash recovery removes stale plaintext scratch on both platforms.

Security sign-off for a public release must include review of these test results and an incident/update response process.

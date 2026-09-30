# M0 feasibility and threat-model record

**Status:** BLOCKED — local package generation, macOS app launch, automated local-storage checks, and partial real container-isolation checks have evidence; Windows runtime, live Entra/ADO and remaining worker controls are unverified.
**Recorded:** 2026-09-27
**Scope:** M0 in [the delivery plan](06-delivery-plan.md).

## Observed environment

| Item | Observed result |
|---|---|
| Checkout | Branch `implementation-base-v1`; Electron/React/TypeScript app and domain, ADO, encrypted storage, reporting, Playwright, and repository-worker packages are present. |
| Host | macOS 26.6.2, arm64. |
| Node/npm | Node 22.21.1; npm 10.9.4. |
| Container runtime | Docker Desktop engine 28.4.0, Linux arm64 engine, running. `node:22-bookworm-slim` is now pulled and has passed the repository-worker integration checks. |
| macOS signing tools | `codesign` and `security` are present. Electron Builder found no Developer ID identity; app signing was skipped. |
| Windows validation tools | This checkout has no Windows shell or Windows test host exposed. The installed Windows App appears in the macOS app inventory, but its UI calls timed out, so no Windows installation or runtime evidence was obtainable. |
| App package | Electron 44.4.5, Node 22.21.1, Vite 8.3.1, electron-builder 26.15.3. |

**Distribution decision:** The product owner explicitly excluded Windows signing from v1 and requested launchable `.exe` files. Windows signing and macOS notarization are outside local-testing v1. Unsigned binaries may show operating-system reputation warnings.

## M0 experiment results

| Gate / experiment | Result | Evidence and remaining work |
|---|---|---|
| macOS arm64 package and launch | PASS (local smoke) | Fresh `npm run package:mac` produced `apps/desktop/release/mac-arm64/Agentic QA.app` and `Agentic QA-1.0.0-arm64.dmg` (146 MiB). Relaunched the packaged app from a fresh process after the current bundle was built; macOS accessibility and screenshot showed the Connections screen, including the Entra registration disclosure, loaded from `app.asar/dist/index.html`. Current DMG SHA-256: `6108e0fdca86aa2811437b32153e82fb0e1850928386724c3fe5b7ef3f0a92f1`. Not a clean-host install test. |
| Windows x64 `.exe` generation | PASS (cross-package only) | Fresh `npm run package:win` produced `apps/desktop/release/Agentic-QA-Setup-1.0.0-x64.exe` (123 MiB) and `apps/desktop/release/Agentic-QA-Portable-1.0.0-x64.exe` (122 MiB). Both are PE32 GUI executables. Current SHA-256: setup `75630e1afb438135c118ec9a6a915305af5d7f76c6a00c2071c3271faa461436`; portable `5bcb6464ec68c3b0c325d3067d88558d0521c4370df32fd86f3ee5642128e7d4`. Electron Builder confirms code signing was skipped. Does not verify Windows launch or install. |
| Windows signing | OUT OF V1 SCOPE | Owner decision. `signExecutable: false` and `signAndEditExecutable: false` are configured. |
| Windows arm64 package | NOT BUILT | Current release target is Windows x64. |
| Windows 11 install and launch | NOT RUN | No Windows shell or test host is accessible from this environment. |
| Entra PKCE sign-in and MSAL cache | PARTIAL | Packaged macOS startup succeeded using Electron `safeStorage`. Automated cache checks cover encrypted persistence, plaintext canaries and corrupt/unavailable fail-closed behavior. Live PKCE, ADO token use, restart persistence and Windows OS protection remain unverified. |
| ADO project/work-item reads and permission cases | NOT RUN | Requires a pilot Entra app registration, organization/project and authorized test account. |
| SQLCipher storage | PARTIAL | Packaged app opened its encrypted local store at startup. Automated checks cover plaintext canaries, reopen/wrong-key behavior, queue persistence and migrations. Windows runtime/key protection remains unverified. |
| Encrypted evidence and crash cleanup | PARTIAL | AES-256-GCM artifact tests cover decryption, tamper/hash detection and restricted metadata. Browser traces, repository stdout/stderr excerpts and JUnit outputs are encrypted at rest, linked to observations, and require a restricted-export warning plus native save dialog. Normal run scratch is deleted; stale private scratch folders are cleaned at startup. Crash injection and Windows checks remain open. |
| Repository worker isolation | PARTIAL (security gate open) | `docker pull node:22-bookworm-slim` succeeded with digest `sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c`. The current `QA_DOCKER_INTEGRATION=1 npx vitest run packages/repo-worker/tests/docker-integration.test.ts --reporter=verbose` passed three tests against the app's pinned image: a host canary and Docker socket were absent; external networking failed; the worker ran as UID 10001 with effective cgroup values 2 GiB memory, 2 CPUs and 128 PIDs; `/proc/mounts` showed a read-only root and writable `/workspace` tmpfs; normal cleanup removed the labeled container; cancellation force-removed a live worker. These verify runtime settings and tested boundaries on this macOS-hosted Docker Desktop Linux engine, not exhaustion resistance or Windows Docker Desktop behavior. No Windows run occurred; CPU/memory exhaustion and hostile child-process persistence remain open. |
| Browser worker boundary | PARTIAL | Local Chromium Playwright tests pass for explicit HTTP origin checks, assertions, cancellation, service-worker/download restrictions and restricted failure traces. `npx vitest run packages/browser-worker/tests/runner.test.ts --reporter=verbose` passed four tests; the off-origin WebSocket test confirms the handshake never reaches a local external test server. Packaged first-run download, staging account, Windows browser behavior and malicious state-change/DNS cases remain unverified. |
| Live story and two-reviewer adjudication | NOT RUN | No pilot ADO story, staging site, test account or second reviewer supplied. M4 still needs at least 20 varied stories/tasks. |
| Prior AI provider integration | Historical pre-ADR-0004 check: optional OpenAI scenario-suggestion path existed. Current implementation evidence is tracked in the M2/M3 rows of the [delivery plan](06-delivery-plan.md). | This historical record predates mandatory provider-backed planning. The current implementation adds OpenAI, Anthropic API-key and OpenRouter adapters, encrypted key import, agentic plan generation, specialist delegation, bounded source inspection, generated Playwright and repository tests, and post-run evidence/code review. No live provider call was made. M2/M3 host and live-provider gates remain open; see [ADR-0004](../decisions/ADR-0004-mandatory-agentic-provider-adapters.md) and the [agentic delivery gates](06-delivery-plan.md). |

## Gate decision

## Latest verification commands

| Command | Outcome |
|---|---|
| `npm run typecheck` | PASS |
| `npm test -- --reporter=dot` | PASS — 20 test files passed, 1 opt-in file skipped; 98 tests passed, 3 opt-in tests skipped. |
| `npx vitest run apps/desktop/tests/App.keyboard.test.tsx --reporter=verbose` | PASS — 3 tests cover Tab/Enter navigation across all workflow screens, Entra client ID/save/sign-in, organization/project selection, search/queue, run approval/execution, report export and reviewer classification. |
| `QA_DOCKER_INTEGRATION=1 npx vitest run packages/repo-worker/tests/docker-integration.test.ts --reporter=verbose` | PASS — 3 tests against pinned `node:22-bookworm-slim`, including effective identity/limit/filesystem/socket checks. |
| `npx vitest run packages/browser-worker/tests/runner.test.ts --reporter=verbose` | PASS — 4 tests, including cross-origin WebSocket blocking. |
| `npm run package:mac` | PASS — macOS arm64 app and DMG generated; fresh app showed the Connections screen at `app.asar/dist/index.html`. |
| `npm run package:win` | PASS — unsigned Windows x64 NSIS installer and portable `.exe` generated; signing skipped by explicit build configuration. |
| `npm run build` | PASS — production renderer and Electron main/preload bundles built. |
| `git diff --check` | PASS |

M0 **does not pass**. Local macOS launch, Windows x64 installer generation, automated storage checks and a stronger real Docker boundary probe succeeded. Clean-host Windows installation, live identity/ADO reads, Windows container isolation, packaged Chromium installation on a clean profile, cross-platform key protection, and resource-exhaustion/hostile child-process checks have not been demonstrated. Continued implementation does not waive these gates.

No supported OS matrix can be declared yet. Generated packages target Windows x64 and macOS arm64. Windows 11 launch, supported macOS versions, and Docker runtime behavior need host checks. The Electron probe and production package builds exist, but no Tauri comparative package was produced. Rust/cargo are installed on this host; `xcrun --show-sdk-version` exits with Xcode's notice that its license has not been accepted. The native Tauri build cannot be measured here without a user accepting that agreement. The Windows test host is also unavailable. Electron remains a provisional, directed implementation choice rather than a completed comparison; see [ADR-0003](../decisions/ADR-0003-provisional-electron-stack.md).

## Inputs needed to close M0/M4 gates

1. Entra public app client ID, pilot tenant(s), Azure DevOps organization/project, authorized test account and a Conditional Access path; include an MSA-only case if available.
2. Pilot repository and malicious fixture, staging site/test account, and a known-bug scenario.
3. Windows 11 test host/VM and macOS test host access. No signing identity is required.
4. A supported OpenAI, Anthropic API or OpenRouter API key for a live, user-approved agentic planning pilot; review the account's data handling and billing limits first. The app blocks QA runs until an agent is configured.
5. Two reviewers for an evidence story and 20 varied stories/tasks for the M4 adjudication pilot.

Record each check with its exact command, artifact identity, host/runtime and outcome. Do not mark M0 or M4 complete until their delivery-plan exit gates have fresh evidence.

# M0 Feasibility Probes Implementation Plan

> **For agentic workers:** Execute inline in this task. Keep the probes disposable and do not commit.

**Goal:** Build comparable Electron and Tauri/Node-sidecar probes and an evidence harness, then use the selected stack to complete M1–M4 and produce the first useful local v1.

**Architecture:** A shared React/Vite renderer is packaged by two isolated shells. Electron uses a narrow preload API; Tauri exposes only a small typed command surface and launches a bundled Node sidecar. A probe runner records versions, artifact sizes, security configuration, and explicit PASS/FAIL/NOT RUN results. Product owner excludes Windows code signing from v1; a launchable unsigned `.exe` is the target. Clean Windows launch, live identity, and worker-isolation evidence still need real target environments.

**Tech Stack:** TypeScript, React, Vite, Electron, Tauri v2, Rust, Vitest, Node test runner, Docker Desktop.

**Spec:** `docs/superpowers/specs/2026-09-27-agentic-qa-m0-design.md`, `docs/spec/06-delivery-plan.md`, and `docs/spec/04-security-privacy.md`.

## Global Constraints

- M0 is a real gate: launchable unsigned app on Windows/macOS, Entra sign-in and one ADO read, hostile repository fixture isolation, and exact supported OS/runtime matrix require evidence. Windows signing is out of scope for v1.
- Renderer code is untrusted: Node integration disabled, context isolation and renderer sandboxing enabled, restrictive CSP, typed/schema-validated IPC, sender-origin checks, and constrained navigation.
- Repository code is untrusted and runs only from an immutable disposable snapshot without host home, Docker socket, host networking, privilege, credentials, or unreviewed network access.
- Site-only checks must remain possible without a container runtime.
- Do not introduce ADO writes, hosted storage, sharing, unattended runs, telemetry, or M5/M6 functionality.
- Never commit, publish, upload, or distribute probe builds as product releases.
- Preserve all existing user changes; do not commit.

---

## Planned files

- `probes/m0/package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`: isolated shared UI and local probe scripts.
- `probes/m0/src/`: the small shared UI that reports shell and runtime metadata without accepting secrets.
- `probes/m0/electron/main.ts`, `preload.ts`, `security.ts`: hardened shell entry, typed minimal bridge, and explicit security configuration.
- `probes/m0/tauri/`: Tauri v2 shell, minimized capabilities, and Node sidecar launch protocol.
- `probes/m0/tests/`: behavior checks for Electron security settings, bridge surface, and evidence status serialization.
- `probes/m0/scripts/`: local build/evidence collector and validation scripts; do not collect environment secrets.
- `docs/spec/08-m0-feasibility-record.md`: fresh evidence and blocked gates.

## Task 1: Establish probe contracts

**Files:**
- Create: `probes/m0/package.json`
- Create: `probes/m0/tsconfig.json`
- Create: `probes/m0/vite.config.ts`
- Create: `probes/m0/tests/security.test.ts`
- Create: `probes/m0/src/security.ts`

**Interface:** `getElectronSecurityPolicy()` returns immutable values for `nodeIntegration`, `contextIsolation`, `sandbox`, `webSecurity`, `webviewTag`, CSP, and navigation policy. `validateProbeResult(input)` accepts only `PASS | FAIL | NOT RUN`, platform/runtime, evidence path, and reason; it rejects secret-shaped fields and missing evidence for PASS.

- [ ] Write tests proving defaults deny Node integration, enable context isolation/sandbox/web security, block webviews and unexpected navigation, and reject a PASS result without evidence.
- [ ] Run `npm test -- --run` in `probes/m0` and verify the new tests fail because contracts are absent.
- [ ] Implement only the policy/result contracts needed by those tests.
- [ ] Run the same command and verify those tests pass.

## Task 2: Build the shared renderer and Electron shell

**Files:**
- Create: `probes/m0/index.html`
- Create: `probes/m0/src/main.tsx`
- Create: `probes/m0/src/App.tsx`
- Create: `probes/m0/electron/main.ts`
- Create: `probes/m0/electron/preload.ts`
- Create: `probes/m0/electron/security.ts`
- Modify: `probes/m0/package.json`, `probes/m0/vite.config.ts`
- Test: `probes/m0/tests/security.test.ts`

**Interface:** Preload exposes only `probe.getRuntimeInfo(): Promise<{ shell: string; appVersion: string; platform: string; arch: string }>`; it exposes no filesystem, shell, token, or generic IPC primitive.

- [ ] Add a test proving the policy is applied to each `BrowserWindow` and packaged UI navigation is allowlisted.
- [ ] Run the targeted test and verify it fails because the Electron entry/security module is absent.
- [ ] Implement the Electron entry and minimal React screen using only `window.probe.getRuntimeInfo()`.
- [ ] Build the Vite renderer, run the targeted tests, and package a local unsigned macOS app/DMG.
- [ ] Launch the app and record the exact command, Electron version, architecture, package hash, package size, and observed startup result.

## Task 3: Add the Tauri shell and sidecar protocol

**Files:**
- Create: `probes/m0/tauri/Cargo.toml`
- Create: `probes/m0/tauri/tauri.conf.json`
- Create: `probes/m0/tauri/capabilities/default.json`
- Create: `probes/m0/tauri/src/main.rs`
- Create: `probes/m0/sidecar/sidecar.mjs`
- Create: `probes/m0/tests/sidecar-protocol.test.ts`
- Modify: `probes/m0/package.json`

**Interface:** Sidecar speaks newline-delimited JSON over stdin/stdout with `{version:1, id, method:'runtime.info'}` and returns `{version:1, id, ok:true, result:{shell, appVersion, platform, arch}}`. Reject unknown methods, protocol versions, malformed input, oversized lines, and extra output channels. Never pass secrets.

- [ ] Write sidecar protocol tests for runtime info, malformed JSON, unknown method, wrong version, and overlong line rejection.
- [ ] Run targeted tests and verify they fail because the sidecar/protocol implementation is absent.
- [ ] Implement the minimal Node sidecar and Tauri command adapter with least-privilege capabilities.
- [ ] Run the Tauri build, launch its macOS bundle, and record build command, versions, architecture, package hash/size, and startup result.
- [ ] Confirm the shared renderer displays equivalent runtime metadata in both shells.

## Task 4: Produce a reproducible local M0 report

**Files:**
- Create: `probes/m0/scripts/collect-evidence.mjs`
- Create: `probes/m0/scripts/validate-evidence.mjs`
- Modify: `probes/m0/tests/security.test.ts`
- Modify: `docs/spec/08-m0-feasibility-record.md`

**Interface:** Collector records only allowlisted nonsecret values (OS release/architecture, Node/Rust/Docker tool versions, package hashes/sizes, command exit status) and writes a schema-versioned JSON report. Required unavailable checks remain `NOT RUN` with a reason; the validator refuses an overall M0 `PASS` if any required gate is not PASS.

- [ ] Write tests proving environment variables containing names matching `TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL` are never serialized and any unpassed required gate prevents overall PASS.
- [ ] Verify the tests fail before implementation.
- [ ] Implement the allowlisted collector and gate validator.
- [ ] Run all probe tests, both macOS package builds, the collector, and whitespace validation.
- [ ] Update the M0 record with only observed outputs; keep Windows signing, live ADO, storage, browser, and malicious-worker checks NOT RUN until actually exercised.

## Task 5: Resume gated experiments

**Files:**
- Modify: `probes/m0/` and `docs/spec/08-m0-feasibility-record.md` only as each supplied environment becomes available.

- [ ] Configure the user-owned Entra public client and verify PKCE, token caching, Conditional Access, scopes, organization discovery, and one read in the supplied pilot tenants.
- [ ] Build and smoke launchable unsigned packages on Windows 11 and target macOS hosts; record the exact supported matrix.
- [ ] Exercise SQLCipher and encrypted evidence persistence, migrations, key loss, offline readability, permissions, and crash cleanup.
- [ ] Run the malicious repository fixture on both Docker Desktop platforms and verify host-secret, socket, network, resource, and descendant-cleanup controls.
- [ ] Exercise browser-origin and data-changing action boundaries against the dedicated staging account.
- [ ] Record each result and leave M0 blocked until every M0 exit condition passes.

## Self-review

- Design experiments, security boundaries, and M0 gate map to the M0 design and delivery plan.
- Paired probes stay outside future product package paths.
- Windows/live identity and security probes are clearly marked as environment-gated; local macOS builds cannot be represented as complete M0 evidence. Windows signing is outside v1 scope.
- No first-release exclusion or verdict rule is changed.

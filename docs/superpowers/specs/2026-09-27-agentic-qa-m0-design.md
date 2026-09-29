# M0 Feasibility Probe Design

**Date:** 2026-09-27  
**Status:** Proposed for review  
**Scope:** Establish evidence for the desktop stack and the first-release security boundary before product implementation. This document does not authorize declaring a milestone passed without the evidence listed below.

## Context and goals

The repository currently contains product documentation and no application code. The architecture selects Electron, SQLCipher-backed SQLite, Playwright, and a constrained container worker provisionally; the delivery plan explicitly requires a cross-platform feasibility gate before that selection becomes a commitment.

M0 will produce throwaway probes and a reproducible evidence record. The probes answer whether the proposed runtime can be packaged and launched on Windows and macOS, complete Entra public-client sign-in and an ADO read, protect local data, and execute hostile repository fixtures within the intended worker boundary. A probe is not product code and will not be promoted into M1 without a separate review of its interfaces and quality.

## Approaches considered

1. **Paired Electron and Tauri/Node-sidecar probes (recommended).** Implement the same small scenario in both candidates, compare the delivery plan's measures, and select only after results are available. This gives the best evidence for the conditional stack decision but has the highest short-term probe cost.
2. **Electron-only probe first.** Validate the preferred option on both platforms, then run a Tauri comparison only if Electron exceeds a defined size, security, runtime, or maintenance budget. This is cheaper initially, but the comparison can be delayed until after sunk work and needs explicit budgets to be falsifiable.
3. **Start the Electron product directly.** This minimizes throwaway work but bypasses the explicit M0 gate and would make platform/security assumptions expensive to revisit. This option is rejected under the current delivery plan.

## Recommended design

### Probe layout and ownership

Keep experiments isolated from the future product packages:

```text
probes/m0/electron/       Electron + React/TypeScript packaging and main-process probe
probes/m0/tauri/          Tauri shell with a Node/Playwright sidecar probe
probes/m0/fixtures/       Hostile repository fixture and small staging test scenario
docs/spec/08-m0-feasibility-record.md
```

The probe applications expose the same visible operations and write comparable, redacted evidence. Their commands, dependencies, versions, artifact sizes, and platform-specific steps are recorded. Do not introduce a root workspace or shared product package until the stack decision is recorded. Avoid storing credentials or raw tokens in fixtures or probe output.

### Experiments

1. **Packaging and runtime.** On clean Windows 11 and supported macOS hosts, build and launch unsigned v1 packages. Windows signing and macOS signing/notarization are outside v1 local-testing scope; revisit before broad public distribution. Measure clean-install size, idle and active memory, browser runtime installation, callback handling, update/rollback behavior, crash cleanup, antivirus friction, and developer build complexity. Record OS version, architecture, build command, package hash, and result. The exact supported OS and architecture matrix is a gate output, not an assumption.
2. **Entra and ADO.** Use public-client authorization-code PKCE with the system browser and no client secret. Test at least two Entra tenants, a Conditional Access case, ADO resource scopes and organization discovery, and one read of an authorized project/work item. Test an MSA-only path to verify the unsupported-account copy. Use a dedicated least-privilege account and redact identity material from records.
3. **Encrypted local storage.** Package SQLCipher-backed SQLite and authenticated encrypted evidence files on both operating systems. Verify creation, close/reopen, migration, offline readability without the OS-protected key, key-loss behavior, restrictive data-directory permissions, and stale plaintext scratch cleanup after normal exit and forced termination. Record the key wrapping mechanism and its same-user malware limits.
4. **Repository worker.** Run an immutable disposable snapshot using Docker Desktop on both operating systems. The worker must be non-root, unprivileged, without host networking, Docker socket, home-directory mounts, credentials, or writable host source. Apply CPU, memory, process, disk, and wall-clock limits, a read-only base, scoped scratch, and explicit egress policy. A malicious fixture attempts home/Docker-socket reads, network access, resource exhaustion, and persistent descendants. Capture the effective container configuration and outcomes. A failure blocks repository execution until an alternative boundary passes.
5. **Browser boundary.** Against a dedicated staging application/test account, exercise foreign-origin redirects, approved auth redirects, downloads/uploads, WebSockets, service-worker requests, file chooser, and state-changing actions without approval. Record which properties are enforced by Playwright policy and which require external network isolation. No production target is used.
6. **End-to-end evidence story.** Use one real pilot work item with a repository criterion and a UI criterion. Freeze the ADO revision, source commit, and site deployment identity; capture assertion, trace, screenshot, failure classification, and export. Two reviewers independently assess whether evidence justifies the verdict and note disagreements.
7. **AI data handling prerequisite.** Before M2, select allowed provider/model(s), review retention/data-handling terms, set usage/cost constraints, and prove that no request occurs before the per-run disclosure payload is previewed and approved. This is recorded separately from the shell stack comparison.

### Decision criteria

M0 passes only when all release-gate checks in `docs/spec/06-delivery-plan.md` have fresh evidence, including launchable unsigned app packages on Windows and macOS, successful Entra sign-in and one ADO read, a hostile repository fixture unable to cross the host-secret boundary, and an exact supported OS/runtime matrix. Record unpassed or untested checks as blockers; no inferred pass is allowed.

Choose Electron only if the cross-platform evidence shows that its single-language integration benefit holds while package size, security, stability, runtime, signing, and support remain acceptable. Otherwise, document the measured trade-off in an ADR and update architecture/specs before M1. If evidence is inconclusive, keep M0 open rather than selecting on preference alone.

### Security and privacy constraints

- Use synthetic or explicitly approved pilot data. Never put credentials, tokens, private keys, or raw provider prompts in logs, fixtures, screenshots, or the evidence record.
- The renderer is untrusted: Node integration disabled, context isolation and sandbox enabled, restrictive CSP, typed/schema-validated IPC, sender-origin checks, constrained navigation.
- Treat repository fixtures and browser content as hostile input. Do not mount the host home directory or Docker socket, run privileged containers, or pass ADO/provider credentials to a worker.
- A container reduces exposure but is not itself proof of a complete security boundary. Record residual risk and any required host/network control.
- Do not call ADO write APIs or transmit model context before the user sees and approves the exact disclosure preview.
- Do not commit, publish, upload, or distribute probe builds as product releases.

## Milestone sequence after M0

Only after M0 passes and its architecture decision is recorded:

- **M1 (FR-01–FR-04):** implement ADO sign-in, organization/project discovery, process-aware work-item/task search, and encrypted persistent QA Queue. Exit with Agile, Scrum, and custom fake data, one live tenant, 401/403/429 coverage, and restart persistence.
- **M2 (FR-05–FR-08):** define versioned domain contracts and immutable Run Manifest; target/source snapshot selection; human-reviewed QA Contract; provider selection and disclosure preview; preflight. Prove no model request before approval and stale-source warnings.
- **M3 (FR-09–FR-10):** build versioned repo/browser worker protocols, run reviewed commands only against disposable snapshots, add browser origin/action limits, evidence and cancellation. Site-only operation must not require a container.
- **M4 (FR-11–FR-13):** add deterministic verdict computation, findings/reviewer annotations, encrypted history, export/deletion, launchable Windows/macOS packages, release security tests, and a human-adjudicated dataset of at least 20 varied stories/tasks. Signing/notarization is a later distribution gate.

Each milestone gets a frozen interface and its own implementation plan after its entry dependencies are met. M5 and M6 remain out of first-release scope.

## Failure handling and outputs

Each experiment has `PASS`, `FAIL`, or `NOT RUN` status, a named platform/runtime, exact command/build identity, concise evidence location, and owner/action for any gap. A failed security control blocks the affected capability; it does not silently downgrade to an undocumented weaker control. The M0 record is updated as evidence arrives, and any stack or schema change is captured in a dated ADR before dependent implementation.

## Review checklist

- Probe implementations remain isolated and disposable.
- The measurements map directly to M0 gates and do not claim unavailable platforms were tested.
- Credential, host filesystem, network, renderer, and worker boundaries match the security spec.
- M1–M4 remain ordered and M5/M6 excluded.
- Every gate has objective evidence and an explicit not-run/failed outcome.

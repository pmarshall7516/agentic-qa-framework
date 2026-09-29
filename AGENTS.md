# Agent instructions

This repository defines and implements a local-first Azure DevOps QA desktop app for Windows and macOS. Follow these instructions for all implementation, review and documentation work in this repository.

## Source of truth

Read these files before changing product behavior or architecture:

1. [Product plan](docs/00-agentic-qa-system-general-plan.md) for product scope and delivery sequence.
2. [Product requirements](docs/spec/01-product-requirements.md) for FR/NFR identifiers and acceptance tests.
3. [Desktop architecture](docs/00-agentic-qa-system-architecture.md) for components, boundaries and data flow.
4. [Domain glossary](docs/CONTEXT.md) for canonical product language.
5. [ADO integration](docs/spec/02-azure-devops-integration.md), [QA engine](docs/spec/03-qa-engine.md), [security and privacy](docs/spec/04-security-privacy.md), [desktop UX](docs/spec/05-desktop-experience.md), [delivery plan](docs/spec/06-delivery-plan.md), and [repository config](docs/spec/07-repository-config.md) for subsystem contracts.

The requirements and security rules constrain the architecture. If docs conflict, do not choose silently: identify the conflicting statements, recommend one resolution, and update the docs before implementing behavior that depends on it. Source tracker payloads and model output must be normalized at adapter boundaries; the domain model and verdict policy are the stable core.

## Current project state and scope

- Treat this as a documentation-first project until repository inspection shows application code has been added. Do not assume a framework, package manager, CI system or existing code structure.
- The first useful release is a **local-first Electron, React and TypeScript desktop app**. SQLCipher-backed SQLite stores local metadata; Playwright handles browser checks; a constrained container worker runs repository commands.
- Azure DevOps Services is the only first-release work tracker. The integration is read-only. Do not add ADO writes, webhooks, hosted storage, sharing or unattended runs to the initial release.
- Azure DevOps authentication reuses the locally installed Azure CLI (`az login`); do not require an app-owned public-client ID. The CLI issues an Entra-backed ADO token. The app must never log or return tokens, pass them to workers, or put them in profile configuration.
- Support repository-only, site-only and combined runs. Site-only checks must work without a container runtime. Repository commands run only against a disposable snapshot in the constrained worker.
- Implement milestones in the order M0 through M4 in [the delivery plan](docs/spec/06-delivery-plan.md). M0 is a real gate: validate packaging, Azure CLI sign-in/token acquisition, encrypted storage, and worker isolation on macOS and Windows before broad product implementation. M5 and M6 require their own stated gates and are outside the first useful release.
- Electron is the preferred stack, conditional on M0 evidence. If a probe justifies Tauri or another change, record the trade-off in an ADR and update architecture and implementation docs before dependent work proceeds.

## Branch workflow

- `develop` is the default branch for ongoing development. Start feature and fix branches from `develop` and merge them back into `develop` through pull requests.
- Merge `develop` into `main` through a pull request when the development branch is ready for a packaged release. Preserve `develop` after release merges.
- Produce packaged builds from `main`.

## Implementation workflow

1. Inspect the current branch, working tree, relevant code, package scripts and all applicable `AGENTS.md` files before editing. Keep user changes intact.
2. Work directly in this repository's current checkout for this user. Do not create or use Git worktrees unless the user explicitly changes this preference.
3. Identify the milestone and requirement IDs this change delivers. Check that it fits the first-release scope and its documented exit gate.
4. Define or confirm the interface before parallel implementation: domain types, IPC messages, worker messages, storage migrations and adapter contracts. Keep contracts versioned where workers or persisted data cross a process boundary.
5. Implement the smallest end-to-end slice that demonstrates the requirement. Keep deterministic execution, data collection and verdict calculation in ordinary code; use an LLM only for bounded interpretation/planning/review.
6. Add behavior-focused tests for the changed contract, including relevant failure, privacy and cancellation paths. Run the targeted checks and platform build checks required by the milestone. Report the exact commands and outcomes; do not claim a check passed without fresh output.
7. Update the relevant spec and this file when an approved implementation decision changes product behavior, permissions, data handling, platform support or package ownership.
8. Hand off with changed paths, requirement IDs, interface changes, checks run, known limitations and the next dependency. Leave unrelated files untouched.

## Delegation and parallel work

Use a lead/integrator agent to own milestone scope, shared contracts, integration, final verification and user-facing status. Delegate only work that can proceed against an agreed interface and in clearly separated files or packages.

Good independent work after the contracts are agreed includes:

- domain schema and pure verdict-policy package;
- fake ADO fixtures and read-only adapter tests;
- renderer screens against frozen typed IPC interfaces;
- browser worker against a versioned scenario/result message;
- repository worker against a versioned command manifest;
- isolated review of security controls or acceptance-criteria coverage.

Keep one owner for shared/high-conflict files at a time: root package manifests and lockfiles, workspace configuration, CI/build/release configuration, shared domain schemas, IPC and worker protocol definitions, database migration registry, and broad documentation. A delegated agent must not redefine an interface that another agent is consuming. If an interface needs to change, the lead coordinates the change and tells affected owners before integration.

For each delegated task, provide: goal and requirement IDs; exact owned paths; paths that are read-only; interfaces to consume and produce; platform/security constraints; checks to run; and explicit out-of-scope items. Ask the agent to report changed files and verification evidence. The integrator inspects the diff and reruns relevant checks rather than relying on the report alone. Do not delegate duplicate implementation of the same boundary to multiple agents unless the goal is an explicit design comparison.

## Required security boundaries

- Renderer code is untrusted relative to the main process. Keep Node integration disabled, context isolation and renderer sandboxing enabled, CSP restrictive, navigation constrained, IPC typed/schema-validated, and sender origin checked. Never expose general filesystem, shell or token APIs to the renderer.
- Use the installed Azure CLI as the delegated identity broker. Acquire ADO tokens only in the main process via fixed executable/argument arrays, keep them transient, and never pass them to renderers, reports, logs, prompts or QA workers. Azure CLI manages its own credential cache; document that machine-level boundary.
- Treat ADO text, repository files/config/scripts, web pages, test artifacts and model output as hostile input. Prompt text never grants a capability. Validate structured model output; the model cannot expand commands, origins, permissions, budgets or verdict status.
- Never execute a model-generated shell string directly. Show exact configured commands to the user and pass executable/argument arrays with shell interpolation disabled.
- Never run project code in the original working tree. Use an immutable snapshot and disposable worker. Do not mount the host home directory or Docker socket, run privileged containers, pass ADO/provider credentials to the worker, or grant unreviewed network access.
- Browser runs use explicit approved origins, bounded actions and test accounts. Destructive or externally visible actions require explicit approval. Capture and export traces only under the redaction/restricted-artifact rules in the security spec.
- Do not call ADO write APIs, create comments/bugs, change PRs, trigger deployments or publish user data in the first release.
- Store retained work items and reports encrypted at rest. Keep key material out of workers; bound and clean plaintext scratch lifetime. Do not add telemetry, cloud sync or automatic upload by default.

## Domain and verdict rules

- Use the canonical terms `Requirement`, `Task`, `QA Queue`, `Target`, `Acceptance Criterion`, `QA Contract`, `Scenario`, `Observation`, `Evidence`, `Coverage`, `Finding`, `Verdict` and `Run Manifest` from `docs/CONTEXT.md`.
- A task informs scope but does not prove its parent's acceptance criteria. Preserve source ID, field and revision for every criterion.
- Freeze ADO revisions, source commit/snapshot hash, target, config, contract revision, tool versions and limits in each run manifest. Reruns create new manifests; do not mutate old reports.
- Each acceptance criterion needs explicit required layers and direct evidence. A zero exit code or model assertion alone cannot verify a criterion.
- Compute run status using the precedence in `docs/spec/03-qa-engine.md`: `FAIL`, then `BLOCKED`, then `NEEDS_REVIEW`, then `PASS`. Empty criteria, zero assertions, missing required layers, flaky tests, ambiguous requirements or insufficient evidence must never produce `PASS`.
- Preserve observations even when a reviewer or human changes a finding classification. Record human overrides with author and reason.

## Test and change expectations

- Keep verdict logic pure and test all status combinations, especially cases where product, test and environment failures coexist.
- For ADO, cover Agile, Scrum, Basic, CMMI and custom work-item types; parent/child relations; paging; missing fields; stale/deleted items; and auth, permission and rate-limit failures.
- For workers, cover timeout, cancellation, child-process cleanup, resource limits, artifact paths, external network attempts, malicious prompt content and host-secret access attempts.
- For desktop changes, cover IPC sender validation, keyboard flow, persistence/migration, sign-in/out, crash recovery, launchable Windows `.exe` packaging (code signing is out of scope for v1), and OS-specific behavior required by the current milestone. macOS signing/notarization is a separate distribution decision, not a prerequisite for local v1 testing.
- Avoid broad refactors during feature slices. Preserve user edits and avoid destructive Git operations. Do not commit, push, publish or merge unless the user explicitly asks.
- Prefer focused modules and narrow interfaces. Keep ADO, AI provider, storage, UI and worker code behind adapters so the core domain remains independently testable.

## Completion handoff

Before calling an implementation task complete, summarize the delivered requirement IDs, user-visible behavior, changed paths, checks actually run with outcomes, platform coverage, security implications and remaining blockers. If a milestone gate is incomplete, state that plainly and do not present the product as release-ready.

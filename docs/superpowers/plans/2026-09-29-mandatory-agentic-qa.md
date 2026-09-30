# Mandatory Agentic QA Implementation Plan

> **For agentic workers:** Implement this plan inline in the current checkout. Preserve unrelated user edits. Do not commit unless explicitly asked.

**Goal:** Require a configured provider-backed Orchestrator Agent for QA runs that plans and delegates repository/browser work within a one-time approved context and cost envelope, then produces evidence-linked results and a delegation diagram.

**Architecture:** Add versioned domain schemas for plans, agent assignments, context envelopes, budgets, results and diagram nodes. Provider adapters discover models and exchange structured agent/tool messages; a main-process coordinator validates plans and routes typed tools to existing isolated workers. The renderer configures the provider, reviews and approves the run envelope once, then shows the actual delegation graph and evidence-linked report.

**Tech Stack:** Electron main/preload/React renderer; TypeScript workspaces; Zod schemas; SQLCipher settings/run storage; OpenAI Responses and Anthropic Messages adapters; existing Playwright and constrained repository workers; Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-mandatory-agentic-qa-design.md`

## Global Constraints

- Renderer code is untrusted relative to the main process; IPC remains typed/schema-validated and sender-origin checked.
- Provider credentials stay in encrypted main-process storage and never enter renderer state, prompts, reports, logs or workers.
- Treat ADO text, repository files/config/scripts, web pages, artifacts and model output as hostile input.
- Never execute a model-generated shell string or allow the model to expand commands, origins, tools, permissions, budgets or verdict status.
- Repository code runs only in a disposable snapshot and constrained worker; never mount host home or pass provider/ADO credentials to workers.
- Browser runs stay within approved origins and bounded actions; external/destructive actions remain gated.
- A Task informs scope but does not prove parent acceptance criteria. Every criterion requires direct evidence.
- Verdict precedence remains `FAIL`, `BLOCKED`, `NEEDS_REVIEW`, `PASS`; agents cannot determine the final verdict.
- Keep local-first storage and read-only ADO behavior; do not add telemetry, uploads, ADO writes, commits or pushes.
- The approved design replaces optional deterministic planning with mandatory agentic planning. No provider/model means no run.

## File structure and interfaces

- `packages/domain/src/agent.ts`: schemas and types for provider capability declarations, model choices, context manifests, budgets, plan assignments, evidence references, agent outcomes and report diagrams.
- `packages/domain/src/run.ts`: record provider/model identities and validated delegation-plan data in immutable run data without credentials.
- `packages/model-adapters/src/provider.ts`: provider interface with `listModels`, `invoke` and normalized tool-call/structured-output contracts. Capability flags include `structuredOutput`, `toolUse`, context limit and pricing metadata where known.
- `packages/model-adapters/src/openai.ts` and `anthropic.ts`: provider-specific model discovery and normalized tool-call/response handling.
- `packages/agent-orchestrator/src/orchestrator.ts`: `runAgenticQa(input, dependencies)` accepts approved `RunEnvelope`, source snapshots and typed tools; returns validated `DelegationPlan`, `AgentWorkResult[]`, usage ledger and progress events.
- Tool catalog stays typed and app-owned: read approved repository file; propose/write generated test only in disposable snapshot; run a reviewed command ID; invoke Playwright scenario on approved origin; read bounded test result/artifact metadata. Tool calls cannot introduce commands or origins.
- `apps/desktop/src/main/controller.ts`: prepare envelope, approve/start orchestrator, broker tool calls, persist progress/results/evidence and finalize reports.
- `apps/desktop/src/shared/ipc.ts`, `main/ipc.ts`, `preload/index.ts`: provider/model settings, discovery, envelope approval and progress/report APIs with strict schema validation.
- `apps/desktop/src/renderer/App.tsx`: provider/model configuration, one-time run-envelope review, agentic run state, diagram and evidence summaries. Preserve the active user's navigation/CSS edits.
- `packages/storage/src/database.ts`: persist agent run metadata/progress using a forward-only migration while preserving historical run readability.
- Update `docs/spec/01-product-requirements.md`, `00-agentic-qa-system-architecture.md`, `spec/04-security-privacy.md`, `spec/05-desktop-experience.md`, `spec/06-delivery-plan.md`; create ADR-0004 to supersede ADR-0002 without rewriting history.

## Task 1: Reconcile the product baseline

**Files:** Modify the product requirements, architecture, security/privacy, desktop UX, delivery plan and ADR-0002 listed above.  
**Interface:** Document the versioned run envelope, agent plan/results, provider boundary, one-time approval and cost policy before dependent implementation.

- [x] Update FR-08 and FR-14/milestones to make an agent, structured planning, delegation, test generation/execution, model discovery and the small dynamic diagram part of the first useful release.
- [x] Change the architecture diagram and data flow to show main-process Orchestrator, capability-checked tool broker and selected repository/browser specialists.
- [x] Replace per-request payload confirmation with a run-level context/permission manifest; requests outside it pause.
- [x] Specify provider APIs/credentials, model capability filtering, role overrides, usage ledger, conservative budget reservation and no-run-without-provider behavior.
- [x] State generated tests remain disposable, reviewed-command-only, no arbitrary shell, no host credentials, no source/ADO writes, and direct evidence controls verdict.
- [x] Add the approved small diagram shape and user-visible workflow to the desktop experience requirements.
- [x] Create `docs/decisions/ADR-0004-mandatory-agentic-provider-adapters.md`, mark ADR-0002 superseded, and link both decisions to the approved design.
- [x] Review changed docs and keep the incomplete specialist/repository-generation work visible as an open M2/M3 gate.

## Task 2: Add validated agent and run contracts

**Files:** Create `packages/domain/src/agent.ts` and tests; modify `packages/domain/package.json`, `packages/domain/src/run.ts`, and run tests.  
**Consumes:** Existing `SourceRefSchema`, `QAContract`, `RunManifestSchema`, `ObservationSchema`, and `ArtifactSchema`.  
**Produces:** `RunEnvelopeSchema`, `AgentCapabilitySchema`, `AgentAssignmentSchema`, `DelegationPlanSchema`, `AgentToolCallSchema`, `AgentWorkResultSchema`, `UsageLedgerSchema`, and `DelegationDiagramSchema`.

- [ ] Write schema tests for valid repo-only, site-only and combined delegation; criteria/task provenance; optional role model override; bounded tool call; budget; evidence-linked results; partial/canceled work; diagram nodes/edges.
- [ ] Write rejection tests for shell strings, arbitrary origins, unknown tool names, credential-shaped values, invalid criterion IDs, unbounded retries/actions, missing evidence references, malformed provider/model IDs and agent-supplied verdicts.
- [x] Implement strict Zod schemas with explicit version fields, max string/array sizes and cross-reference validation helpers.
- [ ] Add optional agent metadata to manifests for compatibility with historic runs; ensure legacy manifest fixture parsing still succeeds.
- [ ] Implement `buildDelegationDiagram(plan, outcomes)` from validated structured assignments, not model-provided Mermaid source; tests verify only selected branches render.
- [x] Run focused domain tests and `npm run typecheck` (latest full suite/typecheck recorded in Task 8).

## Task 3: Build provider and model discovery adapters

**Files:** Create `packages/model-adapters/src/provider.ts`, `anthropic.ts`, provider tests; modify `openai.ts`, package exports and tests.  
**Produces:** `ModelProviderAdapter` with `listModels(credential, fetcher?)` and `invoke(request, credential, fetcher?)`, normalized `ProviderModel`, `AgentRequest`, `AgentResponse`, and `ProviderToolCall` types.

- [ ] Add contract tests for model listing, pagination/size limits, capability metadata filtering, provider auth failure, timeout, malformed response, redirects and rate-limit errors.
- [ ] Add fake-provider tests for normalized tool-call rounds and strict structured JSON output for OpenAI and Anthropic.
- [ ] Implement fixed OpenAI and Anthropic HTTPS destinations, bounded response bodies/timeouts, redirect rejection, API-key validation and provider-specific headers.
- [ ] Normalize supported model lists; do not infer unsupported capabilities from model display names. Treat unknown capabilities as unavailable until provider catalog metadata or an explicit supported provider matrix establishes them.
- [ ] Keep existing OpenAI scenario-suggestion tests/compatibility during migration or replace with equivalent agent contract tests.
- [ ] Run focused model-adapter tests and `npm run typecheck`.

## Task 4: Implement the agent coordinator and safe tool broker

**Files:** Create `packages/agent-orchestrator/package.json`, `src/orchestrator.ts`, `src/tool-broker.ts`, tests; update root workspace dependency graph and main package dependency.  
**Consumes:** Task 2 schemas and Task 3 normalized provider interface; existing repository snapshot/config/runner and Playwright runner.  
**Produces:** `runAgenticQa({ envelope, snapshots, adapter, modelRoles, tools, budget, signal, onProgress })` returning validated plan, assignment outcomes, usage ledger and summary inputs.

- [ ] Write tests for required planning call, criteria/task linking, conditional backend/frontend delegation, combined flow, no unselected target delegation, and retry/call/fan-out/token/cost ceilings.
- [ ] Write tool-broker tests proving path read stays inside approved immutable snapshot, test file writes stay inside disposable workdir, only reviewed command IDs run, Playwright gets only the approved origin, and secrets never enter tool context.
- [ ] Define a bounded provider-neutral tool loop: validate every tool call before execution; return bounded result data; stop on cancellation, budget exhaustion, malformed output, unsupported tool, or iteration cap.
- [x] Implement a conservative reservation and usage accounting for the Orchestrator planning call; specialist dispatch-level accounting remains pending with the tool loop.
- [ ] Implement agent prompts for Orchestrator, Repository, Browser and Reviewer using stable criteria/task provenance, hostile-input framing, tool permissions, evidence requirements and structured output. Prompts may not grant capabilities.
- [ ] Use same default model for all roles unless configured role override exists; prevent role settings selecting models that lack required capabilities.
- [ ] Generate concise result summaries with evidence IDs only; model output cannot create observations/artifacts or set the verdict.
- [ ] Run orchestrator tests and `npm run typecheck`.

## Task 5: Persist provider settings, envelopes and results safely

**Files:** Modify `apps/desktop/src/main/controller.ts`, `apps/desktop/src/main/settings-migration.ts`, `apps/desktop/src/main/index.ts`, `packages/storage/src/database.ts`, their tests and `packages/domain/src/run.ts` as required.  
**Consumes:** Provider registry/adapters and agent-orchestrator interface.  
**Produces:** Main-process API methods for configure/discover providers, build/review a run envelope, approve/start agentic run, stream progress, and persist delegation outcomes/diagram/usage without secrets.

- [ ] Write migration tests for prior schema/settings, multiple provider key references, role-model settings and historical reports.
- [ ] Replace single OpenAI credential setting with provider-key storage keyed by provider; import with native file picker, encrypt locally, never echo keys, and support clear/replace.
- [ ] Add main-process model discovery that reads key only from encrypted settings and calls fixed adapter endpoints; return sanitized model metadata only.
- [ ] Build a run envelope from refreshed ADO revisions, target, repository config/file scope, approved origin, available commands and requested budgets; do not transmit during preview.
- [ ] On approval, create immutable run manifest, snapshot, and run progress before agent calls; persist every validated assignment/result/diagram/usage update.
- [ ] Replace `startRun`'s fixed prewritten-scenario execution as the planning authority with `runAgenticQa`; delegate execution only through the broker and existing isolated workers.
- [ ] Preserve cancellation/interrupted recovery and partial outcomes; the existing deterministic report policy consumes validated observations/findings.
- [ ] Add fake-provider controller tests for end-to-end dispatch, approval envelope enforcement, token/key isolation, cancellation, provider failure, budget stop, browser/repo fan-out and partial report.
- [ ] Run controller/storage/IPC tests and `npm run typecheck`.

## Task 6: Add provider, model, budget and run-envelope UI

**Files:** Modify `apps/desktop/src/shared/ipc.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/App.tsx`, CSS, and IPC/renderer tests.  
**Consumes:** Task 5 main-process API and Task 2 run schemas.  
**Produces:** Searchable supported-model selection, provider credential controls, default/role models, shared budget settings, context envelope preview and one-time approve/start flow.

- [ ] Write interaction tests for required provider/model, credential import/clear, refresh/search models, capability filter, role override fallback and budget bounds.
- [ ] Write run-flow tests for showing ADO revisions/file scope/origin/commands/provider/cost/actions before approval, exclusions, starting exactly once and pausing on an envelope expansion.
- [ ] Add strict IPC validation for provider IDs, model IDs, budgets, envelope IDs and agent events; never expose secrets.
- [x] Replace OpenAI-only settings labels with provider selection and accessible searchable model list; present provider/model, estimated cost/token/action budget and connection state.
- [x] Make run setup display agentic plan generation and require saved provider/model; remove UI claim that local deterministic planning can run a QA plan without a provider.
- [ ] Preserve the current user's uncommitted settings-navigation and CSS changes; do not revert/reformat unrelated UI.
- [ ] Run affected keyboard, renderer and IPC tests; review screen at shared 800px target where practical.

## Task 7: Show generated delegation diagram and evidence-linked results

**Files:** Modify `apps/desktop/src/renderer/App.tsx`, `run.css`, reporting renderers, and corresponding UI/report tests.  
**Consumes:** Persisted `DelegationDiagram`, assignment outcomes, findings, observations and artifact identities.  
**Produces:** Plan and report show a small Orchestrator circle at top, arrows to only selected specialists, arrows to result types and final summary.

- [ ] Write tests for backend-only, frontend-only, combined, skipped, blocked, canceled and completed diagram states.
- [x] Render graph nodes/edges from validated diagram data with accessible text equivalents; do not inject arbitrary Mermaid/HTML from model output.
- [ ] Link each summary claim/criterion result to the direct test observation or evidence artifact; render missing evidence as unverified.
- [ ] Show assignment status and result types in the run progress and final report; preserve partial graph and evidence when execution stops early.
- [x] Include sanitized diagram and agent usage metadata in HTML/Markdown/JSON exports; exclude credentials, raw prompts and restricted artifact bytes.
- [ ] Run reporting and relevant renderer tests.

## Task 8: Final verification and handoff

- [x] Run targeted tests after each task, then `npm test` and `npm run typecheck` once at integration completion.
- [x] Run `npm run build` to verify Electron/renderer packaging compilation.
- [x] Inspect `git diff` and confirm existing uncommitted `App.tsx` and `styles.css` edits remain intact.
- [x] Verify provider keys are kept out of renderer state and adapters use fixed provider endpoints; full security review remains an M0/M2 gate.
- [ ] Report delivered requirement IDs, changed paths, exact check commands/results, platform coverage, security implications and remaining M0/M4/live-provider blockers.

## Known verification limits

- No live provider request or live model capability validation is part of automated tests; use fake providers. Live provider billing/data-retention account review remains an external release check.
- Linux test/build output does not complete the repository's required Windows/macOS M0 gates; report platform evidence separately.
- Claude plan-based authentication is only implemented if a provider-supported third-party integration is available and approved; otherwise Anthropic API-key access is provided and Claude.ai plan usage is explicitly unavailable.

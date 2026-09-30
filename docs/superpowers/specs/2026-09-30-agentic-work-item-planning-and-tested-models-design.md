# Agentic work-item planning and tested model selection

**Status:** proposed implementation design, approved direction 2026-09-30; awaiting spec review before implementation.

## Purpose

Make plan preparation synthesize the selected Azure DevOps work as a feature-level QA proposal, while requiring a reachable, user-selected model for planning and every QA agent role.

The selected Requirement/Story is context for the feature built by its selected Tasks. The app does not test the Story work item as a record, and it does not treat a Task as proof of a parent's acceptance criteria. Instead, the agent reads the refreshed selected work items together, proposes the feature behaviors that should be verified, and maps the work to concrete QA checks.

## Current behavior and root cause

`DesktopController.createDraftPlan` currently creates the draft locally. It splits a Requirement's existing Acceptance Criteria field into criteria, stores Task descriptions as separate candidates, and records a gap when the Requirement field is empty. The configured model is called later from `approvePlan`, after the draft has already been displayed. The UI also disables approval when the draft has no criteria. This prevents an agent from proposing criteria for a Story whose Acceptance Criteria field is empty and explains the reported empty plan.

Model settings currently persist one active provider/model choice. Model discovery is not a saved catalog or a user-initiated reachability test. The orchestration contract supports role-specific models, which can diverge from the user's selected model.

## User flow

### Saved models in Settings

1. A discovered, capability-compatible model can be saved into a local list. A saved entry is identified by provider ID and model ID; display name and supported capabilities are descriptive metadata.
2. Each saved entry has a **Test model** action. The main process sends one small structured request through the same provider adapter and reports success or a safe, actionable failure. The test checks that this account/key can reach the model and receive the required structured response; it does not claim that the model will produce a correct QA plan.
3. The test result and timestamp are local metadata. A provider credential change invalidates the affected provider's test results. Provider secrets remain in the main process and are never returned to the renderer. Claude Code reachability tests must disclose that they use the signed-in plan allowance.
4. Users can remove saved entries. A removed entry cannot be selected for a new plan; existing immutable manifests retain the provider/model identity they already record.

### Select model and prepare the agentic draft

1. Run setup requires a selection from the saved entries whose latest test succeeded. If none qualify, plan preparation is unavailable and the user is directed to Settings.
2. Before the first planning request, show the provider/model and the selected ADO work-item IDs, revisions and fields that will be sent. Include the existing target, command, repository-path, account-label and budget disclosure as applicable. The explicit **Prepare agentic plan** action authorizes the bounded planning request. No provider request happens before that action.
3. The Orchestrator receives every selected work-item snapshot and its validated parent/child relationships as untrusted, provenance-bearing data. For a selected Story with selected child Tasks, it uses the Story description and existing criteria as feature context and reads all selected Task descriptions together. It proposes:
   - a concise feature summary describing the combined behavior the Tasks implement;
   - atomic, testable feature-level Acceptance Criterion proposals with links to the source item fields/revisions that informed each one;
   - per-Task verification intent and scenarios, mapped to the feature criteria they support; and
   - explicit ambiguity, dependency and uncovered-scope notes.
4. The Story is not independently QAed. Checks validate the expected behavior of the delivered feature and the selected Task changes. Task completion state alone is never evidence. Only selected Tasks contribute task-specific scope; the agent does not invent unselected work.
5. Standalone Tasks are planned as their own scope. If no Story is selected, the agent labels any proposed criteria as Task-scoped proposals and preserves that scope in the contract/report.
6. The plan review shows the feature summary, source context, criterion proposals, per-Task verification map, evidence layers/scenarios, provider/model, and unresolved questions. Agent-generated text is clearly labeled as a proposal, distinct from ADO-sourced text. The user can edit, accept, or reject proposals before approving the final run envelope.
7. Approval freezes the accepted QA Contract and the selected tested model in the run manifest/envelope. The same model is used for the Orchestrator and every assigned QA specialist and Reviewer role. Role-specific overrides are not used for this flow. A run never substitutes a different or untested model silently.

## Contract and provenance rules

- Keep ADO source snapshots immutable and retain source ID, revision, field and content hash for every input.
- Represent an agent-proposed criterion as a proposal with links to one or more source references. Do not label it as an ADO-sourced Acceptance Criterion or write it back to ADO.
- A proposal does not count as approved coverage until the user accepts it into the reviewed local QA Contract. Rejection and edits remain visible in the plan history/provenance.
- Existing ADO Acceptance Criteria remain visible as source context and inform the synthesis; they are not silently discarded or rewritten. Where they conflict with Task context, preserve the conflict and request user resolution.
- Criteria with unresolved ambiguity, no required layer, no linked scenario, no direct expected observation, or insufficient evidence cannot yield `PASS`. Existing verdict precedence remains unchanged.
- Freeze model provider/model identity, tested-model entry identity or credential generation, source revisions, prompt/context hash, approved criteria, assignments and limits into the immutable run record. Reruns create new records.
- Work-item text remains hostile data. It cannot change approved origins, commands, tools, budgets, model selection or worker capabilities.

## Boundaries and security

- Model catalog, credential lookup, reachability call, test-state invalidation and provider call construction stay in the main process. Renderer IPC is typed and schema-validated and exposes only safe model metadata and test status.
- Saved model metadata contains no credentials. API keys remain encrypted in local settings; Claude credentials remain owned by Claude Code.
- The model reachability action uses a fixed minimal prompt and strict structured-output schema, bounded input/output, fixed provider endpoints/CLI arguments and the configured adapter. It does not include ADO work items, repository files, target URLs, browser accounts or user run instructions.
- Plan generation transmits only the disclosed work-item context needed for synthesis and approved bounded metadata. Repository file contents are not included in this first synthesis request. Later specialist calls use the same selected model and only their separately disclosed, bounded assignment context.
- Model output is untrusted. Validate the structured schema, source references and assignment links before display. It cannot create executable commands, alter target permissions, approve itself, or set a final verdict.
- The provider call for plan synthesis is a distinct user action before the Plan screen; final run approval is still required before workers execute or repository/browser actions occur.

## Documentation reconciliation

This design supersedes conflicting details in the 2026-09-29 run-planning/execution design that say a missing Requirement criterion must never be proposed and that Task-derived checks remain a separate substitute-only group. It preserves the broader requirements that source provenance is explicit, Tasks do not prove parent behavior, and incomplete evidence cannot pass.

Before implementation, update the product requirements, QA engine, security/privacy, desktop UX and delivery plan to describe proposed versus accepted criteria, the saved/tested model catalog, disclosure timing, and uniform model selection. Update the domain glossary so `Acceptance Criterion` distinguishes source criteria from user-approved, agent-proposed criteria. Keep the earlier design document as historical context and link this design as the superseding planning behavior.

## Acceptance criteria

1. With a Story lacking ADO Acceptance Criteria and several selected child Tasks, plan preparation sends all selected, refreshed snapshots to the configured Orchestrator and displays a feature summary, feature-level criterion proposals and a verification map for each selected Task.
2. The Story is shown as feature context, not as an independently tested work item. No Task completion status or description alone verifies a feature criterion.
3. Every proposed criterion is labeled agent-generated and retains links to source IDs, revisions and fields. Accepted, edited and rejected proposals remain distinguishable; no ADO write occurs.
4. Ambiguous or unsupported behavior remains an explicit question/gap. The app may not manufacture direct evidence or a `PASS` from model output.
5. With existing ADO criteria, synthesis reads those criteria together with the selected Tasks, preserves provenance and surfaces conflicts rather than silently replacing source behavior.
6. A discovered model can be saved; the saved list is persistent and scoped by provider/model identity. Each entry has a reachable/not-reachable test action with safe user feedback.
7. A model is eligible for a run only after a successful reachability test made with the current provider credentials. Credential changes invalidate affected test status.
8. Run setup cannot prepare a plan without selecting one eligible saved model. The selected model is frozen and used for the Orchestrator, every specialist and Reviewer. No role silently uses a different model.
9. Reachability checks send no project data and disclose Claude plan-allowance use before the check. Provider secrets never enter renderer IPC, prompts or reports.
10. The plan-preparation action discloses the exact selected work-item scope and provider/model before transmitting context. No provider request happens before user action; no worker starts before final run approval.
11. Renderer/model catalog and run envelope data are schema-validated; malformed or stale model/test records fail closed with an actionable message.
12. Existing immutable runs remain readable and retain their historical provider/model identity and criteria semantics after any storage/domain migration.

## Requirements and milestone impact

This delivers and refines FR-20 (agentic planning and delegation), FR-21 (provider/model configuration), FR-23 (run context disclosure), and the QA Contract, provenance, privacy, and verdict requirements. Implementation spans the main-process model adapter/controller, domain QA Contract and run envelope, typed IPC, Settings and Run Setup/Plan Review renderer, orchestration prompts/validation, encrypted settings persistence and migrations, tests, and the named source-of-truth docs. It does not alter M0 security gates, ADO read-only boundaries, worker isolation, or verdict precedence.

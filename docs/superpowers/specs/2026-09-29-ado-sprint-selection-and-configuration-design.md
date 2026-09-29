# ADO Sprint Selection and Configuration Design

**Status:** implementation design, 2026-09-29. Approved for execution by the user's request to proceed without another approval checkpoint.

## Goal

Let the user select a team sprint, review its active Requirements and child Tasks, add only the chosen items to the local QA Queue, and export the saved ADO profile settings as a reusable JSON configuration file. Make ADO failures name the failed operation and a safe next step.

## Scope and requirements

This is an M1 work-selection improvement for FR-02, FR-03, FR-04, and FR-13, with NFR-08 keyboard/accessibility expectations. ADO remains read-only. Sprint and profile data stay local. No tokens, credentials, comments, or work-item payloads are exported into profile configuration.

The existing text/ID search remains available. A separate sprint browser will use the active profile's validated organization, project, and team. The user chooses an iteration from that team's iteration list. The browser returns only mapped Requirement types whose state category is `Proposed` or `InProgress`; this definition works with process-specific state names and excludes resolved/completed/removed work. Child Tasks are loaded on demand, shown under their parent, and selectable independently.

The persistent queue remains the sole run input. Bulk selection adds normalized snapshots through one validated IPC operation. It does not create ADO links or update work items.

Settings gains an export action that serializes the saved profile fields (`name`, organization, project, team, board column, and Story IDs) into the existing `schemaVersion: 1` profile format through a native save dialog. Export values come from encrypted local app settings; no placeholder values are substituted.

## Data and request boundaries

- The ADO adapter lists iterations for the selected team and accepts either `values` or `value` in iteration responses.
- The ADO adapter returns each work-item type's state name and category. Active sprint search builds a WIQL predicate scoped by exact `System.IterationPath`, requirement type, and that type's proposed/in-progress states.
- WIQL text and iteration path use the existing escaping function. Paging stays bounded to 200 results and uses the immutable ID cursor.
- Typed, schema-validated IPC carries only iteration IDs and selected work-item IDs. The main process resolves profiles, auth, types, states, snapshots, and queue writes.
- Error messages may include a fixed operation label, HTTP status, and known remediation. They never include tokens, raw request bodies, server payloads, or stack traces.

## User flow

1. Select an active ADO profile in Settings.
2. In Work items, choose a sprint from the profile team's iterations and load active Requirements.
3. Expand a Requirement to see its child Tasks. Check Requirements and/or Tasks and use one **Add selected to QA Queue** action.
4. Review the grouped source entries in QA Queue, configure a target, approve the plan, and start a run.
5. In Settings, export the saved profile configuration to a JSON file for reuse.

Keyboard users can operate the sprint selector, load action, expandable cards, item selection, bulk add, and configuration export. Loading, empty, and error states explain the next action.

## Error handling

ADO errors are mapped at the client boundary to an operation label such as sprint list, work-item search, or work-item details. The renderer preserves only app-authored `Azure DevOps ...` messages from the IPC rejection and otherwise uses a generic fallback. HTTP 400 from work-item details may retry once without the optional Acceptance Criteria field; all other failures remain visible and are not treated as empty results.

## Verification

Behavior tests cover iteration response shapes, per-type state-category scoping, escaped iteration paths, paging, child tasks, one-call bulk queue insertion, profile export contents/secret exclusion, typed IPC validation, and safe error rendering. Run the full Vitest suite, TypeScript typecheck, desktop production build, and an app launch smoke check. Live tenant behavior, user credentials, sprint configuration, site targets, container availability, and Windows execution remain external release checks.

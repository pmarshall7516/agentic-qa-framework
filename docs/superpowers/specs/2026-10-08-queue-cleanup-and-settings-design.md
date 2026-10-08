# Queue editing and Settings organization

**Status:** approved for implementation by the product owner, 2026-10-08.

## Goal

Make the saved QA Queue visible and editable from Work Items, enforce that every queued Task has its parent Requirement, make destructive queue actions clear and confirmable, and organize Settings into focused subtabs.

## Work Items selection

Work Items will show persisted queue membership as checked selections in both search results and sprint browsing. Selection changes are drafts until the user chooses **Apply queue changes**. Applying reconciles only items loaded or otherwise explicitly changed in the current Work Items session; entries outside the loaded results, filters, pages, or sprint remain untouched. Existing entry order is preserved and newly added items append to the queue.

Selecting a Task automatically selects its parent Requirement. Deselecting a Requirement deselects its loaded child Tasks. The main process validates ADO item kinds and parent relations before applying changes; the renderer never defines authoritative parentage.

## Queue invariants and destructive actions

Every queued Task must have its parent Requirement queued. Existing queue data is repaired from cached relationships or Azure DevOps when possible; unresolved orphan Tasks are surfaced for repair and are not silently deleted. Removing a Requirement removes all queued Tasks under it atomically.

The Requirement removal action is labeled **Remove Story and Tasks** and opens a confirmation naming the Requirement and number of queued Tasks. The confirmation includes **Don’t show this again**. Its preference defaults to enabled, is stored in encrypted application settings, and can be changed in Settings. Clear Queue is adjacent to Refresh and always has a confirmation, independent of the Requirement-removal preference. The refresh button label is **Refresh**.

## Settings information architecture

Settings uses accessible subtabs: **Connections** (Azure DevOps account, organizations and profiles), **AI Providers** (provider login/key and saved models), **Test Accounts** (browser accounts), and **Preferences** (queue-removal confirmation). Existing credential boundaries and provider/model behavior remain unchanged.

## Boundaries

Queue reconciliation is a typed, schema-validated IPC operation. Storage updates for applying selection, cascading Requirement removal, and clearing the queue are atomic. The renderer remains sandboxed and receives only setting metadata, never credentials. UI and styles remain shared across Windows and macOS.

## Requirements and acceptance

This change updates FR-03 and FR-04 and NFR-08. Acceptance includes queue selections restored from persisted state; drafts not saved before Apply; apply adds/removes only touched scope; Task selection adds its parent; deselection/removal cannot leave child Tasks without parent; existing queue order is stable; story removal and clear queue confirmations show accurate counts; the suppression setting persists and controls only Story removal; Settings tabs preserve all current settings actions and are keyboard accessible; Work Items and QA Queue fit the supported desktop width without horizontal scrolling.

## Compatibility

FR-04 currently permits standalone Tasks. This design supersedes that behavior. Existing queue entries are retained during startup repair; a Task whose parent cannot be resolved is shown with a recovery message and cannot proceed as a valid queue selection until repaired.

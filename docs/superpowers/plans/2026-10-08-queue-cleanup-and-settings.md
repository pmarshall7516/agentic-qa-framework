# Queue cleanup and Settings organization Implementation Plan

> **For agentic workers:** Execute inline in this task. The user requested implementation on the currently checked-out branch and will run the tests.

**Goal:** Make Work Items edit the persistent QA Queue with staged changes, require parent Requirements for Tasks, clarify queue confirmations, and organize Settings.

**Architecture:** The renderer owns a draft selection derived from the saved queue. A typed main-process operation validates and atomically applies the requested delta. Queue actions use encrypted settings for the Story removal preference; Settings tabs remain presentation-only.

**Tech Stack:** Electron, React, TypeScript, Zod IPC schemas, SQLCipher-backed SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-queue-cleanup-and-settings-design.md`

## Global Constraints

- Work directly on the checked-out `fix/ui-cleanup-queue` branch; do not create branches or worktrees.
- Keep ADO read-only and validate all work-item relationships in the main process.
- Store the preference through the encrypted local store; do not expose credentials to the renderer.
- Keep shared renderer behavior/styles equivalent on macOS and Windows.
- Add focused behavior tests; do not execute tests because the user will test the result.

---

### Task 1: Update product contracts

Update FR-03/FR-04, glossary queue semantics, desktop queue/settings flows, and repository handoff instructions to require parent Requirements for queued Tasks and document the new queue interactions.

### Task 2: Add atomic queue operations and preference IPC

Add validated IPC for applying a queue selection and clearing the queue. Ensure main-process validation checks selected items and parent links. Add storage operations that cascade Requirement deletion and clear the queue atomically. Add encrypted preference read/write through app settings.

### Task 3: Implement shared staged Work Items selection

Initialize a queue draft from persisted state; share it between search cards and sprint selection; make Tasks select their parent; add Apply/Discard affordances; preserve items outside loaded/changed scope; provide accessible checkbox labels and status counts.

### Task 4: Clarify queue destructive actions

Add Story-and-Tasks confirmation with remembered suppression, a Preferences control, a Clear Queue confirmation, and a button labeled Refresh.

### Task 5: Split Settings into subtabs

Move current controls into Connections, AI Providers, Test Accounts, and Preferences. Preserve existing flows and add keyboard-operable tab semantics.

### Task 6: Add behavior coverage and handoff

Add storage/controller/UI tests for staged reconciliation, parent enforcement, cascading removal, clear queue, preference persistence, and settings navigation. Update this plan's completion notes with paths changed and explicitly state that tests were not run.

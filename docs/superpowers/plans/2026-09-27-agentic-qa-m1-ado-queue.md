# M1 ADO Queue Implementation Plan

> **For agentic workers:** Execute inline in this task. Do not commit.

**Goal:** Deliver the first useful desktop slice: public-client ADO sign-in, organization/project selection, normalized process-aware work-item search, encrypted local snapshots, and a persistent QA Queue.

**Architecture:** Keep domain contracts and queue logic pure in `packages/domain`; isolate MSAL and ADO REST calls in `packages/ado`; keep SQLite and key handling in `packages/storage`; expose only schema-validated commands through the Electron preload bridge. Renderer code never sees tokens or raw network clients.

**Tech Stack:** Electron, React, TypeScript, Zod, MSAL Node + MSAL Node Extensions, SQLCipher-backed SQLite, Vitest, fake ADO HTTP fixtures.

**Spec:** `docs/spec/01-product-requirements.md` (FR-01–FR-04), `docs/spec/02-azure-devops-integration.md`, `docs/spec/04-security-privacy.md`, and `docs/spec/05-desktop-experience.md`.

## Global Constraints

- ADO is read-only; request no write scopes and call no write API.
- Use Entra public-client system-browser PKCE with no client secret.
- Use MSAL Node Extensions for the maintained OS-protected token cache; never expose tokens to renderer, logs, reports, or workers.
- Validate every IPC request and sender; renderer has no Node, filesystem, process, shell, or generic network capability.
- Normalize raw ADO payloads at the adapter boundary; preserve source ID, revision, project and organization identity.
- Queue deduplication key is organization + project ID + work-item ID.
- Persist retained work-item snapshots and queue state in encrypted SQLCipher storage.
- Preserve all pre-existing user edits; do not commit.

---

## Planned files

- Root `package.json` and `package-lock.json`: npm workspace and orchestration scripts.
- `packages/domain/src/work-item.ts`, `queue.ts`: normalized contracts and pure queue transitions.
- `packages/domain/tests/`: schema, dedupe, parent/task and stale-state behavior.
- `packages/ado/src/auth.ts`, `client.ts`, `normalize.ts`: public-client identity and read-only ADO adapter.
- `packages/ado/tests/fixtures/`: fake profile/project/category/WIQL/work-item pages and 401/403/429 scenarios.
- `packages/storage/src/database.ts`, `key.ts`, `migrations/`: encrypted DB, OS-protected key and queue persistence.
- `packages/storage/tests/`: encryption, migration, restart, key-loss and deletion behavior.
- `apps/desktop/src/main/`: Electron window, sender-checked typed IPC, auth/ADO/storage composition.
- `apps/desktop/src/preload/`: narrow typed API only.
- `apps/desktop/src/renderer/`: keyboard-accessible connect/project/search/queue screens.
- `docs/spec/08-m0-feasibility-record.md`: update only with observed M0 evidence and blockers.

## Task 1: Freeze and test domain contracts

**Interfaces:**

```ts
type WorkItemKind = 'REQUIREMENT' | 'TASK' | 'OTHER';
interface WorkItemSnapshot {
  organization: string; projectId: string; projectName: string;
  id: number; revision: number; type: string; kind: WorkItemKind;
  title: string; state: string; description?: string;
  acceptanceCriteria?: string; parentId?: number; url: string;
  retrievedAt: string;
}
interface QueueEntry {
  key: string; organization: string; projectId: string;
  workItemId: number; queuedAt: string; stale: boolean;
}
```

- [ ] Write tests for required fields, Agile/Scrum/Basic/CMMI/custom type classification, preservation of source revision, duplicate queue prevention, child task handling, stale marking, remove, and order.
- [ ] Run the domain tests and observe expected missing-module failures.
- [ ] Implement Zod schemas and pure queue functions with no ADO/Electron/storage imports.
- [ ] Run domain tests and TypeScript checks.

## Task 2: Implement and test encrypted local storage

**Interface:** `openQaStore({ userDataPath, safeStorage, driver })` returns `getQueue()`, `upsertSnapshot(snapshot)`, `addToQueue(entry)`, `removeFromQueue(key)`, `reorderQueue(keys)`, `markStale(key, stale)`, and `close()`.

- [ ] Write tests for no plaintext snapshot data on disk, persistence after close/reopen, idempotent migrations, key loss error, duplicate protection, and queue deletion.
- [ ] Run tests and observe failure before implementation.
- [ ] Implement the SQLCipher DB key wrapped by Electron `safeStorage`; fail closed if encryption is unavailable.
- [ ] Run focused storage tests and native addon build for Electron on macOS; add Windows packaging configuration for the same addon.

## Task 3: Implement the read-only ADO adapter

**Interface:** `AdoClient` provides `getProfile(token)`, `listProjects(token, organization)`, `getWorkItemTypes(token, projectId)`, `search(token, query)`, `fetchWorkItems(token, ids)`, and `getChildren(token, parentId)`. `AuthService` exposes `getAccounts()`, `signIn()`, `getAdoToken(account?)`, and `signOut(accountId)`; token strings remain in the main process.

- [ ] Write fake-server contract tests for organization host validation, profile lookup, continuation paging, work-item types, hierarchy-forward children, batch size <=200, missing fields, HTML sanitization, 401/403/429 and deleted/stale items.
- [ ] Run tests and observe missing adapter failures.
- [ ] Implement MSAL Node Extensions cache, silent-first token acquisition, system-browser interactive sign-in, and read-only REST requests to validated `dev.azure.com` / `vssps.dev.azure.com` hosts.
- [ ] Normalize every returned item and classify standard process types while preserving custom type names.
- [ ] Run fake API tests; live tenant proof remains open until app registration and test account are supplied.

## Task 4: Add narrow IPC and working M1 screens

**Interface:** Preload exposes only typed methods for app status, sign-in/out, accounts, organizations, projects, search/fetch, add/remove/reorder queue, and stale refresh. Schemas validate all arguments/results; the main process verifies packaged UI origin before each command.

- [ ] Write IPC tests for malformed requests, unknown commands, renderer sender forgery, token non-exposure, and queue persistence after app restart.
- [ ] Implement IPC handlers that call only the adapter/domain/storage APIs.
- [ ] Implement accessible Connections, Organization/Project, Work Items, and QA Queue views with explicit loading, empty, stale, expired-token, permission, paging, and rate-limit states.
- [ ] Add client ID configuration in main-process-owned settings; do not store a client secret. Explain organization admin consent and unsupported MSA account path.
- [ ] Package macOS arm64 and unsigned Windows x64 `.exe`; verify renderer security properties and record platform evidence precisely.

## Exit review

- FR-01–FR-04 behavior is covered; Agile/Scrum/Basic/CMMI/custom type fixtures and auth/permission/rate-limit/restart cases pass.
- M1 is not declared complete until one live tenant read works, even if fake-server tests pass.
- Any unmet clean-Windows or live-tenant gate remains explicitly open.

# Azure DevOps onboarding and work selection design

**Status:** approved; auth/profile amendment in progress
**Date:** 2026-09-28  
**Scope:** first-run sign-in, organization/project selection, Story and Task selection, and desktop UI cleanup.

**Amendment note:** the Azure CLI identity and reusable profile requirements below supersede the earlier app-owned public-client setup and manual organization/project-only setup. See “Amendment: Azure CLI identity and reusable work profiles.”

## Context

The current renderer starts on a Connections screen that asks each user to provide an Entra application client ID before sign-in. It calls the action “Sign in with Microsoft,” then asks the user to enter an organization and navigate separate numbered screens for project, work items, queue, run setup, plan review and history. The renderer has a 980px minimum width and uses many labels and controls below 12px.

The product owner approved an ADO-focused first-run call to action, use of an application-provided public-client ID, organization choices saved per account, local Story/Task queue selection, and a simpler workspace navigation. The first release remains local-first and read-only against Azure DevOps.

## Identity and first-run experience

### User flow

1. A first-time user sees a focused welcome screen with a primary **Sign in with Azure DevOps** action and a short explanation that access is delegated and read-only.
2. The action opens Microsoft sign-in in the system browser using authorization-code flow with PKCE. The desktop app does not use an embedded login webview or modal for credential entry.
3. After the callback, the app shows the signed-in account and moves the user to organization selection.
4. The user can choose an organization discovered for the account or add an organization by name or validated `https://dev.azure.com/{organization}` URL. The app validates access before saving it.
5. The user selects an accessible project. The app remembers validated organizations for that signed-in account so the user can switch organizations later.

The user-facing button is ADO-branded, while the authentication page and protocol remain Microsoft Entra. Azure DevOps OAuth is not an option for a new app: Microsoft stopped accepting new registrations in April 2025 and schedules the legacy service for removal in 2026. [Azure DevOps OAuth guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops)

### Public-client registration

The distributed application supplies its own Microsoft Entra public-client application ID so end users do not have to create an app registration or paste a client ID. The ID is public configuration, not a credential; no client secret or certificate is embedded in the desktop binary. The app continues to request only delegated Azure DevOps read permissions required for profile, project, work-item and, when selected, Git reads. Tokens stay in the encrypted main-process cache described by ADR-0001.

This decision requires the application publisher or deployment owner to register and maintain a multi-tenant public client, configure the desktop loopback redirect and ADO delegated permissions, and document tenant admin-consent behavior. Development builds need an explicit configuration source for the app ID. The app must fail with a clear setup error if this public configuration is absent; it must not prompt ordinary end users to register an application.

Microsoft's current ADO Entra guidance says personal Microsoft accounts are not natively supported for the Azure DevOps resource. The first release must clearly identify supported Entra-backed organizational accounts and give an actionable error for unsupported account types. [Entra OAuth for Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops)

## Organization and project selection

- After sign-in, list organizations where membership discovery succeeds and provide **Add organization** as a fallback.
- Validate organization input using the existing strict Azure DevOps hostname/name rules; never use an arbitrary hostname as an API root.
- Validate access with a read request before saving the organization to the account's local choices.
- List accessible projects for the selected organization, retaining existing paging and permission/error handling.
- Show the active account, organization and project in the workspace context. Switching organization or project must preserve source identity on queued items and must not merge items that share numeric IDs across projects or organizations.
- Keep saved organization choices local and scoped to the signed-in account. Sign-out and local-data deletion follow the existing security and retention decisions.

## Story and Task selection

### Work-item flow

1. **Work items** is the default workspace destination after project selection.
2. The work-item view helps the user find Stories and requirements by ID or title. It may default to requirement/story types while retaining filters for actual project-specific ADO types, states and custom mappings.
3. Each result shows its actual ADO type, title, ID, state and source revision. A requirement row exposes its child Tasks in a nested, expandable list.
4. The user can add a requirement, one or more child Tasks, or both to the local QA Queue. The selection state is clear on both the result and queue screens; duplicates remain prevented by organization, project and work-item ID.
5. The queue groups selected work by organization and project, keeps the parent relationship visible, and identifies stale or inaccessible revisions before a run.

“Assigning” in this flow means selecting existing ADO items for this app's local QA Queue. It does not change ADO assignees, fields, comments, or any other server-side data. Tasks can inform QA scope but do not prove their parent's acceptance criteria. Preserve source IDs, fields and revisions as required by the domain model.

## Workspace navigation and visual cleanup

Use a focused first-run screen before the workspace. After setup, simplify the primary navigation to:

- **Work items** — organization/project context and search/browse.
- **QA Queue** — selected requirements and tasks, grouped by source.
- **Runs** — run setup, plan review, progress, reports and history.
- **Settings** — connected account, saved organizations, provider configuration and local data controls.

Run setup and plan review remain guided stages after the user starts a run from the queue; they are not separate global navigation destinations. Preserve current product capabilities and security disclosures.

Apply a consistent visual system across the existing renderer: readable type and control sizes, clear spacing and hierarchy, responsive layouts that work below the current 980px minimum, visible focus states, and uncluttered empty/loading/error states. Keep all primary flows keyboard-operable and labeled for assistive technology. The design should prioritize the first-run connection, organization/project selection, work-item browsing and queue while maintaining the same visual rules in run, report and history views.

## Requirements and acceptance criteria

This design refines existing M1 requirements FR-01 through FR-04 and NFR-08; it does not add ADO writeback or change verdict/domain rules.

- **ONB-01:** On a fresh install with app configuration present, the first actionable control is **Sign in with Azure DevOps**; no end-user client-ID registration or entry is required.
- **ONB-02:** Activating sign-in opens the system browser for Entra authorization-code with PKCE. Tokens never enter renderer state or logs.
- **ONB-03:** The app-provided client ID is treated as public configuration only. No client secret is shipped.
- **ONB-04:** After sign-in, a user can choose a discovered organization or add one by validated organization name/URL; inaccessible organizations are not saved as connected choices.
- **ONB-05:** Users can switch among validated organizations saved for their account and select an accessible project. Work-item identity remains scoped by organization and project.
- **ONB-06:** A user can find an ADO Story/requirement, expand child Tasks, and add the Story, selected Tasks, or both to the local QA Queue.
- **ONB-07:** Queue changes are local. No ADO write request occurs. The queue keeps the parent relationship, actual item types and revisions; duplicate additions are prevented.
- **ONB-08:** UI text clearly distinguishes a Task from its parent's acceptance criteria and never represents Task completion as proof of Story behavior.
- **ONB-09:** Before approving a QA plan, the user can review selected Stories/Requirements, Tasks, project scope, acceptance-criteria coverage, required check layers and target. The summary distinguishes Task context from criterion evidence.
- **ONB-10:** After plan approval, the approved run is selected in Runs and exposes **Start approved run** without requiring the user to find the run manually.
- **UI-01:** Main navigation exposes Work items, QA Queue, Runs and Settings; setup/review stages remain in the run flow.
- **UI-02:** The first-run, organization/project, work-item and queue screens fit an 800px-wide desktop window without horizontal page scrolling.
- **UI-03:** Text and controls use a readable size hierarchy; keyboard focus, labels, errors, loading and empty states remain visible and accessible.
- **UI-04:** Existing QA setup, execution, report, history and privacy behaviors remain available after navigation changes.

## Security and compatibility

- Keep Entra delegated authentication because Azure DevOps OAuth registration is closed to new apps and legacy OAuth is scheduled for retirement. The ADO-branded button is product wording, not a different identity provider.
- Use system-browser PKCE, main-process token acquisition, encrypted MSAL cache persistence and sender-validated typed IPC.
- Request only delegated read scopes; no PAT, secret, ADO write permission, server-side queue mutation, telemetry or cloud storage is introduced.
- Validate every organization input and continue restricting requests to approved Azure DevOps hosts.
- Preserve supported account limitations, consent failures, Conditional Access errors, cancellation, sign-out and local data deletion behaviors.

## Files to update after design approval

- `docs/spec/01-product-requirements.md`: clarify first-run ADO-branded sign-in, app-owned public-client configuration, organization management and Story/Task queue acceptance tests.
- `docs/spec/02-azure-devops-integration.md`: describe app-provided client ID and organization validation/remembering behavior.
- `docs/spec/04-security-privacy.md`: retain Entra and document public-client configuration as non-secret.
- `docs/spec/05-desktop-experience.md`: replace the current connection/navigation/work-selection flow with this design.
- `docs/00-agentic-qa-system-architecture.md`, `docs/entra-registration.md`, and `docs/spec/06-delivery-plan.md`: record runtime configuration ownership and update M0/M1 validation if needed.
- Implementation paths, after product docs and implementation plan are approved: `apps/desktop/src/renderer/App.tsx`, renderer styles, `apps/desktop/src/shared/ipc.ts`, main-process settings/storage, ADO organization selection and behavior-focused tests.

## Open release gate

The prior public-client registration gate is superseded. M0 must verify Azure CLI detection, sign-in, ADO token acquisition, encrypted profile storage and ADO reads on Windows and macOS. This design does not claim the existing M0 gate is complete.

## Amendment: Azure CLI identity and reusable work profiles

The user approved reusing the machine's Azure CLI sign-in instead of requiring the app publisher's client-ID configuration. On first use, the app checks whether Azure CLI is installed and signed in, then offers to open the CLI's Microsoft browser sign-in when needed. It obtains an Azure DevOps token in the Electron main process using the fixed Azure DevOps resource ID. The token is transient and is never placed in renderer state, profile configuration, logs, or worker environments. This avoids an app-owned client registration; the CLI token remains Entra-backed, as Azure DevOps' documented CLI flow requires.

The app has a schema-versioned local ADO configuration with one or more named profiles. Each profile contains an organization, project, team, target taskboard column, and zero or more Story IDs. A profile is validated with read-only ADO requests before activation. Settings can add, edit, remove, and activate profiles; the user can switch the active profile before searching or starting a run. Profile values have safe defaults, but the first-use flow does not require entering organization/project/team values when a configuration file is provided. The in-app editor writes back the local profile configuration. Keep credentials out of this file and preserve encrypted-at-rest storage for profile data.

For a configured team and board column, work-item discovery follows this read-only sequence: current team iteration, taskboard work-item IDs and columns, configured Story relation/child IDs, batched item details, then comments. Only Story/Task IDs meeting the chosen board-column filter enter the work-selection flow. Users retain the option to browse/add work manually when no board filter is configured. Descriptions, acceptance criteria, and comments are normalized from HTML at the adapter boundary. ADO remains read-only and local Queue membership does not write back to the service.

This amendment supersedes the public-client registration and mandatory manual org/project-entry details above. The system browser still handles Microsoft authentication through Azure CLI. The M0 gate now verifies CLI availability, sign-in/context selection, token lifetime/failure handling, and read-only API access on macOS and Windows. Azure CLI installation remains a machine prerequisite; app packaging must detect and explain its absence.

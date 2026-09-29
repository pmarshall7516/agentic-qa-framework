# Azure CLI authentication and saved ADO profiles

## Goal

Replace the app-owned Microsoft public-client setup with the installed Azure CLI identity, and let each user configure reusable Azure DevOps run profiles in Settings. Profiles contain an organization, project, team, target board column, and optional Story IDs; users can retain several profiles and switch the active profile before a run. Add read-only sprint/taskboard and comment collection to the ADO adapter.

## Requirements

- Microsoft sign-in is completed by `az login` in the system browser; the app obtains a short-lived ADO resource token from the active CLI context without showing or persisting it in renderer state.
- Profiles are local, schema-versioned configuration data. In-app Settings can add, edit, validate, select, and remove profiles. Preserve the existing account-scoped encrypted storage boundary; do not persist credentials in the profile file.
- A profile can identify multiple Stories. Its project/team/board column determine the taskboard scope. Users can still select Stories and child Tasks into the local QA Queue.
- Reads follow current iteration → taskboard column → Story relations/children → batched details → comments. No ADO write APIs.
- Remove mandatory app client-ID configuration from build and first-run UX. Document that Azure CLI still obtains Entra-backed ADO tokens.
- Update requirements, integration, security, architecture, UX, delivery-plan and setup docs before behavior changes.

## Implementation sequence

1. Revise the approved sign-in design and product/security specs to resolve the existing app-registration conflict in favor of Azure CLI delegated identity and local profiles.
2. Add behavior-focused tests for CLI authentication command handling and for ADO iteration/taskboard/comment request order, parsing and failure paths.
3. Implement main-process-only CLI token acquisition with fixed executable/argument arrays, bounded output/timeouts, and actionable missing-CLI/not-signed-in errors. Never log token output.
4. Extend the ADO client with current team iteration, taskboard work items, child IDs and comment reads; normalize HTML text at the adapter boundary and retain source IDs/revisions.
5. Add validated encrypted profile settings and IPC contracts. Build the Settings editor and active-profile switcher; load config defaults on first launch without requiring manual entry.
6. Connect active profile to work-item loading and QA run context; ensure selection remains local/read-only.
7. Run focused unit/type/build checks and report the unchanged M0 platform validation gate.

## Constraints and open environment dependency

Azure CLI is not installed. Homebrew is present, but currently refuses commands until the macOS Xcode license is accepted. Do not accept that license on the user's behalf. Resume CLI installation after the user accepts the license, or use another supported installer if available without that prerequisite.

## Acceptance checks

- Existing users can sign in using their configured `az` context without an app client ID.
- Missing CLI and missing CLI login produce actionable errors without exposing token data.
- Users can save and switch multiple validated org/project/team/column/Story profiles from Settings.
- ADO reads use the documented sequence and never call a write endpoint.
- `npm run typecheck`, focused tests, and `npm run app:build` pass. No claim of Windows/Mac distribution readiness until M0 platform gates pass.

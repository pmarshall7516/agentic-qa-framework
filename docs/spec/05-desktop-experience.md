# Desktop user experience

**Status:** first-release interaction specification.

## Navigation

First launch is a focused **Sign in with Azure DevOps** screen. The action uses the installed Azure CLI and Microsoft system-browser sign-in. After account and organization setup, primary navigation is **Work items** → **QA Queue** → **Runs** → **Settings**. Settings contains account connection, named ADO run profiles, provider configuration and local-data controls.

The selected account, organization and project are always visible in the header. Switching project does not mix work-item IDs or reports across organizations. Keyboard and screen-reader users can complete every primary flow.

## Connect and choose work

1. **First launch:** explain read-only Azure DevOps access and show **Sign in with Azure DevOps**. Azure CLI opens Microsoft sign-in; no app-owned client ID is needed. Show missing CLI, missing account, success, access denial and cancellation clearly.

Disconnect opens an OS-native choice to cancel, keep local QA data, or delete it. It leaves the machine-wide Azure CLI sign-in intact. Deletion removes queued work items and snapshots, run history/reports/contracts, encrypted evidence, Azure DevOps profiles/type mappings and saved run targets; it preserves optional OpenAI provider settings.
2. **Choose organization/project:** list organizations available through Accounts List where discovery succeeds; offer a validated organization name/URL as fallback. Check project-read access before saving. Remember validated choices per signed-in account. List accessible projects and remember the selection per account.
2a. **Run profiles:** Settings stores multiple validated profiles per CLI account. Each profile includes organization, project, team, target sprint board column and Story IDs; users can create, edit, remove and switch them. Loading a profile reads the current team iteration, Stories, child Tasks in the configured column, details and comments using read-only APIs.
2b. **Sprint scope:** Work items can load active Requirements from a searchable team-sprint picker. Expanding a Requirement shows its child Tasks and each task's column in the selected sprint board; tasks absent from that board are labeled accordingly. The ID/title filter searches loaded Stories and Tasks. A multi-select taskboard-column filter beside it filters only child Task rows, keeping parent Stories visible. Combining both filters uses AND for Tasks; matching the parent Story keeps all of its Tasks eligible for the column filter. Place **Hide Tasks** after the expanded task rows and keep the selected-items Add action in a fixed footer while selection is active.
3. **Search:** input accepts numeric ID or title phrase; filters include state/type and optionally area/iteration. Results show actual ADO type, title, ID, state, revision and parent. Selecting a Requirement/Story shows its acceptance criteria and expandable child Tasks. Add the Requirement, chosen Tasks or both to the local queue; do not update ADO.
4. **Queue:** group entries by organization/project. Render each queued Story as the main row with its queued child Tasks nested below as separate rows; keep standalone Tasks visible in an Other queued work section. Show revision and stale/inaccessible markers. Remove and reorder. Queue order affects presentation, not verdict priority. A Task informs scope but does not prove parent acceptance criteria.

## Configure and run

1. **Target:** choose local repository, ADO Git ref/PR, development/staging URL, or both. Show commit identity, dirty-tree state and URL origin. Never guess which PR or deployment corresponds to a requirement.
2. **Target setup:** select a local or ADO Git repository and optional dev site. No repository config file or JSON editing is required for the supported automatic path: if the root `package.json` has a `test` script, the app adds `npm test` as a diagnostic command and shows it in the plan. Dependency installation stays disabled because the Repository worker has no network access. Exact JUnit testcase mappings are still required before Repository evidence can verify an Acceptance Criterion. Browser-only users can proceed without a repository config or container. Advanced users can optionally save custom commands and mappings in encrypted app settings.
3. **Planning disclosure:** create a deterministic local plan first. Before any optional provider request, show the configured provider/model, exact selected criterion text, exclusions, token estimate and hard output limit; require a separate approval for that request. A user-added candidate criterion may quote a selected Task description; the exact payload preview is authoritative. No provider means no data leaves for planning. Repository files and raw Task descriptions are excluded from the v1 provider payload.
4. **Plan:** before approval, summarize the selected Stories/Requirements and Tasks, organization/project scope, acceptance-criteria coverage, required check layers and QA target in a compact review. Show each source acceptance criterion alongside proposed atomic criteria, scenarios, target layer and required evidence. User can edit; ambiguities remain flagged. Show task-derived checks separately and state that Tasks provide context rather than proof of Story criteria. Then show worker permission summary and test-data effects for final run approval.
5. **Preflight:** validate ADO source revisions, site, browser, container if needed, disk space, credentials and limits. Actionable failures link back to the setting that fixes them. A failed preflight never displays `PASS`.
6. **Run:** after approval, open the approved QA run in Runs with its **Start approved run** action available. Show persisted Orchestrator, worker, Scenario and Browser step progress, last observation, and a cancel button. Cancel stops workers and retains a partial report. Repository command results and JUnit testcase identities appear beside their linked acceptance criteria.

## Report and history

The report opens with both execution state and verdict, plus the reason each follows policy, followed by a criterion coverage table. Each row exposes expected behavior, required layer, scenario status, observation and artifact. Ordered Playwright screenshots are previewable in the report; restricted traces and raw files remain behind the export warning. Findings show expected/actual, reproduction steps, classification, source/target identity and known uncertainty. A separate section lists unverified/blocked criteria and why. Users can export HTML/Markdown/JSON, compare with previous run, rerun using a newly approved manifest, or delete the run and artifacts.

Exports are previewed for restricted artifacts and redaction status. ADO publishing is absent in the first release; an export is a local file the user chooses to share.

## Error copy requirements

Errors name the failed operation, whether it affected the run verdict, and a concrete next action. Examples: “This organization is not available to the signed-in account. Check the organization name or sign in with another account.” “This app build is missing its Azure DevOps sign-in configuration. Contact the app administrator.” “Repository checks could not start because the container runtime is unavailable. Site checks can still run.” “The site redirected to an unapproved origin. Add it to the approved auth flow or choose another target.” Never show raw tokens, provider payloads or stack traces in ordinary UI errors.

## Visual and accessibility requirements

- Use a consistent readable type and control scale, clear spacing and hierarchy, and visible keyboard focus across every screen.
- Windows and macOS use the same renderer and styles. Keep UI changes shared across both platforms and verify them with equivalent viewport size, display scaling and work-item/profile data; document any intentional native-only difference.
- Support an 800px-wide desktop window without horizontal page scrolling on first-run, organization/project, work-item and queue screens.
- Keep loading, empty, error and disconnected states clear; every primary flow remains keyboard-operable and screen-reader labeled.

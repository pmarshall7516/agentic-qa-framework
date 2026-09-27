# Desktop user experience

**Status:** first-release interaction specification.

## Navigation

`Connections` → `Project` → `Work items` → `QA Queue` → `Run setup` → `AI disclosure` → `Plan review` → `Progress` → `Report` → `History`.

The selected account, organization and project are always visible in the header. Switching project does not mix work-item IDs or reports across organizations. Keyboard and screen-reader users can complete every primary flow.

## Connect and choose work

1. **Connect ADO:** explain Entra-backed ADO Services support and requested read permissions. Open system-browser sign-in; show success, consent/admin policy errors, personal-account limitation and sign-out.
2. **Choose organization/project:** list accessible organizations where discovery succeeds; offer validated organization URL entry as fallback. List accessible projects. Remember the last choice locally.
3. **Search:** input accepts numeric ID or title phrase; filters include state/type and optionally area/iteration. Results show type, title, ID, state and parent. Selecting a requirement opens its description, acceptance criteria, child tasks and links. Multi-select adds items to the queue; a child can be included with parent or alone.
4. **Queue:** group entries by org/project. Show revision and stale/inaccessible markers. Remove and reorder. Queue order affects presentation, not verdict priority.

## Configure and run

1. **Target:** choose local repository, ADO Git ref/PR, development/staging URL, or both. Show commit identity, dirty-tree state and URL origin. Never guess which PR or deployment corresponds to a requirement.
2. **Project config:** detect a repository config, show exact test commands and timeouts, choose test account secret reference, approve allowed origin and data-changing scenarios. Browser-only users can proceed without a container.
3. **Planning disclosure:** before generating the plan, show configured AI provider, exact work-item fields and source snippets leaving the machine, redactions, exclusions and estimated usage. Approval is required for that run. If later model calls need additional context, show another preview before transmission.
4. **Plan:** show each source acceptance criterion alongside proposed atomic criteria, scenarios, target layer and required evidence. User can edit; ambiguities remain flagged. Show task-derived checks separately. Then show worker permission summary and test-data effects for final run approval.
5. **Preflight:** validate ADO source revisions, site, browser, container if needed, disk space, credentials and limits. Actionable failures link back to the setting that fixes them. A failed preflight never displays `PASS`.
6. **Run:** live stage and scenario progress, elapsed time, remaining limits, last observation, cancel button. Cancel kills workers and retains a partial report.

## Report and history

The report opens with verdict and the reason it follows policy, followed by a criterion coverage table. Each row exposes expected behavior, required layer, scenario status, observation and artifact. Findings show expected/actual, reproduction steps, classification, source/target identity and known uncertainty. A separate section lists unverified/blocked criteria and why. Users can open a local Playwright trace, export HTML/Markdown/JSON, compare with previous run, rerun using a newly approved manifest, or delete the run and artifacts.

Exports are previewed for restricted artifacts and redaction status. ADO publishing is absent in the first release; an export is a local file the user chooses to share.

## Error copy requirements

Errors name the failed operation, whether it affected the run verdict, and a concrete next action. Examples: “This organization is not available to the signed-in account. Check the organization URL or sign in with another Entra account.” “Repository checks could not start because the container runtime is unavailable. Site checks can still run.” “The site redirected to an unapproved origin. Add it to the approved auth flow or choose another target.” Never show raw tokens, provider payloads or stack traces in ordinary UI errors.

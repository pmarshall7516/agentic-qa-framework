# Azure DevOps Services integration

**Status:** implementation contract for first release. Azure DevOps Server is excluded.

## Identity

Use the user's installed Azure CLI as the delegated identity broker. The app invokes `az login --allow-no-subscriptions` without a shell, then requests an ADO access token using `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --tenant <tenant>`. Microsoft documents this method at [Issue Entra tokens with Azure CLI](https://learn.microsoft.com/en-us/azure/devops/cli/entra-tokens?view=azure-devops). This avoids an app-owned client registration; the token is still Entra-backed. Never use deprecated Azure DevOps OAuth registrations.

The first-run CTA is **Sign in with Azure DevOps**. Azure CLI opens the system browser when its account needs interactive sign-in. If the CLI is unavailable, show an install instruction; if no account is signed in, offer sign-in and explain that `az login` can also be run in Terminal. Do not require an app client ID or client secret.

**Account support caveat:** Microsoft documents limitations for personal Microsoft accounts (MSA) accessing the ADO resource through Entra OAuth. The onboarding UI must say the first release targets Entra-backed organizations and provide a precise unsupported-account error. Do not promise universal ADO-account coverage until tested. [Microsoft Entra ADO guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops).

Only acquire the Azure DevOps resource token when making a read request. Never write token output to logs/files or pass it to renderer/workers. Disconnecting the app clears its selected account/profile but does not run `az logout`, because that would sign the user out of other CLI workflows. Azure CLI owns token refresh and credential caching. M0 must verify CLI account/tenant selection and token expiry behavior on macOS and Windows.

## Selection and discovery

1. Acquire a token for the ADO resource and fetch the signed-in profile (`profiles/me`).
2. Discover organization memberships through Accounts List (`GET https://app.vssps.visualstudio.com/_apis/accounts?memberId={profile-id}&api-version=7.1`, delegated `vso.profile`) when available. Because membership/tenant behavior varies, permit the user to enter a `dev.azure.com/{organization}` URL and validate access by listing projects before saving it. Never accept arbitrary hostnames as ADO API roots.
3. Keep validated organizations, projects, and named run profiles in encrypted local settings scoped to the selected CLI account. A profile contains organization, project, team, taskboard column and Story IDs. Switching profiles changes the active ADO context; queued item identity remains organization/project scoped.
4. List accessible projects for a validated organization, handling continuation/paging and permission failures.
5. Discover requirement and task categories/types for the selected project. Default process names vary: Agile uses User Story; Scrum uses Product Backlog Item; Basic uses Issue; CMMI uses Requirement. Custom types may exist. [Microsoft category reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/titles-ids-descriptions?view=azure-devops).

Relevant APIs: [profile](https://learn.microsoft.com/en-us/rest/api/azure/devops/profile/profiles/get?view=azure-devops-rest-7.1), [accounts](https://learn.microsoft.com/en-us/rest/api/azure/devops/account/accounts?view=azure-devops-rest-7.1), [projects](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1), [work-item categories](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-categories?view=azure-devops-rest-7.1).

## Search and snapshot

- Use WIQL scoped to the selected project, escaped/parameterized input construction, bounded result size and paging strategy. Query by exact numeric ID or title term; filter by configured category/types and state. WIQL returns IDs, so fetch fields/relations separately. [WIQL reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops), [query API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1).
- Fetch work items in batches of at most 200 IDs, selecting only necessary fields; fetch relations to identify hierarchy-forward child tasks. Record each `id`, `rev`, type, title, state, description, acceptance criteria, tags, links and project-specific mapped fields. Sanitize HTML for display. Refresh every queued source from ADO before planning and freeze the returned revision and field excerpts in the plan; a failed refresh must surface its ADO error category and stop plan creation. [Batch API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1), [relation model](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1).
- A task can be queued alone or as a child of a requirement. When queued alone, mark source type `TASK` and treat its description/definition of done as candidate behavior, not a parent acceptance criterion. When queued through a parent, include the parent and selected children in one contract.
- Selecting a Requirement/Story and its Tasks only changes the local QA Queue; do not call any ADO write endpoint or mutate assignments, fields, comments or links.
- For a configured run profile, read in this order: current team iteration, taskboard work items, configured Story hierarchy relations/children, batched details, then item comments. Select child Tasks whose taskboard column matches the configured column. Normalize HTML descriptions, acceptance criteria and comments at the adapter boundary. The APIs are read-only: [iterations](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/iterations/list?view=azure-devops-rest-7.1), [taskboard items](https://learn.microsoft.com/en-us/rest/api/azure/devops/work/taskboard-work-items/list?view=azure-devops-rest-7.1), [comments](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments?view=azure-devops-rest-7.1).
- Field mapping is per project: default `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` where present; let the user map custom fields. Missing fields are shown, never silently filled by the model.
- Preserve the complete selected work-item source context in each approved QA Contract, including Task `System.Description` values and their revisions. A Task description may become a separately labeled candidate check only after user action; it must retain Task provenance and cannot replace Requirement Acceptance Criteria.
- Snapshot every selected work item before plan approval. Keep the revision and retrieval timestamp. If it changes after queueing, refresh the Queue and create a new plan before approval.

## Repository and PR context

List project Git repositories when the user selects an ADO repository. The user must select a ref or PR explicitly. A linked PR is suggested, not assumed to be the sole implementation. Verify its repository and work-item association; multiple linked PRs remain selectable. The privileged ADO adapter fetches a specific commit/ref and creates a token-free source snapshot for the repository worker; do not execute code from an unfrozen moving branch or pass the ADO token to the worker. [Repo list](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/list?view=azure-devops-rest-7.1), [PR API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1).

## Errors and rate behavior

Distinguish expired token, consent/Conditional Access denial, unauthorized project, deleted work item, field absent, rate limit, network outage and malformed content. Retry safe reads with bounded exponential backoff and respect server retry headers. Never retry writes in the first release. Cache only within a user-selected account/org boundary; purge on sign-out. Do not place bearer tokens in URL, logs or reports.

## Contract tests

Use recorded or fake API responses for Agile/Scrum/custom work-item types, multi-page project lists, child tasks, missing acceptance criteria, HTML content, moved/deleted items, 401/403/429, and two organizations with overlapping work-item IDs. Run one live tenant integration test with a dedicated test account before release.

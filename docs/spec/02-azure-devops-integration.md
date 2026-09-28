# Azure DevOps Services integration

**Status:** implementation contract for first release. Azure DevOps Server is excluded.

## Identity

Use a Microsoft Entra **public client** with system-browser authorization code + PKCE and delegated Azure DevOps permissions. A desktop binary cannot protect a client secret. Use `@azure/msal-node` with an app-owned `ICachePlugin` that encrypts the persistent cache through Electron `safeStorage`; do not use MSAL Node Extensions because their native `keytar` dependency prevents the required cross-package workflow. See [ADR-0001](../decisions/ADR-0001-msal-cache-portable-packaging.md), Microsoft's [Electron system-browser PKCE sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp/README.md), and [cache guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching). Never use the deprecated Azure DevOps OAuth registration flow for a new app. Microsoft says new ADO OAuth registrations ended in April 2025 and deprecation is scheduled for 2026: [ADO OAuth notice](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/azure-devops-oauth?view=azure-devops), [public client guidance](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications).

**Account support caveat:** Microsoft documents limitations for personal Microsoft accounts (MSA) accessing the ADO resource through Entra OAuth. The onboarding UI must say the first release targets Entra-backed organizations and provide a precise unsupported-account error. Do not promise universal ADO-account coverage until tested. [Microsoft Entra ADO guidance](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops).

Configure only Azure DevOps delegated read scopes: `vso.profile`, `vso.project`, and `vso.work`; add `vso.code` for ADO Git repository/ref/source reads. The app requests the resource `/.default` scope, which represents the delegated permissions configured and consented for the app. Do not add `user_impersonation`, write/manage scopes, or application permissions. Microsoft documents the [ADO scope definitions](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops) and [Entra ADO resource identifier and `/.default` behavior](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops). Tenant-specific admin-consent behavior and actual API access remain M0 live integration checks. Sign-out removes the local token cache and account metadata; explain that server-side consent revocation is managed in Microsoft account/tenant settings.

## Selection and discovery

1. Acquire a token for the ADO resource and fetch the signed-in profile (`profiles/me`).
2. Discover organization memberships through the Accounts API when available. Because membership/tenant behavior varies, permit the user to enter a `dev.azure.com/{organization}` URL and validate access. Never accept arbitrary hostnames as ADO API roots.
3. List accessible projects for a validated organization, handling continuation/paging and permission failures.
4. Discover requirement and task categories/types for the selected project. Default process names vary: Agile uses User Story; Scrum uses Product Backlog Item; Basic uses Issue; CMMI uses Requirement. Custom types may exist. [Microsoft category reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/titles-ids-descriptions?view=azure-devops).

Relevant APIs: [profile](https://learn.microsoft.com/en-us/rest/api/azure/devops/profile/profiles/get?view=azure-devops-rest-7.1), [accounts](https://learn.microsoft.com/en-us/rest/api/azure/devops/account/accounts?view=azure-devops-rest-7.1), [projects](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1), [work-item categories](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-item-type-categories?view=azure-devops-rest-7.1).

## Search and snapshot

- Use WIQL scoped to the selected project, escaped/parameterized input construction, bounded result size and paging strategy. Query by exact numeric ID or title term; filter by configured category/types and state. WIQL returns IDs, so fetch fields/relations separately. [WIQL reference](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops), [query API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/wiql/query-by-wiql?view=azure-devops-rest-7.1).
- Fetch work items in batches of at most 200 IDs, selecting only necessary fields; fetch relations to identify hierarchy-forward child tasks. Record each `id`, `rev`, type, title, state, description, acceptance criteria, tags, links and project-specific mapped fields. Sanitize HTML for display. [Batch API](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-items-batch?view=azure-devops-rest-7.1), [relation model](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items/get-work-item?view=azure-devops-rest-7.1).
- A task can be queued alone or as a child of a requirement. When queued alone, mark source type `TASK` and treat its description/definition of done as candidate behavior, not a parent acceptance criterion. When queued through a parent, include the parent and selected children in one contract.
- Field mapping is per project: default `System.Description` and `Microsoft.VSTS.Common.AcceptanceCriteria` where present; let the user map custom fields. Missing fields are shown, never silently filled by the model.
- Snapshot every selected work item at run start. Keep the revision and retrieval timestamp. If it changed after queueing, show a diff/refresh choice before the user approves the run.

## Repository and PR context

List project Git repositories when the user selects an ADO repository. The user must select a ref or PR explicitly. A linked PR is suggested, not assumed to be the sole implementation. Verify its repository and work-item association; multiple linked PRs remain selectable. The privileged ADO adapter fetches a specific commit/ref and creates a token-free source snapshot for the repository worker; do not execute code from an unfrozen moving branch or pass the ADO token to the worker. [Repo list](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/list?view=azure-devops-rest-7.1), [PR API](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1).

## Errors and rate behavior

Distinguish expired token, consent/Conditional Access denial, unauthorized project, deleted work item, field absent, rate limit, network outage and malformed content. Retry safe reads with bounded exponential backoff and respect server retry headers. Never retry writes in the first release. Cache only within a user-selected account/org boundary; purge on sign-out. Do not place bearer tokens in URL, logs or reports.

## Contract tests

Use recorded or fake API responses for Agile/Scrum/custom work-item types, multi-page project lists, child tasks, missing acceptance criteria, HTML content, moved/deleted items, 401/403/429, and two organizations with overlapping work-item IDs. Run one live tenant integration test with a dedicated test account before release.

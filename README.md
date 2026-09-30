# Agentic QA Framework

Local-first Windows and macOS desktop harness for evidence-backed QA runs against Azure DevOps Requirements, a repository snapshot, a development/staging site, or both.

## Branch workflow

`develop` is the default branch for ongoing development. Create feature and fix branches from `develop`, then merge completed work back into `develop` through pull requests. When `develop` is ready for a packaged release, merge it into `main` through a pull request. Keep `develop` after that merge; build packaged releases from `main`.

## Build and launch

Requirements: Node.js 22, npm, Azure CLI for Azure DevOps access, and Claude Code only if you use a Claude plan account. Site-only runs do not need Docker; repository checks do. Azure CLI opens Microsoft sign-in in your system browser and supplies the ADO read token.

```sh
npm install
npm run app
npm test
npm run typecheck
```

`npm run app` builds the desktop bundle and opens the Electron app window. It does not launch the renderer as a standalone website. To rebuild and relaunch as separate steps:

```sh
npm run app:build
npm run app:run
```

Azure DevOps sign-in uses the Azure CLI installed on your machine. Install Azure CLI, then use **Sign in with Azure DevOps** in the app; Azure CLI opens Microsoft's sign-in page in your system browser. The app obtains read-only ADO tokens from that CLI session and does not require an app registration or client ID.

If Azure CLI is installed outside `PATH`, set `AGENTIC_QA_AZ_CLI_PATH` to its executable before launching the app.

Build the unsigned launch packages:

```sh
npm run package:mac   # Apple Silicon .app and .dmg
npm run package:win   # Windows x64 NSIS installer and portable launchable .exe
```

Windows signing and macOS notarization are intentionally not part of the local-testing v1. Unsigned binaries may trigger operating-system reputation warnings. The Windows package is generated on the macOS build host; install and launch it on Windows before distributing it to testers.

## First run

1. Install Azure CLI and sign in through **Sign in with Azure DevOps**. The app uses the selected CLI account and read-only Azure DevOps APIs. Azure CLI manages the machine sign-in; the app holds a short-lived ADO token only in main-process memory while making requests.
2. Import a configuration JSON file or select an organization and project. Search Stories and Tasks, or load the active profile's current sprint and configured board-column tasks, then add selected items to the local QA Queue. Search results page by ID cursor; refresh the queue before planning and again before approval to detect changed revisions.
3. In Settings, connect a supported AI provider and save a searchable model: import an API key for OpenAI, Anthropic, or OpenRouter, or choose **Claude account · Claude Code plan** to sign in through Claude Code. Claude credentials stay in Claude Code's local store. Its searchable choices are curated `sonnet`, `opus`, and `haiku` aliases; confirm that the chosen alias is available to your account. Displayed Claude rates are API-equivalent estimates, not plan charges.
4. Choose Site, Repository, or Both. A repository can come from a local folder or an Azure DevOps Git repository/ref; ADO refs are resolved to a commit SHA, and the main process stages only configured files before the token-free snapshot reaches Docker. Site runs need local Chromium, which the Run setup page can download. Browser navigation and requests stay within the exact approved site origin.
5. Select a queued Story and its Tasks, prepare the agentic QA plan, and review the criterion coverage, delegated frontend/backend/browser/repository work, diagram, context disclosure and run limits. The Orchestrator proposes how each criterion should be tested; tasks inform scope but do not prove the Story's acceptance criteria. Approve the plan to start the run, then review per-criterion observations, generated checks, reviewer findings and summaries. Restricted traces, screenshots and command outputs remain encrypted; saving evidence requires a warning and native file picker. A rerun creates a new manifest linked to its predecessor; prior evidence and reports remain unchanged.

Repository checks require a `.agentic-qa.yml` file at the selected repository root. See [the schema and example](docs/spec/07-repository-config.md). Include only files needed for the QA run. The snapshot builder excludes credentials, private keys, Git internals and dependency folders. Repository commands run in a disposable Docker container with no network, a read-only root filesystem, resource ceilings and only the filtered snapshot streamed into a bounded temporary workspace. JUnit tests must explicitly map to repository Scenario IDs to count as direct evidence. Missing Docker, unsupported network setup, or unapproved/missing scenario mappings leave the run blocked or unverified. The first use of repository checks also downloads the Node 22 worker image from Docker Hub.

### Reusable Azure DevOps configuration

Settings supports named profiles for multiple organizations and projects. Import `config/ado-profiles.example.json` or a copy containing your org/project/team/board-column/Story IDs; the app validates each profile against your signed-in account and saves it in encrypted local settings. You can edit, add, remove, and switch profiles in the app. The example contains the Xorbix / Derse values from the supplied workflow; change it before importing if those are not your settings. No credentials belong in this JSON file.

## Security and data

- Azure DevOps calls are read-only. No comments, work-item updates, PR edits, uploads, telemetry, cloud sync or unattended runs are implemented.
- Work items, reports and run profiles are stored in SQLCipher-backed SQLite. Azure CLI manages the machine's sign-in cache; the app does not persist ADO tokens.
- Captured browser traces and screenshots plus bounded repository stdout/stderr and JUnit outputs are marked restricted and encrypted locally, then linked to their observations. Saving one requires an explicit warning confirmation and a native file picker. Plaintext run snapshots live in private temporary storage and are removed after execution; stale app scratch folders are cleaned on startup.
- Renderer code has no Node integration. Main/preload IPC is fixed-channel, schema-validated and origin-checked.

## Current release evidence

The current host produced and launched an unsigned macOS arm64 app, cross-built unsigned Windows x64 NSIS and portable executables, and passed repository-worker integration checks against the pinned Node 22 image for host-secret exclusion, disabled egress and container cleanup. Model-adapter tests use a fake provider response; no live API key was used. Windows installation/launch, live Entra/ADO access, and the remaining hostile-worker/resource-limit checks still require host/account evidence. See the [M0 feasibility record](docs/spec/08-m0-feasibility-record.md) for artifact hashes, exact commands and open gates. Do not describe the current build as release-ready until M0 and M4 exit gates are met.
# Browser accounts, run context, and app icon

Use `apps/desktop/build/icon.png` as the source app artwork (1024x1024 RGBA PNG). The app uses local named browser accounts for test-site sign-in; credentials are stored in encrypted settings and only injected into a selected Playwright worker. Add extra run-specific instructions in New Run, but do not put passwords or keys in instructions. Select **Show browser window** to watch the separate Playwright Chromium window; otherwise checks remain headless. Sign-in, MFA, missing-account and site-access blocks appear with a reason and next action in the result.

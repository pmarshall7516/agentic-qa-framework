# Agentic QA Framework

Local-first Windows and macOS desktop harness for evidence-backed QA runs against Azure DevOps Requirements, a repository snapshot, a development/staging site, or both.

## Branch workflow

`develop` is the default branch for ongoing development. Create feature and fix branches from `develop`, then merge completed work back into `develop` through pull requests. When `develop` is ready for a packaged release, merge it into `main` through a pull request. Keep `develop` after that merge; build packaged releases from `main`.

## Build and launch

Requirements: Node.js 22, npm, and Azure CLI for Azure DevOps access. Site-only runs do not need Docker; repository checks do. Azure CLI opens Microsoft sign-in in your system browser and supplies the ADO read token.

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
3. Choose Site, Repository, or Both. A repository can come from a local folder or an Azure DevOps Git repository/ref; ADO refs are resolved to a commit SHA, and the main process stages only configured files before the token-free snapshot reaches Docker. Site runs need local Chromium, which the Run setup page can download. Browser navigation and requests stay within the exact approved site origin.
4. Review each acceptance criterion and its required evidence layers. The local planner never invents missing acceptance criteria. OpenAI scenario suggestions are optional: import a one-line key from a private text file, choose browser criteria to disclose, inspect the exact request and token limits, then approve sending. The key is encrypted in the local database and never exposed to the renderer or worker. No task descriptions, repository files, artifacts or credentials are sent. Delete the key source file after import.
5. Approve the contract, run it, review per-criterion observations, classify unresolved findings with your name and reason, and export HTML, Markdown, or JSON. Restricted trace, screenshot, command-log, or JUnit evidence stays encrypted; saving one prompts a warning and opens a native file picker. A rerun creates a new manifest linked to its predecessor; prior evidence and reports remain unchanged.

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

# Agentic QA Framework

Local-first Windows and macOS desktop harness for evidence-backed QA runs against Azure DevOps Requirements, a repository snapshot, a development/staging site, or both.

## Build and launch

Requirements: Node.js 22, npm, and Docker Desktop for repository checks. Site-only runs do not need Docker. Entra sign-in requires an Entra public application registration configured for desktop/system-browser sign-in and Azure DevOps delegated read access; follow [the registration guide](docs/entra-registration.md).

```sh
npm install
npm run dev --workspace @agentic-qa/desktop
npm test
npm run typecheck
```

Build the unsigned launch packages:

```sh
npm run package:mac   # Apple Silicon .app and .dmg
npm run package:win   # Windows x64 NSIS installer and portable launchable .exe
```

Windows signing and macOS notarization are intentionally not part of the local-testing v1. Unsigned binaries may trigger operating-system reputation warnings. The Windows package is generated on the macOS build host; install and launch it on Windows before distributing it to testers.

## First run

1. Create the public-client registration described in [the Entra setup guide](docs/entra-registration.md), enter its client ID, and sign in. The app uses read-only Azure DevOps APIs. Tokens stay in the encrypted main-process cache.
2. Select an organization and project, search Requirements and Tasks, map custom work item types when needed, and add items to the QA Queue. Search results page by ID cursor; refresh the queue before planning and again before approval to detect changed revisions.
3. Choose Site, Repository, or Both. A repository can come from a local folder or an Azure DevOps Git repository/ref; ADO refs are resolved to a commit SHA, and the main process stages only configured files before the token-free snapshot reaches Docker. Site runs need local Chromium, which the Run setup page can download. Browser navigation and requests stay within the exact approved site origin.
4. Review each acceptance criterion and its required evidence layers. The local planner never invents missing acceptance criteria. OpenAI scenario suggestions are optional: import a one-line key from a private text file, choose browser criteria to disclose, inspect the exact request and token limits, then approve sending. The key is encrypted in the local database and never exposed to the renderer or worker. No task descriptions, repository files, artifacts or credentials are sent. Delete the key source file after import.
5. Approve the contract, run it, review per-criterion observations, classify unresolved findings with your name and reason, and export HTML, Markdown, or JSON. Restricted trace, screenshot, command-log, or JUnit evidence stays encrypted; saving one prompts a warning and opens a native file picker. A rerun creates a new manifest linked to its predecessor; prior evidence and reports remain unchanged.

Repository checks require a `.agentic-qa.yml` file at the selected repository root. See [the schema and example](docs/spec/07-repository-config.md). Include only files needed for the QA run. The snapshot builder excludes credentials, private keys, Git internals and dependency folders. Repository commands run in a disposable Docker container with no network, a read-only root filesystem, resource ceilings and only the filtered snapshot streamed into a bounded temporary workspace. JUnit tests must explicitly map to repository Scenario IDs to count as direct evidence. Missing Docker, unsupported network setup, or unapproved/missing scenario mappings leave the run blocked or unverified. The first use of repository checks also downloads the Node 22 worker image from Docker Hub.

## Security and data

- Azure DevOps calls are read-only. No comments, work-item updates, PR edits, uploads, telemetry, cloud sync or unattended runs are implemented.
- Work items and reports are stored in SQLCipher-backed SQLite. The database key and MSAL cache are protected with Electron `safeStorage` on the current OS.
- Captured browser traces and screenshots plus bounded repository stdout/stderr and JUnit outputs are marked restricted and encrypted locally, then linked to their observations. Saving one requires an explicit warning confirmation and a native file picker. Plaintext run snapshots live in private temporary storage and are removed after execution; stale app scratch folders are cleaned on startup.
- Renderer code has no Node integration. Main/preload IPC is fixed-channel, schema-validated and origin-checked.

## Current release evidence

The current host produced and launched an unsigned macOS arm64 app, cross-built unsigned Windows x64 NSIS and portable executables, and passed repository-worker integration checks against the pinned Node 22 image for host-secret exclusion, disabled egress and container cleanup. Model-adapter tests use a fake provider response; no live API key was used. Windows installation/launch, live Entra/ADO access, and the remaining hostile-worker/resource-limit checks still require host/account evidence. See the [M0 feasibility record](docs/spec/08-m0-feasibility-record.md) for artifact hashes, exact commands and open gates. Do not describe the current build as release-ready until M0 and M4 exit gates are met.

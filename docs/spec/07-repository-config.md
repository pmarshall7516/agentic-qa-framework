# Repository configuration contract

**Status:** proposed schema v1 for repository checks. M0 may revise this version if the cross-platform worker probe requires it; revisions must be recorded before M3 implementation.

## Location and ownership

The app reads `.agentic-qa.yml` at the selected repository root when present. If it is absent, the app automatically detects a root `package.json` test script and adds `npm test` as a diagnostic command; users do not need to create a file or edit JSON for that path. The exact executable and argument array appears in the reviewed plan. The worker remains network-isolated and does not install dependencies, so tests requiring packages must already be runnable from the selected snapshot/worker environment. This automatic command has no criterion mappings and cannot establish Acceptance Criteria coverage. Exact JUnit mappings remain explicit because guessing which test proves an ADO criterion could produce a false PASS.

Advanced users may save a validated JSON config in encrypted local app settings, keyed to the selected repository identity; its hash is frozen in each Run Manifest. It is passed directly to the coordinator and is not written into the source tree or worker snapshot. The user may separately create a repository file. Config and repository scripts are untrusted input. The app never silently commits or modifies source files.

## Schema v1

```yaml
schemaVersion: 1
project:
  name: customer-portal
repository:
  include:
    - src/**
    - tests/**
    - package.json
    - package-lock.json
  exclude:
    - '**/.env*'
    - '**/node_modules/**'
    - '**/dist/**'
setup:
  - id: dependencies
    label: Install locked dependencies
    executable: npm
    arguments: [ci, '--ignore-scripts']
    workingDirectory: .
    timeoutSeconds: 600
    network: approved-registries
tests:
  - id: unit
    label: Unit tests
    executable: npm
    arguments: [run, qa:unit]
    workingDirectory: .
    timeoutSeconds: 600
    resultFormat: junit
    resultPaths: [artifacts/unit-junit.xml]
    scenarioMappings:
      - scenarioId: wi-4821-1-abcdef1234-repo
        testCaseIds: [Search results.title appears]
    network: none
site:
  baseUrl: https://staging.example.test
  allowedOrigins:
    - https://staging.example.test
  authRedirectOrigins: []
  accountSecretRef: qa-staging-user
limits:
  browserActions: 100
  runSeconds: 1800
  artifactMiB: 500
```

## Validation and execution semantics

- Reject unknown top-level keys, duplicate test IDs, empty executable, scalar shell commands, absolute/out-of-root paths, symlink escapes, environment-variable expansion in command fields, and unsupported result formats. `workingDirectory` and `resultPaths` resolve inside the disposable snapshot only.
- `setup` and `tests` use executable-plus-arguments arrays passed directly to the Docker CLI, with host shell invocation disabled. The v1 worker image currently allows `node`, `npm` and `npx`; the image and allowlist must be extended before other runtimes are enabled. The UI shows each exact command when reviewing the project config. The sample assumes `qa:unit` is a project script that emits the listed JUnit file.
- `include` defines files copied from the selected source snapshot. The app also enforces its own exclusion list for credentials, `.git` internals, OS files and private key patterns even if the config tries to include them. Missing files are reported; they are not silently ignored if required by a test.
- `network` is `none` by default. This v1 worker blocks `approved-registries` because it has no allowlisted egress proxy. Config cannot grant arbitrary outbound access. Setup runs before tests in the same disposable workspace. Dependency lifecycle scripts remain disabled by default; projects requiring them need a reviewed exception or a prebuilt worker image.
- `resultFormat` is `junit` or `none` in v1. A JUnit command maps exact contract `Scenario.id` values to exact `classname.name` testcase identities with `scenarioMappings`. Each mapping must match every listed test identity; extra unrelated testcases cannot verify that Scenario. Empty/missing JUnit output or a missing mapped identity is an error observation. A zero process exit without parsed and explicitly mapped assertions does not verify a criterion. Commands with `resultFormat: none` may provide diagnostic observations but cannot verify a criterion.
- Without a repository config, root `package.json` `scripts.test` is discovered as the bounded `npm test` diagnostic command. Users can optionally replace it with a custom config and exact JUnit mappings in the Advanced section. Save and refresh the plan after editing; only refreshed commands and mappings can be approved.
- `site` is optional for repository-only runs. A site-only run may use GUI settings without this file. `baseUrl` and origins are validated before browser launch. `accountSecretRef` names a local secret and never contains its value.
- Global limits set in the app are ceilings. A repository config can request lower limits, never raise them. The effective limits and config hash are frozen into the run manifest.

## Current v1 worker boundary

The coordinator copies selected regular files into a fresh private temporary snapshot before commands run. It rejects links and hard-linked files, blocks selecting the home directory or filesystem root, and excludes Git internals, dependency folders, environment files, common credential files and private-key patterns regardless of configured globs. The worker mounts only that snapshot into a non-privileged Docker container with networking disabled, read-only root, dropped capabilities, no-new-privileges, process/memory/CPU ceilings and a private tmpfs. It does not mount the Docker socket or host home. Container isolation remains gated on the M0 malicious-fixture tests on both Windows and macOS; do not treat these controls as a passed threat-model gate until exercised on those hosts.

## Future compatibility

Schema versions are explicit. Unknown versions are rejected with a migration message. Config migrations are previewed and save a new file only on user action. Additional adapters for xUnit, pytest, Vitest or API contract results can be added as result parsers without changing verdict semantics.

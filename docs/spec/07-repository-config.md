# Repository configuration contract

**Status:** proposed schema v1 for repository checks. M0 may revise this version if the cross-platform worker probe requires it; revisions must be recorded before M3 implementation.

## Location and ownership

The app looks for `.agentic-qa.yml` at the selected repository root. The user reviews it in the desktop UI before each first run and whenever its content hash changes. The config is repository data, not trusted application policy. A GUI-only config may be stored locally and is linked to the repository snapshot hash. The app never silently commits or modifies this file.

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
- `setup` and `tests` use executable-plus-arguments arrays passed directly to the process API, with `shell: false`. The executable must match an explicit allowlist in the app's worker policy or be approved as a project-specific exception. The UI shows the exact resolved executable and arguments before execution. The sample assumes `qa:unit` is a project script that emits the listed JUnit file.
- `include` defines files copied from the selected source snapshot. The app also enforces its own exclusion list for credentials, `.git` internals, OS files and private key patterns even if the config tries to include them. Missing files are reported; they are not silently ignored if required by a test.
- `network` is `none` by default. `approved-registries` requires a separately approved registry-origin list and a network boundary enforced by the worker runtime; if unavailable, the command is blocked. Config cannot grant arbitrary outbound access. Setup runs before tests in the same disposable workspace. Dependency lifecycle scripts remain disabled by default; projects requiring them need a reviewed exception or a prebuilt worker image.
- `resultFormat` is `junit` or `none` in v1. JUnit testcase identity and assertion failures are parsed into observations. A zero process exit without test cases/criterion mapping does not verify a criterion.
- `site` is optional for repository-only runs. A site-only run may use GUI settings without this file. `baseUrl` and origins are validated before browser launch. `accountSecretRef` names a local secret and never contains its value.
- Global limits set in the app are ceilings. A repository config can request lower limits, never raise them. The effective limits and config hash are frozen into the run manifest.

## Future compatibility

Schema versions are explicit. Unknown versions are rejected with a migration message. Config migrations are previewed and save a new file only on user action. Additional adapters for xUnit, pytest, Vitest or API contract results can be added as result parsers without changing verdict semantics.

# Agentic QA domain language

This glossary defines the product's core terms. Use these names consistently in UI, reports, interfaces and future implementation discussions.

## Work selection

**Requirement**: An Azure DevOps work item whose promised user-visible behavior is being checked; it can be a User Story, Product Backlog Item, Issue, Requirement or mapped custom type. _Avoid_: Story as the generic term.

**Task**: A child work item describing implementation work that may inform QA scope but does not by itself prove a requirement. _Avoid_: Acceptance criterion.

**QA Queue**: The local set of selected requirements or standalone tasks waiting to be configured and run. _Avoid_: Test suite.

**Target**: A repository snapshot, development/staging site, or both, against which a QA run executes. _Avoid_: Environment when referring only to the site.

## Planning and evidence

**Acceptance Criterion**: A distinct expected behavior derived from a source requirement or explicitly added by a user. It retains its source and version.

**QA Contract**: The reviewed set of criteria, scenarios and evidence expectations for one selected requirement/task scope. _Avoid_: Prompt, test list.

**Scenario**: One planned verification path with setup, action, expected observation and target layer. _Avoid_: Test case when no executable test exists.

**Observation**: A recorded execution result with provenance, such as an assertion, test process result or browser event. _Avoid_: Evidence when it lacks a link to an artifact or assertion.

**Evidence**: An immutable reference to a recorded artifact or assertion result supporting an observation, including its source identity and capture time.

**Coverage**: The explicit mapping from each acceptance criterion to required scenarios and supporting or missing evidence. _Avoid_: A single percentage as a substitute for this mapping.

## Outcomes

**Finding**: A reviewed discrepancy or uncertainty with reproduction steps and evidence. It may be a product, test or environment problem.

**Verdict**: The run-level decision computed from criterion outcomes and unresolved findings: `PASS`, `FAIL`, `NEEDS_REVIEW` or `BLOCKED`. _Avoid_: AI score.

**Run Manifest**: The frozen identity of selected work items, targets, contract, versions and limits for one QA execution. _Avoid_: Mutable run settings.

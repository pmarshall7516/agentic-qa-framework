# Agentic QA: product plan

**Status:** proposed planning baseline, 2026-09-27.

## Purpose

Give teams a repeatable way to check whether selected Azure DevOps (ADO) requirements were implemented and behave as intended. A user connects an ADO account, selects an organization and project, searches requirement work items and child tasks, adds them to a QA queue, attaches a repository, a development or staging site, or both, and runs a bounded QA job. The app produces an evidence-backed report for each selected requirement.

The product cannot prove that **all** possible behavior is correct. Its promise is explicit coverage of each identified acceptance criterion, recorded test observations, and visible gaps or uncertainty. A passing test suite alone is never a passing requirement.

## Initial product shape

- **Local-first desktop app** for Windows and macOS. Account tokens, run history, and evidence stay on the user's machine by default. No hosted account or shared backend is required.
- **Azure DevOps Services only** for the first release. Azure DevOps Server and other trackers are later integrations.
- **Manual run initiation.** The user reviews selected work items, target, test plan, AI disclosure preview, cost and action limits before execution.
- **Read-only ADO integration.** The first release never edits work items, PRs, or builds.
- **Three targets:** repository-only, site-only, or repository plus site. The report identifies which layers were actually exercised.
- **Evidence-first decision:** `PASS`, `FAIL`, `NEEDS_REVIEW`, or `BLOCKED`, with an explicit reason and source snapshot.

## Delivery sequence

1. **Foundation:** desktop shell; signed-in ADO organization/project selection; requirement/task search and queue; local persistence; exportable run manifest.
2. **Useful QA slice:** source snapshots; criterion extraction and human-editable test contract; existing-test execution in an isolated worker; site smoke and criterion-driven Playwright checks; evidence and report.
3. **Depth:** code impact analysis, generated tests in a disposable copy, bounded exploratory browser QA, accessibility scans, rerun and comparison, robust failure triage.
4. **Team automation:** optional sharing/sync, ADO writeback, CI triggers and hosted workers after local results and security controls are proven.

The first useful release includes phases 1 and 2. Phase 3 is a quality expansion; phase 4 is a distinct hosted product decision.

## Reading order

1. [Requirements](spec/01-product-requirements.md)
2. [Architecture and technology decisions](00-agentic-qa-system-architecture.md)
3. [ADO integration](spec/02-azure-devops-integration.md)
4. [QA engine and result model](spec/03-qa-engine.md)
5. [Security and privacy](spec/04-security-privacy.md)
6. [User experience](spec/05-desktop-experience.md)
7. [Delivery plan and acceptance gates](spec/06-delivery-plan.md)
8. [Repository configuration](spec/07-repository-config.md)

## Pilot decisions

The first release is local-first and allows a configured AI provider after a disclosure preview. Organization-specific field mapping, supported repository languages, and distribution channel are pilot decisions with explicit discovery gates in the delivery plan.

# Agentic QA: product plan

**Status:** proposed planning baseline, 2026-09-27.

## Purpose

Give teams a repeatable way to check whether selected Azure DevOps (ADO) requirements were implemented and behave as intended. A user connects an ADO account, selects an organization and project, searches requirement work items and child tasks, adds them to a QA queue, attaches a repository, a development or staging site, or both, and runs a bounded QA job. The app produces an evidence-backed report for each selected requirement.

The product cannot prove that **all** possible behavior is correct. Its promise is explicit coverage of each identified acceptance criterion, recorded test observations, and visible gaps or uncertainty. A passing test suite alone is never a passing requirement.

## Initial product shape

- **Local-first desktop app** for Windows and macOS. Account tokens, run history, and evidence stay on the user's machine by default. No hosted account or shared backend is required.
- **Azure DevOps Services only** for the first release. Azure DevOps Server and other trackers are later integrations.
- **Manual run initiation, mandatory agentic execution.** Every QA run requires a configured provider/model. The user approves selected work items, repository/site context, tools, command set, cost and action limits once; the Orchestrator and selected specialist agents then plan and perform QA inside that approved envelope.
- **Read-only ADO integration.** The first release never edits work items, PRs, or builds.
- **Three targets:** repository-only, site-only, or repository plus site. The report identifies which layers were actually exercised.
- **Evidence-first decision:** `PASS`, `FAIL`, `NEEDS_REVIEW`, or `BLOCKED`, with an explicit reason and source snapshot.

## Delivery sequence

1. **Foundation:** desktop shell; signed-in ADO organization/project selection; requirement/task search and queue; local persistence; exportable run manifest; M0 identity, storage and worker gates.
2. **Agentic QA slice:** required provider/model configuration and discovery; source snapshots and context envelope; Orchestrator Agent that maps Requirements, Tasks and acceptance criteria to backend/repository and/or frontend/browser specialists; generated and executed tests in constrained workers; delegation diagram; evidence and report.
3. **Depth:** bounded exploratory browser QA, accessibility scans, rerun and comparison, additional repository/test adapters, robust failure triage and measured cost optimization.
4. **Team automation:** optional sharing/sync, ADO writeback, CI triggers and hosted workers after local agentic results and security controls are proven.

The first useful release includes phases 1 and 2. An AI provider is mandatory for every QA run; a deterministic local plan is not a supported fallback. The application still owns fixed worker capabilities, data collection, evidence validation and verdict policy. Phase 3 is a quality expansion; phase 4 is a distinct hosted product decision.

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

The first release is local-first and requires a configured, supported AI provider after a run-level disclosure/permission envelope is approved. Provider adapters, searchable capability-filtered model selection and bounded per-run cost/work budgets are part of the first useful release. Organization-specific field mapping, supported repository languages, and distribution channel are pilot decisions with explicit discovery gates in the delivery plan.

# ADR-0004: Mandatory agentic orchestration and provider adapters

**Status:** Accepted · **Date:** 2026-09-29  
**Supersedes:** [ADR-0002](ADR-0002-optional-openai-scenario-suggestions.md)

## Context

The product direction requires an AI agent in every QA run. An Orchestrator reads selected Azure DevOps Requirements/Stories, Tasks and acceptance criteria alongside the approved repository/site context; it creates a testing/delegation plan, selects backend/repository and/or frontend/browser specialists, generates and runs tests inside existing constrained workers, reviews evidence, and produces an evidence-linked summary. A local deterministic planning fallback does not satisfy this product requirement.

Existing requirements still require local-first operation, read-only ADO access, constrained workers, source provenance, direct evidence per criterion and an auditable verdict. Agent autonomy must not expand tools, commands, origins, secrets, budgets or verdict authority.

## Decision

- Every user configures a supported provider and model. A run cannot start without a working provider/model and an available user-set budget.
- Implement provider-specific adapters behind a versioned interface for model discovery, capability metadata and structured responses. The current supported choices are direct OpenAI and Anthropic API keys plus OpenRouter, which provides a searchable catalog across multiple upstream providers. Add other adapters only with explicit protocol, credential and destination validation. A key alone does not identify an arbitrary API protocol.
- Settings provides a searchable provider model picker filtered to models known to support required structured output and tool-use behavior; optional role-specific model overrides fall back to the configured default.
- Claude plan/subscription usage is separate from Anthropic API key access. Support plan-based connection only through an officially supported third-party integration; do not reuse browser cookies or a CLI credential cache.
- The user reviews and approves a run-level envelope listing provider/models, ADO source fields/revisions, repository paths, target origin, tools/command IDs, limits, and conservative cost estimate. Agents act autonomously within it. An attempted scope expansion pauses the run.
- A provider-neutral Orchestrator delegates through a typed app-owned tool catalog. A capability broker validates every call. Repository agents may inspect approved snapshots and generate tests only in disposable copies; they can invoke reviewed command IDs but cannot invent shell commands. Browser agents stay within approved origin/action limits.
- A shared run budget limits tokens, provider calls, agent count/fan-out, concurrency, retries, wall time, repository commands, browser actions and artifacts. The coordinator reserves estimated maximum request cost before dispatch and blocks if model pricing is unknown or the reservation exceeds the available budget. Provider-reported usage and estimate are recorded; provider billing is authoritative.
- Agent plans/results are structured, size-limited and validated against source provenance. A diagram is rendered from validated assignments. The reviewer summarizes evidence but cannot invent observations or determine verdict status.
- The Reviewer receives only the bounded context approved for the run, generated test files, computed criterion states and direct observations. It must cite known observation IDs and exact supplied source/test paths and lines; reviewer failure blocks completion, while reviewer prose cannot change findings or verdict policy.
- The Reviewer receives only the bounded context approved for the run, generated test files, computed criterion states and direct observations. It must cite known observation IDs and exact supplied source/test paths and lines; reviewer failure blocks completion, while reviewer prose cannot change findings or verdict policy.
- Existing report policy remains the authority for `PASS`, `FAIL`, `NEEDS_REVIEW` and `BLOCKED`; every acceptance criterion needs direct evidence and Task status cannot prove parent criteria.
- Provider credentials stay in protected main-process storage. The run envelope identifies context sent to the configured provider; users can exclude data before approval. No provider calls happen before approval.
- Provider credentials are imported from a one-line key file through the native file picker and stored in encrypted local settings; keys never enter renderer state. Claude.ai Pro/Max subscription access is not an Anthropic API credential and cannot be selected as a provider connection.

## Consequences

- AI is no longer an optional browser-scenario helper; it is a required orchestration capability. Existing M2 local-draft behavior is not an acceptable fallback for QA runs.
- Repository code and selected Task/Requirement text can be sent to the selected provider, so the user must inspect the context envelope, destination, budgets and provider terms before approval.
- Provider model lists and capabilities vary. Unknown model capability or pricing blocks use until the selected adapter can validate it.
- Cost controls are conservative estimates and per-call ceilings; external provider account billing and retention terms remain authoritative.
- M0 identity, packaging, worker isolation and release security gates still apply. This ADR does not claim those gates are complete.

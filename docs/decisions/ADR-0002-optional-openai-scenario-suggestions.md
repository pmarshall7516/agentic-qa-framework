# ADR-0002: Optional, approval-gated OpenAI scenario suggestions

**Status:** Superseded by [ADR-0004](ADR-0004-mandatory-agentic-provider-adapters.md) · **Date:** 2026-09-27

## Context

M2/FR-08 requires a provider disclosure preview and enforced model budget. The app already creates a deterministic local draft; provider use must remain optional and must never be required to run QA. The renderer is untrusted and must not receive credentials. Model output must not create acceptance criteria, commands, origins, permissions, execution authority or verdicts.

## Decision

- Add the OpenAI Responses API as the first optional provider. Keep a local deterministic plan when no API key is configured.
- Import a one-line API key from a user-selected text file through a native dialog. The main process stores it in SQLCipher-backed local settings; the key is never returned over IPC, placed in renderer state, prompts, reports, logs or worker environments. The user should delete the source file after import.
- Before a request, show the exact model request body and require a separate explicit send action. The user can exclude browser criteria from the payload. Known credential patterns are redacted from ADO criteria before preview; secret-like model output is rejected. The preview is one-use, expires after ten minutes, and is invalidated by provider-setting changes or a replacement preview.
- Send only browser-layer acceptance-criterion text. Do not send work-item descriptions/tasks, repository files, credentials, run artifacts or ADO tokens. Use the fixed HTTPS endpoint, `store: false`, a 12,000-token conservative input ceiling and a user-configurable output ceiling (256–4,096 tokens). Record provider-reported token usage in the run manifest; reject suggestions if returned usage exceeds limits.
- Accept only bounded JSON scenario suggestions for existing browser criteria. Reject unknown/duplicate criterion IDs, unsupported steps, model-suggested nonempty form values and malformed output. Suggestions are unapproved until the user reviews and approves the contract. The model cannot run tools, change source criteria, commands, origins, evidence policy or verdict.

## Consequences and limitations

- Provider calls can incur cost. The app enforces token ceilings and reports token use, but does not guarantee a dollar-cost ceiling because prices vary by account and model. The preview names the model and request budget; users remain responsible for provider billing settings.
- OpenAI account, data-handling and retention terms apply to data the user explicitly approves for transmission. No network request occurs during local drafting, preview generation or app startup.
- Only OpenAI is supported in v1. Adding another provider requires its own endpoint, credential and disclosure review.
- The official API documents the Responses endpoint and notes that `output_text` is an SDK convenience; the adapter parses raw response output items. See [Responses API reference](https://platform.openai.com/docs/api-reference/responses) and [API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint).

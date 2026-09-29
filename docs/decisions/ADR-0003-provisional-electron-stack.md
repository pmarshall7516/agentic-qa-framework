# ADR-0003: Proceed with Electron as the provisional v1 desktop shell

**Status:** Provisional for first-release implementation · **Date:** 2026-09-27

## Context

The v1 product needs a desktop UI, Entra public-client authentication, encrypted SQLite, ADO integration, Playwright, and a constrained repository worker on Windows and macOS. These components already use Node/TypeScript; a Tauri shell would still need to bundle Node and Playwright and add a Rust/JavaScript bridge. The delivery plan required comparative package and runtime evidence before selecting a stack, but product implementation proceeded on the documented Electron preference while live M0 checks remain outstanding.

## Decision

Continue the v1 implementation with Electron, React, and TypeScript. This is a provisional engineering decision based on shared runtime and packaging simplicity, not a claim that Electron passed the full comparison. Reconsider it if the Tauri packaging probe materially improves clean-install size, idle/runtime memory, browser installation, crash cleanup, or Windows distribution without weakening the security boundaries.

## Evidence and remaining gate

Electron 44.4.5 produced an unsigned macOS arm64 app and DMG that launched locally, and unsigned Windows x64 NSIS and portable `.exe` packages. The Windows packages were cross-built only. Installer size is approximately 123 MiB. No Tauri probe, Windows launch, clean-host install, antivirus-friction, or comparative memory/crash measurement has been completed. M0 remains open until those results are recorded.

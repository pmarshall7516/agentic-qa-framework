# ADR-0001: Persist the MSAL cache through the Electron OS-protection adapter

**Status:** Accepted for v1 local testing · **Date:** 2026-09-27

## Context

The first desktop package must build an unsigned Windows installer from the available macOS host while preserving OS-protected MSAL cache encryption. `@azure/msal-node-extensions` selects Windows DPAPI persistence, but its module graph statically imports macOS Keychain and Linux Secret Service persistence modules, which load `keytar`. The installed `keytar` binary is a macOS arm64 native module. Disabling cross-target native rebuilds therefore produces a Windows package that contains an incompatible native dependency; enabling rebuilds cannot cross-compile it from macOS.

MSAL Node exposes the maintained `ICachePlugin` interface for loading cache data before use and persisting it after changes. Electron `safeStorage` protects data with the current OS account's credential store (Keychain on macOS and DPAPI on Windows).

## Decision

Keep MSAL Node and implement its `ICachePlugin` interface over a main-process file adapter. Encrypt the serialized cache with Electron `safeStorage`; refuse sign-in when OS encryption is unavailable; use a separate cache file per client ID; and write encrypted data atomically with private file permissions. Do not load `@azure/msal-node-extensions` or `keytar` in the desktop runtime.

This preserves delegated public-client auth and OS-backed cache protection while allowing the same application sources to select platform-prebuilt SQLCipher binaries during cross-packaging.

## Consequences and validation

- The cache adapter becomes application-owned code and must be tested for corruption, concurrent access, sign-out deletion and plaintext absence.
- OS account protection does not isolate one process from other malware running as the same signed-in user.
- M0 still requires real sign-in and cache restart/revocation checks on macOS and Windows; successful cross-packaging alone does not prove those gates.
- Microsoft documents the `ICachePlugin` load/serialize lifecycle in [MSAL Node token caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching). Electron documents the OS-backed protection contract in [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

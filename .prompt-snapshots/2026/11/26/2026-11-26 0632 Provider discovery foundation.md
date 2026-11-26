---
description: Add an experimental external provider compatibility check.
timestamp: 2026-11-26T06:32:49-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/js/ExternalProviderDiscovery.js,unitTest/ExternalProviderDiscovery.test.cjs}"
---

# Provider discovery foundation

## User prompt

> finish PR 1, don't stop until it's done or you need my input

## Summary

- Added an experimental discovery helper that checks API version, required capabilities, instance identity, secure transport, and backend failures.
- It is not connected to the extension UI or a storage adapter. A live-companion integration test confirms the staging-only server is rejected as incompatible.
- The focused extension suite passed 129 tests; targeted lint passed with the existing test quote convention allowed.

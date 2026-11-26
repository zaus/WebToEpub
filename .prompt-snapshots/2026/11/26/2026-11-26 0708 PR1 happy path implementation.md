---
description: Add the external EPUB browser adapter and enablement diagnostic.
timestamp: 2026-11-26T07:08:43-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/**,unitTest/**}"
---

# PR 1 happy-path implementation

## User prompt

> confirmed. push and continue, update tasks and other planning artifacts to defer "unnecessary" features to appropriate followup sections or later PRs, and finish PR 1.

## Summary

- Added `ExternalEpubStorage` for authenticated loopback load, save and delete operations.
- Added companion enablement to the staging diagnostic page and loaded the external adapter after restart when explicitly enabled.
- Added provider and external-adapter unit tests.
- The focused extension suite passed and targeted lint passed. Real-browser external save/load/merge validation remains a manual sign-off step.

---
description: Implement lock controls and bulk-update exclusion.
timestamp: 2026-11-26T07:47:11-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/**,unitTest/BrowserEpubStorage.test.cjs}"
---

# PR 7 lock workflow

## User prompt

> Keep going with the remaining PRs

## Summary

- Added lock/unlock button state and persisted `LibLocked<ID>`.
- Update-all skips locked books and manual update remains available.
- Added browser-storage tests for toggle state and bulk exclusion.

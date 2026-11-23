---
description: Coordinate manual and acquired merges of the same book.
timestamp: 2026-11-23T09:24:04-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/Library.js, unitTest/BrowserEpubStorage.test.cjs"
---

## User prompt

continue

## Summary

- Queued manual and acquisition merges by existing book ID in the same extension context, retaining the existing source-URL acquisition queue.
- Verified both merge orderings, retry after failure and independent books; the mocked storage suite passed 72 tests.
- Other mutation paths and cross-context concurrency remain unprotected; real-browser validation is pending.

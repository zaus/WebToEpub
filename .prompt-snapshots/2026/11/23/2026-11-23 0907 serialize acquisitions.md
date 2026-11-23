---
description: Serialize same-URL acquisition and document remaining concurrency limits.
timestamp: 2026-11-23T09:07:17-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/Library.js, unitTest/BrowserEpubStorage.test.cjs"
---

## User prompt

continue

## Summary

- Queued overlapping acquisitions by exact source URL within one extension context, including download marker updates; used the submitted URL when creating a book.
- Added tests for duplicate prevention, retry after failure, independent URLs and pending downloads. The focused storage suite passed 66 tests.
- Cross-context operations and manual merges remain uncoordinated. External storage and real-browser validation remain future work.

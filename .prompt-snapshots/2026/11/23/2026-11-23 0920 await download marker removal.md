---
description: Await and report library download marker removal.
timestamp: 2026-11-23T09:20:31-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/Library.js, unitTest/BrowserEpubStorage.test.cjs"
---

## User prompt

continue

## Summary

- Wait for browser storage to clear a library download's chapter marker before clearing the displayed count; report failure after a successful download request.
- Focused storage suite passed 68 tests, including delayed and failed removal. A resolved download request does not prove file completion.
- Concurrent updates and deletion still require coordination and recovery design.

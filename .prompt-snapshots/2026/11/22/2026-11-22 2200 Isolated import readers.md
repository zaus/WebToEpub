---
description: Isolate legacy import readers and await each import.
timestamp: 2026-11-22T22:00:11-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Isolated import readers

## User prompt

> continue the same for the next steps.

## Summary

- Removed the shared import FileReader and used a separate reader for each legacy import.
- Awaited legacy import completion and propagated read errors and aborts through the existing UI handler.
- Verified 39 focused tests, including concurrent readers and read failures.

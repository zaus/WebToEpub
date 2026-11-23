---
description: Surface library export failures and prevent incomplete downloads.
timestamp: 2026-11-22T22:01:36-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Library export failures

## User prompt

> continue the same for the next steps.

## Summary

- Made export read the selected EPUB adapter explicitly and reject missing EPUBs.
- Awaited ZIP entry writes and routed export errors to the existing UI error handler.
- Verified 42 focused tests using mocked browser and ZIP APIs; real archive and browser testing remain pending.

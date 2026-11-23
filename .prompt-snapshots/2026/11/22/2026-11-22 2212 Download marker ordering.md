---
description: Update merged-download chapter markers only after the download request resolves.
timestamp: 2026-11-22T22:12:01-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Download marker ordering

## User prompt

> continue.

## Summary

- Delayed the merged-download chapter marker until the download request resolves and surfaced marker storage errors.
- Verified 57 focused tests, including rejected download requests.
- Firefox download handling currently swallows errors and Android may return early; request resolution is not proof of file completion.

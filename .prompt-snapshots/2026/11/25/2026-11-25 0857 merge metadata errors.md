---
description: Propagate metadata storage failures in merges and library downloads.
timestamp: 2026-11-25T08:57:10-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs"
---

## User prompt

continue as far as you can without my interaction

## Summary

- Read merge URL and filename metadata with the existing error-aware storage helper before saving; read download filenames with the same error handling before starting downloads or clearing chapter markers.
- Added success and failure regression tests; 91 extension tests and targeted implementation lint passed.
- This does not resolve cross-context coordination or external-storage recovery.

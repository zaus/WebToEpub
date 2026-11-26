---
description: Implement and test source/local chapter preview.
timestamp: 2026-11-26T07:41:18-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# PR 5 update preview

## User prompt

> Keep going with the remaining PRs

## Summary

- Added `Library.LibPreviewChapterDelta` for unchanged, appended, removed and reordered chapter lists.
- Preview tests passed and invalid chapter lists are rejected.
- The helper is read-only and does not write EPUB or browser storage.

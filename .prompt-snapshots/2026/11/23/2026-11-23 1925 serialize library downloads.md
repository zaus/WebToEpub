---
description: Serialize library downloads with same-book merges within one extension context.
timestamp: 2026-11-23T19:25:52-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs"
---

## User prompt

continue until the next reasonable milestone requiring my attention

## Summary

- Queued standalone library downloads with existing same-book manual and acquisition merges, from EPUB read through chapter-marker removal.
- Added mocked tests for both orderings, failed downloads, and independent books; the extension storage and staging tests passed 82/82.
- Coordination remains limited to one extension context; other mutation paths and browser validation remain open.

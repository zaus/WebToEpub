---
description: Stop library export when index or metadata storage reads fail.
timestamp: 2026-11-25T08:59:38-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs"
---

## User prompt

continue as far as you can without my interaction

## Summary

- Library export now reads its index and metadata through error-aware helpers before assembling the archive and does not rewrite a missing legacy index.
- Added failure and legacy-library regression tests; focused storage tests passed 84/84 and targeted implementation lint passed.
- This is not a cross-context snapshot or external-backend implementation.

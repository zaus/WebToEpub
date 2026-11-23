---
description: Cover existing upload and chapter-count behavior after the update refactor.
timestamp: 2026-11-22T21:50:10-05:00
model: GitHub Copilot (model not provided)
applyTo: "unitTest/BrowserEpubStorage.test.cjs"
---

# Upload compatibility tests

## User prompt

> commit and continue.  proceed with each reasonable step, then commit and continue to the next one.

## Summary

- Committed the awaited browser update implementation.
- Added regression tests for Firefox upload MIME normalization, source chapter recording, and the chapter-count sentinel.
- All 28 focused tests passed; the tests use mocked browser APIs rather than a real extension workflow.

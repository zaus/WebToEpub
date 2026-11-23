---
description: Require an existing stored EPUB for merge and chapter lookup.
timestamp: 2026-11-22T22:03:04-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Required EPUB reads

## User prompt

> continue the same for the next steps.

## Summary

- Added a required EPUB read through the selected adapter for acquisition merge, manual merge, and chapter lookup.
- Missing books and adapter failures surface before ZIP processing; unknown story URLs retain their previous null result.
- Verified 45 focused tests. Real-browser workflows remain unverified.

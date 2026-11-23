---
description: Prevent writes when prerequisite browser metadata reads fail.
timestamp: 2026-11-22T22:09:55-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Write metadata reads

## User prompt

> continue.

## Summary

- Added checked browser metadata reads to acquisition, update, and import write prerequisites.
- Legacy ID discovery reads existing EPUB keys without writing an ID list before the book write.
- Verified 54 focused tests. Cross-context serialization and other metadata read paths remain open.

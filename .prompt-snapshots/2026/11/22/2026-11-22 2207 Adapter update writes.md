---
description: Route library update and import writes through the selected EPUB adapter.
timestamp: 2026-11-22T22:07:51-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/BrowserEpubStorage.js,plugin/js/Library.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Adapter update writes

## User prompt

> continue.

## Summary

- Routed update and import writes to the selected adapter with associated browser metadata.
- Kept the default browser adapter's EPUB and metadata in one storage call and propagated errors.
- Verified 48 focused tests. The in-process method is not an external backend protocol; split-store failure handling remains to be designed.

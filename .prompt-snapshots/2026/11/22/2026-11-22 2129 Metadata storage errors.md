---
description: Record metadata adapter failure handling and focused tests.
timestamp: 2026-11-22 2129
model: GitHub Copilot
applyTo: "plugin/js/**,unitTest/**"
---

# Metadata storage errors

## User prompt

> push and continue

## Changes and verification

- Pushed the feature branch including the existing cover-adapter implementation.
- Routed metadata reads explicitly through the EPUB adapter and propagated missing-EPUB and backend errors to the metadata-edit UI, while retaining the existing unsupported-EPUB fallback.
- The focused Node test suite passed 15 tests. This is not a completed external storage plugin; writes, other paths, and browser validation remain outstanding.

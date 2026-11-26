---
description: Prevent ZIP imports with malformed headers from silently restoring a reading list.
timestamp: 2026-11-26T06:00:22-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/js/Library.js,unitTest/LibraryArchive.test.cjs}"
---

# ZIP import validation

## User prompt

> keep going

## Summary

- Reject missing or unsupported ZIP archive versions and missing, malformed, negative, fractional, or unsafe book counts before modifying the library or reading list.
- Added real ZIP regression tests for invalid headers, preserving populated and empty version-2 round trips.
- The focused extension suite passed 114 tests and targeted lint passed. This does not preflight every book or prevent partial completion on later failures.

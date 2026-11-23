---
description: Propagate Firefox download errors after cleaning up object URLs.
timestamp: 2026-11-22T22:14:09-05:00
model: GitHub Copilot (model not provided)
applyTo: "{plugin/js/Download.js,unitTest/BrowserEpubStorage.test.cjs}"
---

# Firefox download errors

## User prompt

> continue.

## Summary

- Rejected Firefox download or platform errors after cleanup rather than treating them as successful requests.
- Verified 62 focused tests, including desktop cleanup and synchronous Android link dispatch and failure.
- Browser file completion and cancellation behavior remains unverified.

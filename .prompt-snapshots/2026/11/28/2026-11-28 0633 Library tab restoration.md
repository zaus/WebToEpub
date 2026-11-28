---
description: Fix in-page Library tab to show the real library section.
timestamp: 2026-11-28T06:33:41-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/**,unitTest/**}"
---

# Library tab restoration

## User prompt

> it seems like you removed the library view entirely -- switching views...

## Summary

- Closed `inputSection` before the library markup so the Library tab can display `hiddenBibSection`.
- Updated `switchMainView` to hide acquisition, parser, image and output sections in Library mode.
- Preserved the existing library table/shelf, editable metadata, batch and update-all workflows.
- Bumped manifest to 1.0.14.79 and passed focused tab/library tests.

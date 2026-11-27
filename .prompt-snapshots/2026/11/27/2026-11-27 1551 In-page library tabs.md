---
description: Implement popup tabs and restore library selection metadata workflows.
timestamp: 2026-11-27T15:51:20-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/**,unitTest/**}"
---

# In-page library tabs

## User prompt

> instead of opening a dedicated extension tab, would having an in-page tabbed view ... implement. ... v1.0.14.76 removed: read-only metadata popup, batch operations, multiple selection.

## Summary

- Added popup Acquisition/Library tabs and source-based startup detection.
- Removed dedicated library page files and no longer opens a separate extension tab.
- Restored the full editable metadata form.
- Added shelf and table selection checkboxes plus selected update/download/delete actions, preserving existing batch controls.
- Bumped manifest to 1.0.14.78.
- Focused tests and lint passed.

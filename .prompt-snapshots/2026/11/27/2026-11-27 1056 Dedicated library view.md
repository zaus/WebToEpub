---
description: Implement dedicated library tab and theme contrast fixes.
timestamp: 2026-11-27T10:56:00-05:00
model: GitHub Copilot (model not disclosed)
applyTo: "{plugin/**,unitTest/**}"
---

# Dedicated library view

## User prompt

> bump the extension version, then work on the dedicated library view. where are changes? ... also fix light/darkmode and contrast

## Summary

- Bumped `plugin/manifest.json` to 1.0.14.76.
- Added dedicated `library.html`, `css/library.css`, and `js/LibraryPage.js`.
- Library button now opens the dedicated tab rather than expanding the popup.
- Added theme inheritance, light/dark variables, responsive cards, sorting, drag/drop and quick actions.
- Added and ran dedicated library packaging tests; targeted lint passed.

---
description: Enable full-title filenames when no preference has been saved.
timestamp: 2026-11-23T19:29:34-05:00
model: GitHub Copilot via Copilot SDK in VS Code (model unavailable)
applyTo: "plugin/js/UserPreferences.js,unitTest/UserPreferences.test.cjs"
---

## User prompt

continue until the next reasonable milestone requiring my attention

## Summary

- Enabled the existing full-title filename option by default when its setting is absent, preserving saved true and false values.
- Added preference and checkbox persistence tests, verified the existing full and shortened filename generation, and ran 86 extension regression tests successfully.
- Titles still undergo existing sanitization and the full-title option retains its existing 512-character limit.

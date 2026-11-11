---
description: Continue EPUB storage adapter integration for library downloads.
timestamp: 2026-11-10 1934
model: GitHub Copilot, GPT-6.1-Terra
applyTo: "plugin/js/**,unitTest/**"
---

# Adapter downloads

## User prompt

> before you continue, I'd also like to queue up improvements to the library interface:
> - open in a new view (not smushed in the middle of the acquire panel)
> - responsive shelf view, with drag-n-drop and auto-sorting
> - click to edit book metadata (in flyover/popup), with hover 'quick icons' for locking, updating, deleting
> - better book description import (at least, for the Royal Road parser) that pulls the entire book blurb rather than truncates
>
> add these to 'todo' list, then commit, push, and continue implementation.

## Changes and verification

- The separate WepubLibrary checklist records the requested future work.
- Routed library downloads through the selected EPUB read adapter and report failures from both download buttons. Chapter-count state is cleared only after download succeeds.
- `node --test unitTest/BrowserEpubStorage.test.cjs` passed seven focused tests; browser workflow validation and the remaining storage integration are outstanding.

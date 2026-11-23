---
description: Record adapter-backed EPUB reads for cover extraction.
timestamp: 2026-11-10 2101
model: GitHub Copilot, GPT-6.1-Terra
applyTo: "plugin/js/**,unitTest/**"
---

# Cover storage adapter

## User prompt

> commit and continue

## Changes and verification

- Committed the previous download adapter slice as `8b00f857`.
- Routed uncached cover extraction through the EPUB adapter, preserving cached covers and the missing-cover placeholder. Storage read and cover-cache write failures are surfaced.
- Added focused tests for adapter routing, cached covers, missing EPUBs, read failures, missing-cover placeholders, and cache-write errors. Full browser workflow validation remains pending.

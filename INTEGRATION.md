# Prediction Feature Integration Notes

This repository uses `INTEGRATION_GUIDE.md` as the primary reference for prediction feature integration.

## What is wired in this repo

- Timeline content ingestion now reads prediction fields from MDX frontmatter and metadata:
  - `forecast`
  - `dependencies`
  - `leadingIndicators`
- The loader normalizes both camelCase and snake_case prediction payloads.
- If an item has no explicit `timeline.startYear` but has a forecast p50 year, that p50 is used as timeline placement fallback.
- Validation warnings are emitted for:
  - Missing dependency target IDs
  - Invalid uncertainty ordering (`p10 <= p50 <= p90`)
  - Scenario probabilities not summing to ~1.0
- Timeline cards surface forecast and dependency counts when present.

## Source of truth

For schema details and full backend integration phases, use `INTEGRATION_GUIDE.md` and `INTEGRATION_SCHEMA.json`.

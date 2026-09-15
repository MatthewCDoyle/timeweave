# The Strategist — Agent Pod Spec v2.0

## 1. Purpose

The Strategist owns **forward-looking content intelligence**: freshness decay,
search-volume gaps, thin-content risk, i18n coverage, SEO health,
accessibility/alt-text tracking, and doc-feedback sentiment. It produces a
**Content Health Matrix** and actionable recommendations that feed the Orchestrator.

> **Note:** Readability (Flesch) is owned by the Editor. Taxonomy coverage is owned by the Librarian.
> SEO health moved here from Gatekeeper/Librarian. Accessibility/alt-text moved here from Gatekeeper.

## 2. Inputs

| Source | Key Fields |
|---|---|
| `build-report.json` | `aggregate.dateAnalytics` (fresh / aging / stale), `aggregate.avgWords`, `aggregate.totalDocs`, `clarity.*` (UX metrics), `docs[]` (per-doc metadata) |
| `search-data.json` | `documents[]` (507 docs, taxonomy facets), `taxonomy` |
| `localStorage:zmv-search-log` | Local search query log: `{ queries: [{ q, ts, resultCount }], missedSearches: [{ q, ts }] }` |
| `docusaurus.config.ts` | `i18n.locales` — configured locales |
| `build-report.json` | `aggregate.seoHealth` (title/desc/keywords/slug coverage) |
| `build-report.json` | `docs[]` body content (alt-text scan, WCAG issues) |
| `build-report.json` | `clarity.{rageClickRate, deadClickRate, jsErrorCount, scrollDepth, rageClickPages}` (real Clarity Data Export API fields) |

## 3. Outputs

### Content Health Matrix

```json
{
  "pod": "STRATEGIST",
  "runId": "<uuid>",
  "snapshotDate": "<ISO>",
  "freshness": {
    "fresh": <n>, "recent": <n>, "aging": <n>, "stale": <n>,
    "freshPercent": <n>, "staleDocs": [{ "file": "...", "lastModified": "..." }]
  },
  "thinContent": {
    "threshold": 150,
    "thinDocs": [{ "file": "...", "wordCount": <n> }],
    "count": <n>
  },
  "searchGaps": {
    "totalQueries": <n>,
    "uniqueQueries": <n>,
    "missedSearches": [{ "query": "...", "count": <n> }],
    "topQueries": [{ "query": "...", "count": <n> }]
  },
  "i18n": {
    "configuredLocales": ["en"],
    "defaultLocale": "en",
    "translationCoverage": { "en": 100 }
  },
  "seoHealth": {
    "seoScorePercent": <n>,
    "hasTitle": <n>, "hasDescription": <n>, "hasKeywords": <n>, "hasSlug": <n>
  },
  "accessibility": {
    "imagesWithoutAlt": { "count": <n>, "files": ["..."] },
    "wcagLevel": "AA",
    "criticalErrors": <n>
  },
  "recommendations": [
    { "id": "STRAT-001", "severity": "P1", "category": "...", "description": "...", "actionMode": "..." }
  ]
}
```

## 4. Guardrails

| Metric | Threshold | Action |
|---|---|---|
| Stale docs (>180 days) | > 5% of corpus | P1 — flag for review |
| Thin docs (<150 words) | > 10% of corpus | P2 — enrich or merge |
| Missed searches | > 20 unique queries/week | P1 — content gap audit |
| SEO score | < 50% | P2 — metadata enrichment |
| Images without alt-text | > 0 | P1 — flag for remediation |
| Site-wide rage-click rate | > 5% | P1 — escalate (broad usability) |
| Site-wide dead-click rate | > 10% | P2 — review affordances |
| JS errors per session | > 5% | P1 — triage via console |
| Sessions reaching 50% scroll | < 50% | P2 — content too long / lead buried |
| Per-page rage clicks | ≥ 5 | P2 — page-level usability investigation |

## 5. Activation (Server-side)

`scripts/strategist-activate.mjs` generates a full strategy report JSON
saved to `static/data/strategy-report.json`. The dashboard reads this file
for historical trend display.

## 6. Dashboard Panel

The StrategistPanel shows:
- Freshness breakdown (fresh / recent / aging / stale) with bar
- Thin-content count and list
- Top search queries and missed searches (from localStorage)
- Taxonomy coverage gauge
- Readability buckets
- i18n locale coverage
- Recommendations table with severity and action modes

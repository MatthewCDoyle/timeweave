# Dev Dashboard Data Contract

This document is the canonical ownership and metric contract for the 5 pods and orchestrator used by the Dev Dashboard.

## Pod Ownership

- Librarian: frontmatter completeness, taxonomy coverage, placeholders, DITA migration, publish status.
- Editor: prose/style violations and readability only.
- Strategist: freshness, thin content, search gaps, SEO/a11y analytics, recommendations.
- Gatekeeper: engineering gates (ENG-01..ENG-14), build stability, CI/platform health, release blockers.
- Orchestrator: cross-pod aggregation, global readiness decision, final release verdict.

## Ownership Guardrails

Validation is enforced by scripts/validate-pod-outputs.mjs:

- Schema validation: each pod output must satisfy schemas/pods/{pod}.schema.json.
- Ownership validation: pods fail validation when they emit forbidden top-level domains outside their charter.

## Required Top-Level Fields

- librarian: pod, runId, snapshotDate
- editor: pod, runId, snapshotDate, violations, readability
- strategist: pod, runId, snapshotDate, recommendations
- gatekeeper: pod, runId, snapshotDate, buildStatus, releaseReady, engTests, buildStability, operationalHealth
- orchestrator: runId, snapshotDate, releaseReady, buildStatus, criticalAlerts, warningAlerts, podResults

## Source Provenance Policy

- Prefer first-party artifacts from build-report.json over synthetic defaults.
- If a metric is inferred from a coarse gate state, include a source field (for example engineering.tests.eng10).
- Use isMock only when no direct artifact exists.

## CI Enforcement

Run these on every pull request:

- npm run validate:pods
- npm run test:agents

A pull request should not merge if either command fails.

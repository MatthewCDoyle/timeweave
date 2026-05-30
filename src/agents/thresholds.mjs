/**
 * src/agents/thresholds.mjs
 * ============================================================================
 * Single source of truth for content-quality thresholds across all five pods.
 *
 * Browser-safe ES module — imported by every pod engine (editor, librarian,
 * strategist, gatekeeper, orchestrator) and the activate / server scripts.
 *
 * If you change a value here, update any cross-references in:
 *   - .github/agents/*.agent.md
 *   - .github/copilot-instructions.md
 *   - .github/instructions/docs-content.instructions.md
 *
 * Each entry tags the owning pod so it's clear which pod's spec governs the
 * threshold's interpretation.
 *
 * Policy vs. tuning
 * -----------------
 * This file holds POLICY thresholds only — values stakeholders ask about,
 * agent specs cite, and build/release gates depend on. Pod-internal heuristic
 * tuning (analytics smoothing, scoring cutoffs, list-rank cutoffs) stays
 * local in each engine file and is owned end-to-end by that pod. If a local
 * threshold becomes a release-gate concern, promote it here at that point —
 * not preemptively.
 */

export const thresholds = {
  fleschReadingEase: {
    min: 50,
    appliesTo: 'per-document',
    owner: 'editor',
  },
  thinContentWordCount: {
    min: 150,
    appliesTo: 'per-document',
    owner: 'strategist',
  },
  staleAgeDays: {
    max: 180,
    appliesTo: 'per-document',
    owner: 'strategist',
  },
  globalStabilityScore: {
    min: 95,
    unit: 'percent',
    owner: 'gatekeeper',
  },
  schemaCompletion: {
    min: 70,
    unit: 'percent',
    owner: 'librarian',
  },
  thinDocsRatio: {
    max: 10,
    unit: 'percent',
    owner: 'strategist',
  },
  staleDocsRatio: {
    max: 5,
    unit: 'percent',
    owner: 'strategist',
  },
  imagesWithoutAltText: {
    max: 0,
    owner: 'strategist',
  },
  frontmatterCompletion: {
    min: 95,
    unit: 'percent',
    owner: 'orchestrator',
    note: 'Orchestrator-owned release gate for required frontmatter completion',
  },
  mdxChurnFlagThreshold: {
    max: 20,
    unit: 'files',
    owner: 'librarian',
  },
};

export default thresholds;

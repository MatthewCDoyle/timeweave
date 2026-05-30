/**
 * src/components/DevDashboard/dashboardMath.js
 * ============================================================================
 * Small pure helpers for dashboard panels that need defensible math at the
 * edges (zero denominators, scores out of range). Extracted from inline
 * panel code so the edge cases are unit-testable without a React renderer.
 *
 * Same pattern as healthGauge.js — see tests/dashboardMath.test.mjs for
 * the regression coverage. Phase 24 of the case study (dashboard panel
 * audit) extracted this when the EngineeringTestsPanel pass-rate formula
 * was found to produce NaN when all tests are skipped.
 */

/**
 * Pass-rate percentage for a test summary. Excludes skipped tests from the
 * denominator (a 6/10 result with 4 skipped should be 60%, not 6/14=43%).
 *
 * Edge cases handled:
 *   - All tests skipped       → denom = 0 → returns 0 (not NaN)
 *   - passed > (total-skipped) → clamped to 100 (defensive against bad data)
 *   - Missing fields          → treats as 0
 *
 * @param {{ total?: number, passed?: number, skipped?: number }} summary
 * @returns {number} integer percentage 0–100
 */
export function computePassRate(summary) {
  const total = summary?.total || 0;
  const passed = summary?.passed || 0;
  const skipped = summary?.skipped || 0;
  const denom = total - skipped;
  if (denom <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((passed / denom) * 100)));
}

/**
 * Standard 3-tier color for a percentage score. Used by every panel that
 * shows a 0–100 score. Tiers match the dashboard's convention elsewhere
 * (HealthGauge, SEO Health, Content Quality, etc.):
 *   ≥ 75 → green   (Healthy / on-target)
 *   ≥ 50 → orange  (Fair / needs attention)
 *   else → red     (Failing / needs work)
 *
 * Phase 24 found two panels using a 2-tier scheme that hid the red signal:
 * AnalyticsPanel.publishRate and GatekeeperPanel.lighthouseCI. Both
 * migrated to this helper as part of that fix.
 *
 * @param {number} pct — 0–100 (values outside the range are still mapped to a tier)
 * @returns {string} hex color
 */
export function tierColor(pct) {
  if (pct >= 75) return '#2ecc71';
  if (pct >= 50) return '#f39c12';
  return '#e74c3c';
}

/**
 * Lighthouse-specific tier. Lighthouse's published thresholds are 90/50, not
 * 75/50, so dashboard panels that show Lighthouse scores should use this
 * variant rather than the generic tierColor.
 *   ≥ 90 → green
 *   ≥ 50 → orange
 *   else → red
 *
 * @param {number} pct
 * @returns {string} hex color
 */
export function lighthouseTierColor(pct) {
  if (pct >= 90) return '#2ecc71';
  if (pct >= 50) return '#f39c12';
  return '#e74c3c';
}

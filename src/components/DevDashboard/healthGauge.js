/**
 * src/components/DevDashboard/healthGauge.js
 * ============================================================================
 * Pure-logic helpers for the Content Health Score gauge in BuildOverviewPanel.
 *
 * Extracted from the inline HealthGauge component in index.jsx so the gauge's
 * gradient computation can be unit-tested without a React renderer. The
 * gauge had four user-found rendering bugs this session (Phases 8/9/10/11);
 * Three of them were detectable via the gradient string alone, which is what
 * this module returns.
 *
 * See .github/case-study/insights.md ("The Content Health gauge ...") and
 * tests/healthGauge.test.mjs for the regression coverage rationale.
 */

/**
 * Compute the visual style for the half-donut gauge at a given score (0–100).
 * Returns the pieces the JSX needs, plus the gradient string used by the
 * conic-gradient `background`. Pure — no React, no DOM dependencies.
 *
 * @param {number} score
 * @returns {{ pct: number, color: string, gradient: string, label: string }}
 */
export function computeGaugeStyle(score) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const color =
    pct >= 75 ? '#2ecc71' :
    pct >= 50 ? '#f39c12' :
    '#e74c3c';
  // The gauge is a half-donut. Two things have to be right for the fill
  // to sweep along the arc from end to end:
  //   1. `at 50% 100%` anchors the conic origin at the bottom-center of
  //      the bounding box (the half-donut's pivot — where the two arc ends
  //      meet). Without this, the origin defaults to the geometric center
  //      of the bounding box (mid-height), so wedges toward the arc's left
  //      and right ENDS point SW/SE, leaving the ends gray and only the
  //      apex green — the "cup" look from Phase 9.
  //   2. `from 270deg` puts the gradient's 0° at straight west. With the
  //      origin at the half-donut's pivot, this puts the 0–180° green span
  //      exactly along the visible arc, west → north → east.
  // See .github/case-study/insights.md for the full debugging history.
  const filledDeg = (pct / 100) * 180;
  const gradient = `conic-gradient(from 270deg at 50% 100%, ${color} 0deg ${filledDeg}deg, var(--ifm-color-emphasis-200) ${filledDeg}deg 180deg)`;
  const label =
    pct >= 75 ? 'Healthy' :
    pct >= 50 ? 'Fair' :
    'Needs Work';

  return { pct, color, gradient, label };
}

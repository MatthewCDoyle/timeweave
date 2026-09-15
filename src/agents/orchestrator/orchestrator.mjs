/**
 * src/agents/orchestrator/orchestrator.mjs
 * ============================================================================
 * ZMV Master Orchestrator — client-side aggregation engine.
 *
 * Sense → Analyze → Act
 *
 * Collects pod results (Librarian, Editor, Strategist, Gatekeeper),
 * computes global stability, completeness, release readiness, and generates
 * critical/warning alerts with action modes.
 *
 * The Orchestrator is the sole owner of:
 *   - Frontmatter completion release gate
 *   - Global release readiness verdict
 *
 * Browser-safe: no node: imports at top level.
 */

import { thresholds } from '../thresholds.mjs';

// ---------------------------------------------------------------------------
// Guardrail thresholds — sourced from src/agents/thresholds.mjs
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  globalStability: thresholds.globalStabilityScore.min,
  frontmatterCompletion: thresholds.frontmatterCompletion.min,
};

// ---------------------------------------------------------------------------
// Sense: collect pod results
// ---------------------------------------------------------------------------
function sense(report, podResults) {
  return {
    report,
    pods: {
      librarian: podResults.librarian || null,
      editor: podResults.editor || null,
      gatekeeper: podResults.gatekeeper || null,
      strategist: podResults.strategist || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Analyze: compute global metrics + identify alerts
// ---------------------------------------------------------------------------
function analyze(telemetry) {
  const { report, pods } = telemetry;
  const agg = report.aggregate || {};
  const docs = report.docs || [];
  const totalDocs = docs.length || agg.totalDocs || 0;

  // -- Completeness: % of docs with all required frontmatter fields --
  const REQUIRED = ['title', 'description', 'slug'];
  let docsComplete = 0;
  for (const doc of docs) {
    const fm = doc.frontmatter || {};
    const hasAll = REQUIRED.every(f => fm[f] && fm[f] !== '');
    if (hasAll) docsComplete++;
  }
  const completeness = totalDocs > 0 ? Math.round((docsComplete / totalDocs) * 100) : 0;

  // -- Global Stability: % of docs free from critical issues --
  const placeholders = agg.placeholders?.docsWithPlaceholders || 0;
  const missingMeta = agg.seoHealth
    ? totalDocs - Math.min(agg.seoHealth.hasTitle || 0, agg.seoHealth.hasDescription || 0)
    : 0;
  const criticalIssues = placeholders + missingMeta;
  // Clamp to [0, 100] — `criticalIssues` can exceed `totalDocs` when both
  // metrics flag the same docs (e.g., a doc with placeholders AND missing
  // metadata is double-counted). Negative stability is a math artifact, not
  // a meaningful signal; floor at zero.
  const globalStability = totalDocs > 0
    ? Math.max(0, Math.min(100, Math.round(((totalDocs - criticalIssues) / totalDocs) * 100)))
    : 100;

  // -- Frontmatter completion rate (required fields only) --
  const frontmatterHealth = report.frontmatterHealth || {};
  const frontmatterCompletion = Math.round(
    ((frontmatterHealth.completionRate ?? agg.avgCompleteness ?? 1) * 100)
  );

  // -- Build status --
  let buildStatus = 'PASSING';
  if (globalStability < THRESHOLDS.globalStability) buildStatus = 'FAILING';

  // -- Release readiness --
  let releaseReady = buildStatus === 'PASSING' && frontmatterCompletion >= THRESHOLDS.frontmatterCompletion;

  // -- Alerts --
  const criticalAlerts = [];
  const warningAlerts = [];
  let alertSeq = 1;

  if (globalStability < THRESHOLDS.globalStability) {
    criticalAlerts.push({
      alertId: `ORCH-${alertSeq++}`,
      pod: 'ORCHESTRATOR',
      severity: 'P0',
      category: 'Global Stability',
      description: `Global stability at ${globalStability}% (threshold: ${THRESHOLDS.globalStability}%)`,
      actionMode: 'ESCALATE',
      actionTarget: 'dashboard#orchestrator',
      status: 'OPEN',
    });
  }

  if (placeholders > 0) {
    warningAlerts.push({
      alertId: `ORCH-${alertSeq++}`,
      pod: 'LIBRARIAN',
      severity: 'P2',
      category: 'Placeholders',
      description: `${placeholders} docs contain placeholder text`,
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dashboard#content-quality',
      status: 'OPEN',
    });
  }

  if (frontmatterCompletion < THRESHOLDS.frontmatterCompletion) {
    criticalAlerts.push({
      alertId: `ORCH-${alertSeq++}`,
      pod: 'ORCHESTRATOR',
      severity: 'P1',
      category: 'Frontmatter Completion',
      description: `Required frontmatter completion at ${frontmatterCompletion}% (threshold: ${THRESHOLDS.frontmatterCompletion}%)`,
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dashboard#frontmatter-readiness',
      status: 'OPEN',
    });
  }

  // Librarian pod alerts
  if (pods.librarian) {
    const lib = pods.librarian;
    if (lib.remediations) {
      for (const r of lib.remediations) {
        if (r.severity === 'P0' || r.severity === 'P1') {
          criticalAlerts.push({
            alertId: `ORCH-${alertSeq++}`,
            pod: 'LIBRARIAN',
            severity: r.severity,
            category: r.issue || r.category || 'Librarian Issue',
            description: r.issue || r.description || 'Librarian critical finding',
            actionMode: r.actionMode || 'CLICK_TO_FIX',
            actionTarget: r.actionTarget || 'dashboard#librarian',
            status: r.status || 'OPEN',
          });
        }
      }
    }
  }

  // Editor pod alerts
  if (pods.editor) {
    const ed = pods.editor;
    const highViolations = ed.violations?.bySeverity?.high || 0;
    if (highViolations > 0) {
      warningAlerts.push({
        alertId: `ORCH-${alertSeq++}`,
        pod: 'EDITOR',
        severity: 'P2',
        category: 'Style Violations',
        description: `${highViolations} high-severity style violations detected`,
        actionMode: 'CLICK_TO_FIX',
        actionTarget: 'dashboard#editor',
        status: 'OPEN',
      });
    }
  }

  // Strategist pod alerts
  if (pods.strategist) {
    const strat = pods.strategist;
    if (strat.recommendations) {
      for (const r of strat.recommendations) {
        if (r.severity === 'P1') {
          criticalAlerts.push({
            alertId: `ORCH-${alertSeq++}`,
            pod: 'STRATEGIST',
            severity: r.severity,
            category: r.category || 'Strategist Issue',
            description: r.description || 'Strategist critical finding',
            actionMode: r.actionMode || 'ESCALATE',
            actionTarget: 'dashboard#strategist',
            status: 'OPEN',
          });
        } else if (r.severity === 'P2') {
          warningAlerts.push({
            alertId: `ORCH-${alertSeq++}`,
            pod: 'STRATEGIST',
            severity: r.severity,
            category: r.category || 'Strategist Warning',
            description: r.description || 'Strategist warning',
            actionMode: r.actionMode || 'CLICK_TO_FIX',
            actionTarget: 'dashboard#strategist',
            status: 'OPEN',
          });
        }
      }
    }
  }

  // Gatekeeper pod alerts
  if (pods.gatekeeper) {
    const gk = pods.gatekeeper;
    if (gk.remediations) {
      for (const r of gk.remediations) {
        if (r.severity === 'P0') {
          criticalAlerts.push({
            alertId: `ORCH-${alertSeq++}`,
            pod: 'GATEKEEPER',
            severity: r.severity,
            category: r.issue || 'Gatekeeper Issue',
            description: r.issue || 'Gatekeeper critical finding',
            actionMode: r.actionMode || 'ESCALATE',
            actionTarget: r.actionTarget || 'dashboard#gatekeeper',
            status: r.status || 'OPEN',
          });
        } else if (r.severity === 'P1') {
          warningAlerts.push({
            alertId: `ORCH-${alertSeq++}`,
            pod: 'GATEKEEPER',
            severity: r.severity,
            category: r.issue || 'Gatekeeper Warning',
            description: r.issue || 'Gatekeeper warning',
            actionMode: r.actionMode || 'CLICK_TO_FIX',
            actionTarget: r.actionTarget || 'dashboard#gatekeeper',
            status: r.status || 'OPEN',
          });
        }
      }
    }
    // Gatekeeper release readiness check
    if (gk.releaseReady === false) releaseReady = false;
  }

  // -- Conflict detection --
  // Only Gatekeeper returns releaseReady; Orchestrator computes the rest
  const conflicts = [];
  if (pods.gatekeeper?.releaseReady === true && releaseReady === false) {
    conflicts.push({
      conflictId: `CONFLICT-${Date.now()}`,
      description: 'Gatekeeper says READY but Orchestrator verdict is NOT READY (frontmatter or stability block)',
      podsInvolved: ['GATEKEEPER', 'ORCHESTRATOR'],
      resolution: 'Orchestrator verdict wins (sole release authority)',
      escalated: false,
    });
  }

  if (criticalAlerts.length > 0) {
    buildStatus = 'FAILING';
    releaseReady = false;
  }

  return {
    completeness,
    globalStability,
    frontmatterCompletion,
    buildStatus,
    releaseReady,
    criticalAlerts,
    warningAlerts,
    conflicts,
    pods,
  };
}

// ---------------------------------------------------------------------------
// Main: run full Sense → Analyze → Act cycle
// ---------------------------------------------------------------------------
export function runOrchestrator(report, podResults = {}) {
  const runId = crypto?.randomUUID?.() || `orch-${Date.now()}`;
  const telemetry = sense(report, podResults);
  const analysis = analyze(telemetry);

  return {
    runId,
    snapshotDate: new Date().toISOString(),
    releaseReady: analysis.releaseReady,
    buildStatus: analysis.buildStatus,
    globalStability: analysis.globalStability,
    completeness: analysis.completeness,
    frontmatterCompletion: analysis.frontmatterCompletion,
    criticalAlerts: analysis.criticalAlerts,
    warningAlerts: analysis.warningAlerts,
    podResults: {
      librarian: analysis.pods.librarian ? { status: 'COLLECTED' } : { status: 'NOT_RUN' },
      editor: analysis.pods.editor ? { status: 'COLLECTED' } : { status: 'NOT_RUN' },
      gatekeeper: analysis.pods.gatekeeper ? { status: 'COLLECTED' } : { status: 'NOT_RUN' },
      strategist: analysis.pods.strategist ? { status: 'COLLECTED' } : { status: 'NOT_RUN' },
    },
    conflicts: analysis.conflicts,
    dashboardSyncStatus: 'SUCCESS',
  };
}

// ---------------------------------------------------------------------------
// CLI support
// ---------------------------------------------------------------------------
if (typeof window === 'undefined' && typeof process !== 'undefined' &&
    process.argv?.[1]?.replace(/\\/g, '/').endsWith('orchestrator/orchestrator.mjs')) {
  (async () => {
    const { readFileSync } = await import(/* webpackIgnore: true */ 'node:fs');
    const { resolve } = await import(/* webpackIgnore: true */ 'node:path');
    const reportPath = process.argv[2] || resolve(process.cwd(), 'static/build-report.json');
    const raw = readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw);
    const result = runOrchestrator(report);
    console.log(JSON.stringify(result, null, 2));
  })();
}

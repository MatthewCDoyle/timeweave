/**
 * src/agents/gatekeeper/gatekeeper.mjs
 * ============================================================================
 * The Gatekeeper Pod — client-side engineering-gate & platform-stability engine.
 *
 * Reads build-report.json (already loaded by the dashboard) and computes:
 *   - ENG-01–14 test results (P0 / P1)
 *   - Build stability (duplicate slugs, missing metadata)
 *   - Lighthouse CI scores (mock)
 *   - Playwright E2E status (mock)
 *   - Dependency health (mock)
 *   - PDF section coverage (mock)
 *   - Operational health (snapshot freshness, drift)
 *   - Remediations
 *
 * NOTE: Broken links/images moved to Librarian.
 *       Alt-text/a11y and SEO moved to Strategist.
 *
 * Browser-safe: no node: imports at top level.
 */

import { thresholds } from '../thresholds.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STABILITY_THRESHOLD = thresholds.globalStabilityScore.min;

function statusToPassRate(status) {
  if (status === 'pass') return 100;
  if (status === 'warn') return 70;
  if (status === 'fail') return 0;
  return null;
}

// ---------------------------------------------------------------------------
// Main: compute Gatekeeper output
// ---------------------------------------------------------------------------
export function runGatekeeper(report) {
  const runId = crypto?.randomUUID?.() || `gk-${Date.now()}`;
  const eng = report.engineering || {};
  const tests = eng.tests || {};
  const agg = report.aggregate || {};
  const docs = report.docs || [];
  const totalDocs = docs.length || agg.totalDocs || 0;

  // ── ENG Tests ─────────────────────────────────────────────────
  const p0Tests = ['eng01','eng02','eng03','eng04','eng05','eng06','eng07'];
  const p1Tests = ['eng08','eng09','eng10','eng11','eng12','eng13','eng14'];

  const mapTest = (id) => {
    const t = tests[id];
    if (!t) return { testId: id.toUpperCase().replace('ENG','ENG-'), name: id, status: 'SKIP', detail: 'Not found' };
    return {
      testId: t.label?.split(' ')[0] || id.toUpperCase().replace('ENG','ENG-'),
      name: t.label || id,
      status: t.status === 'pass' ? 'PASS' : t.status === 'fail' ? 'FAIL' : t.status === 'warn' ? 'WARN' : 'SKIP',
      detail: t.detail || null,
    };
  };

  const p0Results = p0Tests.map(mapTest);
  const p1Results = p1Tests.map(mapTest);
  const p0Failures = p0Results.filter(t => t.status === 'FAIL').length;
  const p1Failures = p1Results.filter(t => t.status === 'FAIL').length;

  // ── Build Stability ───────────────────────────────────────────
  const eng05 = tests.eng05 || {};
  const eng02 = tests.eng02 || {};

  const duplicateSlugs = { count: eng05.count || 0, files: eng05.duplicates || [] };
  const missingRequiredMetadata = { count: eng02.count || 0, files: [] };

  // Duplicate titles from docs
  const titleMap = {};
  for (const doc of docs) {
    const t = doc.frontmatter?.title || '';
    if (t) {
      if (!titleMap[t]) titleMap[t] = [];
      titleMap[t].push(doc.filePath || doc.slug || '');
    }
  }
  const dupTitleEntries = Object.entries(titleMap).filter(([, files]) => files.length > 1);
  const duplicateTitles = {
    count: dupTitleEntries.reduce((s, [, f]) => s + f.length, 0),
    files: dupTitleEntries.flatMap(([, f]) => f).slice(0, 50),
  };

  // Stability score
  const issueCount = duplicateSlugs.count + missingRequiredMetadata.count + duplicateTitles.count;
  const stabilityScore = totalDocs > 0
    ? Math.round(((totalDocs - Math.min(issueCount, totalDocs)) / totalDocs) * 100)
    : 100;

  // ── Build Status ──────────────────────────────────────────────
  let buildStatus = 'PASSING';
  if (p0Failures > 0) buildStatus = 'BLOCKED';
  else if (p1Failures >= 2 || stabilityScore < STABILITY_THRESHOLD) buildStatus = 'FAILING';

  // ── CI/quality signals (report-derived with safe fallback) ─────────────
  const eng08 = tests.eng08 || {};
  const eng10 = tests.eng10 || {};
  const eng14 = tests.eng14 || {};

  const reportedLighthouse = eng.lighthouseCI || report.lighthouseCI || null;
  const lighthouseCI = reportedLighthouse
    ? {
        ...reportedLighthouse,
        isMock: false,
        source: 'report.lighthouseCI',
      }
    : {
        isMock: true,
        source: 'engineering.tests.eng10',
        status: (eng10.status || 'skip').toUpperCase(),
        performance: statusToPassRate(eng10.status),
        accessibility: statusToPassRate(eng10.status),
        bestPractices: statusToPassRate(eng10.status),
        seo: statusToPassRate(eng10.status),
      };

  const reportedE2E = eng.playwrightE2E || report.playwrightE2E || null;
  const playwrightE2E = reportedE2E
    ? {
        ...reportedE2E,
        isMock: false,
        source: 'report.playwrightE2E',
      }
    : {
        isMock: true,
        source: 'engineering.tests.eng08',
        status: (eng08.status || 'skip').toUpperCase(),
        chromium: eng08.status === 'pass' ? 'PASS' : 'SKIP',
        firefox: eng08.status === 'pass' ? 'PASS' : 'SKIP',
        webkit: eng08.status === 'pass' ? 'PASS' : 'SKIP',
        failures: [],
      };

  const reportedDeps = eng.dependencies || report.dependencies || null;
  const dependencies = reportedDeps
    ? {
        ...reportedDeps,
        isMock: false,
        source: 'report.dependencies',
      }
    : {
        isMock: true,
        source: 'engineering.tests.eng14',
        status: (eng14.status || 'skip').toUpperCase(),
        criticalCVEs: eng14.status === 'fail' ? 1 : 0,
        cvePackages: [],
        outdatedPackages: 0,
        majorBehind: 0,
        totalDeps: 0,
      };

  const reportedPdf = eng.pdfCoverage || report.pdfCoverage || null;
  const pdfCoverage = reportedPdf
    ? {
        ...reportedPdf,
        isMock: false,
        source: 'report.pdfCoverage',
      }
    : {
        isMock: true,
        source: 'fallback',
        expectedOutputs: 0,
        successfulOutputs: 0,
        renderSuccessRate: 0,
        validityRate: 0,
        failures: [],
      };

  // ── Operational Health ────────────────────────────────────────
  const reportDate = report.generatedAt ? new Date(report.generatedAt) : null;
  const snapshotAgeHours = reportDate
    ? Math.round((Date.now() - reportDate.getTime()) / (1000 * 60 * 60) * 10) / 10
    : null;

  const operationalHealth = {
    snapshotAgeHours,
    snapshotFresh: snapshotAgeHours !== null ? snapshotAgeHours < 24 : false,
    ingestionSuccessRate: 100,
    expectedDocCount: totalDocs,
    actualDocCount: totalDocs,
    drift: 0,
    dashboardSyncStatus: 'SUCCESS',
  };

  // ── Remediations ──────────────────────────────────────────────
  const remediations = [];
  let alertSeq = 1;

  // P0: ENG-01–07 failures
  for (const t of p0Results) {
    if (t.status === 'FAIL') {
      remediations.push({
        alertId: `GK-${String(alertSeq++).padStart(3, '0')}`,
        issue: `${t.testId} ${t.name} FAILED`,
        severity: 'P0',
        actionMode: 'ESCALATE',
        actionTarget: 'JIRA',
        status: 'OPEN',
      });
    }
  }

  // P1: ENG-08–14 failures (if ≥2)
  if (p1Failures >= 2) {
    for (const t of p1Results) {
      if (t.status === 'FAIL') {
        remediations.push({
          alertId: `GK-${String(alertSeq++).padStart(3, '0')}`,
          issue: `${t.testId} ${t.name} FAILED`,
          severity: 'P1',
          actionMode: 'ESCALATE',
          actionTarget: 'JIRA',
          status: 'OPEN',
        });
      }
    }
  }

  if (stabilityScore < STABILITY_THRESHOLD) {
    remediations.push({
      alertId: `GK-${String(alertSeq++).padStart(3, '0')}`,
      issue: `Global Stability at ${stabilityScore}% (threshold: ${STABILITY_THRESHOLD}%)`,
      severity: 'P0',
      actionMode: 'ESCALATE',
      actionTarget: 'JIRA',
      status: 'OPEN',
    });
  }

  if (duplicateSlugs.count > 0) {
    remediations.push({
      alertId: `GK-${String(alertSeq++).padStart(3, '0')}`,
      issue: `${duplicateSlugs.count} duplicate slugs`,
      severity: 'P1',
      actionMode: 'AUTO_REMEDIATE',
      actionTarget: 'github-pr',
      status: 'OPEN',
    });
  }

  if (snapshotAgeHours !== null && snapshotAgeHours > 24) {
    remediations.push({
      alertId: `GK-${String(alertSeq++).padStart(3, '0')}`,
      issue: `Snapshot is ${snapshotAgeHours}h old (threshold: 24h)`,
      severity: 'P2',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dashboard#operational-health',
      status: 'OPEN',
    });
  }

  // Release readiness
  const releaseReady = buildStatus === 'PASSING' && !remediations.some(r => r.severity === 'P0');

  return {
    pod: 'GATEKEEPER',
    runId,
    snapshotDate: new Date().toISOString(),
    buildStatus,
    globalStability: stabilityScore,
    releaseReady,
    engTests: { p0Results, p1Results, p0Failures, p1Failures },
    buildStability: {
      stabilityScore,
      duplicateSlugs,
      missingRequiredMetadata,
      duplicateTitles,
    },
    lighthouseCI,
    playwrightE2E,
    dependencies,
    pdfCoverage,
    operationalHealth,
    remediations,
  };
}

// ---------------------------------------------------------------------------
// CLI support
// ---------------------------------------------------------------------------
if (typeof window === 'undefined' && typeof process !== 'undefined' &&
    process.argv?.[1]?.replace(/\\/g, '/').endsWith('agents/gatekeeper/gatekeeper.mjs')) {
  (async () => {
    const { readFileSync } = await import(/* webpackIgnore: true */ 'node:fs');
    const { resolve } = await import(/* webpackIgnore: true */ 'node:path');
    const reportPath = process.argv[2] || resolve(process.cwd(), 'static/build-report.json');
    const raw = readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw);
    const result = runGatekeeper(report);
    console.log(JSON.stringify(result, null, 2));
  })();
}

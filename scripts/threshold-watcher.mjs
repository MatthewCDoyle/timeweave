#!/usr/bin/env node
/**
 * scripts/threshold-watcher.mjs
 * ============================================================================
 * Post-build threshold watcher — checks agent metrics against defined
 * thresholds and writes static/data/notifications.json.
 *
 * Run automatically after generate-build-report.mjs in the build pipeline.
 * The DevDashboard reads notifications.json and renders alert badges on
 * each agent pod panel.
 *
 * Usage:
 *   node scripts/threshold-watcher.mjs [path/to/build-report.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Thresholds per agent
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  librarian: [
    { metric: 'schemaCompletion', label: 'Schema Completion', threshold: 70, direction: 'below', severity: 'P2', field: r => r.aggregate?.guessing ? Math.round(((r.docs?.length || 0) - (r.aggregate.guessing.docsWithGuesses || 0)) / (r.docs?.length || 1) * 100) : 0 },
    { metric: 'metadataCompleteness', label: 'Metadata Completeness', threshold: 50, direction: 'below', severity: 'P1', field: r => { const docs = r.docs || []; const total = docs.length || 1; const REQUIRED = ['title','description','slug']; let complete = 0; for (const d of docs) { const fm = d.frontmatter || {}; if (REQUIRED.every(f => fm[f] && fm[f] !== '')) complete++; } return Math.round((complete/total)*100); } },
    { metric: 'brokenImages', label: 'Broken Images', threshold: 0, direction: 'above', severity: 'P1', field: r => r.engineering?.tests?.eng04?.count || 0 },
    { metric: 'brokenLinks', label: 'Broken Links', threshold: 0, direction: 'above', severity: 'P1', field: r => r.engineering?.tests?.eng09?.count || 0 },
    { metric: 'ditaCoverage', label: 'DITA Migration Coverage', threshold: 50, direction: 'below', severity: 'P2', field: r => r.ditaMigration?.migrationCoverage || 0 },
  ],
  editor: [
    { metric: 'avgFleschScore', label: 'Avg Flesch Readability', threshold: 40, direction: 'below', severity: 'P2', field: r => { const docs = r.docs || []; let total = 0; let count = 0; for (const d of docs) { const body = d.body || d.rawBody || ''; if (!body) continue; const prose = body.replace(/^---[\s\S]*?---\s*/, ''); const sentences = prose.split(/[.!?]+/).filter(s => s.trim().length > 3); const words = prose.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)); if (!sentences.length || !words.length) continue; let syl = 0; for (const w of words) { let ww = w.toLowerCase().replace(/[^a-z]/g, ''); if (ww.length <= 2) { syl += 1; continue; } ww = ww.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, ''); ww = ww.replace(/^y/, ''); const m = ww.match(/[aeiouy]{1,2}/g); syl += m ? m.length : 1; } const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length); total += score; count++; } return count > 0 ? Math.round(total / count * 10) / 10 : null; } },
    { metric: 'highViolations', label: 'High-Severity Style Violations', threshold: 50, direction: 'above', severity: 'P2', field: _r => null }, // computed at runtime by editor engine
  ],
  strategist: [
    { metric: 'stalePercent', label: 'Stale Docs %', threshold: 5, direction: 'above', severity: 'P1', field: r => { const da = r.aggregate?.dateAnalytics || {}; const total = (da.fresh || 0) + (da.recent || 0) + (da.aging || 0) + (da.stale || 0); return total > 0 ? Math.round((da.stale || 0) / total * 100) : 0; } },
    { metric: 'seoScore', label: 'SEO Score', threshold: 50, direction: 'below', severity: 'P2', field: r => { const seo = r.aggregate?.seoHealth || {}; const total = r.docs?.length || 1; return Math.round(((seo.hasTitle||0) + (seo.hasDescription||0) + (seo.hasKeywords||0) + (seo.hasSlug||0)) / (total * 4) * 100); } },
  ],
  gatekeeper: [
    { metric: 'globalStability', label: 'Global Stability', threshold: 95, direction: 'below', severity: 'P0', field: r => { const docs = r.docs || []; const total = docs.length || 1; const eng = r.engineering?.tests || {}; const issues = (eng.eng05?.count || 0) + (eng.eng04?.count || 0) + (eng.eng02?.count || 0); return Math.round(((total - Math.min(issues, total)) / total) * 100); } },
    { metric: 'p0Failures', label: 'P0 ENG Test Failures', threshold: 0, direction: 'above', severity: 'P0', field: r => { const tests = r.engineering?.tests || {}; let count = 0; for (const id of ['eng01','eng02','eng03','eng04','eng05','eng06','eng07']) { if (tests[id]?.status === 'fail') count++; } return count; } },
    { metric: 'p1Failures', label: 'P1 ENG Test Failures', threshold: 1, direction: 'above', severity: 'P1', field: r => { const tests = r.engineering?.tests || {}; let count = 0; for (const id of ['eng08','eng09','eng10','eng11','eng12','eng13','eng14']) { if (tests[id]?.status === 'fail') count++; } return count; } },
  ],
  orchestrator: [
    { metric: 'frontmatterCompletion', label: 'Frontmatter Completion', threshold: 95, direction: 'below', severity: 'P1', field: r => Math.round((r.frontmatterHealth?.completionRate ?? 1) * 100) },
  ],
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const reportPath = process.argv[2] || path.join(workspaceRoot, 'static', 'build-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

const notifications = {
  generatedAt: new Date().toISOString(),
  agents: {},
  totalAlerts: 0,
};

for (const [agent, checks] of Object.entries(THRESHOLDS)) {
  const alerts = [];

  for (const check of checks) {
    const value = check.field(report);
    if (value === null) continue; // metric not available

    let breached = false;
    if (check.direction === 'below' && value < check.threshold) breached = true;
    if (check.direction === 'above' && value > check.threshold) breached = true;

    if (breached) {
      const direction = check.direction === 'below' ? '<' : '>';
      alerts.push({
        metric: check.metric,
        label: check.label,
        value,
        threshold: check.threshold,
        severity: check.severity,
        message: `${check.label}: ${value}${typeof value === 'number' && check.threshold <= 100 ? '%' : ''} (${direction} ${check.threshold}${check.threshold <= 100 ? '%' : ''} threshold)`,
      });
    }
  }

  notifications.agents[agent] = {
    alertCount: alerts.length,
    alerts,
    status: alerts.some(a => a.severity === 'P0') ? 'CRITICAL'
          : alerts.some(a => a.severity === 'P1') ? 'WARNING'
          : alerts.length > 0 ? 'INFO'
          : 'OK',
  };
  notifications.totalAlerts += alerts.length;
}

// Write output
const outDir = path.join(workspaceRoot, 'static', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'notifications.json');
fs.writeFileSync(outPath, JSON.stringify(notifications, null, 2));

// Console summary
const statusIcon = { OK: '✓', INFO: 'ℹ', WARNING: '⚠', CRITICAL: '✗' };
console.log(`[threshold-watcher] ${notifications.totalAlerts} alert(s) across ${Object.keys(THRESHOLDS).length} agents`);
for (const [agent, data] of Object.entries(notifications.agents)) {
  const icon = statusIcon[data.status] || '?';
  console.log(`  ${icon} ${agent}: ${data.status}${data.alertCount > 0 ? ` (${data.alertCount} alert${data.alertCount > 1 ? 's' : ''})` : ''}`);
  for (const a of data.alerts) {
    console.log(`      ${a.severity} ${a.message}`);
  }
}

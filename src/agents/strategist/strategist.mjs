/**
 * src/agents/strategist/strategist.mjs
 * ============================================================================
 * The Strategist Pod — client-side content-intelligence engine.
 *
 * Reads build-report.json (already loaded by the dashboard) and optional
 * local-search-log data (from localStorage) to compute:
 *   - Content freshness decay
 *   - Thin-content detection
 *   - Search-gap analysis (local queries + missed searches)
 *   - SEO health (moved from Gatekeeper/Librarian)
 *   - Accessibility / alt-text tracking (moved from Gatekeeper)
 *   - Click behavior analytics (from Clarity)
 *   - i18n locale coverage
 *   - Actionable recommendations
 *
 * NOTE: Readability (Flesch) is owned by the Editor.
 *       Taxonomy coverage is owned by the Librarian.
 *
 * Browser-safe: no node: imports at top level.
 */

import { thresholds } from '../thresholds.mjs';

// ---------------------------------------------------------------------------
// Thresholds — shared values come from src/agents/thresholds.mjs
// (canonical source). Local-only values stay here.
// ---------------------------------------------------------------------------
const THIN_WORD_THRESHOLD = thresholds.thinContentWordCount.min;
const STALE_PERCENT_THRESHOLD = thresholds.staleDocsRatio.max;
const THIN_PERCENT_THRESHOLD = thresholds.thinDocsRatio.max;
const STALE_AGE_DAYS = thresholds.staleAgeDays.max;
// Strategist-local thresholds (not yet shared):
const MISSED_SEARCH_THRESHOLD = 20;
const SEO_SCORE_THRESHOLD = 50;
// Click-behavior thresholds (consume real Clarity fields):
const RAGE_CLICK_RATE_HIGH = 0.05;        // >5% site-wide rage clicks
const DEAD_CLICK_RATE_HIGH = 0.10;        // >10% site-wide dead clicks
const JS_ERROR_PER_SESSION_HIGH = 0.05;   // >5% sessions hit a JS error
const SCROLL_DEPTH_50_LOW = 0.50;         // <50% of sessions reach mid-page
const RAGE_CLICK_PAGE_MIN = 5;            // ignore pages with <5 rage clicks

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getSearchLog() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { queries: [], missedSearches: [] };
  }
  try {
    const raw = localStorage.getItem('zmv-search-log');
    if (!raw) return { queries: [], missedSearches: [] };
    const parsed = JSON.parse(raw);
    return {
      queries: Array.isArray(parsed.queries) ? parsed.queries : [],
      missedSearches: Array.isArray(parsed.missedSearches) ? parsed.missedSearches : [],
    };
  } catch {
    return { queries: [], missedSearches: [] };
  }
}

// ---------------------------------------------------------------------------
// Main: compute Strategist output
// ---------------------------------------------------------------------------
export function runStrategist(report, options = {}) {
  const runId = crypto?.randomUUID?.() || `strat-${Date.now()}`;
  const agg = report.aggregate || {};
  const docs = report.docs || [];
  const totalDocs = docs.length || agg.totalDocs || 0;

  // ── Freshness ─────────────────────────────────────────────────
  const dateAnalytics = agg.dateAnalytics || {};
  const fresh = dateAnalytics.fresh || 0;
  const recent = dateAnalytics.recent || 0;
  const aging = dateAnalytics.aging || 0;
  const stale = dateAnalytics.stale || 0;
  const freshTotal = fresh + recent + aging + stale || totalDocs;
  const freshPercent = freshTotal > 0 ? Math.round((fresh / freshTotal) * 100) : 0;
  const stalePercent = freshTotal > 0 ? Math.round((stale / freshTotal) * 100) : 0;

  // Collect stale doc list from docs array
  const staleDocs = [];
  const now = Date.now();
  const STALE_MS = STALE_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const doc of docs) {
    const fm = doc.frontmatter || {};
    const modified = fm.last_modified || fm.date || fm.lastModified || null;
    if (modified) {
      const d = new Date(modified);
      if (!isNaN(d.getTime()) && (now - d.getTime()) > STALE_MS) {
        staleDocs.push({ file: doc.filePath || doc.slug || '', lastModified: modified });
      }
    }
  }

  // ── Thin Content ──────────────────────────────────────────────
  const thinDocs = [];
  for (const doc of docs) {
    const body = doc.body || doc.rawBody || '';
    const wordCount = body.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
    if (wordCount > 0 && wordCount < THIN_WORD_THRESHOLD) {
      thinDocs.push({ file: doc.filePath || doc.slug || '', wordCount });
    }
  }
  thinDocs.sort((a, b) => a.wordCount - b.wordCount);

  // ── Search Gaps ───────────────────────────────────────────────
  const searchLog = options.searchLog || getSearchLog();
  const queryFreq = {};
  for (const entry of searchLog.queries) {
    const q = (entry.q || '').toLowerCase().trim();
    if (q) queryFreq[q] = (queryFreq[q] || 0) + 1;
  }
  const topQueries = Object.entries(queryFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([query, count]) => ({ query, count }));

  const missedFreq = {};
  for (const entry of searchLog.missedSearches) {
    const q = (entry.q || '').toLowerCase().trim();
    if (q) missedFreq[q] = (missedFreq[q] || 0) + 1;
  }
  const missedSearches = Object.entries(missedFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([query, count]) => ({ query, count }));

  // ── i18n Coverage ─────────────────────────────────────────────
  const i18nConfig = options.i18n || { defaultLocale: 'en', locales: ['en'] };
  const translationCoverage = {};
  for (const locale of i18nConfig.locales) {
    translationCoverage[locale] = locale === i18nConfig.defaultLocale ? 100 : 0;
  }

  // ── SEO Health (moved from Gatekeeper/Librarian) ───────────────────────
  const seoHealth = agg.seoHealth || {};
  const seoScorePercent = totalDocs > 0
    ? Math.round(
        ((seoHealth.hasTitle || 0) + (seoHealth.hasDescription || 0) +
         (seoHealth.hasKeywords || 0) + (seoHealth.hasSlug || 0)) /
        (totalDocs * 4) * 100
      )
    : 0;

  // ── Accessibility / Alt-text (moved from Gatekeeper) ──────────────────
  let imagesWithoutAlt = 0;
  const altMissingFiles = [];
  for (const doc of docs) {
    const body = doc.body || doc.rawBody || '';
    const imgTags = body.match(/<img\b[^>]*>/gi) || [];
    for (const tag of imgTags) {
      if (!tag.includes('alt=') || /alt=["']\s*["']/i.test(tag)) {
        imagesWithoutAlt++;
        if (!altMissingFiles.includes(doc.filePath || '')) {
          altMissingFiles.push(doc.filePath || '');
        }
      }
    }
    // Also check markdown images ![](path)
    const mdImgs = body.match(/!\[\s*\]\([^)]+\)/g) || [];
    if (mdImgs.length > 0) {
      imagesWithoutAlt += mdImgs.length;
      if (!altMissingFiles.includes(doc.filePath || '')) {
        altMissingFiles.push(doc.filePath || '');
      }
    }
  }

  const accessibility = {
    wcagLevel: 'AA',
    criticalErrors: 0,
    imagesWithoutAlt: { count: imagesWithoutAlt, files: altMissingFiles.slice(0, 30) },
    docsWithIssues: altMissingFiles.length,
  };

  // ── Recommendations ───────────────────────────────────────────
  const recommendations = [];
  let recSeq = 1;

  if (stalePercent > STALE_PERCENT_THRESHOLD) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P1',
      category: 'Freshness',
      description: `${stale} stale docs (${stalePercent}% of corpus, threshold: ${STALE_PERCENT_THRESHOLD}%). Schedule review cycle.`,
      actionMode: 'ESCALATE',
    });
  }

  const thinPercent = totalDocs > 0 ? Math.round((thinDocs.length / totalDocs) * 100) : 0;
  if (thinPercent > THIN_PERCENT_THRESHOLD) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P2',
      category: 'Thin Content',
      description: `${thinDocs.length} thin docs (${thinPercent}% < ${THIN_WORD_THRESHOLD} words). Enrich or merge.`,
      actionMode: 'CLICK_TO_FIX',
    });
  }

  const uniqueMissed = Object.keys(missedFreq).length;
  if (uniqueMissed > MISSED_SEARCH_THRESHOLD) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P1',
      category: 'Search Gaps',
      description: `${uniqueMissed} unique missed searches detected. Content gap audit needed.`,
      actionMode: 'ESCALATE',
    });
  }

  if (seoScorePercent < SEO_SCORE_THRESHOLD) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P2',
      category: 'SEO',
      description: `SEO score at ${seoScorePercent}% (threshold: ${SEO_SCORE_THRESHOLD}%). Metadata enrichment needed.`,
      actionMode: 'CLICK_TO_FIX',
    });
  }

  if (imagesWithoutAlt > 0) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P1',
      category: 'Accessibility',
      description: `${imagesWithoutAlt} images missing alt-text across ${altMissingFiles.length} files. WCAG remediation needed.`,
      actionMode: 'CLICK_TO_FIX',
    });
  }

  // ── Click Behavior — real Clarity Data Export API fields ───────────────
  const clarity = report.clarity || {};
  const sessions = clarity.sessions || 0;
  const rageClickRate = typeof clarity.rageClickRate === 'number' ? clarity.rageClickRate : null;
  const deadClickRate = typeof clarity.deadClickRate === 'number' ? clarity.deadClickRate : null;
  const jsErrorCount = clarity.jsErrorCount || 0;
  const jsErrorPerSession = sessions > 0 ? jsErrorCount / sessions : null;
  const scrollDepth50 = typeof clarity.scrollDepth?.d50 === 'number' ? clarity.scrollDepth.d50 : null;
  const rageClickPages = Array.isArray(clarity.rageClickPages) ? clarity.rageClickPages : [];

  if (rageClickRate !== null && rageClickRate > RAGE_CLICK_RATE_HIGH) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P1',
      category: 'Click Behavior',
      description: `Site-wide rage-click rate at ${Math.round(rageClickRate * 100)}% (threshold: ${Math.round(RAGE_CLICK_RATE_HIGH * 100)}%). Investigate elements that look interactive but aren't.`,
      actionMode: 'ESCALATE',
    });
  }

  if (deadClickRate !== null && deadClickRate > DEAD_CLICK_RATE_HIGH) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P2',
      category: 'Click Behavior',
      description: `Site-wide dead-click rate at ${Math.round(deadClickRate * 100)}% (threshold: ${Math.round(DEAD_CLICK_RATE_HIGH * 100)}%). Review affordances and event handlers on clickable elements.`,
      actionMode: 'CLICK_TO_FIX',
    });
  }

  if (jsErrorPerSession !== null && jsErrorPerSession > JS_ERROR_PER_SESSION_HIGH) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P1',
      category: 'Click Behavior',
      description: `${jsErrorCount} JS errors across ${sessions} sessions (${Math.round(jsErrorPerSession * 100)}% rate, threshold ${Math.round(JS_ERROR_PER_SESSION_HIGH * 100)}%). Triage via browser console.`,
      actionMode: 'ESCALATE',
    });
  }

  if (scrollDepth50 !== null && scrollDepth50 < SCROLL_DEPTH_50_LOW) {
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P2',
      category: 'Engagement',
      description: `Only ${Math.round(scrollDepth50 * 100)}% of sessions reach 50% scroll depth (threshold: ${Math.round(SCROLL_DEPTH_50_LOW * 100)}%). Content may be too long or the lead is buried.`,
      actionMode: 'CLICK_TO_FIX',
    });
  }

  for (const page of rageClickPages) {
    if (!page || !page.count || page.count < RAGE_CLICK_PAGE_MIN) continue;
    recommendations.push({
      id: `STRAT-${String(recSeq++).padStart(3, '0')}`,
      severity: 'P2',
      category: 'Click Behavior',
      description: `${page.count} rage clicks on ${page.url} — page-level usability issue, investigate.`,
      actionMode: 'CLICK_TO_FIX',
    });
  }

  return {
    pod: 'STRATEGIST',
    runId,
    snapshotDate: new Date().toISOString(),
    freshness: {
      fresh, recent, aging, stale,
      freshPercent, stalePercent, staleDocs: staleDocs.slice(0, 50),
    },
    thinContent: {
      threshold: THIN_WORD_THRESHOLD,
      thinDocs: thinDocs.slice(0, 50),
      count: thinDocs.length,
    },
    searchGaps: {
      totalQueries: searchLog.queries.length,
      uniqueQueries: Object.keys(queryFreq).length,
      missedSearches,
      topQueries,
    },
    seoHealth: {
      seoScorePercent,
      fieldCoverage: {
        hasTitle: seoHealth.hasTitle || 0,
        hasDescription: seoHealth.hasDescription || 0,
        hasKeywords: seoHealth.hasKeywords || 0,
        hasSlug: seoHealth.hasSlug || 0,
      },
    },
    accessibility,
    i18n: {
      configuredLocales: i18nConfig.locales,
      defaultLocale: i18nConfig.defaultLocale,
      translationCoverage,
    },
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// CLI support
// ---------------------------------------------------------------------------
if (typeof window === 'undefined' && typeof process !== 'undefined' &&
    process.argv?.[1]?.replace(/\\/g, '/').endsWith('agents/strategist/strategist.mjs')) {
  (async () => {
    const { readFileSync } = await import(/* webpackIgnore: true */ 'node:fs');
    const { resolve } = await import(/* webpackIgnore: true */ 'node:path');
    const reportPath = process.argv[2] || resolve(process.cwd(), 'static/build-report.json');
    const raw = readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw);

    // Try to load search-data.json for taxonomy coverage
    let searchDocs;
    try {
      const sdPath = resolve(process.cwd(), 'static/data/search-data.json');
      const sd = JSON.parse(readFileSync(sdPath, 'utf8'));
      searchDocs = sd.documents;
    } catch { /* ignore */ }

    const result = runStrategist(report, { searchDocs });
    console.log(JSON.stringify(result, null, 2));
  })();
}

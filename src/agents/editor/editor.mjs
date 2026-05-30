/**
 * src/agents/editor/editor.mjs
 * ============================================================================
 * The Editor Pod — client-side computation engine.
 *
 * Reads build-report.json (already loaded by the dashboard) and computes
 * style-rule violation statistics, readability scores, and terminology drift
 * from the doc body content available in the report.
 *
 * This is the browser-safe "Run" button — read-only analysis, zero writes.
 * For actual file scanning + PR creation, see scripts/editor-activate.mjs.
 */

import { thresholds } from '../thresholds.mjs';

const FLESCH_MIN = thresholds.fleschReadingEase.min;

// ---------------------------------------------------------------------------
// Flesch Reading Ease
// ---------------------------------------------------------------------------
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 2) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const m = word.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}

function fleschScore(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const words = text.split(/\s+/).filter(w => /[a-zA-Z]/.test(w));
  if (!sentences.length || !words.length) return null;
  const totalSyllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const asl = words.length / sentences.length;
  const asw = totalSyllables / words.length;
  return Math.round((206.835 - 1.015 * asl - 84.6 * asw) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Quick pattern-based violation checks (subset for browser preview)
// ---------------------------------------------------------------------------
const QUICK_CHECKS = [
  { id: 'RULE-002', cat: 'Voice', sev: 'high', re: /\b(we recommend|we suggest|we provide|we offer|our product)\b/gi, msg: 'First-person "we" usage' },
  { id: 'RULE-004', cat: 'Voice', sev: 'high', re: /\b(you can|you may)\b/gi, msg: '"You can/may" in instructions' },
  { id: 'RULE-007', cat: 'Tense', sev: 'high', re: /\bwill\s+(open|display|show|appear|start|begin|close|create|generate)\b/gi, msg: 'Future tense for immediate result' },
  { id: 'RULE-012', cat: 'Anthropomorphism', sev: 'high', re: /\b(the (?:system|program|device|app|software) (?:wants|knows|thinks|asks|tells|tries|decides|remembers|forgets|understands|feels))\b/gi, msg: 'Anthropomorphism' },
  { id: 'RULE-021', cat: 'Terminology', sev: 'high', re: /\b(e\.g\.|etc\.|i\.e\.|et al\.)/g, msg: 'Latin abbreviation' },
  { id: 'RULE-022', cat: 'Terminology', sev: 'high', re: /\b(see (?:the )?(?:information |section )?(?:above|below))\b/gi, msg: '"above/below" reference' },
  { id: 'RULE-024', cat: 'Terminology', sev: 'low', re: /\bplease\b/gi, msg: '"Please" in instructions' },
  { id: 'RULE-045', cat: 'Punctuation', sev: 'medium', re: /[.!?]\s{2,}/g, msg: 'Double space after punctuation' },
  { id: 'RULE-049', cat: 'Punctuation', sev: 'medium', re: /\b(can't|won't|don't|doesn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|couldn't|wouldn't|shouldn't|it's|they're|we're|you're|let's|that's|there's|here's|what's|who's)\b/gi, msg: 'Contraction' },
  { id: 'RULE-050', cat: 'Punctuation', sev: 'medium', re: /[a-zA-Z]!(?!\s*[UuSs]\d)/g, msg: 'Exclamation point in body text' },
  { id: 'RULE-062', cat: 'Grammar', sev: 'low', re: /\b(actually|currently|easily|generally|simply|seamlessly|very)\b/gi, msg: 'Filler word' },
  { id: 'RULE-069', cat: 'Formatting', sev: 'medium', re: /(?<!\d)\.\d+\b/g, msg: 'Missing leading zero before decimal' },
  { id: 'RULE-083', cat: 'Compliance', sev: 'high', re: /\b(outstanding|perfect|unsurpassed|leader|famous brand|unique|ultimate|revolutionary|extreme|permanent|impeccable|top|universal|maximum|unparalleled|breakthrough|unmatched|super|exclusively|extraordinary|unprecedented|champion|preferred)\b/gi, msg: 'Superlative (China ad law)' },
];

// ---------------------------------------------------------------------------
// Main: compute Editor output from a parsed build-report
// ---------------------------------------------------------------------------
export function runEditor(report) {
  const runId = crypto?.randomUUID?.() || `ed-${Date.now()}`;
  const docs = report.docs || [];
  const totalDocs = docs.length;

  const violations = [];
  const readabilityScores = [];
  const byCat = {};
  const bySev = { high: 0, medium: 0, low: 0 };

  for (const doc of docs) {
    // Use body text if available, otherwise skip
    const body = doc.body || doc.rawBody || '';
    if (!body) continue;

    // Strip frontmatter
    const prose = body.replace(/^---[\s\S]*?---\s*/, '');

    // Readability
    const score = fleschScore(prose);
    if (score !== null) {
      readabilityScores.push({ file: doc.filePath, fleschScore: score });
    }

    // Quick pattern checks
    for (const rule of QUICK_CHECKS) {
      const matches = prose.matchAll(rule.re);
      for (const m of matches) {
        violations.push({
          ruleId: rule.id,
          category: rule.cat,
          severity: rule.sev,
          file: doc.filePath,
          original: m[0],
          msg: rule.msg,
        });
        byCat[rule.cat] = (byCat[rule.cat] || 0) + 1;
        bySev[rule.sev] = (bySev[rule.sev] || 0) + 1;
      }
    }
  }

  // Readability summary
  const avgFlesch = readabilityScores.length
    ? Math.round(readabilityScores.reduce((s, r) => s + r.fleschScore, 0) / readabilityScores.length * 10) / 10
    : null;
  const belowThreshold = readabilityScores.filter(r => r.fleschScore < FLESCH_MIN);

  return {
    pod: 'EDITOR',
    runId,
    snapshotDate: new Date().toISOString(),
    filesScanned: docs.filter(d => d.body || d.rawBody).length,
    totalDocs,
    violations: {
      totalCount: violations.length,
      byCategory: Object.entries(byCat).map(([category, count]) => ({ category, count })),
      bySeverity: bySev,
      items: violations.slice(0, 200), // cap for browser performance
    },
    readability: {
      repoAvgFleschScore: avgFlesch,
      threshold: FLESCH_MIN,
      docsBelowThreshold: {
        count: belowThreshold.length,
        items: belowThreshold.slice(0, 50),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// CLI support
// ---------------------------------------------------------------------------
if (typeof window === 'undefined' && typeof process !== 'undefined' &&
    process.argv?.[1]?.replace(/\\/g, '/').endsWith('agents/editor/editor.mjs')) {
  (async () => {
    const { readFileSync } = await import(/* webpackIgnore: true */ 'node:fs');
    const { resolve } = await import(/* webpackIgnore: true */ 'node:path');
    const reportPath = process.argv[2] || resolve(process.cwd(), 'static/build-report.json');
    const raw = readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw);
    const result = runEditor(report);
    console.log(JSON.stringify(result, null, 2));
  })();
}

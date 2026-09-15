#!/usr/bin/env node
/**
 * scripts/strategist-alt-gate.mjs
 * ============================================================================
 * Content-level CI gate for strategist-pod PRs. Verifies that any alt-text
 * added in the diff doesn't match known-bad patterns: CMS rendition slugs
 * (Cq5dam, jcr, rendition), version-number-shaped strings, or other noise
 * patterns that produce worse-than-empty screen-reader output.
 *
 * Catches the Phase 13 / 15a bug class — alt text like "Cq5dam.Web.1280.1280"
 * that gets announced verbatim by assistive technology, worse than empty alt
 * (which is decoratively skipped).
 *
 * Scoping: should run only on branches matching `strategist/*`. Hand-authored
 * alt text on other PRs won't follow these patterns and would not false-
 * positive, but limiting scope keeps the signal clean.
 *
 * Usage:
 *   node scripts/strategist-alt-gate.mjs                    # GATE_BASE=origin/main
 *   GATE_BASE=main node scripts/strategist-alt-gate.mjs     # custom base
 *   node scripts/strategist-alt-gate.mjs --json             # JSON output
 *
 * Exit codes:
 *   0 — every alt-text added looks plausibly human (or skipped if empty)
 *   1 — at least one alt-text matches a known-bad pattern
 *   2 — script error
 *
 * See .github/case-study/insights.md "Three more agent pods produced broken
 * output of different bug classes" for the Phase 13/15a motivating incident.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const BASE_REF = process.env.GATE_BASE || 'origin/main';

// ---------------------------------------------------------------------------
// Known-bad alt-text patterns. Tested against the alt-text string AFTER
// humanization (i.e., as it appears in the rendered Markdown), case-insensitive.
//
// Each pattern carries a `why` so the failure report is actionable.
// ---------------------------------------------------------------------------
const BAD_PATTERNS = [
  {
    pattern: /^Cq5dam\b/i,
    why: 'CMS rendition slug — screen readers announce as "C Q 5 dam"',
  },
  {
    pattern: /^Jcr(\s|$)/i,
    why: 'AEM JCR path fragment — not a description',
  },
  {
    pattern: /^Renditions?\b/i,
    why: 'Image rendition path component — not a description',
  },
  {
    pattern: /^\d+(\.\d+)+$/,
    why: 'Version-number-shaped — meaningless as alt text',
  },
  {
    pattern: /^\d+x\d+$/i,
    why: 'Dimension-shaped (WxH) — describes pixels, not content',
  },
  {
    pattern: /\.(png|jpg|jpeg|gif|svg|webp)$/i,
    why: 'Ends with image extension — filename leak, not description',
  },
  {
    pattern: /^(image|img|picture|photo|graphic|screenshot)$/i,
    why: 'Generic placeholder — describes nothing specific',
  },
];

// Common Zebra/tech acronyms whose casing the agent commonly mangles. If alt
// text contains a known acronym in wrong casing (e.g., "Hmi" instead of "HMI",
// "Ico" instead of "Icon"), flag as a softer warning rather than a hard fail.
// See Phase 17 / bug #8 in the case study.
const ACRONYM_CASING_WARNINGS = [
  { wrong: /\bHmi\b/, right: 'HMI' },
  { wrong: /\bUsb\b/, right: 'USB' },
  { wrong: /\bGpio\b/, right: 'GPIO' },
  { wrong: /\bOcr\b/, right: 'OCR' },
  { wrong: /\bTcp\b/, right: 'TCP' },
  { wrong: /\bIp\b(?!\.)/, right: 'IP' },
  { wrong: /\bIco\b/, right: 'Icon (probable abbreviation)' },
  { wrong: /\bDch\b/, right: 'DCH' },
  { wrong: /\bRoi\b/, right: 'ROI' },
];

// ---------------------------------------------------------------------------
// Get diff
// ---------------------------------------------------------------------------
let diff;
try {
  diff = execFileSync(
    'git',
    ['diff', BASE_REF, '--unified=0', '--', 'docs/'],
    { cwd: workspaceRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
} catch (e) {
  console.error(`✗ git diff failed (base=${BASE_REF}): ${e.message}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Walk the diff, find every alt-text in `+` lines.
// Match both Markdown image and HTML img tag forms.
// ---------------------------------------------------------------------------
const failures = [];
const warnings = [];
let currentFile = null;

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice('+++ b/'.length);
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  const added = line.slice(1);

  // Markdown: ![ALT](url)
  for (const m of added.matchAll(/!\[([^\]]*)\]\(/g)) {
    const alt = m[1].trim();
    if (!alt) continue; // empty alt is decoratively valid; not flagged
    checkAlt(alt, currentFile, 'markdown', added);
  }

  // HTML: <img ... alt="ALT" ...> (single or double quoted)
  for (const m of added.matchAll(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["']/gi)) {
    const alt = m[1].trim();
    if (!alt) continue;
    checkAlt(alt, currentFile, 'html', added);
  }
}

function checkAlt(alt, file, kind, sourceLine) {
  for (const { pattern, why } of BAD_PATTERNS) {
    if (pattern.test(alt)) {
      failures.push({ file, kind, alt, why, sourceLine });
      return; // one failure per alt is enough
    }
  }
  for (const { wrong, right } of ACRONYM_CASING_WARNINGS) {
    if (wrong.test(alt)) {
      warnings.push({ file, kind, alt, why: `Acronym casing — "${alt.match(wrong)[0]}" should likely be "${right}"`, sourceLine });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const report = {
  baseRef: BASE_REF,
  failures: failures.length,
  warnings: warnings.length,
  details: { failures, warnings },
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Strategist alt-text gate — base=${BASE_REF}`);
  console.log(`  Failures (hard fail): ${failures.length}`);
  console.log(`  Warnings (acronym casing): ${warnings.length}`);
  console.log();
  if (failures.length > 0) {
    console.log('FAIL — alt-text matching known-bad patterns:');
    for (const f of failures.slice(0, 30)) {
      console.log(`  ${f.file}: ${f.kind}`);
      console.log(`    alt = "${f.alt}"`);
      console.log(`    why = ${f.why}`);
      console.log();
    }
    if (failures.length > 30) console.log(`  ... +${failures.length - 30} more`);
  } else {
    console.log('No bad-pattern alt-text detected.');
  }
  if (warnings.length > 0) {
    console.log();
    console.log('Warnings (non-blocking — acronym casing):');
    for (const w of warnings.slice(0, 20)) {
      console.log(`  ${w.file}: alt = "${w.alt}" — ${w.why}`);
    }
    if (warnings.length > 20) console.log(`  ... +${warnings.length - 20} more`);
  }
}

process.exit(failures.length > 0 ? 1 : 0);

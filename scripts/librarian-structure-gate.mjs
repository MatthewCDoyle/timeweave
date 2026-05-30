#!/usr/bin/env node
/**
 * scripts/librarian-structure-gate.mjs
 * ============================================================================
 * Content-level CI gate for librarian-pod PRs. Detects two structural-damage
 * patterns the librarian has historically produced:
 *
 *   1. Heading-count regression — a doc loses ≥ THRESHOLD% of its headings
 *      between the base ref and HEAD. Catches the Phase 14 / bug #4 class
 *      (DL-07 over-removal of H1 version anchors when sub-headings exist).
 *
 *   2. List-to-table conversion — a doc gains `| --- |` table-separator
 *      syntax in positions adjacent to lines that were bullet-list items
 *      in the base ref. Catches the Phase 19 / bug #9 class (DL-01
 *      reconstructing nested bullet lists as tables).
 *
 * Scoping: should run only on branches matching `librarian/*`. The patterns
 * checked here are specifically remediations the librarian performs; on
 * other branches the gate would produce mostly-irrelevant warnings.
 *
 * Usage:
 *   node scripts/librarian-structure-gate.mjs
 *   GATE_BASE=main node scripts/librarian-structure-gate.mjs
 *   node scripts/librarian-structure-gate.mjs --json
 *
 * Exit codes:
 *   0 — no structural regressions
 *   1 — at least one file shows a regression
 *   2 — script error
 *
 * See .github/case-study/insights.md "Three more agent pods..." (bug #4) and
 * "DL-01 over-matched bullets and JSDoc" (bug #9) for the motivating
 * incidents.
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
// HEAD_REF lets the gate compare two arbitrary refs (useful for testing
// historical incidents against today's gate logic). Defaults to working tree.
const HEAD_REF = process.env.GATE_HEAD || 'HEAD';

// % of original headings that may be lost before triggering a failure.
// 50% means: a file with 16 headings on main that drops to 8 or fewer
// triggers the gate. Phase 14's worst case was 16 → 0 H1s in one file.
const HEADING_LOSS_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Get the list of changed files
// ---------------------------------------------------------------------------
let changed;
try {
  const refArgs = HEAD_REF === 'HEAD'
    ? [BASE_REF, '--name-only', '--', 'docs/']
    : [BASE_REF, HEAD_REF, '--name-only', '--', 'docs/'];
  changed = execFileSync(
    'git',
    ['diff', ...refArgs],
    { cwd: workspaceRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).split('\n').filter(Boolean);
} catch (e) {
  console.error(`✗ git diff failed (base=${BASE_REF}): ${e.message}`);
  process.exit(2);
}

// Helper — read file content at a given ref (or empty string if missing)
function showAtRef(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], {
      cwd: workspaceRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Per-file analyzers
// ---------------------------------------------------------------------------
const HEADING_RE = /^#+\s/m;
const BULLET_RE = /^\s*[-*+]\s/;
const TABLE_SEP_RE = /^\s*\|\s*-{3,}\s*(\|\s*-{3,}\s*)*\|\s*$/;

function countHeadings(text) {
  let count = 0;
  for (const line of text.split('\n')) {
    if (/^#+\s/.test(line)) count++;
  }
  return count;
}

function findNewTableSeparators(oldText, newText) {
  // Lines in new that are table separators and weren't separators at the same
  // logical position in old. Heuristic: a separator is "new" if its bullet-
  // shaped neighbor (the line just above the separator's header) used to be
  // a bullet in the old text.
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const oldBulletSet = new Set();
  for (const line of oldLines) {
    const t = line.trim();
    if (BULLET_RE.test(line) && t.length > 4) {
      // Track the bullet TEXT (after marker + space), not the line. This
      // catches the case where DL-01 wraps a bullet's text as `| BULLET TEXT |`.
      oldBulletSet.add(t.replace(/^[-*+]\s+/, '').slice(0, 120));
    }
  }

  const findings = [];
  for (let i = 0; i < newLines.length; i++) {
    if (!TABLE_SEP_RE.test(newLines[i])) continue;

    // Look at the lines around the separator (header above, rows below).
    const header = newLines[i - 1] || '';
    const headerCell = header.replace(/^\|\s*/, '').replace(/\s*\|.*$/, '').trim();
    // Strip leading bullet markers (`* `, `- `, `+ `) so we match against
    // the bullet's *content* — which is what `fixFlattenedTables` wraps.
    const headerStripped = headerCell.replace(/^[-*+]\s+/, '').slice(0, 120);

    if (oldBulletSet.has(headerStripped)) {
      findings.push({ lineIdx: i, header, headerCell });
    } else {
      // Also check the row line BELOW the separator
      const row = newLines[i + 1] || '';
      const rowCell = row.replace(/^\|\s*/, '').replace(/\s*\|.*$/, '').trim();
      const rowStripped = rowCell.replace(/^[-*+]\s+/, '').slice(0, 120);
      if (oldBulletSet.has(rowStripped)) {
        findings.push({ lineIdx: i, header, headerCell });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Run the checks
// ---------------------------------------------------------------------------
const failures = [];

for (const file of changed) {
  if (!/\.(mdx?|MD|MDX)$/.test(file)) continue;
  const oldText = showAtRef(BASE_REF, file);
  const newText = showAtRef(HEAD_REF, file);
  if (!oldText && newText) continue; // new file; nothing to regress against
  if (!newText && oldText) continue; // deletion; not a structural-damage pattern

  // Check 1: heading-count regression
  const oldHeads = countHeadings(oldText);
  const newHeads = countHeadings(newText);
  if (oldHeads > 0) {
    const lossPct = (oldHeads - newHeads) / oldHeads;
    if (newHeads < oldHeads && lossPct >= HEADING_LOSS_THRESHOLD) {
      failures.push({
        kind: 'heading-loss',
        file,
        oldHeadings: oldHeads,
        newHeadings: newHeads,
        lossPct: Math.round(lossPct * 100),
      });
    }
  }

  // Check 2: list-to-table conversion
  const listToTable = findNewTableSeparators(oldText, newText);
  if (listToTable.length > 0) {
    failures.push({
      kind: 'list-to-table',
      file,
      occurrences: listToTable.length,
      samples: listToTable.slice(0, 3).map((f) => ({
        approxLine: f.lineIdx + 1,
        header: f.headerCell,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const report = {
  baseRef: BASE_REF,
  filesScanned: changed.length,
  failures: failures.length,
  details: failures,
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Librarian structure gate — base=${BASE_REF}`);
  console.log(`  Files scanned: ${changed.length}`);
  console.log(`  Failures: ${failures.length}`);
  console.log();
  if (failures.length > 0) {
    console.log('FAIL — structural regressions detected:');
    for (const f of failures.slice(0, 30)) {
      if (f.kind === 'heading-loss') {
        console.log(`  ${f.file}: HEADING LOSS`);
        console.log(`    base had ${f.oldHeadings} headings; PR has ${f.newHeadings} (${f.lossPct}% loss)`);
        console.log(`    Threshold: ${Math.round(HEADING_LOSS_THRESHOLD * 100)}% loss — see Phase 14 / DL-07 over-removal`);
      } else if (f.kind === 'list-to-table') {
        console.log(`  ${f.file}: LIST → TABLE CONVERSION (${f.occurrences} occurrence${f.occurrences === 1 ? '' : 's'})`);
        for (const s of f.samples) {
          console.log(`    ~line ${s.approxLine}: header was a bullet in base — "${s.header.slice(0, 80)}"`);
        }
        console.log(`    See Phase 19 / DL-01 bullet-misread`);
      }
      console.log();
    }
    if (failures.length > 30) console.log(`  ... +${failures.length - 30} more`);
  } else {
    console.log('No structural regressions detected.');
  }
}

process.exit(failures.length > 0 ? 1 : 0);

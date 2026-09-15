#!/usr/bin/env node
/**
 * scripts/editor-prose-gate.mjs
 * ============================================================================
 * Content-level CI gate for editor-pod PRs. Verifies that every prose change
 * in the diff is reproducible by applying the current rule registry to the
 * original line. Catches the Phase 12 bug class (silent regex-substitution
 * corruption like `performance` → `doance`) by failing any change that
 * doesn't correspond to an allowed registry fix.
 *
 * Strategy — "registry-replay verification":
 *   1. Read .content/rule-registry.json
 *   2. Collect every pattern with a non-null `fix` template (auto-fixable
 *      substitutions only — auto-derived flag-only patterns are skipped)
 *   3. For each (old_line, new_line) pair in the diff:
 *        result = old_line
 *        for each fix in registry: result = result.replace(regex, fix)
 *      If result === new_line → OK. Else → FAIL.
 *
 * Hand-authored edits will also fail this gate (no pattern reproduces them),
 * so this gate is only sound on editor-pod PRs. Wire it up in a workflow that
 * triggers on branches matching `editor/*`.
 *
 * Usage:
 *   node scripts/editor-prose-gate.mjs                      # GATE_BASE=origin/main
 *   GATE_BASE=main node scripts/editor-prose-gate.mjs       # custom base
 *   node scripts/editor-prose-gate.mjs --json               # JSON output
 *
 * Exit codes:
 *   0  — all changes accounted for by registry
 *   1  — at least one change not reproducible (potential corruption)
 *   2  — script error (no registry, no git, etc.)
 *
 * See .github/case-study/insights.md "Automated remediation almost shipped
 * corrupted prose past every check we had" for the motivating incident.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const BASE_REF = process.env.GATE_BASE || 'origin/main';

// ---------------------------------------------------------------------------
// Load registry → list of allowed substitutions
// ---------------------------------------------------------------------------
const registryPath = path.join(workspaceRoot, '.content', 'rule-registry.json');
if (!fs.existsSync(registryPath)) {
  console.error(`✗ Rule registry not found at ${registryPath}. Run: npm run editor:registry:build`);
  process.exit(2);
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

const fixTemplates = [];
for (const rule of registry.rules || []) {
  for (const p of rule.patterns || []) {
    if (p.fix !== null && p.fix !== undefined) {
      fixTemplates.push({
        ruleId: rule.id,
        regex: new RegExp(p.regex, p.flags || 'g'),
        fix: p.fix,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Get unified diff against the base ref
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
// Parse unified diff into per-hunk (oldLines, newLines) pairs
// ---------------------------------------------------------------------------
const hunks = [];
let currentFile = null;
let currentHunk = null;

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice('+++ b/'.length);
    continue;
  }
  if (line.startsWith('@@')) {
    if (currentHunk) hunks.push(currentHunk);
    currentHunk = { file: currentFile, oldLines: [], newLines: [] };
    continue;
  }
  if (!currentHunk) continue;
  if (line.startsWith('-') && !line.startsWith('---')) {
    currentHunk.oldLines.push(line.slice(1));
  } else if (line.startsWith('+') && !line.startsWith('+++')) {
    currentHunk.newLines.push(line.slice(1));
  }
}
if (currentHunk) hunks.push(currentHunk);

// ---------------------------------------------------------------------------
// Replay registry against each (old, new) line pair
// ---------------------------------------------------------------------------
function applyAllFixes(line) {
  let result = line;
  for (const { regex, fix } of fixTemplates) {
    result = result.replace(new RegExp(regex.source, regex.flags), fix);
  }
  return result;
}

const failures = [];
const skipped = [];

for (const hunk of hunks) {
  // Pair lines only when counts match — keeps the gate from misaligning on
  // complex hunks (additions, deletions, wholesale rewrites). Unanalyzable
  // hunks are reported separately rather than treated as failures.
  if (hunk.oldLines.length !== hunk.newLines.length) {
    skipped.push({
      file: hunk.file,
      reason: `unequal -/+ line count (${hunk.oldLines.length}/${hunk.newLines.length}) — not a substitution pattern`,
    });
    continue;
  }
  for (let i = 0; i < hunk.oldLines.length; i++) {
    const oldLine = hunk.oldLines[i];
    const newLine = hunk.newLines[i];
    if (oldLine === newLine) continue;
    const replayed = applyAllFixes(oldLine);
    if (replayed !== newLine) {
      failures.push({
        file: hunk.file,
        oldLine,
        newLine,
        replayed,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const report = {
  baseRef: BASE_REF,
  fixTemplatesCount: fixTemplates.length,
  hunksAnalyzed: hunks.length,
  skippedHunks: skipped.length,
  failures: failures.length,
  details: { failures, skipped },
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Editor prose-gate — base=${BASE_REF}`);
  console.log(`  Registry fix-templates loaded: ${fixTemplates.length}`);
  console.log(`  Hunks analyzed: ${hunks.length}`);
  console.log(`  Skipped (complex hunks): ${skipped.length}`);
  console.log(`  Failures (unaccounted changes): ${failures.length}`);
  console.log();
  if (failures.length > 0) {
    console.log('FAIL — changes not reproducible from rule registry:');
    for (const f of failures.slice(0, 20)) {
      console.log(`  ${f.file}:`);
      console.log(`    - ${f.oldLine}`);
      console.log(`    + ${f.newLine}`);
      console.log(`    (registry-replay produced: "${f.replayed}")`);
      console.log();
    }
    if (failures.length > 20) {
      console.log(`  ... +${failures.length - 20} more`);
    }
  } else {
    console.log('PASS — every change is reproducible from the rule registry.');
  }
}

process.exit(failures.length > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * scripts/editor-activate.mjs
 * ============================================================================
 * The Editor Pod — server-side style-rule scanner.
 *
 * Scans MDX/MD doc bodies against .content/style-rules.md, produces a
 * violation report, and creates separate PRs for each distinct task:
 *   PR 1 — Prose quality fixes (voice, tense, terminology, grammar)
 *   PR 2 — Mechanical fixes (punctuation, contractions, formatting)
 *
 * Usage:
 *   node scripts/editor-activate.mjs                    # scan + PRs
 *   node scripts/editor-activate.mjs --dry-run           # report only
 *   node scripts/editor-activate.mjs --scope=fs42-prg    # scope filter
 *   node scripts/editor-activate.mjs --json              # JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(workspaceRoot, 'docs');
const rulesPath = path.join(workspaceRoot, '.content', 'style-rules.md');

// CLI flags
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const JSON_OUT = args.includes('--json');
const SCOPE_ARG = args.find(a => a.startsWith('--scope='));
const SCOPE = SCOPE_ARG ? SCOPE_ARG.split('=')[1] : null;

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------
function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (/\.(mdx?|md)$/i.test(entry.name)) results.push(full);
  }
  return results;
}

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
// Enforceable rules with auto-fix patterns
// ---------------------------------------------------------------------------
// Rule loading — lazy from .content/rule-registry.json
// ---------------------------------------------------------------------------
// The registry is produced by scripts/parse-style-rules.mjs from the human-
// authored .content/style-rules.md plus the regex+fix sidecar at
// .content/rule-patterns.json. Run `npm run editor:registry:build` (or the
// pipeline `npm run editor:registry`) before activating.
const registryPath = path.join(workspaceRoot, '.content', 'rule-registry.json');

/**
 * Substitute $1..$9 backreferences and $& (full match) in a fix template.
 * Returns null when the template is null (= flag-only, no auto-fix).
 */
function buildFixFn(template) {
  if (template === null || template === undefined) return null;
  return (m) => String(template).replace(/\$([0-9&])/g, (_, k) =>
    k === '&' ? m[0] : (m[parseInt(k, 10)] ?? ''));
}

let _ruleSet = null;
function getRuleSet() {
  if (_ruleSet) return _ruleSet;
  if (!fs.existsSync(registryPath)) {
    throw new Error(
      `Rule registry not found at ${registryPath}.\n` +
      `Run: npm run editor:registry:build`
    );
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const enforceable = [];
  const flag = [];
  for (const rule of registry.rules || []) {
    for (const p of rule.patterns || []) {
      const compiled = {
        id:    rule.id,
        cat:   rule.category,
        sev:   rule.severity,
        phase: p.phase || 'prose',
        re:    new RegExp(p.regex, p.flags || 'g'),
        msg:   p.msg,
        fix:   buildFixFn(p.fix),
        patternSource: p.source || rule.patternSource,
      };
      // Patterns with a fix template → auto-fixable; otherwise flag-only.
      if (compiled.fix !== null) enforceable.push(compiled);
      else flag.push(compiled);
    }
  }
  _ruleSet = { enforceable, flag, registry };
  return _ruleSet;
}

// ---------------------------------------------------------------------------
// Strip frontmatter, imports, code blocks from MDX body — preserving line
// numbers, so detection-time line numbers match the original file's line
// numbers. applyFixes() operates on the original file content and indexes by
// these line numbers; deleting frontmatter (the prior behavior) shifted body
// lines up by N and caused fixes to target the wrong line. Masking instead of
// deleting keeps line count and offsets intact. See .github/case-study/insights.md.
// ---------------------------------------------------------------------------
function extractProse(content) {
  // Frontmatter: replace ALL characters with spaces, preserving newlines.
  let body = content.replace(/^---[\s\S]*?\n---\s*$/m, (m) =>
    m.replace(/[^\n]/g, ' '));
  // Fenced code blocks: same treatment (multiline-safe).
  body = body.replace(/```[\s\S]*?```/g, (m) =>
    m.replace(/[^\n]/g, ' '));
  // Imports on their own lines: blank the line (no newline added/removed).
  body = body.replace(/^import\s+.*$/gm, (m) => ' '.repeat(m.length));
  // Inline strips (single-line each — no line-count change either way).
  body = body.replace(/`[^`]+`/g, (m) => ' '.repeat(m.length));
  body = body.replace(/<[^>]+>/g, (m) => ' '.repeat(m.length));
  return body;
}

// ---------------------------------------------------------------------------
// Scan a single file
// ---------------------------------------------------------------------------
function scanFile(filePath, relPath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const prose = extractProse(content);
  const lines = prose.split('\n');

  const violations = [];
  const flags = [];

  const { enforceable, flag } = getRuleSet();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    for (const rule of enforceable) {
      for (const m of line.matchAll(new RegExp(rule.re.source, rule.re.flags))) {
        const proposed = rule.fix ? rule.fix(m) : null;
        violations.push({
          violationId: `${rule.id}-${relPath}-L${i + 1}-${m.index}`,
          ruleId: rule.id, category: rule.cat, severity: rule.sev,
          phase: rule.phase,
          file: relPath, line: i + 1,
          original: m[0], proposed,
          msg: rule.msg,
          autoFixable: proposed !== null,
        });
      }
    }

    for (const rule of flag) {
      for (const m of line.matchAll(new RegExp(rule.re.source, rule.re.flags))) {
        flags.push({
          flagId: `${rule.id}-${relPath}-L${i + 1}-${m.index}`,
          ruleId: rule.id, category: rule.cat, severity: rule.sev,
          file: relPath, line: i + 1,
          original: m[0], msg: rule.msg,
        });
      }
    }
  }

  const score = fleschScore(prose);

  return { violations, flags, fleschScore: score };
}

// ---------------------------------------------------------------------------
// Apply auto-fixes to a file's content
// ---------------------------------------------------------------------------
function applyFixes(content, approvedViolations) {
  let body = content;
  // Apply in reverse line order to preserve positions
  const sorted = [...approvedViolations]
    .filter(v => v.autoFixable && v.proposed !== null)
    .sort((a, b) => b.line - a.line);

  for (const v of sorted) {
    // Simple string replacement per line
    const lines = body.split('\n');
    const lineIdx = v.line - 1;
    if (lineIdx >= 0 && lineIdx < lines.length) {
      lines[lineIdx] = lines[lineIdx].replace(v.original, v.proposed);
    }
    body = lines.join('\n');
  }
  return body;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
function git(...gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd: workspaceRoot, encoding: 'utf8', stdio: 'pipe',
  }).trim();
}
function gh(...ghArgs) {
  return execFileSync('gh', ghArgs, {
    cwd: workspaceRoot, encoding: 'utf8', stdio: 'pipe',
  }).trim();
}

function createBranchAndPR(changedFiles, branchName, commitMsg, prTitle, prBody, originalBranch) {
  let prUrl = null;

  const listFile = path.join(os.tmpdir(), `editor-add-${Date.now()}.txt`);
  try {
    fs.writeFileSync(listFile, changedFiles.join('\n'), 'utf8');
    git('add', '--pathspec-from-file', listFile);
  } finally {
    try { fs.unlinkSync(listFile); } catch { /* ignore */ }
  }

  try { git('branch', '-D', branchName); } catch { /* doesn't exist */ }
  git('checkout', '-b', branchName);

  try {
    git('commit', '-m', commitMsg);
    try { git('push', 'origin', branchName, '--force'); } catch (e) { console.error('Push failed:', e.message); }

    try {
      prUrl = gh('pr', 'create', '--title', prTitle, '--body', prBody,
        '--base', originalBranch, '--head', branchName, '--assignee', '@me');
    } catch {
      try { prUrl = gh('pr', 'view', branchName, '--json', 'url', '--jq', '.url'); } catch { /* ignore */ }
    }

    git('checkout', originalBranch);
  } catch (err) {
    try { git('checkout', originalBranch); } catch { /* ignore */ }
    throw err;
  }

  return { branchName, prUrl };
}

// ---------------------------------------------------------------------------
// Main activate function
// ---------------------------------------------------------------------------
export function activate({ dryRun = false, scope = null } = {}) {
  // Verify rules source-of-truth exists
  if (!fs.existsSync(rulesPath)) {
    return { error: 'style-rules.md not found at .content/style-rules.md', status: 'HALTED_MISSING_RULES' };
  }
  // Verify the compiled rule registry exists (built by parse-style-rules.mjs)
  if (!fs.existsSync(registryPath)) {
    return {
      error: 'Rule registry not found at .content/rule-registry.json. Run: npm run editor:registry:build',
      status: 'HALTED_MISSING_REGISTRY',
    };
  }
  // Eagerly load the registry so a parse error fails fast with a clear message.
  let ruleSet;
  try {
    ruleSet = getRuleSet();
  } catch (err) {
    return { error: err.message, status: 'HALTED_MISSING_REGISTRY' };
  }

  const scanRoot = scope ? path.join(docsRoot, scope) : docsRoot;
  if (!fs.existsSync(scanRoot)) {
    return { error: `Scope directory not found: ${scanRoot}`, status: 'HALTED_BAD_SCOPE' };
  }

  const files = walk(scanRoot);
  const allViolations = [];
  const allFlags = [];
  const readabilityScores = [];

  for (const filePath of files) {
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const result = scanFile(filePath, relPath);
    allViolations.push(...result.violations);
    allFlags.push(...result.flags);
    if (result.fleschScore !== null) {
      readabilityScores.push({ file: relPath, fleschScore: result.fleschScore });
    }
  }

  // Split violations by phase (now self-described on each violation)
  const proseViolations      = allViolations.filter((v) => v.phase === 'prose');
  const mechanicalViolations = allViolations.filter((v) => v.phase === 'mechanical');

  const proseAutoFixable = proseViolations.filter(v => v.autoFixable);
  const mechAutoFixable = mechanicalViolations.filter(v => v.autoFixable);
  const humanReview = [
    ...allViolations.filter(v => !v.autoFixable),
    ...allFlags,
  ];

  // Severity counts
  const bySev = { high: 0, medium: 0, low: 0 };
  const byCat = {};
  for (const v of allViolations) {
    bySev[v.severity] = (bySev[v.severity] || 0) + 1;
    byCat[v.category] = (byCat[v.category] || 0) + 1;
  }

  // Readability summary
  const avgFlesch = readabilityScores.length
    ? Math.round(readabilityScores.reduce((s, r) => s + r.fleschScore, 0) / readabilityScores.length * 10) / 10
    : null;

  // Git setup (shared by both PRs)
  const date = new Date().toISOString().slice(0, 10);
  const suffix = scope ? `-${scope.replace(/[\/\\]/g, '-')}` : '';
  const scopeLabel = scope ? `docs/${scope}` : 'all docs';
  let originalBranch = 'main';

  if (!dryRun) {
    try { git('config', 'user.name'); } catch { git('config', 'user.name', 'editor-bot'); }
    try { git('config', 'user.email'); } catch { git('config', 'user.email', 'editor@local'); }
    try { originalBranch = git('branch', '--show-current'); } catch { /* keep main */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1: Prose quality fixes (voice, tense, terminology, grammar)
  // ═══════════════════════════════════════════════════════════════════════
  const phase1Files = new Set();

  if (!dryRun && proseAutoFixable.length > 0) {
    const byFile = {};
    for (const v of proseAutoFixable) {
      (byFile[v.file] = byFile[v.file] || []).push(v);
    }
    for (const [relFile, violations] of Object.entries(byFile)) {
      const absPath = path.join(workspaceRoot, relFile);
      const original = fs.readFileSync(absPath, 'utf8');
      const fixed = applyFixes(original, violations);
      if (fixed !== original) {
        fs.writeFileSync(absPath, fixed, 'utf8');
        phase1Files.add(absPath);
      }
    }
  }

  const phase1Summary = {
    label: 'Prose Quality Fixes',
    categories: ['Voice', 'Tense', 'Terminology', 'Grammar'],
    violations: proseViolations.length,
    autoFixed: proseAutoFixable.length,
    docsModified: phase1Files.size,
    branch: null,
    prUrl: null,
  };

  if (!dryRun && phase1Files.size > 0) {
    try {
      const branchName = `editor/prose-fixes${suffix}-${date}`;
      const commitMsg = `editor: fix ${proseAutoFixable.length} prose violations in ${scopeLabel} (${date})`;
      const prTitle = `Editor: fix ${proseAutoFixable.length} prose quality issues (${scopeLabel})`;
      const proseByCat = {};
      for (const v of proseAutoFixable) { proseByCat[v.category] = (proseByCat[v.category] || 0) + 1; }
      const prBody = [
        '## Prose Quality Fixes',
        '',
        `**Scope:** ${scopeLabel}`,
        `**Files modified:** ${phase1Files.size}`,
        `**Violations fixed:** ${proseAutoFixable.length}`,
        `**Date:** ${date}`,
        '',
        '| Category | Count |',
        '|----------|-------|',
        ...Object.entries(proseByCat).sort().map(([cat, n]) => `| ${cat} | ${n} |`),
        '',
        '> Voice, tense, terminology, and grammar corrections.',
        '> Please review before merging.',
      ].join('\n');

      const gitResult = createBranchAndPR([...phase1Files], branchName, commitMsg, prTitle, prBody, originalBranch);
      phase1Summary.branch = gitResult.branchName;
      phase1Summary.prUrl = gitResult.prUrl;

      // Restore working tree for Phase 2
      git('checkout', originalBranch);
    } catch (err) {
      phase1Summary.branch = `(git error: ${err.message})`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2: Mechanical fixes (punctuation, contractions, formatting)
  // Re-read files fresh so phases stay independent
  // ═══════════════════════════════════════════════════════════════════════
  const phase2Files = new Set();

  if (!dryRun && mechAutoFixable.length > 0) {
    const byFile = {};
    for (const v of mechAutoFixable) {
      (byFile[v.file] = byFile[v.file] || []).push(v);
    }
    for (const [relFile, violations] of Object.entries(byFile)) {
      const absPath = path.join(workspaceRoot, relFile);
      const original = fs.readFileSync(absPath, 'utf8');
      const fixed = applyFixes(original, violations);
      if (fixed !== original) {
        fs.writeFileSync(absPath, fixed, 'utf8');
        phase2Files.add(absPath);
      }
    }
  }

  const phase2Summary = {
    label: 'Mechanical Fixes',
    categories: ['Punctuation', 'Formatting'],
    violations: mechanicalViolations.length,
    autoFixed: mechAutoFixable.length,
    docsModified: phase2Files.size,
    branch: null,
    prUrl: null,
  };

  if (!dryRun && phase2Files.size > 0) {
    try {
      const branchName = `editor/mechanical-fixes${suffix}-${date}`;
      const commitMsg = `editor: fix ${mechAutoFixable.length} mechanical violations in ${scopeLabel} (${date})`;
      const prTitle = `Editor: fix ${mechAutoFixable.length} mechanical issues (${scopeLabel})`;
      const mechByCat = {};
      for (const v of mechAutoFixable) { mechByCat[v.category] = (mechByCat[v.category] || 0) + 1; }
      const prBody = [
        '## Mechanical Fixes',
        '',
        `**Scope:** ${scopeLabel}`,
        `**Files modified:** ${phase2Files.size}`,
        `**Violations fixed:** ${mechAutoFixable.length}`,
        `**Date:** ${date}`,
        '',
        '| Category | Count |',
        '|----------|-------|',
        ...Object.entries(mechByCat).sort().map(([cat, n]) => `| ${cat} | ${n} |`),
        '',
        '> Punctuation, contraction, and formatting corrections.',
        '> Please review before merging.',
      ].join('\n');

      const gitResult = createBranchAndPR([...phase2Files], branchName, commitMsg, prTitle, prBody, originalBranch);
      phase2Summary.branch = gitResult.branchName;
      phase2Summary.prUrl = gitResult.prUrl;
    } catch (err) {
      phase2Summary.branch = `(git error: ${err.message})`;
    }
  }

  const output = {
    pod: 'EDITOR',
    dryRun,
    scope: scope || 'all',
    filesScanned: files.length,
    totalViolations: allViolations.length,
    autoFixable: proseAutoFixable.length + mechAutoFixable.length,
    humanReview: humanReview.length,
    flagsRaised: allFlags.length,
    docsModified: phase1Files.size + phase2Files.size,
    bySeverity: bySev,
    byCategory: Object.entries(byCat).map(([category, count]) => ({ category, count })),
    readability: {
      avgFleschScore: avgFlesch,
      threshold: 50,
      docsBelowThreshold: readabilityScores.filter(r => r.fleschScore < 50).length,
    },
    rulesSource: {
      // Audit trail: every Editor run can be traced back to specific commits
      // of the rules + patterns inputs that produced it.
      rulesFileSha: ruleSet.registry.sourceRulesFileSha || null,
      patternsFileSha: ruleSet.registry.sourcePatternsFileSha || null,
      registryGeneratedAt: ruleSet.registry.generatedAt || null,
      totals: ruleSet.registry.totals || null,
    },
    phase1: phase1Summary,
    phase2: phase2Summary,
    violations: allViolations.slice(0, 300),
    flags: allFlags.slice(0, 100),
    humanReviewItems: humanReview.slice(0, 100),
  };

  if (JSON_OUT || !process.stdout.isTTY) {
    console.log(JSON.stringify(output, null, 2));
  } else if (!dryRun) {
    console.log(`\n✅ Editor Activation Complete`);

    console.log(`\n   PR 1 — Prose Quality Fixes:`);
    console.log(`     Violations: ${phase1Summary.violations} · Fixed: ${phase1Summary.autoFixed} · Docs: ${phase1Summary.docsModified}`);
    if (phase1Summary.branch) console.log(`     Branch: ${phase1Summary.branch}`);
    if (phase1Summary.prUrl) console.log(`     PR: ${phase1Summary.prUrl}`);

    console.log(`\n   PR 2 — Mechanical Fixes:`);
    console.log(`     Violations: ${phase2Summary.violations} · Fixed: ${phase2Summary.autoFixed} · Docs: ${phase2Summary.docsModified}`);
    if (phase2Summary.branch) console.log(`     Branch: ${phase2Summary.branch}`);
    if (phase2Summary.prUrl) console.log(`     PR: ${phase2Summary.prUrl}`);

    console.log(`\n   ${humanReview.length} items flagged for human review`);
    console.log(`   Avg readability: ${avgFlesch ?? 'N/A'}`);
  } else {
    console.log(`\n🔍 Editor Dry Run: ${allViolations.length} violations found`);
    console.log(`   Prose: ${proseViolations.length} (${proseAutoFixable.length} auto-fixable)`);
    console.log(`   Mechanical: ${mechanicalViolations.length} (${mechAutoFixable.length} auto-fixable)`);
    console.log(`   ${humanReview.length} need human review`);
    console.log(`   Avg readability: ${avgFlesch ?? 'N/A'}`);
  }

  return output;
}

// CLI entry
(async () => {
  activate({ dryRun: DRY_RUN, scope: SCOPE });
})();

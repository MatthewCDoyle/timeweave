#!/usr/bin/env node
/**
 * scripts/strategist-activate.mjs
 * ============================================================================
 * The Strategist Pod — content strategy report + accessibility auto-fix.
 *
 * Phase 1: Reads build-report.json + search-data.json, runs the Strategist
 *          engine, writes static/data/strategy-report.json.
 * Phase 2: Scans docs for accessibility issues (missing alt-text), applies
 *          fixes, and creates a PR.
 *
 * Usage:
 *   node scripts/strategist-activate.mjs                    # full run
 *   node scripts/strategist-activate.mjs --dry-run           # report only
 *   node scripts/strategist-activate.mjs --scope=fs42-prg    # scope filter
 *   node scripts/strategist-activate.mjs --json              # JSON output
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
// Read i18n config from docusaurus.config.ts (simple regex extraction)
// ---------------------------------------------------------------------------
function readI18nConfig() {
  const configPath = path.join(workspaceRoot, 'docusaurus.config.ts');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    // Extract defaultLocale
    const defaultMatch = raw.match(/defaultLocale:\s*['"](\w+)['"]/);
    const defaultLocale = defaultMatch ? defaultMatch[1] : 'en';
    // Extract locales array
    const localesMatch = raw.match(/locales:\s*\[([^\]]*)\]/);
    let locales = ['en'];
    if (localesMatch) {
      locales = localesMatch[1]
        .split(',')
        .map(s => s.trim().replace(/['"]/g, ''))
        .filter(Boolean);
    }
    return { defaultLocale, locales };
  } catch {
    return { defaultLocale: 'en', locales: ['en'] };
  }
}

// ---------------------------------------------------------------------------
// Alt-text generator (heuristic from filename)
// ---------------------------------------------------------------------------
// AEM-published image URLs commonly take the form:
//   .../media/<asset-name>.<ext>/_jcr_content/renditions/cq5dam.web.WxH.<ext>
// The asset name (the meaningful slug) is the segment BEFORE `_jcr_content`,
// not the basename — which would be the rendition file `cq5dam.web...`.
// Returns the asset-name slug humanized; falls back to the basename for
// non-AEM URLs. ALT TEXT FROM A FILENAME IS A POOR APPROXIMATION — alt text
// derived this way is a PROPOSAL only; a human reviewer must approve each
// one before merge. See .github/case-study/insights.md.
function generateAltText(imgPath) {
  // Try AEM-style URLs first: find the asset name before _jcr_content
  const aemMatch = imgPath.match(/\/([^/]+?)\.[a-z]+\/_jcr_content\b/i);
  let raw;
  if (aemMatch) {
    raw = aemMatch[1];
  } else {
    raw = path.basename(imgPath).replace(/\.[^.]+$/, '');
  }
  // Strip common CMS-rendition prefixes that aren't meaningful as alt text
  raw = raw.replace(/^(g|t|c|r)[-_]/i, '');
  const humanized = raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
  // Reject obvious CMS-noise patterns (Cq5dam, jcr, rendition slugs)
  if (!humanized || /^(Cq5dam|Jcr|Rendition)/i.test(humanized) || /^\d+(\.\d+)+$/.test(humanized)) {
    return null; // no useful proposal; caller should flag for human authoring
  }
  return humanized;
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------
function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: workspaceRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
}
function gh(...ghArgs) {
  return execFileSync('gh', ghArgs, { cwd: workspaceRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function createBranchAndPR(changedFiles, branchName, commitMsg, prTitle, prBody, originalBranch) {
  let prUrl = null;

  const listFile = path.join(os.tmpdir(), `strategist-add-${Date.now()}.txt`);
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
// Main
// ---------------------------------------------------------------------------
export async function activate(options = {}) {
  const dryRun = options.dryRun ?? DRY_RUN;
  const scope = options.scope ?? SCOPE;

  const scanRoot = scope ? path.join(docsRoot, scope) : docsRoot;
  if (scope && !fs.existsSync(scanRoot)) {
    throw new Error(`Scope folder not found: ${scanRoot}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const suffix = scope ? `-${scope.replace(/[\/\\]/g, '-')}` : '';
  const scopeLabel = scope ? `docs/${scope}` : 'all docs';

  // Git setup (shared by PR phase)
  let originalBranch = 'main';
  if (!dryRun) {
    try { git('config', 'user.name'); } catch { git('config', 'user.name', 'strategist-bot'); }
    try { git('config', 'user.email'); } catch { git('config', 'user.email', 'strategist@local'); }
    try { originalBranch = git('branch', '--show-current'); } catch { /* keep main */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1: Strategy report generation
  // ═══════════════════════════════════════════════════════════════════════
  const reportPath = path.join(workspaceRoot, 'static', 'build-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error('build-report.json not found. Run npm run build-report first.');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  let searchDocs;
  const sdPath = path.join(workspaceRoot, 'static', 'data', 'search-data.json');
  try {
    const sd = JSON.parse(fs.readFileSync(sdPath, 'utf8'));
    searchDocs = sd.documents;
  } catch { /* ignore */ }

  const i18n = readI18nConfig();

  const { runStrategist } = await import('../src/agents/strategist/strategist.mjs');
  const strategyResult = runStrategist(report, { searchDocs, i18n, searchLog: { queries: [], missedSearches: [] } });

  if (!dryRun) {
    const outDir = path.join(workspaceRoot, 'static', 'data');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'strategy-report.json');
    fs.writeFileSync(outPath, JSON.stringify(strategyResult, null, 2));
    strategyResult._outputPath = outPath;
  }

  const phase1Summary = {
    label: 'Strategy Report',
    recommendations: strategyResult.recommendations?.length || 0,
    outputPath: strategyResult._outputPath || null,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2: Accessibility / alt-text fixes (PR)
  // ═══════════════════════════════════════════════════════════════════════
  const files = walk(scanRoot);
  const a11yFindings = [];
  const changedFiles = [];
  let altTextFixed = 0;
  let htmlAltFlagged = 0;

  for (const filePath of files) {
    let raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    let modified = false;

    // Markdown images: ![](path) → propose ![Alt Text](path) when the
    // filename gives us a usable hint; otherwise flag for human authoring.
    // Auto-applying alt text derived from CMS filenames produces worse
    // accessibility than empty alt (screen readers announce noise like
    // "Cq5dam dot Web dot 1280 dot 1280"). When we DO auto-apply, the PR
    // is a PROPOSAL — every line needs human review before merge.
    const mdImgRe = /!\[\s*\]\(([^)]+)\)/g;
    let match;
    while ((match = mdImgRe.exec(raw)) !== null) {
      const imgPath = match[1];
      const alt = generateAltText(imgPath);
      const canAutoApply = alt !== null;
      a11yFindings.push({
        file: relPath, issue: 'missing-alt-text', severity: 'P1',
        detail: `Image ${imgPath} missing alt-text`,
        fix: alt,
        suggestedFix: alt,
        autoFixable: canAutoApply,
        ...(canAutoApply ? {} : { reason: 'no useful alt-text derivable from URL; human authoring required' }),
      });
      if (!dryRun && canAutoApply) {
        raw = raw.replace(match[0], `![${alt}](${imgPath})`);
        modified = true;
        altTextFixed++;
      }
    }

    // HTML img tags without alt — flag only (no auto-apply)
    const htmlImgRe = /<img\b([^>]*)>/gi;
    while ((match = htmlImgRe.exec(raw)) !== null) {
      const attrs = match[1];
      if (!attrs.includes('alt=') || /alt=["']\s*["']/i.test(attrs)) {
        const srcMatch = attrs.match(/src=["']([^"']+)["']/);
        const src = srcMatch ? srcMatch[1] : 'unknown';
        a11yFindings.push({
          file: relPath, issue: 'missing-alt-text-html', severity: 'P1',
          detail: `HTML img ${src} missing alt-text`,
          suggestedFix: generateAltText(src),
          autoFixable: false,
        });
        htmlAltFlagged++;
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, raw, 'utf8');
      changedFiles.push(filePath);
    }
  }

  const phase2Summary = {
    label: 'Accessibility Fixes',
    docsModified: changedFiles.length,
    altTextFixed,
    htmlAltFlagged,
    totalFindings: a11yFindings.length,
    branch: null,
    prUrl: null,
  };

  // Create Phase 2 PR
  if (!dryRun && changedFiles.length > 0) {
    try {
      const branchName = `strategist/a11y-proposals${suffix}-${date}`;
      const commitMsg = `strategist: propose alt-text for ${altTextFixed} images in ${scopeLabel} (${date})`;
      const prTitle = `Strategist: PROPOSE alt-text for ${altTextFixed} images (${scopeLabel})`;
      const prBody = [
        '## ⚠️ Accessibility — PROPOSED alt-text, not finished work',
        '',
        '**This PR contains PROPOSALS, not auto-fixes.** Every alt-text line in the diff was derived from a filename heuristic and is almost certainly inadequate for WCAG 2.2. Treat this PR as a worksheet:',
        '',
        '1. Read each `![Alt-Text](url)` change in the diff',
        '2. Replace each one with a description that actually conveys the image\'s meaning to a screen-reader user',
        '3. Reject (revert) any image where the proposed text is worse than empty alt',
        '4. Merge only after every line is human-authored',
        '',
        `**Scope:** ${scopeLabel}`,
        `**Files touched:** ${changedFiles.length}`,
        `**Alt-text proposals:** ${altTextFixed}`,
        `**HTML img flagged (no proposal — author manually):** ${htmlAltFlagged}`,
        `**Date:** ${date}`,
        '',
        '### Why filename-derived alt text is risky',
        '',
        'Screen readers announce alt text verbatim. A filename slug like `Cq5dam.Web.1280.1280` becomes "Cq5dam dot Web dot 1280 dot 1280" in the reader\'s voice — worse than empty alt (which is decoratively skipped). The generator now reaches for the AEM asset name behind `_jcr_content` paths, but even that yields generic slugs like "Aurora Licensing Menu" instead of real descriptions like "Aurora Focus device licensing tab with PKID entry and Number of Seats fields."',
        '',
        '> Body content only — no frontmatter changes.',
        '> See [.github/case-study/insights.md](.github/case-study/insights.md) for the auto-remediation hazard pattern.',
      ].join('\n');

      const gitResult = createBranchAndPR(changedFiles, branchName, commitMsg, prTitle, prBody, originalBranch);
      phase2Summary.branch = gitResult.branchName;
      phase2Summary.prUrl = gitResult.prUrl;
    } catch (err) {
      phase2Summary.branch = `(git error: ${err.message})`;
    }
  }

  return {
    pod: 'STRATEGIST',
    dryRun,
    scope: scope || 'all',
    date,
    phase1: phase1Summary,
    phase2: phase2Summary,
    strategy: strategyResult,
    a11yFindings: a11yFindings.slice(0, 200),
  };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
if (process.argv[1]?.replace(/\\/g, '/').endsWith('strategist-activate.mjs')) {
  (async () => {
    try {
      const result = await activate({ dryRun: DRY_RUN, scope: SCOPE });
      if (JSON_OUT || DRY_RUN) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n[STRATEGIST] Activation complete.`);

        // Phase 1
        console.log(`\n  Phase 1 — Strategy Report:`);
        console.log(`    Recommendations: ${result.phase1.recommendations}`);
        if (result.phase1.outputPath) console.log(`    Written to: ${result.phase1.outputPath}`);

        // Phase 2
        console.log(`\n  Phase 2 — Accessibility Fixes:`);
        console.log(`    Docs modified: ${result.phase2.docsModified}`);
        console.log(`    Alt-text fixed: ${result.phase2.altTextFixed}`);
        console.log(`    HTML img flagged: ${result.phase2.htmlAltFlagged}`);
        if (result.phase2.branch) console.log(`    Branch: ${result.phase2.branch}`);
        if (result.phase2.prUrl) console.log(`    PR: ${result.phase2.prUrl}`);
      }
    } catch (err) {
      console.error('[STRATEGIST] Error:', err.message);
      process.exit(1);
    }
  })();
}

#!/usr/bin/env node
/**
 * scripts/gatekeeper-activate.mjs
 * ============================================================================
 * The Gatekeeper Pod — engineering gate scanner.
 *
 * Scans docs for build-integrity issues (duplicate slugs, broken images,
 * engineering gate failures. Flags/escalates
 * only — does NOT create PRs.
 *
 * Usage:
 *   node scripts/gatekeeper-activate.mjs                  # full scan
 *   node scripts/gatekeeper-activate.mjs --dry-run         # report only
 *   node scripts/gatekeeper-activate.mjs --scope=fs42-prg  # scope filter
 *   node scripts/gatekeeper-activate.mjs --json            # JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
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
// Frontmatter parser (slug + title extraction only)
// ---------------------------------------------------------------------------
function parseFrontMatter(content) {
  if (!content.startsWith('---\n')) return { frontMatter: {}, body: content };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { frontMatter: {}, body: content };
  const raw = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontMatter = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    frontMatter[key] = val;
  }
  return { frontMatter, body };
}

// ---------------------------------------------------------------------------
// Engineering gate checks
// ---------------------------------------------------------------------------

/** Detect duplicate slugs across all docs */
function checkDuplicateSlugs(files) {
  const slugMap = {};
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const { frontMatter } = parseFrontMatter(raw);
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const slug = frontMatter.slug || relPath.replace(/\.(mdx?|md)$/i, '').replace(/\/index$/, '');
    (slugMap[slug] = slugMap[slug] || []).push(relPath);
  }
  return Object.entries(slugMap)
    .filter(([, paths]) => paths.length > 1)
    .map(([slug, paths]) => ({
      issue: 'duplicate-slug',
      severity: 'P1',
      slug,
      files: paths,
      detail: `Slug "${slug}" used by ${paths.length} files`,
    }));
}

/** Detect duplicate titles across all docs */
function checkDuplicateTitles(files) {
  const titleMap = {};
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const { frontMatter } = parseFrontMatter(raw);
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const title = frontMatter.title;
    if (title) {
      (titleMap[title] = titleMap[title] || []).push(relPath);
    }
  }
  return Object.entries(titleMap)
    .filter(([, paths]) => paths.length > 1)
    .map(([title, paths]) => ({
      issue: 'duplicate-title',
      severity: 'P2',
      title,
      files: paths,
      detail: `Title "${title}" used by ${paths.length} files`,
    }));
}

/** Detect broken image references */
function checkBrokenImages(files) {
  const findings = [];
  const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const dir = path.dirname(filePath);
    let match;
    while ((match = imgRe.exec(raw)) !== null) {
      const imgRef = match[1].split('#')[0].split('?')[0]; // strip anchors/params
      if (/^https?:\/\//i.test(imgRef)) continue; // skip external
      const resolved = path.resolve(dir, imgRef);
      // Also check in static/img
      const staticResolved = path.join(workspaceRoot, 'static', imgRef.replace(/^\//, ''));
      if (!fs.existsSync(resolved) && !fs.existsSync(staticResolved)) {
        findings.push({
          issue: 'broken-image',
          severity: 'P1',
          file: relPath,
          image: imgRef,
          detail: `Image not found: ${imgRef}`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Build report integration — read ENG test results if available
// ---------------------------------------------------------------------------
function readEngTests() {
  const reportPath = path.join(workspaceRoot, 'static', 'build-report.json');
  if (!fs.existsSync(reportPath)) return { available: false, tests: [] };

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const tests = report.engineering?.tests || [];
    return { available: true, tests };
  } catch {
    return { available: false, tests: [] };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function activate(options = {}) {
  const dryRun = options.dryRun ?? DRY_RUN;
  const scope = options.scope ?? SCOPE;

  let scanRoot = docsRoot;
  if (scope) {
    const scoped = path.join(docsRoot, scope);
    if (fs.existsSync(scoped)) scanRoot = scoped;
  }

  if (!fs.existsSync(scanRoot)) {
    throw new Error(`docs/ directory not found at ${scanRoot}`);
  }

  const files = walk(scanRoot);
  const date = new Date().toISOString().slice(0, 10);
  const scopeLabel = scope ? `docs/${scope}` : 'all docs';

  // ═══════════════════════════════════════════════════════════════════════
  // Engineering gate checks
  // ═══════════════════════════════════════════════════════════════════════
  const duplicateSlugs = checkDuplicateSlugs(files);
  const duplicateTitles = checkDuplicateTitles(files);
  const brokenImages = checkBrokenImages(files);

  // ═══════════════════════════════════════════════════════════════════════
  // Build report ENG test results
  // ═══════════════════════════════════════════════════════════════════════
  const engTests = readEngTests();

  // ═══════════════════════════════════════════════════════════════════════
  // Compute stability score
  // ═══════════════════════════════════════════════════════════════════════
  const totalIssues = duplicateSlugs.length + brokenImages.length;
  const stabilityScore = files.length > 0
    ? Math.round((1 - totalIssues / files.length) * 100 * 10) / 10
    : 100;

  // ═══════════════════════════════════════════════════════════════════════
  // Build escalation list (flags only — Gatekeeper does not create PRs)
  // ═══════════════════════════════════════════════════════════════════════
  const escalations = [];

  if (stabilityScore < 95) {
    escalations.push({
      alertId: 'GK-STABILITY',
      severity: 'P0',
      type: 'ESCALATE',
      detail: `Global stability ${stabilityScore}% is below 95% threshold`,
    });
  }

  for (const ds of duplicateSlugs) {
    escalations.push({
      alertId: `GK-SLUG-${ds.slug}`,
      severity: 'P1',
      type: 'FLAG',
      detail: ds.detail,
      files: ds.files,
    });
  }

  for (const bi of brokenImages) {
    escalations.push({
      alertId: `GK-IMG-${bi.file}`,
      severity: 'P1',
      type: 'FLAG',
      detail: bi.detail,
    });
  }

  for (const dt of duplicateTitles) {
    escalations.push({
      alertId: `GK-TITLE-${dt.title.slice(0, 30)}`,
      severity: 'P2',
      type: 'FLAG',
      detail: dt.detail,
      files: dt.files,
    });
  }

  // Failed ENG tests
  if (engTests.available) {
    const failed = engTests.tests.filter(t => t.status === 'FAIL');
    for (const t of failed) {
      escalations.push({
        alertId: `GK-ENG-${t.id || t.testId}`,
        severity: t.severity || 'P1',
        type: 'ESCALATE',
        detail: `Engineering test ${t.id || t.testId} FAILED: ${t.label || t.description || ''}`,
      });
    }
  }

  const output = {
    pod: 'GATEKEEPER',
    dryRun,
    scope: scope || 'all',
    date,
    filesScanned: files.length,
    stabilityScore,
    buildIntegrity: {
      duplicateSlugs: duplicateSlugs.length,
      duplicateTitles: duplicateTitles.length,
      brokenImages: brokenImages.length,
    },
    engTests: {
      available: engTests.available,
      total: engTests.tests.length,
      passed: engTests.tests.filter(t => t.status === 'PASS').length,
      failed: engTests.tests.filter(t => t.status === 'FAIL').length,
    },
    escalations,
    findings: [
      ...duplicateSlugs,
      ...duplicateTitles,
      ...brokenImages,
    ].slice(0, 300),
  };

  return output;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
if (process.argv[1]?.replace(/\\/g, '/').endsWith('gatekeeper-activate.mjs')) {
  try {
    const result = activate({ dryRun: DRY_RUN, scope: SCOPE });
    if (JSON_OUT || DRY_RUN) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n[GATEKEEPER] Engineering gate scan complete.`);
      console.log(`  Files scanned: ${result.filesScanned}`);
      console.log(`  Stability score: ${result.stabilityScore}%`);
      console.log(`  Duplicate slugs: ${result.buildIntegrity.duplicateSlugs}`);
      console.log(`  Duplicate titles: ${result.buildIntegrity.duplicateTitles}`);
      console.log(`  Broken images: ${result.buildIntegrity.brokenImages}`);
      if (result.engTests.available) {
        console.log(`  ENG tests: ${result.engTests.passed} passed, ${result.engTests.failed} failed`);
      }
      console.log(`  Escalations: ${result.escalations.length}`);
    }
  } catch (err) {
    console.error('[GATEKEEPER] Error:', err.message);
    process.exit(1);
  }
}

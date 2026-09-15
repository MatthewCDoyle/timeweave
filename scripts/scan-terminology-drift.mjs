#!/usr/bin/env node
/**
 * scripts/scan-terminology-drift.mjs
 * ============================================================================
 * Walks every .md/.mdx file under docs/ and finds usages of variant terms
 * declared in .content/terminology-map.json. Emits a drift report.
 *
 * For each match, we record:
 *   - file path (repo-relative)
 *   - line number
 *   - the variant text matched
 *   - the canonical replacement
 *   - the rule that governs it (e.g., RULE-019)
 *   - the severity (high|medium|low)
 *
 * Excludes:
 *   - Frontmatter (between leading --- / --- markers)
 *   - Fenced code blocks (``` ... ```)
 *   - Inline code spans (`...`)  — best-effort, single line only
 *
 * Word boundaries: variants are matched with \b on each side. Variants
 * containing punctuation (e.g. "e.g.") have those chars escaped. Matching
 * is case-sensitive — TCM rules are case-specific (e.g., "internet" vs
 * "Internet" are intentionally distinguished).
 *
 * Usage:
 *   node scripts/scan-terminology-drift.mjs
 *   node scripts/scan-terminology-drift.mjs --scope=fs10-prg
 *   node scripts/scan-terminology-drift.mjs --json     # machine-readable
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const root       = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const flag = (k, def) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m ? m.split('=').slice(1).join('=') : def;
};
const JSON_OUT = args.includes('--json');
const SCOPE    = flag('scope', null);
const mapPath    = path.resolve(root, flag('map',    '.content/terminology-map.json'));
const docsRoot   = path.resolve(root, flag('docs',   'docs'));
const outputPath = path.resolve(root, flag('output', 'static/data/terminology-drift.json'));

// --- Map loading -----------------------------------------------------------

if (!fs.existsSync(mapPath)) {
  console.error(`✗ Terminology map not found at ${mapPath}.`);
  console.error(`  Run \`node scripts/generate-terminology-map.mjs\` first.`);
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const terms = map.terms || [];

// Build a flat variant→entry index to drive a single regex pass per file.
// Some variants appear under multiple canonicals; we keep all attributions.
const variantIndex = new Map();   // lower-cased variant → array of entries
for (const t of terms) {
  for (const v of t.variants) {
    const key = v;
    if (!variantIndex.has(key)) variantIndex.set(key, []);
    variantIndex.get(key).push({
      canonical: t.canonical,
      ruleId:    t.ruleId,
      severity:  t.severity,
      note:      t.note || null,
    });
  }
}

// Sort variants by length descending so longer phrases match before shorter
// substrings ("bar code" before "code"). Build one combined regex.
const sortedVariants = [...variantIndex.keys()].sort((a, b) => b.length - a.length);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// We use lookarounds for word-ish boundaries. Variants like "w/" don't have
// trailing word chars, so we use a permissive non-letter boundary.
const pattern = sortedVariants.map((v) => `(?<![A-Za-z0-9_])${escape(v)}(?![A-Za-z0-9_])`).join('|');
const variantRe = sortedVariants.length ? new RegExp(pattern, 'g') : null;

// --- File walker -----------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(md|mdx)$/i.test(e.name)) out.push(full);
  }
  return out;
}

// --- Per-file scan ---------------------------------------------------------

function stripExclusions(text) {
  // Returns the same length string but with frontmatter / code blocks /
  // inline code replaced by spaces, so line numbers are preserved.
  const lines = text.split(/\r?\n/);
  let inFrontmatter = false;
  let inFence = false;
  let frontmatterClosedAt = -1;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Frontmatter: leading --- on line 0 opens, next --- closes
    if (i === 0 && line.trim() === '---') { inFrontmatter = true; lines[i] = ' '.repeat(line.length); continue; }
    if (inFrontmatter) {
      lines[i] = ' '.repeat(line.length);
      if (line.trim() === '---') { inFrontmatter = false; frontmatterClosedAt = i; }
      continue;
    }

    // Fenced code blocks (``` or ~~~)
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      lines[i] = ' '.repeat(line.length);
      continue;
    }
    if (inFence) { lines[i] = ' '.repeat(line.length); continue; }

    // Inline code spans on a single line (`...`)
    line = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    lines[i] = line;
  }

  return lines.join('\n');
}

function scanFile(filePath, relPath) {
  if (!variantRe) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const cleaned = stripExclusions(raw);
  const findings = [];
  const lines = cleaned.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    variantRe.lastIndex = 0;
    while ((m = variantRe.exec(line)) !== null) {
      const variant = m[0];
      const attribs = variantIndex.get(variant) || [];
      for (const a of attribs) {
        // Skip if the matched variant equals its own canonical (case-sensitive
        // identity — e.g., "internet" canonical, "internet" not in variants).
        if (variant === a.canonical) continue;
        findings.push({
          file: relPath,
          line: i + 1,
          column: m.index + 1,
          variant,
          canonical: a.canonical,
          ruleId: a.ruleId,
          severity: a.severity,
          ...(a.note ? { note: a.note } : {}),
        });
      }
    }
  }
  return findings;
}

// --- Main ------------------------------------------------------------------

const scanRoot = SCOPE ? path.join(docsRoot, SCOPE) : docsRoot;
if (!fs.existsSync(scanRoot)) {
  console.error(`✗ Scan root not found: ${scanRoot}`);
  process.exit(1);
}

const files = walk(scanRoot);
const allFindings = [];
const perFileCounts = {};

for (const filePath of files) {
  const relPath = path.relative(root, filePath).replace(/\\/g, '/');
  const findings = scanFile(filePath, relPath);
  if (findings.length) {
    perFileCounts[relPath] = findings.length;
    allFindings.push(...findings);
  }
}

// Aggregate views
const byVariant = {};
const byCanonical = {};
const byRule = {};
const bySeverity = { high: 0, medium: 0, low: 0 };

for (const f of allFindings) {
  byVariant[f.variant]    = (byVariant[f.variant]    || 0) + 1;
  byCanonical[f.canonical] = (byCanonical[f.canonical] || 0) + 1;
  byRule[f.ruleId]        = (byRule[f.ruleId]        || 0) + 1;
  if (f.severity in bySeverity) bySeverity[f.severity]++;
}

const sortedFiles = Object.entries(perFileCounts).sort((a, b) => b[1] - a[1]);
const sortedVariantsOut = Object.entries(byVariant).sort((a, b) => b[1] - a[1]);
const sortedRules = Object.entries(byRule).sort((a, b) => b[1] - a[1]);

const report = {
  generatedAt: new Date().toISOString(),
  scope: SCOPE || 'all',
  filesScanned: files.length,
  filesWithDrift: Object.keys(perFileCounts).length,
  totalFindings: allFindings.length,
  bySeverity,
  byRule,
  byVariant,
  byCanonical,
  topFiles: sortedFiles.slice(0, 25).map(([file, count]) => ({ file, count })),
  topVariants: sortedVariantsOut.slice(0, 25).map(([variant, count]) => ({ variant, count })),
  findings: allFindings.slice(0, 1000),         // cap to keep file sane
  truncated: allFindings.length > 1000,
  sourceMapSha: map.sourceRulesFileSha || null,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const pct = files.length ? Math.round((Object.keys(perFileCounts).length / files.length) * 100) : 0;
  console.log(`✓ Drift scan complete → ${path.relative(root, outputPath).replace(/\\/g, '/')}`);
  console.log(`  Files scanned:    ${files.length}${SCOPE ? ` (scope=${SCOPE})` : ''}`);
  console.log(`  Files with drift: ${Object.keys(perFileCounts).length} (${pct}%)`);
  console.log(`  Total findings:   ${allFindings.length}`);
  console.log(`  Severity:         high=${bySeverity.high} · medium=${bySeverity.medium} · low=${bySeverity.low}`);
  console.log('');
  console.log('  Top variants by frequency:');
  for (const [variant, count] of sortedVariantsOut.slice(0, 10)) {
    console.log(`    ${String(count).padStart(5)} × "${variant}"`);
  }
  console.log('');
  console.log('  Top files:');
  for (const [file, count] of sortedFiles.slice(0, 10)) {
    console.log(`    ${String(count).padStart(4)}  ${file}`);
  }
  console.log('');
  console.log('  Rules with most violations:');
  for (const [ruleId, count] of sortedRules.slice(0, 5)) {
    console.log(`    ${String(count).padStart(5)}  ${ruleId}`);
  }
}

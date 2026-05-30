#!/usr/bin/env node
/**
 * scripts/dita-loss-scanner.mjs
 * ============================================================================
 * Scans converted DITA→Markdown docs for semantic loss artifacts.
 *
 * Usage:
 *   node scripts/dita-loss-scanner.mjs                       # scan all docs
 *   node scripts/dita-loss-scanner.mjs --scope=fs10-prg      # one folder
 *   node scripts/dita-loss-scanner.mjs --json                 # JSON output
 *   node scripts/dita-loss-scanner.mjs --out=report.json      # write to file
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(workspaceRoot, 'docs');

// CLI
const args = process.argv.slice(2);
const SCOPE = args.find(a => a.startsWith('--scope='))?.split('=')[1] || null;
const JSON_OUT = args.includes('--json');
const OUT_FILE = args.find(a => a.startsWith('--out='))?.split('=')[1] || null;

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(mdx|md)$/i.test(e.name) && !e.name.startsWith('_')) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test definitions — each returns an array of findings for one file
// ---------------------------------------------------------------------------

/** DL-01: Tables rendered as plaintext (no pipe delimiters) */
function testBrokenTables(body, lines) {
  const findings = [];
  // Look for sequences of short lines that alternate label/value
  // without any pipe characters — hallmark of destroyed tables
  const hasAnyTable = /\|.*\|/.test(body);

  // Heuristic: 3+ consecutive short lines (<80 chars) with no pipes,
  // where at least one looks like a spec label (ends with colon or is Title Case)
  let run = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length > 0 && t.length < 80 && !t.includes('|') &&
        !t.startsWith('#') && !t.startsWith('```') && !t.startsWith(':::') &&
        !t.startsWith('import ') && !t.startsWith('- ') && !t.startsWith('> ') &&
        !/^\d+\.\s/.test(t)) {
      run.push(i + 1); // 1-indexed
    } else {
      if (run.length >= 4) {
        findings.push({
          test: 'DL-01', label: 'Table rendered as plaintext',
          lines: [run[0], run[run.length - 1]],
          detail: `${run.length} consecutive bare-text lines (likely a destroyed table)`,
        });
      }
      run = [];
    }
  }
  if (run.length >= 4) {
    findings.push({
      test: 'DL-01', label: 'Table rendered as plaintext',
      lines: [run[0], run[run.length - 1]],
      detail: `${run.length} consecutive bare-text lines (likely a destroyed table)`,
    });
  }
  return findings;
}

/** DL-02: Missing admonitions (note/caution/warning as plain text) */
function testMissingAdmonitions(body, lines) {
  const findings = [];
  const admonRe = /^(Note|Caution|Warning|Important|Danger|Tip|Notice)\s*[:.]?\s/i;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // Skip if already inside an admonition block
    if (t.startsWith(':::')) continue;
    if (admonRe.test(t)) {
      // Check if previous line is ::: opener
      const prev = i > 0 ? lines[i - 1].trim() : '';
      if (!prev.startsWith(':::')) {
        const match = t.match(admonRe);
        findings.push({
          test: 'DL-02', label: 'Missing admonition wrapper',
          lines: [i + 1],
          detail: `"${match[1]}" should be wrapped in :::${match[1].toLowerCase()} block`,
        });
      }
    }
  }
  return findings;
}

/** DL-03: Duplicate list content (list + plaintext copy) */
function testDuplicateContent(body, lines) {
  const findings = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('- ') || t.length < 8) continue;
    const listText = t.slice(2).trim();
    // Look ahead for the same text without the bullet
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const cand = lines[j].trim();
      if (cand === listText && cand.length > 5) {
        findings.push({
          test: 'DL-03', label: 'Duplicate list content',
          lines: [i + 1, j + 1],
          detail: `List item duplicated as plaintext: "${listText.slice(0, 60)}..."`,
        });
        break;
      }
    }
  }
  return findings;
}

/** DL-04: Empty body / gutted content */
function testEmptyBody(body, lines, fm) {
  const findings = [];
  // Strip blank lines and imports
  const meaningful = lines.filter(l => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('import ') && !t.startsWith('#');
  });
  if (meaningful.length < 3) {
    findings.push({
      test: 'DL-04', label: 'Empty/gutted body content',
      lines: [1],
      detail: `Only ${meaningful.length} meaningful line(s) in body`,
    });
  }
  // Check for recovered-content sentinel
  if (fm.includes('Recovered content') || fm.includes('Manual restoration')) {
    findings.push({
      test: 'DL-04', label: 'Recovered content sentinel',
      lines: [1],
      detail: 'Description indicates body was lost and partially recovered',
    });
  }
  return findings;
}

/** DL-05: Orphaned HTML entities from DITA */
function testOrphanedEntities(body, lines) {
  const findings = [];
  const entityRe = /&(lt|gt|amp|quot|apos);/g;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    // Skip code blocks
    if (t.trim().startsWith('```')) continue;
    let m;
    while ((m = entityRe.exec(t)) !== null) {
      findings.push({
        test: 'DL-05', label: 'Orphaned HTML entity',
        lines: [i + 1],
        detail: `"${m[0]}" should be literal character in markdown`,
      });
    }
    entityRe.lastIndex = 0;
  }
  return findings;
}

/** DL-06: Code fencing errors */
function testFencingErrors(body, lines) {
  const findings = [];
  let inFence = false;
  let fenceStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('```')) {
      if (!inFence) {
        inFence = true;
        fenceStart = i + 1;
      } else {
        inFence = false;
      }
    }
  }
  if (inFence) {
    findings.push({
      test: 'DL-06', label: 'Unclosed code fence',
      lines: [fenceStart],
      detail: `Code fence opened at line ${fenceStart} never closed`,
    });
  }
  return findings;
}

/** DL-07: Empty headings (## with no content before next heading) */
function testEmptyHeadings(body, lines) {
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('#')) continue;
    // Look for content between this heading and the next heading or EOF
    let hasContent = false;
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j].trim();
      if (n.startsWith('#')) break;
      if (n.length > 0 && !n.startsWith('import ')) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      findings.push({
        test: 'DL-07', label: 'Empty heading (no content)',
        lines: [i + 1],
        detail: `Heading "${t.slice(0, 60)}" has no content beneath it`,
      });
    }
  }
  return findings;
}

/** DL-08: Orphaned DITA/HTML tags still in markdown */
function testOrphanedTags(body, lines) {
  const findings = [];
  const tagRe = /<\/?(p|ul|ol|li|table|tr|td|th|tbody|thead|note|prereq|result|context|cmd|uicontrol|menucascade|stepresult|postreq|fig|image|xref|section|body|shortdesc|conbody|taskbody|concept|task|reference|refbody)[\s>]/gi;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    let m;
    while ((m = tagRe.exec(lines[i])) !== null) {
      findings.push({
        test: 'DL-08', label: 'Orphaned DITA/HTML tag',
        lines: [i + 1],
        detail: `Raw tag "${m[0].trim()}" found outside code block`,
      });
    }
    tagRe.lastIndex = 0;
  }
  return findings;
}

/** DL-09: Title echoed in body */
function testTitleEcho(body, lines, fm) {
  const findings = [];
  const titleMatch = fm.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
  if (!titleMatch) return findings;
  const title = titleMatch[1].trim();
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const t = lines[i].trim();
    if (t === title || t === `# ${title}`) {
      findings.push({
        test: 'DL-09', label: 'Title echoed in body',
        lines: [i + 1],
        detail: `Body repeats frontmatter title "${title.slice(0, 50)}"`,
      });
      break;
    }
  }
  return findings;
}

/** DL-10: Broken ordered lists / procedures losing numbering */
function testBrokenProcedures(body, lines) {
  const findings = [];
  // Detect bullet lists where items start with "Step N" or ordinal words
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('- ') && /^-\s+(Step\s+\d|First,?\s|Second,?\s|Third,?\s|Then,?\s|Next,?\s|Finally,?\s)/i.test(t)) {
      findings.push({
        test: 'DL-10', label: 'Procedure lost numbering',
        lines: [i + 1],
        detail: `Bullet list item appears to be a numbered step: "${t.slice(0, 60)}"`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// DL-11: Style-rule violations (Editor pod's rule registry surfaced here so
// the semantic-loss report has a unified view of "what's wrong with the
// corpus." Loaded lazily; if the registry is missing, the test no-ops
// instead of failing the scan.
// ---------------------------------------------------------------------------
let _ruleRegistry = null;
function loadRuleRegistry() {
  if (_ruleRegistry !== null) return _ruleRegistry;   // cached (or false on miss)
  const regPath = path.join(workspaceRoot, '.content', 'rule-registry.json');
  if (!fs.existsSync(regPath)) {
    _ruleRegistry = false;
    return false;
  }
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const compiled = [];
    for (const rule of reg.rules || []) {
      for (const p of rule.patterns || []) {
        compiled.push({
          id:       rule.id,
          severity: rule.severity,
          category: rule.category,
          re:       new RegExp(p.regex, p.flags || 'g'),
          msg:      p.msg || '',
        });
      }
    }
    _ruleRegistry = { compiled, sourceRulesFileSha: reg.sourceRulesFileSha };
  } catch {
    _ruleRegistry = false;
  }
  return _ruleRegistry;
}

/**
 * Strip code blocks, inline code, frontmatter, and HTML/MDX tags from body
 * so style-rule patterns don't fire inside code samples or markup. Mirrors
 * the editor-activate extractProse() behavior so DL-11 hits align with what
 * the Editor pod would produce.
 */
function extractStyleRuleProse(body) {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/<[^>]+>/g, '');
}

/** DL-11: Style-rule violations — surfaces Editor pod's rule-registry hits */
function testStyleRuleViolations(body, lines, _fm) {
  const reg = loadRuleRegistry();
  if (!reg) return [];

  const prose = extractStyleRuleProse(body);
  const proseLines = prose.split('\n');
  const findings = [];

  for (const rule of reg.compiled) {
    for (let i = 0; i < proseLines.length; i++) {
      const line = proseLines[i];
      if (!line.trim()) continue;
      const re = new RegExp(rule.re.source, rule.re.flags);
      let m;
      while ((m = re.exec(line)) !== null) {
        findings.push({
          test:   'DL-11',
          label:  'Style-rule violation',
          lines:  [i + 1],
          detail: `${rule.id} (${rule.severity || 'n/a'}): ${rule.msg || 'pattern matched'} — "${m[0]}"`,
        });
        if (!re.global) break;
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// All tests
// ---------------------------------------------------------------------------
const ALL_TESTS = [
  testBrokenTables,
  testMissingAdmonitions,
  testDuplicateContent,
  testEmptyBody,
  testOrphanedEntities,
  testFencingErrors,
  testEmptyHeadings,
  testOrphanedTags,
  testTitleEcho,
  testBrokenProcedures,
  testStyleRuleViolations,
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function scan(scopeFolder) {
  const scanRoot = scopeFolder ? path.join(docsRoot, scopeFolder) : docsRoot;
  if (!fs.existsSync(scanRoot)) {
    console.error(`Folder not found: ${scanRoot}`);
    process.exit(1);
  }

  const files = walk(scanRoot);
  const results = [];
  const summary = {
    scope: scopeFolder || 'all',
    totalFiles: files.length,
    filesWithIssues: 0,
    totalFindings: 0,
    byTest: {},
  };

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const normalized = raw.replace(/\r\n/g, '\n');

    // Split frontmatter from body
    let fm = '', body = normalized;
    if (normalized.startsWith('---\n')) {
      const end = normalized.indexOf('\n---\n', 4);
      if (end !== -1) {
        fm = normalized.slice(4, end);
        body = normalized.slice(end + 5);
      }
    }

    const lines = body.split('\n');
    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const fileFindings = [];

    for (const testFn of ALL_TESTS) {
      const hits = testFn(body, lines, fm);
      fileFindings.push(...hits);
    }

    if (fileFindings.length > 0) {
      summary.filesWithIssues++;
      summary.totalFindings += fileFindings.length;
      results.push({ file: relPath, findings: fileFindings });
      for (const f of fileFindings) {
        summary.byTest[f.test] = (summary.byTest[f.test] || 0) + 1;
      }
    }
  }

  return { summary, results };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
const { summary, results } = scan(SCOPE);

if (OUT_FILE) {
  const outPath = path.resolve(workspaceRoot, OUT_FILE);
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), 'utf8');
  console.log(`Report written to ${outPath}`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, results }, null, 2));
} else {
  console.log(`\n🔍 DITA Semantic Loss Scan — scope: ${summary.scope}`);
  console.log(`   Files scanned: ${summary.totalFiles}`);
  console.log(`   Files with issues: ${summary.filesWithIssues}`);
  console.log(`   Total findings: ${summary.totalFindings}`);
  console.log(`\n   By test:`);

  const testLabels = {
    'DL-01': 'Tables as plaintext',
    'DL-02': 'Missing admonitions',
    'DL-03': 'Duplicate list content',
    'DL-04': 'Empty/gutted body',
    'DL-05': 'Orphaned HTML entities',
    'DL-06': 'Unclosed code fences',
    'DL-07': 'Empty headings',
    'DL-08': 'Orphaned DITA/HTML tags',
    'DL-09': 'Title echoed in body',
    'DL-10': 'Broken procedures',
    'DL-11': 'Style-rule violations',
  };

  for (const [test, count] of Object.entries(summary.byTest).sort()) {
    console.log(`     ${test} ${testLabels[test] || ''}: ${count}`);
  }

  console.log(`\n   Top affected files:`);
  const sorted = [...results].sort((a, b) => b.findings.length - a.findings.length);
  for (const r of sorted.slice(0, 15)) {
    console.log(`     ${r.file} (${r.findings.length} issues)`);
    for (const f of r.findings.slice(0, 3)) {
      console.log(`       ${f.test} L${Array.isArray(f.lines) ? f.lines.join('-') : f.lines}: ${f.detail}`);
    }
    if (r.findings.length > 3) console.log(`       ... +${r.findings.length - 3} more`);
  }
  console.log('');
}

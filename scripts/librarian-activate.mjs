#!/usr/bin/env node
/**
 * scripts/librarian-activate.mjs
 * ============================================================================
 * "Activate Librarian" — auto-fills missing frontmatter fields in MDX/MD docs
 * using content analysis + path heuristics, then creates a git branch + commit.
 *
 * Reads every doc in docs/, compares existing frontmatter against the full
 * taxonomy schema, infers missing values from file path and body content,
 * and writes updated frontmatter back to disk.
 *
 * Usage:
 *   node scripts/librarian-activate.mjs              # auto-fill + commit
 *   node scripts/librarian-activate.mjs --dry-run    # preview only, no writes
 *   node scripts/librarian-activate.mjs --json       # output plan as JSON
 *
 * Called from the DevDashboard "Activate Librarian" button via the companion
 * HTTP server (scripts/librarian-server.mjs).
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

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const JSON_OUT = args.includes('--json');
const SCOPE_ARG = args.find(a => a.startsWith('--scope='));
const SCOPE = SCOPE_ARG ? SCOPE_ARG.split('=')[1] : null;

// ---------------------------------------------------------------------------
// Path → product_name mapping (mirrors generate-search-data.mjs)
// ---------------------------------------------------------------------------
const PATH_PRODUCT_MAP = [
  { prefix: 'fs10-prg/', product: 'FS10',       family: 'aurora', device: 'Fixed Scanner' },
  { prefix: 'fs42-prg/', product: 'FS42',       family: 'aurora', device: 'Fixed Scanner' },
  { prefix: 'fs80-prg/', product: 'FS80',       family: 'aurora', device: 'Fixed Scanner' },
  { prefix: 'xs20-prg/', product: 'VS20',       family: 'aurora', device: 'Smart Camera'  },
  { prefix: 'ziml-prg/', product: 'ZIML',       family: 'aurora', device: 'Smart Camera'  },
  { prefix: 'js-guide/', product: 'JavaScript', family: 'aurora', device: 'Smart Camera'  },
];

// ---------------------------------------------------------------------------
// Content-analysis keyword maps
// ---------------------------------------------------------------------------
const USE_CASE_PATTERNS = [
  { re: /\bocr\b|optical character/i,                         val: 'Optical Character Recognition (OCR)' },
  { re: /barcode|1d.?code|2d.?code|qr.?code/i,               val: 'Barcode Reading' },
  { re: /assembly|verification|presence/i,                     val: 'Assembly Verification' },
  { re: /gpio|digital.?i\/o|port/i,                            val: 'GPIO Control' },
  { re: /javascript|scripting|script/i,                        val: 'Application Development' },
  { re: /tcp|serial|usb.?cdc|ethernet|rs.?232|communication/i, val: 'Communication / Integration' },
  { re: /licens/i,                                              val: 'Licensing' },
  { re: /anomaly|deep.?learning|\bai\b/i,                      val: 'Deep Learning / Anomaly Detection' },
  { re: /deploy|job/i,                                         val: 'Job Deployment' },
  { re: /install|mount|wiring|cable/i,                         val: 'Installation' },
  { re: /maintenance|clean|firmware|update/i,                  val: 'Maintenance' },
  { re: /troubleshoot|diagnos|error|fault/i,                   val: 'Troubleshooting' },
];

const ROLE_PATTERNS = [
  { re: /javascript|api|sdk|script|code|develop/i,   val: 'Integrator/Developer' },
  { re: /install|wiring|mount|cable|hardware/i,       val: 'Controls Engineer' },
  { re: /admin|network|config|license|firmware/i,     val: 'System Administrator' },
  { re: /operator|scan|read|run|job|trigger/i,         val: 'Operator' },
];

const SKILL_PATTERNS = [
  { re: /advanced|debug|optim|deep.?learning|regex/i, val: 'Advanced' },
  { re: /getting.?started|introduction|overview|basic/i, val: 'Beginner' },
];

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------
function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && /\.(mdx|md)$/i.test(entry.name) && !entry.name.startsWith('_')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Frontmatter parser — returns raw YAML lines + parsed object
// ---------------------------------------------------------------------------
function parseFrontMatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { yaml: null, frontMatter: {}, body: content, hasFrontMatter: false };
  }
  const nl = content.includes('\r\n') ? '\r\n' : '\n';
  const end = content.indexOf(`${nl}---${nl}`, 4);
  if (end === -1) {
    return { yaml: null, frontMatter: {}, body: content, hasFrontMatter: false };
  }
  const yaml = content.slice(4, end);
  const body = content.slice(end + nl.length + 3 + nl.length);
  const frontMatter = parseYamlBlock(yaml);
  return { yaml, frontMatter, body, hasFrontMatter: true };
}

function parseYamlBlock(raw) {
  const result = {};
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }
    const key = trimmed.slice(0, colonIdx).trim();
    if (!key) { i++; continue; }
    let rawValue = stripInlineComment(trimmed.slice(colonIdx + 1)).trim();
    // Inline array
    if (rawValue.startsWith('[')) {
      result[key] = parseInlineArray(rawValue);
      i++; continue;
    }
    // Block array or empty value
    if (rawValue === '' || rawValue === null) {
      const items = [];
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (next.startsWith('- ') || next === '-') {
          const item = next.slice(1).trim().replace(/^['"]|['"]$/g, '').trim();
          if (item) items.push(item);
          i++;
        } else if (!next || next.startsWith('#')) {
          i++;
        } else {
          break;
        }
      }
      result[key] = items.length > 0 ? items : '';
      continue;
    }
    // Boolean / number / quoted string
    if (rawValue === 'true') { result[key] = true; i++; continue; }
    if (rawValue === 'false') { result[key] = false; i++; continue; }
    result[key] = rawValue.replace(/^['"]|['"]$/g, '');
    i++;
  }
  return result;
}

function stripInlineComment(str) {
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === '#' && (i === 0 || str[i - 1] === ' ')) {
      return str.slice(0, i);
    }
  }
  return str;
}

function parseInlineArray(raw) {
  const inner = raw.replace(/^\[|\]$/g, '');
  if (!inner.trim()) return [];
  return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Content-based inference engine
// ---------------------------------------------------------------------------
function inferFields(filePath, frontMatter, body) {
  const relPath = path.relative(docsRoot, filePath).replace(/\\/g, '/');
  const base = path.basename(filePath).toLowerCase();
  const title = frontMatter.title || path.basename(filePath, path.extname(filePath));
  const textSample = `${title} ${(body || '').slice(0, 4000)}`;
  const changes = {};

  // ── product_name ────────────────────────────────────────────────────────
  if (!frontMatter.product_name || frontMatter.product_name === '') {
    for (const { prefix, product } of PATH_PRODUCT_MAP) {
      if (relPath.startsWith(prefix)) {
        changes.product_name = product;
        break;
      }
    }
    if (!changes.product_name && /aurora.?focus/i.test(textSample)) {
      changes.product_name = 'Aurora Focus';
    }
  }

  // ── product_family ──────────────────────────────────────────────────────
  if (!frontMatter.product_family || frontMatter.product_family === '') {
    for (const { prefix, family } of PATH_PRODUCT_MAP) {
      if (relPath.startsWith(prefix)) {
        changes.product_family = family;
        break;
      }
    }
  }

  // ── device_type ─────────────────────────────────────────────────────────
  if (!frontMatter.device_type || frontMatter.device_type === '') {
    for (const { prefix, device } of PATH_PRODUCT_MAP) {
      if (relPath.startsWith(prefix)) {
        changes.device_type = device;
        break;
      }
    }
    if (!changes.device_type) {
      const hasSmartCam = /vs\d{2}|xs\d{2}|ns42|aurora focus/i.test(textSample);
      const hasFixedScanner = /fs\d{2}|fixed.?scanner/i.test(textSample);
      if (hasSmartCam && hasFixedScanner) changes.device_type = 'Smart Camera / Fixed Scanner';
      else if (hasSmartCam) changes.device_type = 'Smart Camera';
      else if (hasFixedScanner) changes.device_type = 'Fixed Scanner';
    }
  }

  // ── content_type ────────────────────────────────────────────────────────
  if (!frontMatter.content_type || frontMatter.content_type === '') {
    if (base.startsWith('rn-')) changes.content_type = 'Release Notes';
    else if (base.startsWith('t-')) changes.content_type = 'Tutorial';
    else if (base.startsWith('c-')) changes.content_type = 'Concept';
    else if (base.startsWith('r-')) changes.content_type = 'Reference';
    else if (base.startsWith('g-')) changes.content_type = 'Guide';
    else if (base === 'index.mdx' || base === 'index.md') changes.content_type = 'Index';
    // Body-based fallback
    else if (/step\s*\d|step-by-step|procedure/i.test(textSample)) changes.content_type = 'Guide';
    else if (/api\b|endpoint|parameter|return/i.test(textSample)) changes.content_type = 'Reference';
  }

  // ── use_case ────────────────────────────────────────────────────────────
  const existingUseCases = Array.isArray(frontMatter.use_case) ? frontMatter.use_case : [];
  if (existingUseCases.length === 0 && (!frontMatter.use_case || frontMatter.use_case === '')) {
    const inferred = [];
    for (const { re, val } of USE_CASE_PATTERNS) {
      if (re.test(textSample) && !inferred.includes(val)) {
        inferred.push(val);
      }
    }
    if (inferred.length > 0) changes.use_case = inferred;
  }

  // ── role ────────────────────────────────────────────────────────────────
  const existingRoles = Array.isArray(frontMatter.role) ? frontMatter.role : [];
  if (existingRoles.length === 0 && (!frontMatter.role || frontMatter.role === '')) {
    const inferred = [];
    for (const { re, val } of ROLE_PATTERNS) {
      if (re.test(textSample) && !inferred.includes(val)) {
        inferred.push(val);
      }
    }
    if (inferred.length > 0) changes.role = inferred;
  }

  // ── skill_level ─────────────────────────────────────────────────────────
  if (!frontMatter.skill_level || frontMatter.skill_level === '') {
    const ct = frontMatter.content_type || changes.content_type || '';
    for (const { re, val } of SKILL_PATTERNS) {
      if (re.test(textSample)) { changes.skill_level = val; break; }
    }
    if (!changes.skill_level) {
      if (ct === 'Reference') changes.skill_level = 'Intermediate';
      else if (ct === 'Tutorial' || ct === 'Guide') changes.skill_level = 'Beginner';
      else if (ct === 'Release Notes' || ct === 'Index') changes.skill_level = 'All';
    }
  }

  // ── description (from body if empty) ────────────────────────────────────
  if (!frontMatter.description || frontMatter.description === '' || frontMatter.description === "''") {
    const firstPara = (body || '')
      .replace(/^import\s+.*$/gm, '')         // strip import lines
      .replace(/^#.*$/gm, '')                  // strip headings
      .replace(/<[^>]+>/g, '')                 // strip JSX/HTML
      .trim()
      .split(/\n\n/)[0]?.trim()
      .replace(/\n/g, ' ')
      .slice(0, 160);
    if (firstPara && firstPara.length > 15) {
      changes.description = firstPara;
    }
  }

  // ── status ──────────────────────────────────────────────────────────────
  if (!frontMatter.status || frontMatter.status === '') {
    if (base.startsWith('rn-') || base === 'index.mdx' || base === 'index.md') {
      changes.status = 'Published';
    } else {
      changes.status = 'Draft';
    }
  }

  // ── keywords (supplement from path segments if empty) ───────────────────
  const existingKw = Array.isArray(frontMatter.keywords) ? frontMatter.keywords : [];
  if (existingKw.length === 0) {
    const segments = relPath.split('/').slice(0, -1)
      .flatMap(s => s.split('-'))
      .filter(s => s.length > 2 && !/^(prg|mdx|docs)$/i.test(s));
    if (segments.length > 0) changes.keywords = [...new Set(segments)].slice(0, 6);
  }

  return changes;
}

// ---------------------------------------------------------------------------
// YAML serialiser — inserts new keys into existing frontmatter
// ---------------------------------------------------------------------------
function insertIntoFrontMatter(yamlStr, changes) {
  const lines = yamlStr.split('\n');

  for (const [key, value] of Object.entries(changes)) {
    // Remove existing empty key if present (e.g. "description: ''")
    const existingIdx = lines.findIndex(l => {
      const trimmed = l.trim();
      return trimmed.startsWith(`${key}:`) || trimmed === `${key}:`;
    });

    const newLines = serializeYamlField(key, value);

    if (existingIdx !== -1) {
      // Replace existing line (and consume any child array lines)
      let endIdx = existingIdx + 1;
      while (endIdx < lines.length && /^\s+-\s/.test(lines[endIdx])) {
        endIdx++;
      }
      lines.splice(existingIdx, endIdx - existingIdx, ...newLines);
    } else {
      // Append at end
      lines.push(...newLines);
    }
  }

  return lines.join('\n');
}

function serializeYamlField(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [
      `${key}:`,
      ...value.map(v => `  - ${quoteIfNeeded(String(v))}`),
    ];
  }
  if (typeof value === 'boolean') return [`${key}: ${value}`];
  if (typeof value === 'number') return [`${key}: ${value}`];
  return [`${key}: ${quoteIfNeeded(String(value))}`];
}

function quoteIfNeeded(str) {
  // Quote strings that contain special YAML chars
  if (/[:#\[\]{}&*!|>'"%@`]/.test(str) || str === '' || str === 'true' || str === 'false') {
    return `'${str.replace(/'/g, "''")}'`;
  }
  return str;
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

/** Run git with args array — avoids shell escaping issues on Windows */
function git(...args) {
  return execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
}

/** Run gh CLI with args array */
function gh(...args) {
  return execFileSync('gh', args, { cwd: workspaceRoot, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function createBranchAndPR(changedFiles, branchName, commitMsg, prTitle, prBody, originalBranch) {
  let prUrl = null;

  // Stage the changed files via a temp file to avoid Windows ENAMETOOLONG
  const listFile = path.join(os.tmpdir(), `librarian-add-${Date.now()}.txt`);
  try {
    fs.writeFileSync(listFile, changedFiles.join('\n'), 'utf8');
    git('add', '--pathspec-from-file', listFile);
  } finally {
    try { fs.unlinkSync(listFile); } catch { /* ignore */ }
  }

  // Create a fresh branch from current HEAD (carrying the staged changes)
  try { git('branch', '-D', branchName); } catch { /* doesn't exist — fine */ }
  git('checkout', '-b', branchName);

  try {
    git('commit', '-m', commitMsg);

    try {
      git('push', 'origin', branchName, '--force');
    } catch (pushErr) {
      console.error('Push failed:', pushErr.message);
    }

    try {
      prUrl = gh(
        'pr', 'create',
        '--title', prTitle,
        '--body', prBody,
        '--base', originalBranch,
        '--head', branchName,
        '--assignee', '@me',
      );
    } catch (prErr) {
      try {
        prUrl = gh('pr', 'view', branchName, '--json', 'url', '--jq', '.url');
      } catch { /* ignore */ }
      if (!prUrl) console.error('PR creation failed:', prErr.message);
    }

    // Switch back to original branch
    git('checkout', originalBranch);
  } catch (err) {
    try { git('checkout', originalBranch); } catch { /* ignore */ }
    throw err;
  }

  return { branchName, prUrl };
}

// ---------------------------------------------------------------------------
// Phase 2: Semantic Loss Body Fixes (DL-01 through DL-10)
// ---------------------------------------------------------------------------

/** DL-09: Remove title echo — body line that duplicates frontmatter title.
 *  Safety check: never remove the title-echo line if it's the body's ONLY
 *  non-empty content. Such docs are already functionally empty (likely DL-04
 *  candidates); removing the line makes them formally empty and trips the
 *  docs-body-guard CI gate. The echo stays so the doc still has *something*
 *  to render until a human can author real content. See
 *  .github/case-study/insights.md.
 */
function fixTitleEcho(lines, frontMatter) {
  const title = frontMatter.title;
  if (!title) return { lines, fixes: [] };

  const isEchoLine = (s) => {
    const t = s.trim();
    return t === title || t === `# ${title}`;
  };
  // If the title echo is the body's sole non-empty content, leave it alone —
  // removing it would empty the doc.
  const nonEmpty = lines.filter((s) => s.trim().length > 0);
  if (nonEmpty.length === 1 && isEchoLine(nonEmpty[0])) {
    return { lines, fixes: [] };
  }

  const fixes = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (i < 5 && isEchoLine(lines[i])) {
      fixes.push({ test: 'DL-09', line: i + 1, detail: `Removed echoed title: "${title}"` });
      continue;
    }
    out.push(lines[i]);
  }
  return { lines: out, fixes };
}

/** DL-03: Remove duplicate plaintext copies of list items */
function fixDuplicateContent(lines) {
  const fixes = [];
  const toRemove = new Set();

  for (let i = 0; i < lines.length - 1; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('- ') || t.length < 8) continue;
    const listText = t.slice(2).trim();
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const cand = lines[j].trim();
      if (cand === listText && cand.length > 5 && !toRemove.has(j)) {
        toRemove.add(j);
        fixes.push({ test: 'DL-03', line: j + 1, detail: `Removed duplicate: "${listText.slice(0, 60)}"` });
        break;
      }
    }
  }

  const out = lines.filter((_, i) => !toRemove.has(i));
  return { lines: out, fixes };
}

/** DL-05: Replace orphaned HTML entities outside code blocks */
function fixOrphanedEntities(lines) {
  const fixes = [];
  let inFence = false;
  const out = lines.map((line, i) => {
    if (line.trim().startsWith('```')) { inFence = !inFence; return line; }
    if (inFence) return line;
    const replaced = line
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    if (replaced !== line) {
      fixes.push({ test: 'DL-05', line: i + 1, detail: 'Replaced HTML entities with literal characters' });
    }
    return replaced;
  });
  return { lines: out, fixes };
}

/** DL-06: Close unclosed code fences */
function fixUnclosedFences(lines) {
  const fixes = [];
  let inFence = false;
  let fenceStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) {
      if (!inFence) { inFence = true; fenceStart = i; }
      else { inFence = false; }
    }
  }
  if (inFence) {
    lines.push('```');
    fixes.push({ test: 'DL-06', line: fenceStart + 1, detail: `Closed unclosed code fence from line ${fenceStart + 1}` });
  }
  return { lines, fixes };
}

/** DL-07: Remove empty headings (## with no content before next heading) */
function fixEmptyHeadings(lines) {
  const fixes = [];
  const toRemove = new Set();

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('#')) continue;
    let hasContent = false;
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j].trim();
      if (n.startsWith('#')) break;
      if (n.length > 0 && !n.startsWith('import ')) { hasContent = true; break; }
    }
    if (!hasContent) {
      toRemove.add(i);
      fixes.push({ test: 'DL-07', line: i + 1, detail: `Removed empty heading: "${t.slice(0, 60)}"` });
    }
  }

  const out = lines.filter((_, i) => !toRemove.has(i));
  return { lines: out, fixes };
}

/** DL-02: Wrap admonition-like text in ::: blocks */
function fixMissingAdmonitions(lines) {
  const fixes = [];
  const out = [];
  const admonRe = /^(Note|Caution|Warning|Important|Danger|Tip|Notice)\s*[:.]?\s+(.*)/i;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith(':::')) { out.push(lines[i]); continue; }
    const prev = i > 0 ? lines[i - 1].trim() : '';
    if (prev.startsWith(':::')) { out.push(lines[i]); continue; }

    const m = t.match(admonRe);
    if (m) {
      const type = m[1].toLowerCase();
      const rest = m[2].trim();
      // Collect continuation lines (non-blank, non-heading, not starting with another admonition)
      const block = [rest];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j].trim();
        if (next === '' || next.startsWith('#') || next.startsWith(':::') || admonRe.test(next)) break;
        block.push(next);
        j++;
      }
      const admonType = type === 'important' ? 'info' : type === 'notice' ? 'note' : type;
      out.push(`:::${admonType}`);
      for (const bl of block) out.push(bl);
      out.push(':::');
      out.push('');
      fixes.push({ test: 'DL-02', line: i + 1, detail: `Wrapped "${m[1]}" in :::${admonType} block` });
      i = j - 1; // skip consumed lines
    } else {
      out.push(lines[i]);
    }
  }
  return { lines: out, fixes };
}

/** DL-10: Convert bullet lists with step-like text to numbered lists */
function fixBrokenProcedures(lines) {
  const fixes = [];
  const stepRe = /^-\s+(Step\s+\d+[:.]\s*|First,?\s+|Second,?\s+|Third,?\s+|Fourth,?\s+|Fifth,?\s+|Then,?\s+|Next,?\s+|Finally,?\s+)/i;
  let stepNum = 0;

  const out = lines.map((line, i) => {
    const t = line.trim();
    const m = t.match(stepRe);
    if (m) {
      stepNum++;
      const content = t.slice(2).replace(stepRe.source.slice(4), '').trim() || t.slice(2 + m[1].length).trim() || t.slice(2).trim();
      // Remove the "Step N:" or "First," prefix since numbering replaces it
      const cleaned = t.slice(2).replace(/^(Step\s+\d+[:.]\s*|First,?\s*|Second,?\s*|Third,?\s*|Fourth,?\s*|Fifth,?\s*|Then,?\s*|Next,?\s*|Finally,?\s*)/i, '').trim();
      fixes.push({ test: 'DL-10', line: i + 1, detail: `Converted to numbered step ${stepNum}` });
      return `${stepNum}. ${cleaned || t.slice(2).trim()}`;
    }
    if (t === '' || t.startsWith('#')) stepNum = 0; // reset numbering at breaks
    return line;
  });
  return { lines: out, fixes };
}

/** DL-08: Remove orphaned DITA/HTML tags outside code blocks */
function fixOrphanedTags(lines) {
  const fixes = [];
  let inFence = false;
  const tagRe = /<\/?(p|ul|ol|li|table|tr|td|th|tbody|thead|note|prereq|result|context|cmd|uicontrol|menucascade|stepresult|postreq|fig|image|xref|section|body|shortdesc|conbody|taskbody|concept|task|reference|refbody)[\s>][^>]*>/gi;

  const out = lines.map((line, i) => {
    if (line.trim().startsWith('```')) { inFence = !inFence; return line; }
    if (inFence) return line;
    const cleaned = line.replace(tagRe, (match) => {
      fixes.push({ test: 'DL-08', line: i + 1, detail: `Removed orphaned tag: "${match.trim()}"` });
      return '';
    });
    return cleaned;
  });
  return { lines: out, fixes };
}

/** DL-01: Reconstruct flattened tables from consecutive bare-text lines */
function fixFlattenedTables(lines) {
  const fixes = [];
  const out = [];
  let i = 0;
  let inFence = false;

  // Lines that should never be treated as table-cell candidates:
  // - bullet markers (`- `, `* `, `+ ` — and `*   ` with multiple spaces, common in DITA→MD output)
  // - JSDoc-style asterisk continuation lines (`* @param`, `* @returns`, etc.)
  // - numbered list items
  // - headings, fences, admonitions, imports, blockquotes, existing table rows
  const isStructural = (s) => {
    if (s === '') return true;
    if (s.includes('|')) return true;
    if (/^[*+-]\s/.test(s)) return true; // bullet (dash, star, plus, with whitespace)
    if (/^\*[ \t]+@\w+/.test(s)) return true; // JSDoc tag continuation
    if (s.startsWith('#') || s.startsWith('```') || s.startsWith(':::')) return true;
    if (s.startsWith('import ') || s.startsWith('> ')) return true;
    if (/^\d+\.\s/.test(s)) return true;
    return false;
  };

  while (i < lines.length) {
    // Fence tracking — fixFlattenedTables runs AFTER fixUnclosedFences in the
    // chain, so fences are balanced by the time we see them. Don't treat lines
    // inside a code fence as table candidates; they're code, not flattened
    // tables (e.g., JSDoc comments would otherwise reconstruct as a table).
    if (lines[i].trim().startsWith('```')) {
      inFence = !inFence;
      out.push(lines[i]);
      i++;
      continue;
    }
    if (inFence) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const t = lines[i].trim();

    if (isStructural(t)) {
      out.push(lines[i]);
      i++;
      continue;
    }

    // Detect a run of 4+ short bare-text lines (likely a flattened table)
    const run = [];
    let j = i;
    while (j < lines.length) {
      const lt = lines[j].trim();
      // Stop the run if we hit a fence delimiter — don't run across the boundary
      if (lt.startsWith('```')) break;
      if (lt.length > 0 && lt.length < 100 && !isStructural(lt)) {
        run.push(lt);
        j++;
      } else {
        break;
      }
    }

    if (run.length < 4) {
      // Not a table — pass through
      if (j === i) j = i + 1; // ensure forward progress for lines skipped by inner loop
      for (let k = i; k < j; k++) out.push(lines[k]);
      i = j;
      continue;
    }

    // Try to detect column count: if alternating short/long or pairs
    // Heuristic: try 2-column first (most common: label + value)
    // Check if even number of lines suggests pairs
    if (run.length % 2 === 0 && run.length >= 4) {
      // Check if odd-indexed lines look like "values" (longer, have numbers/units)
      let looksLikePairs = true;
      for (let k = 0; k < Math.min(6, run.length); k += 2) {
        // Label lines tend to be shorter title-case words
        if (run[k].length > run[k + 1]?.length * 3) { looksLikePairs = false; break; }
      }

      if (looksLikePairs) {
        // Build 2-column table from pairs
        const col1Header = run[0];
        const col2Header = run[1];
        out.push(`| ${col1Header} | ${col2Header} |`);
        out.push('| --- | --- |');
        for (let k = 2; k < run.length; k += 2) {
          const c1 = run[k] || '';
          const c2 = run[k + 1] || '';
          out.push(`| ${c1} | ${c2} |`);
        }
        out.push('');
        fixes.push({
          test: 'DL-01', line: i + 1,
          detail: `Reconstructed ${Math.floor(run.length / 2)} row table from ${run.length} bare-text lines`,
        });
        i = j;
        continue;
      }
    }

    // Fallback: odd count or non-pair structure — try single-column table
    // (better than raw text, at least gives structure)
    out.push(`| ${run[0]} |`);
    out.push('| --- |');
    for (let k = 1; k < run.length; k++) {
      out.push(`| ${run[k]} |`);
    }
    out.push('');
    fixes.push({
      test: 'DL-01', line: i + 1,
      detail: `Reconstructed single-column table from ${run.length} bare-text lines`,
    });
    i = j;
  }

  return { lines: out, fixes };
}

/**
 * Apply all semantic loss fixes to a file's body content.
 * Returns { body, fixes } where fixes is an array of { test, line, detail }.
 * Ordering matters — run in a specific sequence to avoid conflicts.
 */
function applySemanticLossFixes(body, frontMatter) {
  let lines = body.split('\n');
  const allFixes = [];

  // Order: title echo → duplicates → entities → fences → admonitions → procedures → tags → tables
  // (DL-07 empty-headings remediation removed; downgraded to flag-only)
  let result;

  result = fixTitleEcho(lines, frontMatter);
  lines = result.lines; allFixes.push(...result.fixes);

  result = fixDuplicateContent(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  result = fixOrphanedEntities(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  result = fixUnclosedFences(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  result = fixMissingAdmonitions(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  result = fixBrokenProcedures(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  result = fixOrphanedTags(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  // DL-07 (empty headings) is detection-only — the dita-loss-scanner emits
  // findings, but we do NOT auto-remove. The remediation can't distinguish
  // "empty heading" from "heading whose content is in sub-sections" (e.g.
  // release-notes files use H1 version anchors with H2 sub-sections). Removing
  // them flattens the document outline. Downgraded to PROPOSE-only on
  // 2026-05-11; see .github/case-study/insights.md Phase 14.
  // result = fixEmptyHeadings(lines);
  // lines = result.lines; allFixes.push(...result.fixes);

  result = fixFlattenedTables(lines);
  lines = result.lines; allFixes.push(...result.fixes);

  // Safety net: refuse to apply fixes if the cumulative result would empty
  // a previously non-empty body. The docs-body-guard CI gate catches this at
  // a higher level (and exists *because* of prior incidents like the DL-09
  // title-echo over-removal). Catching it here lets the librarian self-heal
  // and skip the offending file gracefully instead of generating a PR that
  // CI will reject. See .github/case-study/insights.md.
  const inputHadContent = body.trim().length > 0;
  const outputIsEmpty = lines.join('\n').trim().length === 0;
  if (inputHadContent && outputIsEmpty) {
    return { body, fixes: [] }; // discard all fixes for this file
  }

  return { body: lines.join('\n'), fixes: allFixes };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function activate(options = {}) {
  const dryRun = options.dryRun ?? DRY_RUN;
  const scope = options.scope ?? SCOPE;
  const scanRoot = scope ? path.join(docsRoot, scope) : docsRoot;

  if (scope && !fs.existsSync(scanRoot)) {
    throw new Error(`Scope folder not found: ${scanRoot}`);
  }

  const files = walk(scanRoot);
  const date = new Date().toISOString().slice(0, 10);
  const suffix = scope ? `-${scope.replace(/[\/\\]/g, '-')}` : '';
  const scopeLabel = scope ? `docs/${scope}` : 'all docs';

  // Git setup (shared by both PRs)
  let originalBranch = 'main';
  if (!dryRun) {
    try { git('config', 'user.name'); } catch { git('config', 'user.name', 'librarian-bot'); }
    try { git('config', 'user.email'); } catch { git('config', 'user.email', 'librarian@local'); }
    try { originalBranch = git('branch', '--show-current'); } catch { /* keep main */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pass 1: Frontmatter auto-fill
  // ═══════════════════════════════════════════════════════════════════════
  const plan = [];
  const phase1Files = new Set();
  let totalFields = 0;

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const { yaml, frontMatter, body, hasFrontMatter } = parseFrontMatter(raw);
    if (!hasFrontMatter) continue;

    const changes = inferFields(filePath, frontMatter, body);
    if (Object.keys(changes).length === 0) continue;

    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    const fieldCount = Object.keys(changes).length;
    totalFields += fieldCount;
    plan.push({ file: relPath, fields: fieldCount, changes });

    if (!dryRun) {
      const updatedYaml = insertIntoFrontMatter(yaml, changes);
      const updatedContent = `---\n${updatedYaml}\n---\n${body}`;
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      phase1Files.add(filePath);
    }
  }

  const phase1Summary = {
    label: 'Frontmatter Auto-Fill',
    docsModified: plan.length,
    fieldsAdded: totalFields,
    branch: null,
    prUrl: null,
  };

  // Create Phase 1 PR
  if (!dryRun && phase1Files.size > 0) {
    try {
      const branchName = `librarian/schema-fill${suffix}-${date}`;
      const commitMsg = `librarian: auto-fill ${phase1Files.size} docs frontmatter in ${scopeLabel} (${date})`;
      const prTitle = `Librarian: schema auto-fill — ${phase1Files.size} docs (${scopeLabel})`;
      const prBody = [
        '## Frontmatter Auto-Fill',
        '',
        `**Scope:** ${scopeLabel}`,
        `**Files modified:** ${phase1Files.size}`,
        `**Fields added:** ${totalFields}`,
        `**Date:** ${date}`,
        '',
        'Inferred missing frontmatter fields from file paths and body content:',
        '- product_name, product_family, device_type',
        '- content_type, use_case, role, skill_level',
        '- description (extracted from first paragraph)',
        '- status, keywords',
        '',
        '> All values are inferred from content analysis and path heuristics.',
        '> Please review before merging.',
      ].join('\n');

      const gitResult = createBranchAndPR([...phase1Files], branchName, commitMsg, prTitle, prBody, originalBranch);
      phase1Summary.branch = gitResult.branchName;
      phase1Summary.prUrl = gitResult.prUrl;

      // Restore working tree to original branch state for Phase 2
      // (Phase 1 changes are on the branch, not on the working tree anymore)
      git('checkout', originalBranch);
    } catch (err) {
      phase1Summary.branch = `(git error: ${err.message})`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pass 2: Semantic loss body fixes (re-read files fresh)
  // ═══════════════════════════════════════════════════════════════════════
  const bodyPlan = [];
  const phase2Files = new Set();
  let totalBodyFixes = 0;

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
    const { yaml, frontMatter, body, hasFrontMatter } = parseFrontMatter(raw);
    if (!hasFrontMatter) continue;

    const { body: fixedBody, fixes } = applySemanticLossFixes(body, frontMatter);
    if (fixes.length === 0) continue;

    const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
    totalBodyFixes += fixes.length;
    bodyPlan.push({ file: relPath, fixCount: fixes.length, fixes });

    if (!dryRun) {
      const updatedContent = `---\n${yaml}\n---\n${fixedBody}`;
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      phase2Files.add(filePath);
    }
  }

  const phase2ByTest = {};
  for (const bp of bodyPlan) {
    for (const f of bp.fixes) {
      phase2ByTest[f.test] = (phase2ByTest[f.test] || 0) + 1;
    }
  }

  const phase2Summary = {
    label: 'Semantic Loss Body Fixes',
    docsModified: bodyPlan.length,
    totalFixes: totalBodyFixes,
    byTest: phase2ByTest,
    branch: null,
    prUrl: null,
  };

  // Create Phase 2 PR
  if (!dryRun && phase2Files.size > 0) {
    const TEST_LABELS = {
      'DL-01': ['Flattened Tables', 'Reconstructed pipe-delimited tables from bare text'],
      'DL-02': ['Missing Admonitions', 'Wrapped Note/Caution/Warning in :::blocks'],
      'DL-03': ['Duplicate Content', 'Removed plaintext duplicates of list items'],
      'DL-05': ['Orphaned Entities', 'Replaced &lt; &gt; &amp; with literal characters'],
      'DL-06': ['Unclosed Fences', 'Added closing ``` to unclosed code blocks'],
      'DL-07': ['Empty Headings', 'Removed headings with no content beneath'],
      'DL-08': ['Orphaned Tags', 'Stripped unconverted DITA/HTML tags'],
      'DL-09': ['Title Echoes', 'Removed body lines duplicating frontmatter title'],
      'DL-10': ['Broken Procedures', 'Converted bullet lists to numbered steps'],
    };

    try {
      const branchName = `librarian/dita-fix${suffix}-${date}`;
      const commitMsg = `librarian: DITA body fixes for ${phase2Files.size} docs in ${scopeLabel} (${date})`;
      const prTitle = `Librarian: DITA migration fixes — ${phase2Files.size} docs (${scopeLabel})`;

      const bodyLines = [
        '## DITA Migration Body Fixes',
        '',
        `**Scope:** ${scopeLabel}`,
        `**Files repaired:** ${phase2Files.size}`,
        `**Total fixes:** ${totalBodyFixes}`,
        `**Date:** ${date}`,
        '',
        '| Fix | Count | Description |',
        '|-----|-------|-------------|',
      ];
      for (const [test, count] of Object.entries(phase2ByTest).sort()) {
        const [label, desc] = TEST_LABELS[test] || [test, ''];
        bodyLines.push(`| ${label} (${test}) | ${count} | ${desc} |`);
      }
      bodyLines.push(
        '',
        '> Automated repairs for DITA→Markdown conversion artifacts.',
        '> Body content only — no frontmatter changes.',
        '> Please review before merging.',
      );

      const gitResult = createBranchAndPR([...phase2Files], branchName, commitMsg, prTitle, bodyLines.join('\n'), originalBranch);
      phase2Summary.branch = gitResult.branchName;
      phase2Summary.prUrl = gitResult.prUrl;
    } catch (err) {
      phase2Summary.branch = `(git error: ${err.message})`;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    dryRun,
    scope: scope || 'all',
    docsScanned: files.length,
    docsModified: phase1Files.size + phase2Files.size,
    phase1: phase1Summary,
    phase2: phase2Summary,
    plan,
    bodyPlan,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (process.argv[1]?.replace(/\\/g, '/').endsWith('librarian-activate.mjs')) {
  const result = activate();
  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n📚 Librarian Activation ${result.dryRun ? '(DRY RUN)' : ''}`);
    console.log(`   Scanned: ${result.docsScanned} docs`);

    // Phase 1
    console.log(`\n   PR 1 — Frontmatter Auto-Fill:`);
    console.log(`     Docs: ${result.phase1.docsModified} · Fields: ${result.phase1.fieldsAdded}`);
    if (result.phase1.branch) console.log(`     Branch: ${result.phase1.branch}`);
    if (result.phase1.prUrl) console.log(`     PR: ${result.phase1.prUrl}`);
    if (result.plan.length > 0) {
      for (const p of result.plan.slice(0, 20)) {
        console.log(`       ${p.file} (+${p.fields}: ${Object.keys(p.changes).join(', ')})`);
      }
      if (result.plan.length > 20) console.log(`       ... and ${result.plan.length - 20} more`);
    }

    // Phase 2
    console.log(`\n   PR 2 — DITA Migration Body Fixes:`);
    console.log(`     Docs: ${result.phase2.docsModified} · Fixes: ${result.phase2.totalFixes}`);
    if (result.phase2.branch) console.log(`     Branch: ${result.phase2.branch}`);
    if (result.phase2.prUrl) console.log(`     PR: ${result.phase2.prUrl}`);
    if (Object.keys(result.phase2.byTest).length > 0) {
      const testLabels = {
        'DL-01': 'Flattened Tables', 'DL-02': 'Missing Admonitions', 'DL-03': 'Duplicate Content',
        'DL-05': 'Orphaned Entities', 'DL-06': 'Unclosed Fences', 'DL-07': 'Empty Headings',
        'DL-08': 'Orphaned Tags', 'DL-09': 'Title Echoes', 'DL-10': 'Broken Procedures',
      };
      for (const [test, count] of Object.entries(result.phase2.byTest).sort()) {
        console.log(`       ${test} ${testLabels[test] || ''}: ${count}`);
      }
    }
    if (result.bodyPlan.length > 0) {
      console.log('     Top files:');
      const sorted = [...result.bodyPlan].sort((a, b) => b.fixCount - a.fixCount);
      for (const bp of sorted.slice(0, 15)) {
        console.log(`       ${bp.file} (${bp.fixCount} fixes)`);
      }
      if (sorted.length > 15) console.log(`       ... and ${sorted.length - 15} more`);
    }
    console.log('');
  }
}

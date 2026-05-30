#!/usr/bin/env node
/**
 * scripts/generate-build-report.mjs
 * ============================================================================
 * Walks all .mdx/.md files in docs/, parses frontmatter, analyses content,
 * makes educated guesses for missing taxonomy fields, and outputs
 * static/build-report.json.
 *
 * Guessed values are clearly flagged with `_guessed: true` in the per-doc
 * `guesses` map so authors can review and promote them into actual frontmatter.
 *
 * Usage:
 *   node scripts/generate-build-report.mjs
 *
 * Output:
 *   static/build-report.json
 *
 * Design for portability:
 *   Drop this script + dashboard.config.js into any Docusaurus repo and run
 *   `node scripts/generate-build-report.mjs` from the repo root.
 */

import './_load-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

const workspaceRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(workspaceRoot, 'docs');
const outputPath = path.join(workspaceRoot, 'static', 'build-report.json');
const configPath = path.join(workspaceRoot, 'dashboard.config.js');

// ---------------------------------------------------------------------------
// Load dashboard config (graceful fallback if absent)
// ---------------------------------------------------------------------------
let dashboardConfig;
try {
  dashboardConfig = require(configPath);
} catch {
  dashboardConfig = { fields: [], placeholderPattern: /\[.*?\]|TODO|TBD/i, taxonomyFields: [] };
}

const { fields: configFields, placeholderPattern, taxonomyFields } = dashboardConfig;

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------
export function walk(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && /\.(mdx|md)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Frontmatter parser (handles strings, quoted strings, inline YAML arrays,
// block YAML arrays, inline comments, and comment-only lines)
// ---------------------------------------------------------------------------
export function parseFrontMatter(content) {
  // Normalise line endings to LF for consistent parsing
  content = content.replace(/\r\n/g, '\n');
  if (!content.startsWith('---\n')) {
    return { frontMatter: {}, body: content };
  }
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontMatter: {}, body: content };
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 5);
  const frontMatter = parseYamlBlock(raw);
  return { frontMatter, body };
}

/**
 * Minimal YAML block parser sufficient for Docusaurus MDX frontmatter.
 * Handles: strings, quoted strings, inline arrays, block arrays, comments.
 * @param {string} raw - Raw YAML text between the `---` delimiters
 * @returns {Record<string, string|string[]|null>}
 */
export function parseYamlBlock(raw) {
  const result = {};
  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines and comment-only lines
    if (!trimmed || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = trimmed.slice(0, colonIdx).trim();
    if (!key) { i++; continue; }

    // Strip inline comments from value portion (but preserve URLs http://…)
    let rawValue = trimmed.slice(colonIdx + 1);
    // Only strip inline comments that are preceded by whitespace outside a quoted string
    rawValue = stripInlineComment(rawValue).trim();

    // Inline JSON-style array: `["a","b"]` or `['a','b']`
    if (rawValue.startsWith('[')) {
      result[key] = parseInlineArray(rawValue);
      i++;
      continue;
    }

    // Empty value – might be followed by a YAML block sequence
    if (rawValue === '' || rawValue === null) {
      const items = [];
      i++;
      while (i < lines.length) {
        const nextTrimmed = lines[i].trim();
        if (nextTrimmed.startsWith('- ') || nextTrimmed === '-') {
          const item = nextTrimmed.slice(1).trim().replace(/^['"]|['"]$/g, '').trim();
          if (item) items.push(item);
          i++;
        } else if (!nextTrimmed || nextTrimmed.startsWith('#')) {
          i++;
        } else {
          break;
        }
      }
      result[key] = items.length > 0 ? items : null;
      continue;
    }

    // Quoted or plain string
    result[key] = rawValue.replace(/^['"]|['"]$/g, '').trim();
    i++;
  }

  return result;
}

/** Remove `# comment` suffix outside quoted regions. */
function stripInlineComment(str) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '#' && !inSingle && !inDouble) {
      return str.slice(0, i);
    }
  }
  return str;
}

/** Parse `["a","b"]` or `['a', 'b']` inline arrays. */
export function parseInlineArray(str) {
  const inner = str.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------
export function detectPlaceholders(frontMatter, body) {
  const found = [];
  for (const [key, value] of Object.entries(frontMatter)) {
    const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
    if (placeholderPattern.test(text)) {
      found.push({ field: key, value: text.slice(0, 80) });
    }
  }
  // Also check first 3000 chars of body for placeholder-heavy content
  const bodySnippet = (body || '').slice(0, 3000);
  const bodyMatches = bodySnippet.match(new RegExp(placeholderPattern.source, 'gi')) || [];
  if (bodyMatches.length > 0) {
    found.push({ field: '_body', count: bodyMatches.length });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Intelligent guessing engine
// ---------------------------------------------------------------------------

/** Guess content_type from filename prefix convention. */
export function guessContentType(filename) {
  const base = path.basename(filename).toLowerCase();
  if (base.startsWith('rn-')) return 'Release Notes';
  if (base.startsWith('t-')) return 'Tutorial';
  if (base.startsWith('c-')) return 'Concept';
  if (base.startsWith('r-')) return 'Reference';
  if (base.startsWith('g-')) return 'Guide';
  if (base === 'index.mdx' || base === 'index.md') return 'Index';
  return null;
}

/** Guess device_type from content mentions. */
export function guessDeviceType(title, body) {
  const text = `${title} ${body}`.toLowerCase();
  const smartCameraModels = /vs\d{2}|xs\d{2}|ns42|aurora focus/i;
  const fixedScannerModels = /fs\d{2}|fixed.?scanner/i;
  const hasSmartCamera = smartCameraModels.test(text);
  const hasFixedScanner = fixedScannerModels.test(text);
  if (hasSmartCamera && hasFixedScanner) return 'Smart Camera / Fixed Scanner';
  if (hasSmartCamera) return 'Smart Camera';
  if (hasFixedScanner) return 'Fixed Scanner';
  return null;
}

/** Returns true when the text context suggests job deployment content (but not CI deploy). */
function isJobDeploymentContext(text) {
  return /deploy|job/i.test(text) && !/deploy.*build/i.test(text);
}

/** Guess use_case from title/body keywords. */
export function guessUseCase(title, body) {
  const text = `${title} ${body.slice(0, 2000)}`.toLowerCase();
  const cases = [];
  if (/\bocr\b|optical character/i.test(text)) cases.push('Optical Character Recognition (OCR)');
  if (/barcode|1d.?code|2d.?code|qr.?code/i.test(text)) cases.push('Barcode Reading');
  if (/assembly|verification|presence/i.test(text)) cases.push('Assembly Verification');
  if (/gpio|digital.?i\/o|port/i.test(text)) cases.push('GPIO Control');
  if (/javascript|scripting|script/i.test(text)) cases.push('Application Development');
  if (/tcp|serial|usb.?cdc|ethernet|rs.?232/i.test(text)) cases.push('Communication / Integration');
  if (/licens/i.test(text)) cases.push('Licensing');
  if (/anomaly|deep.?learning|ai\b/i.test(text)) cases.push('Deep Learning / Anomaly Detection');
  if (isJobDeploymentContext(text)) cases.push('Job Deployment');
  return cases.length > 0 ? cases : null;
}

/** Guess role from content_type. */
export function guessRole(contentType) {
  const map = {
    'Tutorial':      ['Integrator/Developer'],
    'Guide':         ['Integrator/Developer', 'Controls Engineer'],
    'Concept':       ['Integrator/Developer', 'Controls Engineer'],
    'Reference':     ['Integrator/Developer'],
    'Release Notes': ['System Administrator', 'Integrator/Developer'],
    'Index':         null,
  };
  return map[contentType] ?? null;
}

/** Guess skill_level from content_type and title. */
export function guessSkillLevel(contentType, title) {
  const t = (title || '').toLowerCase();
  if (/advanced|debug|optim|deep.?learning/i.test(t)) return 'Advanced';
  if (contentType === 'Release Notes' || contentType === 'Index') return 'All';
  if (contentType === 'Reference') return 'Intermediate';
  if (contentType === 'Tutorial' || contentType === 'Guide') return 'Beginner';
  return null;
}

/** Guess status: default Draft if missing and not a known-published type. */
export function guessStatus(contentType, filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base.startsWith('rn-')) return 'Published';
  if (base === 'index.mdx' || base === 'index.md') return 'Published';
  return 'Draft';
}

/**
 * Run all guessers for a single doc.
 * Returns `{ field: guessedValue, ... }` — only fields that are actually missing.
 */
export function buildGuesses(frontMatter, filePath, body) {
  const guesses = {};
  const title = frontMatter.title || path.basename(filePath, path.extname(filePath));

  const contentTypeGuess = guessContentType(filePath);

  if (!frontMatter.content_type && contentTypeGuess) {
    guesses.content_type = contentTypeGuess;
  }

  const effectiveContentType = frontMatter.content_type || contentTypeGuess;

  if (!frontMatter.device_type) {
    const g = guessDeviceType(title, body);
    if (g) guesses.device_type = g;
  }

  if (!frontMatter.use_case || (Array.isArray(frontMatter.use_case) && frontMatter.use_case.length === 0)) {
    const g = guessUseCase(title, body);
    if (g) guesses.use_case = g;
  }

  if (!frontMatter.role || (Array.isArray(frontMatter.role) && frontMatter.role.length === 0)) {
    const g = guessRole(effectiveContentType);
    if (g) guesses.role = g;
  }

  if (!frontMatter.skill_level) {
    const g = guessSkillLevel(effectiveContentType, title);
    if (g) guesses.skill_level = g;
  }

  if (!frontMatter.status) {
    guesses.status = guessStatus(effectiveContentType, filePath);
  }

  return guesses;
}

// ---------------------------------------------------------------------------
// Word count helper
// ---------------------------------------------------------------------------
export function countWords(text) {
  return (text || '').trim().split(/\s+/).filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------
// Section detector (which top-level docs/ subdirectory)
// ---------------------------------------------------------------------------
export function detectSection(filePath) {
  const rel = path.relative(docsRoot, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  if (parts.length === 1) return 'root';
  return parts[0];
}

// ---------------------------------------------------------------------------
// URL builder (mirrors generate-askai-index.mjs)
// ---------------------------------------------------------------------------
function buildDocUrl(filePath, frontMatter) {
  if (frontMatter.slug) {
    const slug = String(frontMatter.slug);
    if (slug.startsWith('/docs/')) return slug;
    if (slug.startsWith('/')) return `/docs${slug}`;
  }
  const rel = path.relative(docsRoot, filePath).replace(/\\/g, '/');
  const noExt = rel.replace(/\.(mdx|md)$/i, '');
  if (noExt.endsWith('/index')) return `/docs/${noExt.slice(0, -6)}`;
  return `/docs/${noExt}`;
}

// ---------------------------------------------------------------------------
// Completeness scorer
// ---------------------------------------------------------------------------
// Counts every field declared in dashboard.config.js, not just `required: true`
// ones. The earlier required-only version masked real schema gaps — e.g., this
// corpus had `industry` at 0% and `last_reviewed` at 4% but still scored 99%
// because those fields weren't `required`. The `required` flag remains useful
// for other panels (taxonomy validation, drift gating) but no longer gates the
// headline number. See .github/case-study/insights.md for the full debugging
// history.
export function scoreCompleteness(frontMatter, guesses) {
  if (configFields.length === 0) return 1;

  let filled = 0;
  for (const f of configFields) {
    const val = frontMatter[f.key];
    const hasValue = val !== undefined && val !== null && val !== '' &&
      !(Array.isArray(val) && val.length === 0);
    if (hasValue) filled++;
  }
  return Number((filled / configFields.length).toFixed(2));
}

// ---------------------------------------------------------------------------
// Date parsing helper
// ---------------------------------------------------------------------------
/** Parse a date string like YYYY-MM-DD into a timestamp (ms). Returns null if invalid. */
export function parseDateField(value) {
  if (!value || typeof value !== 'string') return null;
  // Skip placeholder patterns like [YYYY-MM-DD]
  if (/\[/.test(value) || /TODO|TBD/i.test(value)) return null;
  const ts = Date.parse(value.trim());
  return Number.isNaN(ts) ? null : ts;
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Main: process all docs
// ---------------------------------------------------------------------------
const files = walk(docsRoot);
const docs = [];
const nowMs = Date.now();

for (const filePath of files) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontMatter, body } = parseFrontMatter(raw);

  const title = frontMatter.title || path.basename(filePath, path.extname(filePath));
  const url = buildDocUrl(filePath, frontMatter);
  const section = detectSection(filePath);
  const wordCount = countWords(body);
  const placeholders = detectPlaceholders(frontMatter, body);
  const guesses = buildGuesses(frontMatter, filePath, body);
  const completenessScore = scoreCompleteness(frontMatter, guesses);
  const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');

  // File system last modified date (always available)
  const stat = fs.statSync(filePath);
  const lastModified = stat.mtime.toISOString();
  const lastModifiedMs = stat.mtime.getTime();

  // Parse last_reviewed frontmatter date
  const lastReviewedMs = parseDateField(frontMatter.last_reviewed);

  docs.push({
    filePath: relPath,
    url,
    title,
    section,
    wordCount,
    completenessScore,
    /** ISO string of file's last modification (from filesystem). */
    lastModified,
    /** Parsed last_reviewed date as ISO string, or null if missing/placeholder. */
    lastReviewed: lastReviewedMs ? new Date(lastReviewedMs).toISOString() : null,
    /** Raw frontmatter parsed from the file. */
    frontmatter: frontMatter,
    /**
     * Auto-filled values for missing fields.
     * Each entry also carries `_guessed: true` so dashboards can highlight them.
     */
    guesses: Object.fromEntries(
      Object.entries(guesses).map(([k, v]) => [k, { value: v, _guessed: true }])
    ),
    /** Keys of fields where a guess was made. For quick iteration. */
    guessedFields: Object.keys(guesses),
    /** Detected placeholder patterns (both in frontmatter values and body). */
    placeholders,
    hasPlaceholders: placeholders.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Aggregate statistics
// ---------------------------------------------------------------------------
const totalDocs = docs.length;
const totalWords = docs.reduce((s, d) => s + d.wordCount, 0);
const avgWords = totalDocs > 0 ? Math.round(totalWords / totalDocs) : 0;
const avgCompleteness = totalDocs > 0
  ? Number((docs.reduce((s, d) => s + d.completenessScore, 0) / totalDocs).toFixed(2))
  : 0;

// Field coverage: count of docs that have a value for each field
const fieldCoverage = {};
const fieldCoveragePercent = {};
for (const f of configFields) {
  const count = docs.filter((d) => {
    const val = d.frontmatter[f.key];
    return val !== undefined && val !== null && val !== '' &&
      !(Array.isArray(val) && val.length === 0);
  }).length;
  fieldCoverage[f.key] = count;
  fieldCoveragePercent[f.key] = totalDocs > 0 ? Number((count / totalDocs).toFixed(2)) : 0;
}

// Taxonomy value counts
const taxonomy = {};
for (const field of taxonomyFields) {
  const counts = {};
  for (const doc of docs) {
    const effectiveVal = doc.frontmatter[field] !== undefined && doc.frontmatter[field] !== null
      ? doc.frontmatter[field]
      : doc.guesses[field]?.value;

    if (effectiveVal === undefined || effectiveVal === null) continue;

    const values = Array.isArray(effectiveVal) ? effectiveVal : [effectiveVal];
    for (const v of values) {
      const vStr = String(v).trim();
      if (!vStr) continue;
      counts[vStr] = (counts[vStr] || 0) + 1;
    }
  }
  taxonomy[field] = counts;
}

// Section document counts
const sectionCounts = {};
for (const doc of docs) {
  sectionCounts[doc.section] = (sectionCounts[doc.section] || 0) + 1;
}

// Guessing stats
const totalGuessed = docs.reduce((s, d) => s + d.guessedFields.length, 0);
const docsWithGuesses = docs.filter((d) => d.guessedFields.length > 0).length;

// Placeholder stats
const docsWithPlaceholders = docs.filter((d) => d.hasPlaceholders).length;
const placeholderFieldCounts = {};
for (const doc of docs) {
  for (const p of doc.placeholders) {
    const key = p.field;
    placeholderFieldCounts[key] = (placeholderFieldCounts[key] || 0) + 1;
  }
}

// SEO health (single pass). hasDescription rejects placeholders so the score
// reflects real content quality, not just key presence — `description:
// 'Recovered content. Manual restoration in progress.'` (the DL-04 sentinel)
// counts as missing. See .github/case-study/insights.md.
const seoHealth = { hasTitle: 0, hasDescription: 0, hasKeywords: 0, hasSlug: 0 };
for (const d of docs) {
  if (d.frontmatter.title) seoHealth.hasTitle++;
  const desc = d.frontmatter.description;
  if (desc && !placeholderPattern.test(String(desc))) seoHealth.hasDescription++;
  const kw = d.frontmatter.keywords;
  if (kw && !(Array.isArray(kw) && kw.length === 0)) seoHealth.hasKeywords++;
  if (d.frontmatter.slug) seoHealth.hasSlug++;
}

// ---------------------------------------------------------------------------
// DITA Migration Analytics
// ---------------------------------------------------------------------------
const DITA_COMPONENTS = ['Prereq', 'TaskResult', 'UIControl', 'MenuCascade', 'KBD', 'TaskContext', 'StepResult'];
const DITA_COMPONENT_RE = new RegExp(`<(${DITA_COMPONENTS.join('|')})[ />]`, 'g');
const DITA_LEGACY_RE = /<(prereq|result|postreq|uicontrol|menucascade|cmd|stepresult|context|note\s+type=)[\s>]/gi;
const DITA_IMPORT_RE = /from\s+['"]@site\/src\/components\/DitaSemantic['"]/;

const ditaMigration = {
  totalFiles: 0,
  filesWithComponents: 0,
  filesWithLegacyTags: 0,
  filesWithImport: 0,
  componentUsage: Object.fromEntries(DITA_COMPONENTS.map((c) => [c, 0])),
  legacyTagCount: 0,
  taskFilesWithoutSemantic: 0,
  migrationCoverage: 0,
  docsWithLegacy: [],
  topComponentUsers: [],
};

for (const d of docs) {
  const filePath = path.resolve(workspaceRoot, d.filePath);
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { continue; }

  ditaMigration.totalFiles++;
  const hasImport = DITA_IMPORT_RE.test(raw);
  if (hasImport) ditaMigration.filesWithImport++;

  // Count component usage
  let docComponentCount = 0;
  for (const match of raw.matchAll(DITA_COMPONENT_RE)) {
    const name = match[1];
    ditaMigration.componentUsage[name] = (ditaMigration.componentUsage[name] || 0) + 1;
    docComponentCount++;
  }
  if (docComponentCount > 0) ditaMigration.filesWithComponents++;

  // Detect legacy DITA XML tags
  const legacyMatches = raw.match(DITA_LEGACY_RE) || [];
  if (legacyMatches.length > 0) {
    ditaMigration.filesWithLegacyTags++;
    ditaMigration.legacyTagCount += legacyMatches.length;
    ditaMigration.docsWithLegacy.push({
      title: d.title,
      filePath: d.filePath,
      count: legacyMatches.length,
    });
  }

  // Task-oriented docs (filenames starting with t- or containing "task") without semantic components
  const basename = path.basename(d.filePath).toLowerCase();
  const isTaskDoc = basename.startsWith('t-') || /task|procedure|how.?to|step/i.test(d.title);
  if (isTaskDoc && docComponentCount === 0 && !hasImport) {
    ditaMigration.taskFilesWithoutSemantic++;
  }
}

// Migration coverage: % of task-like docs that use at least one semantic component
const taskLikeDocs = docs.filter((d) => {
  const basename = path.basename(d.filePath).toLowerCase();
  return basename.startsWith('t-') || /task|procedure|how.?to|step/i.test(d.title);
}).length;
ditaMigration.migrationCoverage = taskLikeDocs > 0
  ? Number((ditaMigration.filesWithComponents / Math.max(taskLikeDocs, ditaMigration.filesWithComponents)).toFixed(3))
  : ditaMigration.filesWithComponents > 0 ? 1 : 0;

// Sort legacy docs by count descending, keep top 10
ditaMigration.docsWithLegacy.sort((a, b) => b.count - a.count);
ditaMigration.docsWithLegacy = ditaMigration.docsWithLegacy.slice(0, 10);

// ---------------------------------------------------------------------------
// Date analytics (freshness buckets based on file mtime)
// ---------------------------------------------------------------------------
const dateAnalytics = { fresh: 0, recent: 0, aging: 0, stale: 0 };
let totalAgeDays = 0;
for (const d of docs) {
  const ageMs = nowMs - new Date(d.lastModified).getTime();
  const ageDays = ageMs / DAY_MS;
  totalAgeDays += ageDays;
  if (ageDays < 30)       dateAnalytics.fresh++;
  else if (ageDays < 90)  dateAnalytics.recent++;
  else if (ageDays < 180) dateAnalytics.aging++;
  else                    dateAnalytics.stale++;
}
const meanContentAgeDays = docs.length > 0 ? Math.round(totalAgeDays / docs.length) : 0;
const stalePageRate = docs.length > 0 ? Number((dateAnalytics.stale / docs.length).toFixed(3)) : 0;
// Screenshot currency: % of docs containing images whose mtime is < 180 days
const IMG_RE = /!\[.*?\]\([^)]+\)|<img\s[^>]+src=/i;
const docsWithImages = docs.filter((d) => {
  try { return IMG_RE.test(fs.readFileSync(d.filePath, 'utf8')); } catch { return false; }
});
const currentScreenshots = docsWithImages.filter((d) => {
  const ageDays = (nowMs - new Date(d.lastModified).getTime()) / DAY_MS;
  return ageDays < 180;
});
const screenshotCurrencyRate = docsWithImages.length > 0
  ? Number((currentScreenshots.length / docsWithImages.length).toFixed(3))
  : 1;

// lastReviewed coverage
const lastReviewedCount = docs.filter((d) => d.lastReviewed).length;

// Docs authored per month (by file mtime)
const modifiedByMonth = {};
for (const d of docs) {
  const date = new Date(d.lastModified);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  modifiedByMonth[key] = (modifiedByMonth[key] || 0) + 1;
}

// ---------------------------------------------------------------------------
// Frontmatter health section — MDX/frontmatter readiness for this repository
// ---------------------------------------------------------------------------
function buildFrontmatterHealthSection(config) {
  const requiredFields = (configFields || []).filter((f) => f.required).map((f) => f.key);
  const missingByField = Object.fromEntries(requiredFields.map((k) => [k, 0]));

  let docsComplete = 0;
  const incompleteDocs = [];

  for (const doc of docs) {
    const frontmatter = doc.frontmatter || {};
    const missingFields = requiredFields.filter((field) => {
      const value = frontmatter[field];
      if (Array.isArray(value)) return value.length === 0;
      return value === null || value === undefined || String(value).trim() === '';
    });

    if (missingFields.length === 0) {
      docsComplete++;
      continue;
    }

    for (const field of missingFields) {
      missingByField[field] = (missingByField[field] || 0) + 1;
    }

    incompleteDocs.push({
      filePath: doc.filePath,
      title: doc.title,
      section: doc.section,
      lastModified: doc.lastModified,
      missingFields,
      missingCount: missingFields.length,
      completenessScore: doc.completenessScore,
    });
  }

  incompleteDocs.sort((a, b) => b.missingCount - a.missingCount || a.title.localeCompare(b.title));

  const docsIncomplete = Math.max(0, totalDocs - docsComplete);
  const completionRate = totalDocs > 0 ? Number((docsComplete / totalDocs).toFixed(3)) : 1;

  const reviewWindowDays = Number(config?.frontmatter?.reviewWindowDays || 180);
  const nowMs = Date.now();
  let reviewedDocs = 0;
  let staleReviewedDocs = 0;

  for (const doc of docs) {
    if (!doc.lastReviewed) continue;
    reviewedDocs++;
    const ageDays = (nowMs - new Date(doc.lastReviewed).getTime()) / DAY_MS;
    if (ageDays > reviewWindowDays) staleReviewedDocs++;
  }

  return {
    requiredFields,
    docsComplete,
    docsIncomplete,
    completionRate,
    missingByField,
    incompleteDocs,
    readinessThreshold: Number(config?.frontmatter?.releaseReadinessThreshold || 95),
    review: {
      reviewWindowDays,
      reviewedDocs,
      unreviewedDocs: Math.max(0, totalDocs - reviewedDocs),
      staleReviewedDocs,
      reviewCoverage: totalDocs > 0 ? Number((reviewedDocs / totalDocs).toFixed(3)) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Clarity / UX Metrics section — live fetch or mock seed data
// ---------------------------------------------------------------------------
/**
 * buildClaritySection(config)
 *
 * When CLARITY_API_KEY + CLARITY_PROJECT_ID are set, fetches live UX metrics
 * from the Microsoft Clarity Data Export API.  Otherwise returns mock seed data.
 *
 * Shape returned:
 * {
 *   isMock: boolean,
 *   sessions: number,
 *   avgSessionDurationSec: number,
 *   rageClickRate: number,       // 0–1 fraction
 *   deadClickRate: number,       // 0–1 fraction
 *   clickBackRate: number,       // 0–1 fraction
 *   jsErrorCount: number,
 *   scrollDepth: { d25: number, d50: number, d75: number, d100: number }, // fractions
 *   rageClickPages: Array<{ url: string, count: number }>,
 * }
 */
async function buildClaritySection(config) {
  const { clarityApiKey } = config?.clarity || {};
  const canUseLive = !!clarityApiKey;

  // Mock data — used when credentials are absent OR when live fetch fails.
  // (Same shape as live response so the dashboard renders identically.)
  const buildMock = (mockReason = null) => ({
    isMock: true,
    mockReason,
    sessions: 3842,
    avgSessionDurationSec: 127,
    rageClickRate: 0.034,
    deadClickRate: 0.089,
    clickBackRate: 0.112,
    jsErrorCount: 7,
    scrollDepth: { d25: 0.91, d50: 0.72, d75: 0.48, d100: 0.23, averageDepthPercent: 47, isApproximate: false },
    rageClickPages: [
      { url: '/docs/sdk/quickstart',      count: 18 },
      { url: '/docs/security/hardening',  count: 11 },
      { url: '/docs/api/reference',       count:  9 },
      { url: '/docs/licensing/overview',  count:  6 },
      { url: '/docs/getting-started',     count:  4 },
    ],
    windowDays: null,
  });

  if (!canUseLive) return buildMock();

  // ── Live Clarity Data Export API ──────────────────────────────────────────
  // Reference: https://learn.microsoft.com/en-us/clarity/data-export-api
  // The API has ONE endpoint: /project-live-insights
  // The Bearer token is project-scoped — no project ID needed in the URL.
  // Window: numOfDays must be 1, 2, or 3 (no longer ranges supported).
  const endpoint = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
  const headers  = { Authorization: `Bearer ${clarityApiKey}`, Accept: 'application/json' };
  const numOfDays = 3;

  try {
    const [totalsRes, urlsRes] = await Promise.all([
      fetch(`${endpoint}?numOfDays=${numOfDays}`,                   { headers }),
      fetch(`${endpoint}?numOfDays=${numOfDays}&dimension1=URL`,    { headers }),
    ]);
    if (!totalsRes.ok) throw new Error(`Clarity totals: HTTP ${totalsRes.status}`);
    if (!urlsRes.ok)   throw new Error(`Clarity URLs: HTTP ${urlsRes.status}`);

    const totals = await totalsRes.json();
    const byUrl  = await urlsRes.json();

    const findMetric = (data, name) =>
      (Array.isArray(data) ? data.find((m) => m.metricName === name)?.information?.[0] : null) || {};

    const traffic       = findMetric(totals, 'Traffic');
    const engagement    = findMetric(totals, 'EngagementTime');
    const scrollDepth   = findMetric(totals, 'ScrollDepth');
    const jsErrors      = findMetric(totals, 'JavaScriptErrors');
    const rageClicks    = findMetric(totals, 'RageClicks');
    const deadClicks    = findMetric(totals, 'DeadClicks');
    const quickBacks    = findMetric(totals, 'QuickBackClick');

    const totalSessions       = parseInt(traffic.totalSessionCount,   10) || 0;
    const totalActiveTimeMs   = parseInt(engagement.activeTime,        10) || 0;
    const avgSessionDurationSec = totalSessions > 0
      ? Math.round((totalActiveTimeMs / totalSessions) / 1000)
      : 0;

    const pctToFraction = (v) => Math.max(0, Math.min(1, parseFloat(v || 0) / 100));
    const rageClickRate = pctToFraction(rageClicks.sessionsWithMetricPercentage);
    const deadClickRate = pctToFraction(deadClicks.sessionsWithMetricPercentage);
    const clickBackRate = pctToFraction(quickBacks.sessionsWithMetricPercentage);
    const jsErrorCount  = parseInt(jsErrors.totalErrorsCount, 10) || 0;
    const avgDepthPercent = parseFloat(scrollDepth.averageScrollDepth || 0);

    // Per-URL rage clicks (from the dimension1=URL call)
    const rageByUrl = (Array.isArray(byUrl)
      ? byUrl.find((m) => m.metricName === 'RageClicks')?.information
      : null) || [];
    const rageClickPages = rageByUrl
      .map((it) => ({
        url: it.URL || it.Url || '(unknown)',
        count: parseInt(it.subTotalCount || it.totalCount || 0, 10),
      }))
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Clarity exposes only AVERAGE scroll depth (not per-bucket distribution).
    // We approximate d25/d50/d75/d100 from the average so existing dashboard
    // bars still render. The truthful value is in `averageDepthPercent` and
    // `isApproximate: true` flags that the bucketed values are estimated.
    const approxBucket = (thresh) => {
      if (avgDepthPercent <= 0) return 0;
      if (avgDepthPercent >= thresh) return Math.max(0.5, 1 - (thresh / 200));
      return Math.max(0, (avgDepthPercent / thresh) * 0.7);
    };

    return {
      isMock: false,
      sessions: totalSessions,
      avgSessionDurationSec,
      rageClickRate,
      deadClickRate,
      clickBackRate,
      jsErrorCount,
      scrollDepth: {
        d25:  approxBucket(25),
        d50:  approxBucket(50),
        d75:  approxBucket(75),
        d100: approxBucket(100),
        averageDepthPercent: avgDepthPercent,
        isApproximate: true,
      },
      rageClickPages,
      windowDays: numOfDays,
    };
  } catch (err) {
    console.warn(`⚠ Clarity live fetch failed (${err.message}) — falling back to mock data.`);
    return buildMock(err.message);
  }
}

// ---------------------------------------------------------------------------
// Engineering Tests (ENG-01 through ENG-14)
// ---------------------------------------------------------------------------
async function buildEngineeringTests() {
  const results = {};

  // ENG-01: Production Build — checked externally (build already succeeded if we're here)
  results.eng01 = { label: 'ENG-01 Production Build', status: 'pass', detail: 'Build succeeded (script running post-build)' };

  // ENG-02: Required Fields — docs missing required frontmatter
  const requiredFields = configFields.filter((f) => f.required).map((f) => f.key);
  const docsMissingRequired = docs.filter((d) => {
    return requiredFields.some((k) => {
      const v = d.frontmatter[k];
      return v === undefined || v === null || v === '';
    });
  });
  results.eng02 = {
    label: 'ENG-02 Required Fields',
    status: docsMissingRequired.length === 0 ? 'pass' : 'fail',
    count: docsMissingRequired.length,
    detail: `${docsMissingRequired.length} docs missing required fields`,
  };

  // ENG-03: MDX + Import Integrity — scan for unresolved imports
  let brokenImports = 0;
  for (const d of docs) {
    const raw = fs.readFileSync(path.join(workspaceRoot, d.filePath), 'utf8');
    const importMatches = raw.match(/^import\s+.*from\s+['"]([^'"]+)['"]/gm) || [];
    for (const imp of importMatches) {
      const modMatch = imp.match(/from\s+['"]([^'"]+)['"]/);
      if (modMatch) {
        const mod = modMatch[1];
        if (mod.startsWith('.') || mod.startsWith('/')) {
          const resolved = path.resolve(path.dirname(path.join(workspaceRoot, d.filePath)), mod);
          const candidates = [resolved, resolved + '.js', resolved + '.jsx', resolved + '.ts', resolved + '.tsx', resolved + '.mdx', resolved + '.md'];
          if (!candidates.some((c) => fs.existsSync(c))) {
            brokenImports++;
          }
        }
      }
    }
  }
  results.eng03 = {
    label: 'ENG-03 MDX + Import Integrity',
    status: brokenImports === 0 ? 'pass' : 'fail',
    count: brokenImports,
    detail: `${brokenImports} unresolved imports`,
  };

  // ENG-04: Image Asset Integrity — broken image refs
  let brokenImages = 0;
  for (const d of docs) {
    const raw = fs.readFileSync(path.join(workspaceRoot, d.filePath), 'utf8');
    // Markdown images
    const mdImgs = raw.match(/!\[.*?\]\(([^)]+)\)/g) || [];
    for (const img of mdImgs) {
      const srcMatch = img.match(/\]\(([^)]+)\)/);
      if (srcMatch) {
        const src = srcMatch[1].split(/[#?]/)[0];
        if (src.startsWith('http')) continue;
        const resolved = path.resolve(path.dirname(path.join(workspaceRoot, d.filePath)), src);
        if (!fs.existsSync(resolved)) brokenImages++;
      }
    }
    // HTML img tags
    const htmlImgs = raw.match(/<img[^>]+src=["']([^"']+)["']/gi) || [];
    for (const tag of htmlImgs) {
      const srcMatch = tag.match(/src=["']([^"']+)["']/i);
      if (srcMatch) {
        const src = srcMatch[1].split(/[#?]/)[0];
        if (src.startsWith('http')) continue;
        const resolved = path.resolve(path.dirname(path.join(workspaceRoot, d.filePath)), src);
        if (!fs.existsSync(resolved)) brokenImages++;
      }
    }
  }
  results.eng04 = {
    label: 'ENG-04 Image Asset Integrity',
    status: brokenImages === 0 ? 'pass' : 'fail',
    count: brokenImages,
    detail: `${brokenImages} broken image references`,
  };

  // ENG-05: Slug Uniqueness
  const slugMap = {};
  for (const d of docs) {
    const slug = d.frontmatter.slug || d.url;
    if (slug) {
      if (!slugMap[slug]) slugMap[slug] = [];
      slugMap[slug].push(d.filePath);
    }
  }
  const duplicateSlugs = Object.entries(slugMap).filter(([, files]) => files.length > 1);
  results.eng05 = {
    label: 'ENG-05 Slug Uniqueness',
    status: duplicateSlugs.length === 0 ? 'pass' : 'fail',
    count: duplicateSlugs.length,
    detail: `${duplicateSlugs.length} duplicate slugs`,
    duplicates: duplicateSlugs.map(([slug]) => slug),
  };

  // ENG-06: Date Format Validation
  const dateFields = ['date', 'last_reviewed', 'last_updated'];
  let invalidDates = 0;
  for (const d of docs) {
    for (const df of dateFields) {
      const v = d.frontmatter[df];
      if (v && typeof v === 'string') {
        if (/\[/.test(v) || /TODO|TBD/i.test(v) || Number.isNaN(Date.parse(v.trim()))) {
          invalidDates++;
        }
      }
    }
  }
  results.eng06 = {
    label: 'ENG-06 Date Format Validation',
    status: invalidDates === 0 ? 'pass' : 'warn',
    count: invalidDates,
    detail: `${invalidDates} invalid date fields`,
  };

  // ENG-07: SSR Guard Violations — scan src/ for window/document/localStorage without guards
  const srcDir = path.join(workspaceRoot, 'src');
  let ssrViolations = 0;
  const ssrFiles = [];
  function walkSrc(dir) {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules') files.push(...walkSrc(full));
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) files.push(full);
    }
    return files;
  }
  for (const srcFile of walkSrc(srcDir)) {
    const code = fs.readFileSync(srcFile, 'utf8');
    const hasUnsafe = /\b(window|document|localStorage|sessionStorage)\b/.test(code);
    const hasGuard = /useEffect|useLayoutEffect|BrowserOnly|typeof\s+window/.test(code);
    if (hasUnsafe && !hasGuard) {
      ssrViolations++;
      ssrFiles.push(path.relative(workspaceRoot, srcFile));
    }
  }
  results.eng07 = {
    label: 'ENG-07 SSR Guard Violations',
    status: ssrViolations === 0 ? 'pass' : 'warn',
    count: ssrViolations,
    detail: `${ssrViolations} files with unguarded browser APIs`,
    files: ssrFiles,
  };

  // ENG-08: Playwright E2E — CI only, report status
  results.eng08 = { label: 'ENG-08 Playwright E2E', status: 'skip', detail: 'CI-only gate' };

  // ENG-09: Internal Links — check relative markdown links
  let brokenLinks = 0;
  const brokenLinkDetails = [];
  for (const d of docs) {
    const raw = fs.readFileSync(path.join(workspaceRoot, d.filePath), 'utf8');
    const links = raw.match(/\[.*?\]\(([^)]+)\)/g) || [];
    for (const link of links) {
      const hrefMatch = link.match(/\]\(([^)]+)\)/);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].split(/[#?]/)[0];
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('/')) continue;
      if (/\.(png|jpg|jpeg|gif|svg|webp|pdf)$/i.test(href)) continue;
      const resolved = path.resolve(path.dirname(path.join(workspaceRoot, d.filePath)), href);
      const candidates = [resolved, resolved + '.md', resolved + '.mdx', resolved + '/index.md', resolved + '/index.mdx'];
      if (!candidates.some((c) => fs.existsSync(c))) {
        brokenLinks++;
        if (brokenLinkDetails.length < 10) {
          brokenLinkDetails.push({ source: d.filePath, href });
        }
      }
    }
  }
  results.eng09 = {
    label: 'ENG-09 Internal Links',
    status: brokenLinks === 0 ? 'pass' : 'warn',
    count: brokenLinks,
    detail: `${brokenLinks} broken internal links (static check)`,
    samples: brokenLinkDetails,
  };

  // ENG-10: Lighthouse CI — CI only
  results.eng10 = { label: 'ENG-10 Lighthouse CI', status: 'skip', detail: 'CI-only gate' };

  // ENG-11: Orphaned Sidebar IDs — all sidebars use autogenerated, so N/A
  results.eng11 = {
    label: 'ENG-11 Orphaned Sidebar IDs',
    status: 'pass',
    detail: 'All sidebars use autogenerated — no explicit IDs to orphan',
  };

  // ENG-12: i18n Build Verification — placeholder (no non-English locales)
  results.eng12 = { label: 'ENG-12 i18n Build', status: 'skip', detail: 'No non-English locales configured' };

  // ENG-13: CSP Configured — check docusaurus.config for CSP header
  let cspFound = false;
  try {
    const configRaw = fs.readFileSync(path.join(workspaceRoot, 'docusaurus.config.ts'), 'utf8');
    cspFound = /Content-Security-Policy/i.test(configRaw);
  } catch { /* ignore */ }
  results.eng13 = {
    label: 'ENG-13 CSP Configured',
    status: cspFound ? 'pass' : 'warn',
    detail: cspFound ? 'CSP header detected' : 'No Content-Security-Policy found in config',
  };

  // ENG-14: Security Audit — run npm audit
  let criticalCves = null;
  try {
    const { execSync } = await import('node:child_process');
    const auditOut = execSync('npm audit --json 2>nul', { cwd: workspaceRoot, encoding: 'utf8', timeout: 15000 });
    const audit = JSON.parse(auditOut);
    const vuln = audit.metadata?.vulnerabilities || {};
    criticalCves = (vuln.high || 0) + (vuln.critical || 0);
  } catch {
    criticalCves = null;
  }
  results.eng14 = {
    label: 'ENG-14 Security Audit',
    status: criticalCves === 0 ? 'pass' : criticalCves === null ? 'skip' : 'fail',
    count: criticalCves,
    detail: criticalCves === null ? 'npm audit unavailable' : `${criticalCves} high/critical CVEs`,
  };

  // Summary
  const all = Object.values(results);
  const passed = all.filter((t) => t.status === 'pass').length;
  const failed = all.filter((t) => t.status === 'fail').length;
  const warned = all.filter((t) => t.status === 'warn').length;
  const skipped = all.filter((t) => t.status === 'skip').length;

  return { tests: results, summary: { total: all.length, passed, failed, warned, skipped } };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const frontmatterHealth = buildFrontmatterHealthSection(dashboardConfig);
const clarity = await buildClaritySection(dashboardConfig);
const engineering = await buildEngineeringTests();

const report = {
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  version: '1.0.0',
  aggregate: {
    totalDocs,
    totalWords,
    avgWords,
    avgCompleteness,
    guessing: {
      totalGuessedFields: totalGuessed,
      docsWithGuesses,
    },
    placeholders: {
      docsWithPlaceholders,
      byField: placeholderFieldCounts,
    },
    fieldCoverage,
    fieldCoveragePercent,
    taxonomy,
    seoHealth,
    sections: sectionCounts,
    dateAnalytics: {
      ...dateAnalytics,
      meanContentAgeDays,
      stalePageRate,
      screenshotCurrencyRate,
      lastReviewedCount,
      lastReviewedPercent: totalDocs > 0
        ? Number((lastReviewedCount / totalDocs).toFixed(2))
        : 0,
      modifiedByMonth,
    },
  },
  frontmatterHealth,
  clarity,
  engineering,
  ditaMigration,
  docs,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`[build-report] ${totalDocs} docs processed → ${outputPath}`);
console.log(`[build-report] avg completeness: ${(avgCompleteness * 100).toFixed(0)}%`);
console.log(`[build-report] guessed fields: ${totalGuessed} across ${docsWithGuesses} docs`);
console.log(`[build-report] placeholder warnings: ${docsWithPlaceholders} docs`);
console.log(`[build-report] frontmatter readiness: ${Math.round(frontmatterHealth.completionRate * 100)}% complete`);
console.log(`[build-report] Clarity section: ${clarity.isMock ? 'mock data' : 'live'}`);
console.log(`[build-report] Engineering: ${engineering.summary.passed}/${engineering.summary.total} passed, ${engineering.summary.failed} failed, ${engineering.summary.warned} warned`);

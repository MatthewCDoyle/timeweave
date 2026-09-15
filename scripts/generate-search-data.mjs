#!/usr/bin/env node
/**
 * scripts/generate-search-data.mjs
 * ============================================================================
 * Walks all .mdx/.md files in docs/, extracts frontmatter metadata, and
 * outputs static/data/search-data.json for the FilterableDocsUI component.
 *
 * Output format:
 *   {
 *     "documents": [ { url, title, summary, content_type, device_type, ... } ],
 *     "taxonomy":  { "content_type": [{id, name}, ...], ... }
 *   }
 *
 * Usage:
 *   node scripts/generate-search-data.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(workspaceRoot, 'docs');
const outputDir = path.join(workspaceRoot, 'static', 'data');
const outputPath = path.join(outputDir, 'search-data.json');

// Taxonomy facets to expose in the UI (must match frontmatter keys).
const FACET_KEYS = [
  'content_type',
  'device_type',
  'product_family',
  'product_name',
  'role',
  'use_case',
  'task',
  'industry',
  'skill_level',
];

// Seed values that always appear in the taxonomy even if no doc uses them yet.
const TAXONOMY_SEEDS = {
  product_name: [
    'Aurora Focus',
    'FS10',
    'FS20',
    'FS42',
    'FS80',
    'JavaScript',
    'VS20',
    'ZIML',
  ],
};

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
// Frontmatter parser
// ---------------------------------------------------------------------------
function parseFrontMatter(content) {
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
    if (rawValue.startsWith('[')) {
      result[key] = parseInlineArray(rawValue);
      i++; continue;
    }
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
      result[key] = items.length > 0 ? items : null;
      continue;
    }
    result[key] = rawValue.replace(/^['"]|['"]$/g, '').trim();
    i++;
  }
  return result;
}

function stripInlineComment(str) {
  let inSingle = false, inDouble = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === '#' && !inSingle && !inDouble) return str.slice(0, i);
  }
  return str;
}

function parseInlineArray(str) {
  const inner = str.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Path-based product_name auto-tagging
// Maps doc path prefixes to product names (applied when frontmatter is missing
// or to supplement existing tags).
// ---------------------------------------------------------------------------
const PATH_PRODUCT_MAP = [
  { prefix: 'fs10-prg/',  product: 'FS10' },
  { prefix: 'fs42-prg/',  product: 'FS42' },
  { prefix: 'fs80-prg/',  product: 'FS80' },
  { prefix: 'xs20-prg/',  product: 'VS20' },
  { prefix: 'ziml-prg/',  product: 'ZIML' },
  { prefix: 'js-guide/',  product: 'JavaScript' },
];

// ---------------------------------------------------------------------------
// Path patterns to exclude from search results entirely.
// ---------------------------------------------------------------------------
const PATH_EXCLUDE_PATTERNS = [
  /about-this-guide/i,
  /about-the-guide/i,
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(docsRoot)) {
    console.error(`docs/ directory not found at ${docsRoot}`);
    process.exit(1);
  }

  const files = walk(docsRoot);
  const documents = [];
  /** @type {Record<string, Map<string, string>>} */
  const taxonomySets = {};
  FACET_KEYS.forEach(k => { taxonomySets[k] = new Map(); });

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
    const { frontMatter, body } = parseFrontMatter(raw);

    if (!frontMatter.title) continue; // skip files without a title

    // Build Docusaurus URL from file path
    const relPath = path.relative(docsRoot, filePath);
    const relUrl = relPath.replace(/\\/g, '/');

    // Skip excluded paths
    if (PATH_EXCLUDE_PATTERNS.some(re => re.test(relUrl))) continue;

    const url = '/' + relUrl
      .replace(/\/index\.(mdx|md)$/i, '')
      .replace(/\.(mdx|md)$/i, '');

    const doc = {
      url,
      title: frontMatter.title,
      summary: frontMatter.description || '',
    };

    // Attach facet values and collect taxonomy entries
    for (const key of FACET_KEYS) {
      const val = frontMatter[key];
      if (val == null) {
        doc[key] = [];
        continue;
      }
      const arr = Array.isArray(val) ? val : [val];
      doc[key] = arr;

      for (const v of arr) {
        if (v && !taxonomySets[key].has(v)) {
          taxonomySets[key].set(v, toLabel(v));
        }
      }
    }

    // Auto-tag product_name based on file path
    for (const { prefix, product } of PATH_PRODUCT_MAP) {
      if (relUrl.startsWith(prefix) && !doc.product_name.includes(product)) {
        doc.product_name.push(product);
        if (!taxonomySets.product_name.has(product)) {
          taxonomySets.product_name.set(product, toLabel(product));
        }
      }
    }

    documents.push(doc);
  }

  // Build taxonomy object with sorted option lists
  // Inject seed values so they always appear as dropdown options
  for (const [key, seeds] of Object.entries(TAXONOMY_SEEDS)) {
    if (!taxonomySets[key]) continue;
    for (const seed of seeds) {
      if (!taxonomySets[key].has(seed)) {
        taxonomySets[key].set(seed, toLabel(seed));
      }
    }
  }

  const taxonomy = {};
  for (const key of FACET_KEYS) {
    const entries = [...taxonomySets[key].entries()];
    if (entries.length === 0) continue; // omit empty facets
    taxonomy[key] = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, name]) => ({ id, name }));
  }

  // Write output
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = { documents, taxonomy };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`search-data.json: ${documents.length} documents, ${Object.keys(taxonomy).length} facets → ${outputPath}`);
}

/** Convert a slug-style value to a human-readable label. */
function toLabel(str) {
  return str
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

main();

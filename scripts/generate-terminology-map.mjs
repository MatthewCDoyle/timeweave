#!/usr/bin/env node
/**
 * scripts/generate-terminology-map.mjs
 * ============================================================================
 * Parses .content/style-rules.md and emits .content/terminology-map.json.
 *
 * Looks for blocks of the form:
 *
 *   **Key pairs (Use → Do Not Use):**
 *   - "<canonical>" → "<variant>," "<variant>," ...
 *   - ...
 *
 * Each bulleted line becomes a `terms[]` entry:
 *   { canonical: "...", variants: ["...", ...], ruleId: "RULE-019",
 *     severity: "high", note?: "parenthetical context if present" }
 *
 * Multiple canonicals per line are split on commas:
 *   - "for example," "such as" → "e.g.," "etc."
 *   →  yields TWO entries (one per canonical), sharing the same variants list.
 *
 * Parenthetical context (e.g., "(except in table headers)") is preserved as
 * a `note` field and NOT mixed into variants.
 *
 * Records the git SHA of style-rules.md so each map is traceable to a
 * specific rules version.
 *
 * Usage:
 *   node scripts/generate-terminology-map.mjs
 *   node scripts/generate-terminology-map.mjs --rules .content/style-rules.md \
 *                                              --output .content/terminology-map.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const root       = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const flag = (k, def) => {
  const m = args.find((a) => a.startsWith(`--${k}=`));
  return m ? m.split('=').slice(1).join('=') : def;
};
const rulesPath  = path.resolve(root, flag('rules',  '.content/style-rules.md'));
const outputPath = path.resolve(root, flag('output', '.content/terminology-map.json'));

// --- Parse helpers ---------------------------------------------------------

function gitSha(filePath) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path.relative(root, filePath).replace(/\\/g, '/')}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

/**
 * Split a comma-separated list of double-quoted terms into an array.
 *   `"a," "b," "c"`  →  ['a', 'b', 'c']
 * Tolerates inconsistent whitespace and trailing punctuation.
 */
function splitQuoted(input) {
  const out = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(input)) !== null) out.push(m[1].trim());
  return out;
}

/**
 * Extract any trailing parenthetical from a line and return [stripped, note].
 *   `"a" → "b" (only in headings)`  →  [`"a" → "b"`, `only in headings`]
 */
function splitParenthetical(line) {
  const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return [line, null];
  // Don't peel the paren if the inside still contains a quoted term — that's
  // a real terminology variant in parens, not a note.
  if (/"[^"]+"/.test(m[2])) return [line, null];
  return [m[1].trim(), m[2].trim()];
}

function parseRulesFile(text) {
  const lines = text.split(/\r?\n/);
  const terms = [];
  let currentRule = null;
  let currentSeverity = null;
  let inKeyPairs = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const ruleMatch = line.match(/^### (RULE-\d+)/);
    if (ruleMatch) {
      currentRule = ruleMatch[1];
      currentSeverity = null;
      inKeyPairs = false;
      continue;
    }
    if (line.startsWith('---')) { inKeyPairs = false; continue; }

    const sevMatch = line.match(/^\*\*Severity:\*\*\s*(\w+)/);
    if (sevMatch) currentSeverity = sevMatch[1].toLowerCase();

    if (/^\*\*Key pairs/.test(line)) { inKeyPairs = true; continue; }

    if (inKeyPairs && /^\s*-\s+/.test(line)) {
      const body = line.replace(/^\s*-\s+/, '');
      const [stripped, note] = splitParenthetical(body);
      const arrowIdx = stripped.indexOf('→');
      if (arrowIdx === -1) continue;

      const canonicalPart = stripped.slice(0, arrowIdx);
      const variantPart   = stripped.slice(arrowIdx + 1);

      const canonicals = splitQuoted(canonicalPart);
      const variants   = splitQuoted(variantPart);

      if (!canonicals.length || !variants.length) continue;

      // Multiple canonicals on one line: emit a separate entry per canonical
      // so the drift scanner can flag any variant → any canonical.
      for (const canonical of canonicals) {
        terms.push({
          canonical,
          variants: [...new Set(variants)],
          ruleId: currentRule,
          severity: currentSeverity,
          ...(note ? { note } : {}),
        });
      }
    }
  }
  return terms;
}

// --- Main ------------------------------------------------------------------

if (!fs.existsSync(rulesPath)) {
  console.error(`✗ Rules file not found at ${rulesPath}`);
  process.exit(1);
}

const text   = fs.readFileSync(rulesPath, 'utf8');
const terms  = parseRulesFile(text);

// Sanity stats
const totalCanonicals = new Set(terms.map((t) => t.canonical.toLowerCase())).size;
const totalVariants   = terms.reduce((s, t) => s + t.variants.length, 0);
const ruleIds         = [...new Set(terms.map((t) => t.ruleId))].sort();

const output = {
  generatedAt: new Date().toISOString(),
  sourceRulesFileSha: gitSha(rulesPath),
  rulesPath: path.relative(root, rulesPath).replace(/\\/g, '/'),
  totals: {
    canonicalTerms: totalCanonicals,
    totalEntries: terms.length,
    totalVariants,
    rulesRepresented: ruleIds,
  },
  terms,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

console.log(`✓ Generated terminology map → ${path.relative(root, outputPath).replace(/\\/g, '/')}`);
console.log(`  Source SHA: ${output.sourceRulesFileSha || '(not in git)'}`);
console.log(`  Canonical terms: ${totalCanonicals}`);
console.log(`  Total entries:   ${terms.length}`);
console.log(`  Total variants:  ${totalVariants}`);
console.log(`  Rules covered:   ${ruleIds.join(', ')}`);

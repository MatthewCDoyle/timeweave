#!/usr/bin/env node
/**
 * scripts/parse-style-rules.mjs
 * ============================================================================
 * Parses .content/style-rules.md (the canonical TCM Style Rules source) and
 * merges it with .content/rule-patterns.json (the regex+fix sidecar) to
 * produce .content/rule-registry.json — the runtime rule registry consumed
 * by scripts/editor-activate.mjs.
 *
 * Why a parser + sidecar (not just the markdown):
 *   - The markdown is human-authored. Most rules use sentence-shaped
 *     Do/Don't examples that illustrate intent but can't be reduced to a
 *     regex automatically (e.g., "use active voice").
 *   - The sidecar provides explicit regex + fix templates only for rules
 *     whose enforcement logic isn't auto-derivable. Terminology rules
 *     (RULE-019, RULE-020) WITH `**Key pairs (Use → Do Not Use):**` blocks
 *     are auto-derived directly from the markdown.
 *   - The parser merges metadata (category, severity, directive, do,
 *     don't, exception, note, enforceable) from the markdown with the
 *     pattern data from the sidecar.
 *
 * Output shape:
 *   {
 *     generatedAt, sourceRulesFileSha, sourcePatternsFileSha,
 *     totals: { total, enforceable, guidance, autoDerived,
 *               fromSidecar, unimplemented },
 *     rules: [{ id, category, severity, directive, enforceable,
 *               do, don't, exception, note,
 *               patterns: [{ regex, flags, phase, fix, msg, source }],
 *               patternSource: 'auto-derived' | 'sidecar' | 'none' }, ...]
 *   }
 *
 * Usage:
 *   node scripts/parse-style-rules.mjs
 *   node scripts/parse-style-rules.mjs --rules .content/style-rules.md \
 *                                       --patterns .content/rule-patterns.json \
 *                                       --output .content/rule-registry.json
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
const rulesPath    = path.resolve(root, flag('rules',    '.content/style-rules.md'));
const patternsPath = path.resolve(root, flag('patterns', '.content/rule-patterns.json'));
const outputPath   = path.resolve(root, flag('output',   '.content/rule-registry.json'));

// --- helpers ---------------------------------------------------------------

function gitSha(filePath) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path.relative(root, filePath).replace(/\\/g, '/')}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function splitQuoted(input) {
  const out = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(input)) !== null) out.push(m[1].trim());
  return out;
}

function splitParenthetical(line) {
  const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return [line, null];
  if (/"[^"]+"/.test(m[2])) return [line, null];
  return [m[1].trim(), m[2].trim()];
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// --- parse style-rules.md into structured rule blocks ---------------------

function parseRules(text) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let cur = null;

  function pushCurrent() {
    if (cur && cur.id) blocks.push(cur);
    cur = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ruleMatch = line.match(/^### (RULE-\d+|GUIDANCE-\d+)\s*$/);
    if (ruleMatch) {
      pushCurrent();
      cur = {
        id: ruleMatch[1],
        category: null, severity: null, enforceable: null,
        directive: null, exception: null, note: null,
        doExamples: [], dontExamples: [],
        keyPairs: [],   // [{ canonicals: [...], variants: [...], note? }]
      };
      continue;
    }
    if (!cur) continue;

    if (line.startsWith('---')) {
      pushCurrent();
      continue;
    }

    let m;
    if ((m = line.match(/^\*\*Category:\*\*\s*(.+)$/)))     cur.category    = m[1].trim();
    else if ((m = line.match(/^\*\*Severity:\*\*\s*(\w+)/)))cur.severity    = m[1].toLowerCase();
    else if ((m = line.match(/^\*\*Enforceable:\*\*\s*(.+)$/))) {
      const v = m[1].trim().toLowerCase();
      cur.enforceable = v.startsWith('yes');
    }
    else if ((m = line.match(/^\*\*Directive:\*\*\s*(.+)$/))) cur.directive = m[1].trim();
    else if ((m = line.match(/^\*\*Do:\*\*\s*(.+)$/)))      cur.doExamples.push(m[1].trim());
    else if ((m = line.match(/^\*\*Don't:\*\*\s*(.+)$/)))   cur.dontExamples.push(m[1].trim());
    else if ((m = line.match(/^\*\*Exception:\*\*\s*(.+)$/))) cur.exception = m[1].trim();
    else if ((m = line.match(/^\*\*Note:\*\*\s*(.+)$/)))    cur.note      = m[1].trim();
    else if (/^\*\*Key pairs/.test(line)) {
      // Collect subsequent bulleted pairs until next blank line or section.
      cur._inKeyPairs = true;
    }
    else if (cur._inKeyPairs && /^\s*-\s+/.test(line)) {
      const body = line.replace(/^\s*-\s+/, '');
      const [stripped, pairNote] = splitParenthetical(body);
      const arrowIdx = stripped.indexOf('→');
      if (arrowIdx === -1) continue;
      const canonicals = splitQuoted(stripped.slice(0, arrowIdx));
      const variants   = splitQuoted(stripped.slice(arrowIdx + 1));
      if (canonicals.length && variants.length) {
        cur.keyPairs.push({ canonicals, variants, ...(pairNote ? { note: pairNote } : {}) });
      }
    }
    else if (cur._inKeyPairs && line.trim() === '') {
      cur._inKeyPairs = false;
    }
  }
  pushCurrent();
  return blocks;
}

// --- auto-derive patterns from Key pairs (terminology rules) --------------

function autoDerivePatterns(rule) {
  if (!rule.keyPairs?.length) return [];
  const patterns = [];
  for (const pair of rule.keyPairs) {
    for (const variant of pair.variants) {
      // Skip variants that ARE one of the canonicals — case-sensitive equality
      if (pair.canonicals.includes(variant)) continue;
      // Pick the first canonical as the suggested fix
      const canonical = pair.canonicals[0];
      const escaped = escapeRegex(variant);
      // Permissive non-letter/digit boundary so phrases like "bar code" match
      const regex = `(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`;
      patterns.push({
        regex,
        flags: 'g',
        phase: 'prose',
        // Auto-derived substitutions are flag-only (PROPOSE), not auto-fix.
        // Many key-pair substitutions are context-dependent and semantically
        // dangerous as blind regex replacements — e.g., "screen" → "window"
        // breaks UI element names like "Configuration screen"; "perform" → "do"
        // alters technical register. The detection is still useful as a signal;
        // a human reviewer decides whether each match is a real violation.
        // Safe substitutions (e.g., "w/" → "with", "WiFi" → "Wi-Fi") can be
        // promoted to fix:canonical via the .content/rule-patterns.json sidecar
        // on a case-by-case basis. See .github/case-study/insights.md.
        fix: null,
        suggestedFix: canonical,
        msg: `Non-canonical "${variant}" — consider "${canonical}"`,
        source: 'auto-derived',
        ...(pair.note ? { contextNote: pair.note } : {}),
      });
    }
  }
  return patterns;
}

// --- main ------------------------------------------------------------------

if (!fs.existsSync(rulesPath)) {
  console.error(`✗ Rules file not found at ${rulesPath}`);
  process.exit(1);
}
if (!fs.existsSync(patternsPath)) {
  console.error(`✗ Patterns sidecar not found at ${patternsPath}`);
  process.exit(1);
}

const rulesText  = fs.readFileSync(rulesPath, 'utf8');
const sidecar    = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
const blocks     = parseRules(rulesText);

const rules = [];
let autoDerived = 0;
let fromSidecar = 0;
let unimplemented = 0;
let enforceable = 0;
let guidance = 0;

for (const b of blocks) {
  if (b.id.startsWith('GUIDANCE-')) guidance++;
  else if (b.enforceable === false) guidance++;
  else enforceable++;

  let patterns = [];
  let patternSource = 'none';

  // 1. Sidecar wins — explicit patterns are the curated source
  if (sidecar[b.id]) {
    patterns = sidecar[b.id].map((p) => ({ ...p, source: 'sidecar' }));
    patternSource = 'sidecar';
    fromSidecar++;
  }
  // 2. Otherwise try auto-derivation from Key pairs
  else if (b.keyPairs.length > 0) {
    patterns = autoDerivePatterns(b);
    patternSource = 'auto-derived';
    if (patterns.length > 0) autoDerived++;
    else unimplemented++;
  }
  // 3. No pattern available
  else {
    unimplemented++;
  }

  rules.push({
    id: b.id,
    category: b.category,
    severity: b.severity,
    enforceable: b.enforceable,
    directive: b.directive,
    do: b.doExamples,
    dont: b.dontExamples,
    ...(b.exception ? { exception: b.exception } : {}),
    ...(b.note ? { note: b.note } : {}),
    ...(b.keyPairs.length > 0 ? { keyPairs: b.keyPairs } : {}),
    patterns,
    patternSource,
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceRulesFileSha: gitSha(rulesPath),
  sourcePatternsFileSha: gitSha(patternsPath),
  paths: {
    rules: path.relative(root, rulesPath).replace(/\\/g, '/'),
    patterns: path.relative(root, patternsPath).replace(/\\/g, '/'),
  },
  totals: {
    total: rules.length,
    enforceable,
    guidance,
    autoDerived,
    fromSidecar,
    unimplemented,
  },
  rules,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

console.log(`✓ Rule registry built → ${path.relative(root, outputPath).replace(/\\/g, '/')}`);
console.log(`  Source rules SHA:    ${output.sourceRulesFileSha || '(not in git)'}`);
console.log(`  Source patterns SHA: ${output.sourcePatternsFileSha || '(not in git)'}`);
console.log(`  Total entries:       ${output.totals.total}  (${enforceable} enforceable + ${guidance} guidance/flag)`);
console.log(`  Patterns by source:  ${output.totals.fromSidecar} sidecar · ${output.totals.autoDerived} auto-derived · ${output.totals.unimplemented} no pattern (metadata-only)`);

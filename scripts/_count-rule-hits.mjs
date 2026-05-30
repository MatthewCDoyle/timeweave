#!/usr/bin/env node
// One-off scanner that bypasses the activate output cap to get true per-rule
// hit counts across the corpus. Throwaway script — for sanity-checking new
// rule patterns before they ship.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(fs.readFileSync(path.join(root, '.content/rule-registry.json'), 'utf8'));

function buildFix(t) { return t == null ? null : (m) => String(t).replace(/\$([0-9&])/g, (_, k) => k === '&' ? m[0] : (m[parseInt(k,10)] ?? '')); }
const rules = [];
for (const r of reg.rules) {
  for (const p of r.patterns || []) {
    rules.push({ id: r.id, sev: r.severity, re: new RegExp(p.regex, p.flags || 'g'), fix: buildFix(p.fix) });
  }
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(f));
    else if (/\.(md|mdx)$/i.test(e.name)) out.push(f);
  }
  return out;
}
function extractProse(s) {
  return s.replace(/^---[\s\S]*?---\s*/, '').replace(/^import\s+.*$/gm, '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/<[^>]+>/g, '');
}

const files = walk(path.join(root, 'docs'));
const counts = {};
for (const f of files) {
  const prose = extractProse(fs.readFileSync(f, 'utf8'));
  for (const rule of rules) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    const matches = prose.match(re);
    if (matches) counts[rule.id] = (counts[rule.id] || 0) + matches.length;
  }
}

console.log(`Files scanned: ${files.length}`);
console.log('');
console.log('Hits per rule (descending):');
for (const [k, v] of Object.entries(counts).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k.padEnd(14)}${v}`);
}
console.log('');
console.log(`Total: ${Object.values(counts).reduce((s,v)=>s+v,0)}`);

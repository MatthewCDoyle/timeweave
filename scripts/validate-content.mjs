#!/usr/bin/env node
// Validates timeweave-events/timeweave-articles frontmatter against schema/*.schema.json,
// enforces the cross-file business rules from the schema design doc, computes the
// derived `enables` reverse index, and writes generated manifest/content JSON.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import matter from 'gray-matter';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVENTS_DIR = path.join(ROOT, 'timeweave-events');
const ARTICLES_DIR = path.join(ROOT, 'timeweave-articles');
const OUT_DIR = path.join(ROOT, '.timeweave', 'generated');

const SPECULATIVE_CONFIDENCES = new Set([
  'speculative',
  'speculative-low-confidence',
  'speculative-narrative',
  'speculative-unsourced',
  'unsubstantiated',
]);

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', name), 'utf8'));
}

function findContentFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findContentFiles(full));
    } else if (/\.mdx?$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  const ajv = new Ajv2020({allErrors: true, strict: false});
  addFormats(ajv);
  ajv.addSchema(loadSchema('shared-defs.schema.json'));
  const validateEvent = ajv.compile(loadSchema('event.schema.json'));
  const validateArticle = ajv.compile(loadSchema('article.schema.json'));

  const errors = [];
  const records = [];

  for (const file of findContentFiles(EVENTS_DIR)) {
    const relPath = path.relative(ROOT, file);
    const {data} = matter(fs.readFileSync(file, 'utf8'));
    const valid = validateEvent(data);
    if (!valid) {
      for (const e of validateEvent.errors) {
        errors.push(`${relPath}: ${e.instancePath || '(root)'} ${e.message}`);
      }
      continue;
    }
    records.push({kind: 'event', file: relPath, data});
  }

  for (const file of findContentFiles(ARTICLES_DIR)) {
    const relPath = path.relative(ROOT, file);
    const {data} = matter(fs.readFileSync(file, 'utf8'));
    const valid = validateArticle(data);
    if (!valid) {
      for (const e of validateArticle.errors) {
        errors.push(`${relPath}: ${e.instancePath || '(root)'} ${e.message}`);
      }
      continue;
    }
    records.push({kind: 'article', file: relPath, data});
  }

  // ID uniqueness
  const byId = new Map();
  for (const record of records) {
    const id = record.data.id;
    if (byId.has(id)) {
      errors.push(`Duplicate id "${id}" in ${record.file} and ${byId.get(id).file}`);
      continue;
    }
    byId.set(id, record);
  }

  // year_sort / year_precision consistency
  for (const record of records) {
    const {year_sort, year_precision} = record.data;
    if (year_precision === 'unresolved' && year_sort !== null) {
      errors.push(`${record.file}: year_sort must be null when year_precision is "unresolved"`);
    }
    if (year_precision !== 'unresolved' && year_sort === null) {
      errors.push(`${record.file}: year_sort may only be null when year_precision is "unresolved"`);
    }
  }

  // dispute presence whenever confidence: disputed
  for (const record of records) {
    if (record.data.confidence === 'disputed' && !record.data.dispute) {
      errors.push(`${record.file}: confidence "disputed" requires a "dispute" object`);
    }
  }

  // event_type: stub must never be hand-authored; it is computed from absence of `article`
  for (const record of records) {
    if (record.kind === 'event' && record.data.event_type === 'stub') {
      errors.push(`${record.file}: event_type "stub" must never be authored directly — it is computed from the absence of "article"`);
    }
  }

  // compute effective_event_type for events (stub derivation)
  for (const record of records) {
    if (record.kind !== 'event') continue;
    record.effectiveEventType = record.data.article ? (record.data.event_type || 'milestone') : 'stub';
  }

  // ID reference existence: requires, related_events, primary_event, article, requires_resolution_of
  function checkRef(record, id, fieldLabel) {
    if (id && !byId.has(id)) {
      errors.push(`${record.file}: ${fieldLabel} references unknown id "${id}"`);
    }
  }
  for (const record of records) {
    const d = record.data;
    for (const id of d.requires || []) checkRef(record, id, 'requires');
    if (record.kind === 'event' && d.article) checkRef(record, d.article, 'article');
    if (record.kind === 'article') {
      checkRef(record, d.primary_event, 'primary_event');
      for (const id of d.related_events || []) checkRef(record, id, 'related_events');
      for (const sig of d.predictive_signals || []) {
        for (const id of sig.requires_resolution_of || []) checkRef(record, id, 'predictive_signals.requires_resolution_of');
      }
    }
  }

  // speculative confidence gate
  for (const record of records) {
    if (record.kind === 'event' && record.effectiveEventType === 'speculative') {
      if (!SPECULATIVE_CONFIDENCES.has(record.data.confidence)) {
        errors.push(`${record.file}: event_type "speculative" requires a speculative* or "unsubstantiated" confidence, got "${record.data.confidence}"`);
      }
    }
  }

  // convergence minimum: >=2 requires from >=2 distinct pillars
  for (const record of records) {
    if (record.kind === 'event' && record.effectiveEventType === 'convergence') {
      const requiresIds = record.data.requires || [];
      const pillars = new Set();
      for (const id of requiresIds) {
        const target = byId.get(id);
        if (target) pillars.add(target.data.pillar);
      }
      if (requiresIds.length < 2 || pillars.size < 2) {
        errors.push(`${record.file}: event_type "convergence" requires at least 2 "requires" entries spanning at least 2 different pillars`);
      }
    }
  }

  // predictive signals gate: article whose primary_event's effective confidence starts with "speculative" must carry predictive_signals
  for (const record of records) {
    if (record.kind !== 'article') continue;
    const primary = byId.get(record.data.primary_event);
    if (!primary) continue;
    if (String(primary.data.confidence).startsWith('speculative')) {
      if (!record.data.predictive_signals || record.data.predictive_signals.length === 0) {
        errors.push(`${record.file}: article for speculative primary_event "${primary.data.id}" requires at least one predictive_signals entry`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\nTimeWeave content validation failed with ${errors.length} error(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error('');
    process.exit(1);
  }

  // compute enables: reverse index of requires, across events only (the authored graph edges)
  const enablesById = new Map();
  for (const record of records) {
    if (record.kind !== 'event') continue;
    for (const reqId of record.data.requires || []) {
      if (!enablesById.has(reqId)) enablesById.set(reqId, []);
      enablesById.get(reqId).push(record.data.id);
    }
  }

  const content = records.map((record) => ({
    kind: record.kind,
    file: record.file,
    ...record.data,
    ...(record.kind === 'event'
      ? {event_type: record.effectiveEventType, enables: enablesById.get(record.data.id) || []}
      : {}),
  }));

  const manifest = records
    .map((record) => ({id: record.data.id, title: record.data.title, kind: record.kind}))
    .sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(OUT_DIR, {recursive: true});
  fs.writeFileSync(path.join(OUT_DIR, 'content.json'), JSON.stringify(content, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`TimeWeave content validation passed: ${records.length} record(s) (${manifest.length} ids). Generated ${path.relative(ROOT, OUT_DIR)}/`);
}

main();

#!/usr/bin/env node
/**
 * scripts/validate-pod-outputs.mjs
 * ============================================================================
 * Runs each pod engine against the current build-report.json and validates
 * the output against the per-pod JSON Schema in schemas/pods/
 * (or .github/schemas/ for legacy layouts).
 *
 * Catches drift between what the engines emit and what the dashboard expects.
 * Run on every PR via CI; run manually before tagging a release.
 *
 * Zero-dep validator: a pragmatic JSON Schema Draft 2020-12 subset covering
 * what our schemas actually use (required, type, enum, const, properties,
 * additionalProperties, items, minimum/maximum, minLength, pattern, $ref to
 * common.schema.json#/$defs/*, oneOf via "type": [list]).
 *
 * Usage:
 *   node scripts/validate-pod-outputs.mjs           # validate all 5 pods
 *   node scripts/validate-pod-outputs.mjs --pod=editor
 *   node scripts/validate-pod-outputs.mjs --json    # machine-readable
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
const ONLY_POD = flag('pod', null);

// --- Schema loading --------------------------------------------------------

const schemaDirCandidates = [
  path.join(root, '.github', 'schemas'),
  path.join(root, 'schemas', 'pods'),
];
const schemaDir = schemaDirCandidates.find((d) => fs.existsSync(d));
if (!schemaDir) {
  throw new Error(`No schema directory found. Looked in: ${schemaDirCandidates.join(', ')}`);
}
const schemas = {};
const commonSchemaPath = path.join(schemaDir, 'common.schema.json');
const commonSchema = JSON.parse(fs.readFileSync(commonSchemaPath, 'utf8'));

for (const file of fs.readdirSync(schemaDir)) {
  if (!file.endsWith('.schema.json') || file === 'common.schema.json') continue;
  const podKey = file.replace('.schema.json', '');
  schemas[podKey] = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
}

// --- Validator -------------------------------------------------------------

/**
 * Resolve a $ref. We support two shapes:
 *   - `common.schema.json#/$defs/<name>` — explicit cross-schema ref
 *   - `#/$defs/<name>`                   — bare ref (resolved against
 *                                           common.schema.json since that's
 *                                           where all our $defs live).
 *
 * The bare form appears inside common.schema's own $defs (e.g., remediation
 * has `severity: { $ref: "#/$defs/severity" }`).
 */
function resolveRef(ref) {
  let m = ref.match(/^common\.schema\.json#\/\$defs\/(.+)$/);
  if (!m) m = ref.match(/^#\/\$defs\/(.+)$/);
  if (!m) throw new Error(`Unsupported $ref: ${ref}`);
  const def = commonSchema.$defs?.[m[1]];
  if (!def) throw new Error(`Definition not found in common.schema.json: ${m[1]}`);
  return def;
}

/**
 * Validate `value` against `schema` rooted at `pathPrefix` (for error context).
 * Returns array of error objects: [{ path, message }, ...]; empty = valid.
 */
function validate(schema, value, pathPrefix = '$') {
  const errors = [];

  // Resolve $ref first
  if (schema.$ref) {
    return validate(resolveRef(schema.$ref), value, pathPrefix);
  }

  // const
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path: pathPrefix, message: `expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}` });
    return errors;
  }

  // enum
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path: pathPrefix, message: `must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` });
    return errors;
  }

  // type (string or array of strings)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = Array.isArray(value) ? 'array' :
                   value === null       ? 'null'  :
                   Number.isInteger(value) ? 'integer' :
                   typeof value;
    const ok = types.some((t) => {
      if (t === 'integer') return Number.isInteger(value);
      if (t === 'number')  return typeof value === 'number';
      if (t === 'array')   return Array.isArray(value);
      if (t === 'null')    return value === null;
      if (t === 'object')  return value !== null && typeof value === 'object' && !Array.isArray(value);
      return typeof value === t;
    });
    if (!ok) {
      errors.push({ path: pathPrefix, message: `expected type ${types.join('|')}, got ${actual}` });
      return errors;
    }
  }

  // Numeric constraints
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push({ path: pathPrefix, message: `${value} below minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push({ path: pathPrefix, message: `${value} above maximum ${schema.maximum}` });
  }

  // String constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push({ path: pathPrefix, message: `string length ${value.length} below minLength ${schema.minLength}` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push({ path: pathPrefix, message: `string does not match pattern /${schema.pattern}/` });
  }

  // Object: required + properties + additionalProperties
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const k of schema.required) {
        if (!(k in value)) errors.push({ path: pathPrefix, message: `missing required property '${k}'` });
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value) {
          errors.push(...validate(sub, value[k], `${pathPrefix}.${k}`));
        }
      }
    }
    // additionalProperties === false would forbid extra keys; our schemas
    // default to true, so we skip enforcing it.
  }

  // Array: items
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validate(schema.items, value[i], `${pathPrefix}[${i}]`));
    }
  }

  return errors;
}

// --- Ownership guardrails --------------------------------------------------

const OWNERSHIP_FORBIDDEN_TOP_LEVEL = {
  librarian: ['readability', 'lighthouseCI', 'playwrightE2E', 'engTests', 'releaseReady'],
  editor: ['seoHealth', 'accessibility', 'engTests', 'lighthouseCI', 'releaseReady'],
  strategist: ['readability', 'engTests', 'buildStability', 'releaseReady'],
  gatekeeper: ['readability', 'schemaCoverage', 'taxonomyCoverage', 'searchGaps'],
  orchestrator: ['violations', 'readability', 'lighthouseCI', 'playwrightE2E', 'dependencies'],
};

function validateOwnership(podKey, output) {
  const errors = [];
  const forbidden = OWNERSHIP_FORBIDDEN_TOP_LEVEL[podKey] || [];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      errors.push({
        path: `$.${key}`,
        message: `ownership violation: '${key}' is outside ${podKey} pod boundaries`,
      });
    }
  }
  return errors;
}

// --- Pod runners -----------------------------------------------------------

async function loadPod(podKey) {
  const map = {
    librarian:    () => import('../src/agents/librarian/librarian.mjs').then((m) => m.runLibrarian),
    editor:       () => import('../src/agents/editor/editor.mjs').then((m) => m.runEditor),
    strategist:   () => import('../src/agents/strategist/strategist.mjs').then((m) => m.runStrategist),
    gatekeeper:   () => import('../src/agents/gatekeeper/gatekeeper.mjs').then((m) => m.runGatekeeper),
    orchestrator: () => import('../src/agents/orchestrator/orchestrator.mjs').then((m) => m.runOrchestrator),
  };
  const loader = map[podKey];
  if (!loader) throw new Error(`Unknown pod key: ${podKey}`);
  return await loader();
}

function loadReport() {
  const reportPath = path.join(root, 'static', 'build-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`build-report.json not found at ${reportPath}. Run: npm run build-report`);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

// --- Main ------------------------------------------------------------------

const report = loadReport();
const podsToValidate = ONLY_POD ? [ONLY_POD] : Object.keys(schemas);
const results = {};

// Audit pass: walk pod output and collect every AUTO_REMEDIATE entry.
// This isn't a fail condition — it's a per-PR "look here" list for human
// reviewers. NEW REMEDIATION RULES MUST DEFAULT TO PROPOSE; AUTO_REMEDIATE
// requires evidence of corpus-wide context-safety. The audit surfaces every
// instance so reviewers can sanity-check each one. See common.schema.json's
// actionMode description and .github/case-study/insights.md.
function collectAutoRemediate(value, path = '$', out = []) {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && value.actionMode === 'AUTO_REMEDIATE') {
      out.push({
        path,
        alertId: value.alertId || value.id || value.violationId || '(no id)',
        issue: value.issue || value.description || value.msg || '(no description)',
        severity: value.severity || '(no severity)',
        hasSafetyJustification: typeof value.safetyJustification === 'string' && value.safetyJustification.length > 0,
      });
    }
    for (const [k, v] of Object.entries(value)) {
      collectAutoRemediate(v, `${path}.${k}`, out);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectAutoRemediate(v, `${path}[${i}]`, out));
  }
  return out;
}

const autoRemediations = {};

for (const podKey of podsToValidate) {
  if (!schemas[podKey]) {
    results[podKey] = { ok: false, errors: [{ path: '$', message: `No schema found for ${podKey} in ${schemaDir}` }] };
    continue;
  }
  try {
    const runFn = await loadPod(podKey);
    const output = runFn(report);
    const errors = [
      ...validate(schemas[podKey], output, '$'),
      ...validateOwnership(podKey, output),
    ];
    results[podKey] = { ok: errors.length === 0, errors };
    autoRemediations[podKey] = collectAutoRemediate(output);
  } catch (err) {
    results[podKey] = { ok: false, errors: [{ path: '$', message: `Engine threw: ${err.message}` }] };
  }
}

// --- Output ----------------------------------------------------------------

const allPassed = Object.values(results).every((r) => r.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: allPassed, results, autoRemediations }, null, 2));
} else {
  for (const [pod, r] of Object.entries(results)) {
    if (r.ok) {
      console.log(`\x1b[32m✓\x1b[0m ${pod.padEnd(12)} valid`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m ${pod.padEnd(12)} ${r.errors.length} error(s):`);
      for (const e of r.errors.slice(0, 20)) {
        console.log(`    \x1b[2m${e.path}\x1b[0m  ${e.message}`);
      }
      if (r.errors.length > 20) console.log(`    \x1b[2m... ${r.errors.length - 20} more\x1b[0m`);
    }
  }
  console.log('');
  console.log(allPassed
    ? '\x1b[32mAll pod outputs valid against their schemas.\x1b[0m'
    : '\x1b[31mOne or more pods failed schema validation.\x1b[0m');

  // PROPOSE-by-default audit summary (informational, non-fatal)
  const totalAuto = Object.values(autoRemediations).reduce((s, arr) => s + arr.length, 0);
  if (totalAuto > 0) {
    console.log('');
    console.log(`\x1b[33mAUTO_REMEDIATE audit — ${totalAuto} entr${totalAuto === 1 ? 'y' : 'ies'} require reviewer attention:\x1b[0m`);
    console.log('\x1b[2m  (PROPOSE is the default. AUTO_REMEDIATE requires demonstrated context-safety.)\x1b[0m');
    for (const [pod, list] of Object.entries(autoRemediations)) {
      if (!list.length) continue;
      console.log(`\x1b[33m  ${pod}: ${list.length} AUTO_REMEDIATE entr${list.length === 1 ? 'y' : 'ies'}\x1b[0m`);
      for (const e of list.slice(0, 5)) {
        const flag = e.hasSafetyJustification ? '\x1b[32m✓justified\x1b[0m' : '\x1b[31m✗no justification\x1b[0m';
        console.log(`    [${e.severity}] ${e.alertId} — ${String(e.issue).slice(0, 70)} ${flag}`);
      }
      if (list.length > 5) console.log(`    \x1b[2m... +${list.length - 5} more\x1b[0m`);
    }
  }
}

process.exit(allPassed ? 0 : 1);

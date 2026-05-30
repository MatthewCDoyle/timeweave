/**
 * src/agents/librarian/librarian.mjs
 * ============================================================================
 * The Librarian Pod — client-side computation engine.
 *
 * Reads build-report.json and computes the full Librarian output contract:
 *   - Metadata completeness & required field debt
 *   - Schema intelligence (guessed vs authored, completion %)
 *   - Content quality (placeholders, missing metadata)
 *   - Broken links & images (moved from Gatekeeper)
 *   - DITA semantic conversion tracking
 *   - Publish status (MDX churn, publish rate)
 *   - Remediation proposals
 *
 * Can be imported in the browser (DevDashboard) or run via Node CLI:
 *   node src/agents/librarian/librarian.mjs [path/to/build-report.json]
 */

import { thresholds } from '../thresholds.mjs';

// ---------------------------------------------------------------------------
// Taxonomy dimensions the Librarian considers "required" for MCP utility
// ---------------------------------------------------------------------------
const TAXONOMY_DIMENSIONS = ['device_type', 'role', 'use_case', 'skill_level', 'product_name'];

const REQUIRED_FIELDS = ['title', 'description', 'slug'];

const MDX_CHURN_THRESHOLD = thresholds.mdxChurnFlagThreshold.max;
const SCHEMA_COMPLETION_MIN = thresholds.schemaCompletion.min;

// ---------------------------------------------------------------------------
// Main: compute Librarian output from a parsed build-report
// ---------------------------------------------------------------------------
export function runLibrarian(report) {
  const runId = crypto?.randomUUID?.() || `lib-${Date.now()}`;
  const docs = report.docs || [];
  const aggregate = report.aggregate || {};
  const totalDocs = docs.length || aggregate.totalDocs || 0;

  // ── Step 1: Metadata Audit ───────────────────────────────────────────────
  let requiredFieldDebt = 0;
  const docsWithMissingFieldsList = [];
  const missingByDimension = {};
  for (const dim of TAXONOMY_DIMENSIONS) missingByDimension[dim] = 0;

  for (const doc of docs) {
    const fm = doc.frontmatter || {};
    let docMissing = false;

    for (const field of REQUIRED_FIELDS) {
      if (!fm[field] || fm[field] === '') {
        requiredFieldDebt++;
        docMissing = true;
      }
    }

    for (const dim of TAXONOMY_DIMENSIONS) {
      const val = fm[dim];
      if (!val || (Array.isArray(val) && val.length === 0)) {
        missingByDimension[dim]++;
        docMissing = true;
      }
    }

    if (docMissing) {
      docsWithMissingFieldsList.push(doc.filePath);
    }
  }

  const completenessPercent = totalDocs > 0
    ? Math.round(((totalDocs - docsWithMissingFieldsList.length) / totalDocs) * 100)
    : 0;

  // ── Step 2: Schema Intelligence ──────────────────────────────────────────
  const guessing = aggregate.guessing || {};
  const guessedFieldsTotal = guessing.totalGuessedFields || 0;
  const docsWithGuesses = guessing.docsWithGuesses || 0;
  const fullyAuthored = totalDocs - docsWithGuesses;
  const schemaCompletionPercent = totalDocs > 0
    ? Math.round((fullyAuthored / totalDocs) * 100)
    : 0;

  // Field coverage
  const fieldCoveragePercent = aggregate.fieldCoveragePercent || {};
  const fieldCoverage = Object.entries(fieldCoveragePercent).map(([field, pct]) => ({
    field,
    coveragePercent: Math.round(pct * 100),
  }));

  // High-risk guessed docs (guessed taxonomy fields)
  const highRiskGuessedDocs = [];
  for (const doc of docs) {
    const guessed = doc.guessedFields || [];
    const taxonomyGuessed = guessed.filter((f) => TAXONOMY_DIMENSIONS.includes(f));
    if (taxonomyGuessed.length > 0) {
      highRiskGuessedDocs.push({ file: doc.filePath, guessedFields: taxonomyGuessed });
    }
  }

  // ── Step 3: Content Quality ──────────────────────────────────────────────
  const placeholders = aggregate.placeholders || {};
  const docsWithPlaceholders = placeholders.docsWithPlaceholders || 0;
  const placeholderFiles = docs.filter((d) => d.hasPlaceholders).map((d) => d.filePath);
  const placeholdersByField = Object.entries(placeholders.byField || {}).map(([field, count]) => ({
    field, count,
  }));

  const seoHealth = aggregate.seoHealth || {};
  const missingTitles = totalDocs - (seoHealth.hasTitle || 0);
  const missingDescriptions = totalDocs - (seoHealth.hasDescription || 0);
  const missingKeywords = totalDocs - (seoHealth.hasKeywords || 0);

  // Docs needing attention: worst docs by combined issues
  const docsNeedingAttention = [];
  for (const doc of docs) {
    const issues = [];
    const fm = doc.frontmatter || {};
    if (!fm.title) issues.push('missing_title');
    if (!fm.description) issues.push('missing_description');
    if (!fm.slug) issues.push('missing_slug');
    if (doc.hasPlaceholders) issues.push('has_placeholders');
    if ((doc.guessedFields || []).length > 3) issues.push('high_guessed_fields');
    if (issues.length >= 2) {
      docsNeedingAttention.push({ file: doc.filePath, issues });
    }
  }
  docsNeedingAttention.sort((a, b) => b.issues.length - a.issues.length);

  // ── Step 4: Broken Links & Images (moved from Gatekeeper) ─────────────────
  const eng = report.engineering || {};
  const tests = eng.tests || {};
  const eng04 = tests.eng04 || {};
  const eng09 = tests.eng09 || {};

  const brokenImages = { count: eng04.count || 0, files: eng04.files || [] };
  const brokenLinks = {
    count: eng09.count || 0,
    affectedDocs: (eng09.samples || []).length,
    links: (eng09.samples || []).slice(0, 50).map(s => ({
      sourceFile: typeof s === 'string' ? s : s.file || '',
      targetUrl: typeof s === 'string' ? '' : s.target || '',
    })),
  };

  // ── Step 5: DITA Semantic Conversion ─────────────────────────────────────
  const ditaMigration = report.ditaMigration || {};
  const ditaCoverage = ditaMigration.migrationCoverage || 0;
  const ditaFilesWithComponents = ditaMigration.filesWithComponents || 0;
  const ditaLegacyTags = ditaMigration.filesWithLegacyTags || 0;
  const ditaTasksWithoutSemantic = ditaMigration.taskFilesWithoutSemantic || 0;
  const ditaComponentUsage = ditaMigration.componentUsage || {};
  const ditaTotalUses = ditaMigration.totalUses || 0;

  // ── Step 5b: Semantic Loss (from dita-loss-report.json) ──────────────────
  const semanticLoss = report.semanticLoss || {};
  const lossSummary = semanticLoss.summary || {};
  const lossResults = semanticLoss.results || [];
  const lossByTest = lossSummary.byTest || {};
  const flattenedTables = lossByTest['DL-01'] || 0;
  const missingAdmonitions = lossByTest['DL-02'] || 0;
  const duplicateContent = lossByTest['DL-03'] || 0;
  const guttedBodies = lossByTest['DL-04'] || 0;
  const orphanedEntities = lossByTest['DL-05'] || 0;
  const unclosedFences = lossByTest['DL-06'] || 0;
  const emptyHeadings = lossByTest['DL-07'] || 0;
  const orphanedTags = lossByTest['DL-08'] || 0;
  const titleEchoes = lossByTest['DL-09'] || 0;
  const brokenProcedures = lossByTest['DL-10'] || 0;
  const styleRuleViolations = lossByTest['DL-11'] || 0;   // Editor pod's rule-registry hits surfaced via the semantic loss scanner
  const totalLossFindings = lossSummary.totalFindings || 0;
  const filesWithLoss = lossSummary.filesWithIssues || 0;

  // Top 20 worst files by semantic loss count
  const worstFiles = [...lossResults]
    .sort((a, b) => b.findings.length - a.findings.length)
    .slice(0, 20)
    .map(r => ({
      file: r.file,
      issueCount: r.findings.length,
      tests: [...new Set(r.findings.map(f => f.test))],
    }));

  // ── Step 6: Publish Status ───────────────────────────────────────────────
  const da = aggregate.dateAnalytics || {};
  const mdxChurn = da.fresh || 0; // docs modified < 30 days as proxy
  const mdxChurnFlag = mdxChurn > MDX_CHURN_THRESHOLD;

  const statusTax = aggregate.taxonomy?.status || {};
  const published = statusTax.Published || statusTax.published || totalDocs;
  const draft = statusTax.Draft || statusTax.draft || 0;
  const publishRate = totalDocs > 0 ? Math.round((published / totalDocs) * 100) : 100;

  // ── Step 7: Remediations ─────────────────────────────────────────────────
  const remediations = [];
  let alertSeq = 1;

  if (brokenLinks.count > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${brokenLinks.count} broken internal links`,
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#librarian',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (brokenImages.count > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${brokenImages.count} broken image references`,
      severity: 'P1',
      actionMode: 'AUTO_REMEDIATE',
      actionTarget: 'docs/staging (GitHub PR)',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (highRiskGuessedDocs.length > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${highRiskGuessedDocs.length} docs have guessed taxonomy fields (high MCP risk)`,
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#librarian',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (docsWithPlaceholders > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${docsWithPlaceholders} docs contain placeholder text`,
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#librarian',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (mdxChurnFlag) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `MDX churn (${mdxChurn}) exceeds threshold (${MDX_CHURN_THRESHOLD})`,
      severity: 'P2',
      actionMode: 'ESCALATE',
      actionTarget: 'JIRA',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (missingTitles > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${missingTitles} docs missing title`,
      severity: 'P2',
      actionMode: 'AUTO_REMEDIATE',
      actionTarget: 'docs/staging (proposal only)',
      aiGenerated: true,
      status: 'OPEN',
    });
  }

  if (missingDescriptions > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${missingDescriptions} docs missing description`,
      severity: 'P2',
      actionMode: 'AUTO_REMEDIATE',
      actionTarget: 'docs/staging (proposal only)',
      aiGenerated: true,
      status: 'OPEN',
    });
  }

  if (schemaCompletionPercent < SCHEMA_COMPLETION_MIN) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `Schema Completion at ${schemaCompletionPercent}% (< ${SCHEMA_COMPLETION_MIN}% threshold)`,
      severity: 'P2',
      actionMode: 'ESCALATE',
      actionTarget: 'JIRA + Confluence',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (publishRate < 90) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `Publish Rate at ${publishRate}% (< 90% threshold)`,
      severity: 'P2',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#librarian',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (ditaCoverage < 50 && ditaTasksWithoutSemantic > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `DITA migration coverage at ${Math.round(ditaCoverage)}% — ${ditaTasksWithoutSemantic} task files without semantic wrappers`,
      severity: 'P2',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#dita-migration',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (ditaLegacyTags > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${ditaLegacyTags} files still contain legacy DITA XML tags`,
      severity: 'P2',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#dita-migration',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (flattenedTables > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${flattenedTables} flattened tables detected (DITA tables lost structure)`,
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#dita-migration',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (guttedBodies > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${guttedBodies} docs have empty/gutted body content`,
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#dita-migration',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (duplicateContent > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${duplicateContent} duplicate list items (table cell extraction artifact)`,
      severity: 'P2',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#dita-migration',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (emptyHeadings > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${emptyHeadings} empty headings with no content beneath`,
      severity: 'P2',
      actionMode: 'CLICK_TO_FIX',
      actionTarget: 'dev-dashboard#dita-migration',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  if (titleEchoes > 0) {
    remediations.push({
      alertId: `LIB-${alertSeq++}`,
      issue: `${titleEchoes} docs echo frontmatter title in body`,
      severity: 'P3',
      actionMode: 'AUTO_REMEDIATE',
      actionTarget: 'docs/staging (GitHub PR)',
      aiGenerated: false,
      status: 'OPEN',
    });
  }

  // ── Assemble output contract ─────────────────────────────────────────────
  return {
    pod: 'LIBRARIAN',
    runId,
    snapshotDate: report.generatedAt || new Date().toISOString(),
    metadataCompleteness: {
      completenessPercent,
      requiredFieldDebt,
      docsWithMissingFields: {
        count: docsWithMissingFieldsList.length,
        files: docsWithMissingFieldsList.slice(0, 50),
      },
      missingByDimension: {
        device: missingByDimension.device_type || 0,
        role: missingByDimension.role || 0,
        useCase: missingByDimension.use_case || 0,
        skillLevel: missingByDimension.skill_level || 0,
        productName: missingByDimension.product_name || 0,
      },
    },
    schemaIntelligence: {
      guessedFieldsTotal,
      docsWithGuesses,
      fullyAuthored,
      schemaCompletionPercent,
      fieldCoverage,
      highRiskGuessedDocs: highRiskGuessedDocs.slice(0, 20),
    },
    contentQuality: {
      docsWithPlaceholders: { count: docsWithPlaceholders, files: placeholderFiles.slice(0, 30) },
      missingTitles,
      missingDescriptions,
      missingKeywords,
      placeholdersByField,
      docsNeedingAttention: docsNeedingAttention.slice(0, 15),
    },
    brokenLinks,
    brokenImages,
    ditaMigration: {
      migrationCoverage: ditaCoverage,
      filesWithComponents: ditaFilesWithComponents,
      totalUses: ditaTotalUses,
      legacyTags: ditaLegacyTags,
      taskFilesWithoutSemantic: ditaTasksWithoutSemantic,
      componentUsage: ditaComponentUsage,
    },
    semanticLoss: {
      totalFindings: totalLossFindings,
      filesWithIssues: filesWithLoss,
      byTest: {
        flattenedTables,
        missingAdmonitions,
        duplicateContent,
        guttedBodies,
        orphanedEntities,
        unclosedFences,
        emptyHeadings,
        orphanedTags,
        titleEchoes,
        brokenProcedures,
        styleRuleViolations,
      },
      worstFiles,
    },
    publishStatus: {
      published,
      draft,
      publishRate,
      mdxChurn,
      mdxChurnThreshold: MDX_CHURN_THRESHOLD,
      mdxChurnFlag,
    },
    remediations,
    tokenUsage: 0,
  };
}

// ---------------------------------------------------------------------------
// CLI mode: node src/agents/librarian/librarian.mjs [report-path]
// ---------------------------------------------------------------------------
if (typeof window === 'undefined' && typeof process !== 'undefined' &&
    process.argv?.[1]?.replace(/\\/g, '/').endsWith('agents/librarian/librarian.mjs')) {
  // Wrap in async IIFE to avoid top-level await (which makes the module async
  // and breaks Webpack's require().default in the browser bundle).
  (async () => {
    const { readFileSync } = await import(/* webpackIgnore: true */ 'node:fs');
    const { resolve } = await import(/* webpackIgnore: true */ 'node:path');
    const reportPath = process.argv[2] || resolve(process.cwd(), 'static/build-report.json');
    const raw = readFileSync(reportPath, 'utf8');
    const report = JSON.parse(raw);
    const result = runLibrarian(report);
    console.log(JSON.stringify(result, null, 2));
  })();
}

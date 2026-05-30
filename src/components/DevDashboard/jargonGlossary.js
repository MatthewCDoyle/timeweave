/**
 * src/components/DevDashboard/jargonGlossary.js
 * ============================================================================
 * Single source of truth for jargon-to-definition mapping used by JargonTerm.
 *
 * Plain JS (no React, no CSS modules) so it can be unit-tested directly
 * without a renderer. Keep aligned with:
 *   - .github/agent-actions.md (action vocabulary)
 *   - .github/case-study/insights.md (DL-XX definitions, severity rationale)
 *   - scripts/dita-loss-scanner.mjs (DL test IDs)
 *   - src/agents/librarian/instructions.md (pod ownership)
 *
 * When adding new dashboard jargon, add an entry here so JargonTerm renders
 * the tooltip automatically.
 */

export const JARGON_GLOSSARY = {
  // Semantic-loss test codes — DL-XX series. Source: dita-loss-scanner.mjs.
  'DL-01': 'Flattened tables. DITA <table>/<simpletable> rendered as bare-text lines with no pipe delimiters.',
  'DL-02': 'Missing admonitions. <note type="..."> unwrapped to plain paragraphs instead of :::note blocks.',
  'DL-03': 'Duplicate list content. List items extracted twice during conversion (bullet + plaintext).',
  'DL-04': 'Gutted/empty body. Doc body lost during conversion. Not auto-fixable — needs human authoring from DITA source.',
  'DL-05': 'Orphaned HTML entities. &lt; &gt; &amp; surviving from DITA source.',
  'DL-06': 'Unclosed code fences. Code blocks opened with ``` but never closed.',
  'DL-07': 'Empty headings. Section headings with no content beneath them.',
  'DL-08': 'Orphaned DITA/HTML tags. Raw XML tags surviving in the Markdown output.',
  'DL-09': 'Title echoes. Frontmatter title duplicated as plain text in the body.',
  'DL-10': 'Broken procedures. Numbered steps converted to bullet lists.',
  'DL-11': 'Style-rule violations. Editor pod findings emitted alongside structural losses.',

  // Severity codes — destroys-the-doc / partial-loss / cosmetic tiers.
  'P0': 'Critical. Destroys the doc for the reader. Release-gate failure.',
  'P1': 'High. Significant content loss or visual breakage. Fix soon.',
  'P2': 'Medium. Noise or partial loss. Quality concern.',
  'P3': 'Low. Cosmetic. Polish-tier.',

  // Action vocabulary — the canonical 5 verbs per .github/agent-actions.md.
  // New remediation rules MUST default to PROPOSE; AUTO_REMEDIATE requires
  // demonstrated context-safety (see common.schema.json actionMode docs).
  'AUTO_REMEDIATE': 'Agent applies the fix automatically and opens a PR. Use only when the substitution is provably context-safe across the corpus.',
  'PROPOSE': 'Agent opens a PR with the proposed fix; a human reviews each line before merge. Default for new remediation rules.',
  'CLICK_TO_FIX': 'Agent surfaces the finding in the dashboard; user clicks to apply the fix.',
  'FLAG': 'Agent reports the finding without proposing a fix. Detection-only.',
  'ESCALATE': 'Agent escalates to a human owner via a dashboard alert or PR comment.',

  // Agent names — for the few places they appear as bare codes.
  'LIBRARIAN':    'Agent owning metadata, schema, DITA migration tracking, and link integrity.',
  'EDITOR':       'Agent owning prose quality, style-rule violations (TCM Style Guide), and terminology drift.',
  'STRATEGIST':   'Agent owning SEO, accessibility (alt-text), freshness, and click-pattern analysis.',
  'GATEKEEPER':   'Agent owning engineering tests (ENG-01..14), build stability, and release verdicts. Flag/escalate only — never auto-fixes.',
  'ORCHESTRATOR': 'Agent aggregating other agents\' findings and resolving conflicts. Does not edit content.',
};

/**
 * Resolve a jargon term to its definition. Returns null if no definition
 * is known. Used by JargonTerm to decide whether to render a tooltip.
 *
 * @param {string} code
 * @returns {string | null}
 */
export function resolveJargon(code) {
  if (!code) return null;
  return JARGON_GLOSSARY[code] || null;
}

/**
 * src/components/DevDashboard/personas.js
 * ============================================================================
 * Persona / lens configuration for the dev dashboard.
 *
 * Each persona declares:
 *   - which panels are primary (relevant + put at top, with accent border)
 *   - which are secondary (relevant but not the focus)
 *   - which are collapsed (one-line summary at the bottom)
 *   - which pods' findings should drive the persona's Top Actions widget
 *
 * The "default" lens shows everything uncollapsed; its Top Actions widget
 * surfaces the highest-severity findings across ALL pods.
 *
 * To add a new persona: add an entry to PERSONAS, define `panels` keyed by
 * panel ID, and add the persona to PERSONA_OPTIONS (used by the switcher).
 */

// Stable IDs for every panel currently rendered by the dashboard.
// Keep in sync with the render order in index.jsx.
export const PANEL_IDS = {
  BUILD_OVERVIEW:    'build-overview',
  SCHEMA_ANALYTICS:  'schema-analytics',
  SCHEMA_INTEL:      'schema-intelligence',
  DATE_FRESHNESS:    'date-freshness',
  SEO_HEALTH:        'seo-health',
  ANALYTICS:         'analytics',
  CONTENT_PERF:      'content-performance',
  SEARCH:            'search',
  CONTENT_QUALITY:   'content-quality',
  DITA_MIGRATION:    'dita-migration',
  TERMINOLOGY_DRIFT: 'terminology-drift',
  ENG_TESTS:         'engineering-tests',
  FRONTMATTER_READINESS: 'frontmatter-readiness',
  REVIEW_CADENCE:        'review-cadence',
  FRONTMATTER_GAPS:      'frontmatter-gaps',
  UX_METRICS:        'ux-metrics',
  ORCHESTRATOR:      'pod-orchestrator',
  POD_LIBRARIAN:     'pod-librarian',
  POD_EDITOR:        'pod-editor',
  POD_STRATEGIST:    'pod-strategist',
  POD_GATEKEEPER:    'pod-gatekeeper',
};

// Relevance levels for panels under a persona lens
export const RELEVANCE = {
  PRIMARY:   'primary',     // pinned at top, accent border
  SECONDARY: 'secondary',   // rendered fully, no accent
  COLLAPSED: 'collapsed',   // one-line summary at bottom, click to expand
};

// All panels default to SECONDARY for the "all" lens (no collapse)
const allSecondary = Object.fromEntries(
  Object.values(PANEL_IDS).map((id) => [id, RELEVANCE.SECONDARY]),
);

// Helper to build a panel-relevance map from primary + collapsed lists
function buildRelevanceMap({ primary = [], collapsed = [] } = {}) {
  const map = {};
  for (const id of Object.values(PANEL_IDS)) {
    if (primary.includes(id))         map[id] = RELEVANCE.PRIMARY;
    else if (collapsed.includes(id))  map[id] = RELEVANCE.COLLAPSED;
    else                               map[id] = RELEVANCE.SECONDARY;
  }
  return map;
}

export const PERSONAS = {
  all: {
    id: 'all',
    label: 'All (default)',
    description: 'Full dashboard with all panels expanded. Top Actions widget surfaces highest-severity findings across every agent.',
    panels: allSecondary,
    // Default top-actions: all pods' findings, ranked by Gatekeeper > Librarian > Strategist > Editor priority
    actionPods: ['gatekeeper', 'librarian', 'strategist', 'editor'],
    actionLimit: 5,
  },

  strategist: {
    id: 'strategist',
    label: 'Content Strategist',
    description: 'Content health: freshness, gaps, SEO, accessibility, taxonomy completeness, click behavior.',
    panels: buildRelevanceMap({
      primary: [
        PANEL_IDS.BUILD_OVERVIEW,
        PANEL_IDS.SCHEMA_ANALYTICS,
        PANEL_IDS.SCHEMA_INTEL,
        PANEL_IDS.DATE_FRESHNESS,
        PANEL_IDS.SEO_HEALTH,
        PANEL_IDS.CONTENT_PERF,
        PANEL_IDS.CONTENT_QUALITY,
        PANEL_IDS.TERMINOLOGY_DRIFT,
        PANEL_IDS.UX_METRICS,
        PANEL_IDS.POD_STRATEGIST,
        PANEL_IDS.POD_LIBRARIAN,
        PANEL_IDS.POD_EDITOR,
        PANEL_IDS.DITA_MIGRATION,
        PANEL_IDS.SEARCH,
        PANEL_IDS.ANALYTICS,
        PANEL_IDS.ORCHESTRATOR,
      ],
      collapsed: [
        PANEL_IDS.ENG_TESTS,
        PANEL_IDS.FRONTMATTER_READINESS,
        PANEL_IDS.REVIEW_CADENCE,
        PANEL_IDS.FRONTMATTER_GAPS,
        PANEL_IDS.POD_GATEKEEPER,
      ],
    }),
    actionPods: ['strategist', 'librarian', 'editor'],
    actionLimit: 3,
  },

  developer: {
    id: 'developer',
    label: 'Developer',
    description: 'Engineering: build stability, P0/P1 gates, broken assets, DITA debt, schema integrity.',
    panels: buildRelevanceMap({
      primary: [
        PANEL_IDS.BUILD_OVERVIEW,
        PANEL_IDS.ENG_TESTS,
        PANEL_IDS.POD_GATEKEEPER,
        PANEL_IDS.POD_LIBRARIAN,
        PANEL_IDS.DITA_MIGRATION,
        PANEL_IDS.SCHEMA_INTEL,
        PANEL_IDS.FRONTMATTER_GAPS,
        PANEL_IDS.ORCHESTRATOR,
      ],
      collapsed: [
        PANEL_IDS.SEO_HEALTH,
        PANEL_IDS.ANALYTICS,
        PANEL_IDS.UX_METRICS,
        PANEL_IDS.REVIEW_CADENCE,
        PANEL_IDS.FRONTMATTER_READINESS,
        PANEL_IDS.POD_EDITOR,
        PANEL_IDS.POD_STRATEGIST,
      ],
    }),
    actionPods: ['gatekeeper', 'librarian'],
    actionLimit: 3,
  },

  pm: {
    id: 'pm',
    label: 'Program Manager',
    description: 'Release readiness: frontmatter completion, review cadence, build status, cross-system verdict.',
    panels: buildRelevanceMap({
      primary: [
        PANEL_IDS.BUILD_OVERVIEW,
        PANEL_IDS.ORCHESTRATOR,
        PANEL_IDS.FRONTMATTER_READINESS,
        PANEL_IDS.REVIEW_CADENCE,
        PANEL_IDS.FRONTMATTER_GAPS,
        PANEL_IDS.ENG_TESTS,
        PANEL_IDS.CONTENT_QUALITY,
      ],
      collapsed: [
        PANEL_IDS.SCHEMA_ANALYTICS,
        PANEL_IDS.SCHEMA_INTEL,
        PANEL_IDS.DATE_FRESHNESS,
        PANEL_IDS.SEO_HEALTH,
        PANEL_IDS.ANALYTICS,
        PANEL_IDS.CONTENT_PERF,
        PANEL_IDS.SEARCH,
        PANEL_IDS.DITA_MIGRATION,
        PANEL_IDS.UX_METRICS,
        PANEL_IDS.POD_LIBRARIAN,
        PANEL_IDS.POD_EDITOR,
        PANEL_IDS.POD_STRATEGIST,
        PANEL_IDS.POD_GATEKEEPER,
      ],
    }),
    actionPods: ['orchestrator', 'gatekeeper', 'strategist'],
    actionLimit: 3,
  },
};

export const PERSONA_OPTIONS = Object.values(PERSONAS).map((p) => ({
  id: p.id,
  label: p.label,
  description: p.description,
}));

export const DEFAULT_PERSONA_ID = 'all';

// One-line summaries shown when a panel is collapsed. Each fn receives the
// build-report and returns a short status string.
export const PANEL_SUMMARIES = {
  [PANEL_IDS.SCHEMA_ANALYTICS]: (r) => {
    const t = r.aggregate?.taxonomy?.role || {};
    const total = Object.values(t).reduce((s, v) => s + v, 0);
    return `${r.aggregate?.totalDocs || 0} docs · ${total} role tags`;
  },
  [PANEL_IDS.SCHEMA_INTEL]: (r) => {
    const pct = r.aggregate?.guessing
      ? Math.round((((r.aggregate.totalDocs || 0) - (r.aggregate.guessing.docsWithGuesses || 0)) / Math.max(1, r.aggregate.totalDocs)) * 100)
      : null;
    return `Schema completion: ${pct ?? '–'}%`;
  },
  [PANEL_IDS.DATE_FRESHNESS]: (r) => {
    const da = r.aggregate?.dateAnalytics || {};
    return `Fresh ${da.fresh || 0} · Recent ${da.recent || 0} · Aging ${da.aging || 0} · Stale ${da.stale || 0}`;
  },
  [PANEL_IDS.SEO_HEALTH]: (r) => {
    const seo = r.aggregate?.seoHealth || {};
    const total = r.docs?.length || 1;
    const pct = Math.round(((seo.hasTitle || 0) + (seo.hasDescription || 0) + (seo.hasKeywords || 0) + (seo.hasSlug || 0)) / (total * 4) * 100);
    return `SEO score ${pct}%`;
  },
  [PANEL_IDS.ANALYTICS]: (_r) => 'GA presence + publish status',
  [PANEL_IDS.CONTENT_PERF]: (r) => `Avg ${Math.round(r.aggregate?.avgWords || 0)} words/doc`,
  [PANEL_IDS.SEARCH]: (_r) => 'Search index health + query metrics',
  [PANEL_IDS.CONTENT_QUALITY]: (r) => {
    const ph = r.aggregate?.placeholders?.docsWithPlaceholders || 0;
    return `${ph} docs with placeholder text`;
  },
  [PANEL_IDS.DITA_MIGRATION]: (r) => `${Math.round(r.ditaMigration?.migrationCoverage || 0)}% migrated`,
  [PANEL_IDS.TERMINOLOGY_DRIFT]: (r) => {
    const d = r.terminologyDrift;
    if (!d) return 'Drift report not generated — run npm run terminology';
    if (!d.totalFindings) return `✓ No drift across ${d.filesScanned} files`;
    return `${d.totalFindings} findings · ${d.filesWithDrift}/${d.filesScanned} files affected`;
  },
  [PANEL_IDS.ENG_TESTS]: (r) => {
    const tests = r.engineering?.tests || {};
    let p0 = 0, p1 = 0;
    for (const id of ['eng01','eng02','eng03','eng04','eng05','eng06','eng07']) if (tests[id]?.status === 'fail') p0++;
    for (const id of ['eng08','eng09','eng10','eng11','eng12','eng13','eng14']) if (tests[id]?.status === 'fail') p1++;
    const status = p0 > 0 ? 'BLOCKED' : (p1 >= 2 ? 'FAILING' : 'PASSING');
    return `${status} · ${p0} P0 / ${p1} P1 failures`;
  },
  [PANEL_IDS.FRONTMATTER_READINESS]: (r) => {
    const fm = r.frontmatterHealth || {};
    return `${fm.docsComplete || 0}/${(fm.docsComplete || 0) + (fm.docsIncomplete || 0)} docs complete · ${Math.round((fm.completionRate || 0) * 100)}%`;
  },
  [PANEL_IDS.REVIEW_CADENCE]: (r) => {
    const review = r.frontmatterHealth?.review || {};
    return `${review.reviewedDocs || 0} reviewed · ${review.staleReviewedDocs || 0} stale`; 
  },
  [PANEL_IDS.FRONTMATTER_GAPS]: (r) => `${r.frontmatterHealth?.docsIncomplete || 0} docs with missing required fields`,
  [PANEL_IDS.UX_METRICS]: (r) => {
    const c = r.clarity || {};
    return `${c.sessions || 0} sessions · ${Math.round((c.rageClickRate || 0) * 100)}% rage`;
  },
  [PANEL_IDS.POD_LIBRARIAN]:  (_r) => 'Metadata · schema · DITA · links',
  [PANEL_IDS.POD_EDITOR]:     (_r) => 'Style · readability · terminology',
  [PANEL_IDS.POD_STRATEGIST]: (_r) => 'Freshness · search gaps · SEO · A11y · click behavior',
  [PANEL_IDS.POD_GATEKEEPER]: (_r) => 'Engineering gates · stability · operational health',
};

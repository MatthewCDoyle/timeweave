/**
 * src/components/DevDashboard/index.jsx
 * ============================================================================
 * Developer Dashboard — visually impressive 11-panel build intelligence suite.
 *
 * Panels:
 *   1.  Build Overview (hero header with health score gauge)
 *   2.  Schema Analytics (device type · role · use case · skill level)
 *   3.  Schema Intelligence (field coverage heatmap + guessing stats)
 *   4.  Date & Freshness Analytics (freshness buckets · monthly velocity)
 *   5.  SEO Health (metadata completeness)
 *   6.  Analytics (GA presence · publish status)
 *   7.  Content Performance (word count distribution)
 *   8.  Search (index health + query metrics)
 *   9.  Content Quality (placeholders · missing metadata table)
 *  10.  Frontmatter Readiness (required-field completion · review cadence · missing-field table)
 *  11.  UX Metrics — Microsoft Clarity (sessions · rage/dead clicks · scroll depth)
 *
 * All charts: pure CSS/SVG (conic-gradient donuts, CSS flex bars).
 * Zero external chart libraries.
 */

import React, { useEffect, useState, useMemo } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';
import { runLibrarian } from '../../agents/librarian/librarian.mjs';
import { runEditor } from '../../agents/editor/editor.mjs';
import { runOrchestrator } from '../../agents/orchestrator/orchestrator.mjs';
import { runStrategist } from '../../agents/strategist/strategist.mjs';
import { runGatekeeper } from '../../agents/gatekeeper/gatekeeper.mjs';
import { POD_API } from './podConfig';
import { usePodPanel } from './usePodPanel';
import { computeGaugeStyle } from './healthGauge';
import { computePassRate, tierColor, lighthouseTierColor } from './dashboardMath';
import { JargonTerm } from './JargonTerm';
import { DetailsOnDemand } from './DetailsOnDemand';
import { ActivateProgress } from './ActivateProgress';
import { PrCard } from './PrCard';
import { usePersona } from './usePersona';
import { PersonaSwitcher } from './PersonaSwitcher';
import { TopActions } from './TopActions';
import { CollapsedPanel } from './CollapsedPanel';
import { TerminologyDriftPanel } from './TerminologyDriftPanel';
import { PANEL_IDS, RELEVANCE } from './personas';
import { PodPanel } from './PodPanel';
import { dashboardTooltips } from './dashboardTooltips';

// Helper: look up a tooltip string from the centralized metric definitions.
// Returns '' if the panel or metric key isn't present so it's safe to use
// directly as a title= attribute (browsers ignore empty titles).
function tip(panel, metric) {
  return dashboardTooltips?.[panel]?.metrics?.[metric]?.tooltip || '';
}

// ---------------------------------------------------------------------------
// Zebra Aurora palette – 10 distinguishable colours
// ---------------------------------------------------------------------------
const PALETTE = [
  '#003fbd', '#bdf75f', '#e67e22', '#9b59b6', '#1abc9c',
  '#e74c3c', '#3498db', '#f39c12', '#2ecc71', '#e91e63',
];

// ---------------------------------------------------------------------------
// DonutChart — pure CSS conic-gradient with center label
// ---------------------------------------------------------------------------
function DonutChart({ counts, centerLabel }) {
  const entries = Object.entries(counts || {})
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return <span className={styles.empty}>No data</span>;

  const segments = entries.map(([label, count], i) => ({
    label,
    count,
    pct: (count / total) * 100,
    color: PALETTE[i % PALETTE.length],
  }));

  let cursor = 0;
  const stops = segments.map(({ pct, color }) => {
    const start = cursor;
    cursor += pct;
    return `${color} ${start.toFixed(1)}% ${cursor.toFixed(1)}%`;
  });
  const gradient = `conic-gradient(${stops.join(', ')})`;

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donutContainer}>
        <div className={styles.donut} style={{ background: gradient }} title={`Total: ${total}`}>
          <div className={styles.donutHole}>
            <span className={styles.donutCenter}>{centerLabel ?? total}</span>
          </div>
        </div>
      </div>
      <div className={styles.donutLegend}>
        {segments.map(({ label, count, color, pct }) => (
          <div key={label} className={styles.donutLegendItem}>
            <span className={styles.donutLegendSwatch} style={{ background: color }} />
            <span className={styles.donutLegendLabel}>{label}</span>
            <span className={styles.donutLegendPct}>{pct.toFixed(0)}%</span>
            <span className={styles.donutLegendCount}>{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BarChart — CSS flex vertical bars
// ---------------------------------------------------------------------------
function BarChart({ counts, maxBars = 10, color }) {
  const all = Object.entries(counts || {})
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);
  const entries = all.slice(0, maxBars);
  const hiddenCount = all.length - entries.length;
  const hiddenSum = all.slice(maxBars).reduce((s, [, v]) => s + v, 0);
  const max = entries[0]?.[1] || 1;
  if (!entries.length) return <span className={styles.empty}>No data</span>;

  return (
    <div className={styles.barChart}>
      {/* Gridlines align with the top of a hypothetical bar at pct% of the
          bar area. The bar area is the container's content box minus the
          1.6rem padding-bottom that reserves space for axis labels. The prior
          formula `calc(${pct}% + 1.4rem)` was wrong on two counts: it used
          the full container height as the reference (instead of the bar area
          height) AND used 1.4rem when the CSS padding is 1.6rem. Result:
          the 75% gridline rendered near the top of the chart at ~6% from
          top, not where 75%-height bars peaked. See Phase 25 in case-study. */}
      {[75, 50, 25].map((pct) => (
        <div
          key={pct}
          className={styles.barChartGridline}
          style={{ bottom: `calc((100% - 1.6rem) * ${pct / 100} + 1.6rem)` }}
        />
      ))}
      {entries.map(([label, count], i) => {
        const heightPct = Math.max(4, (count / max) * 100);
        const barColor = color || PALETTE[i % PALETTE.length];
        return (
          <div key={label} className={styles.barWrap} title={`${label}: ${count}`}>
            <span className={styles.barCount}>{count}</span>
            <div
              className={styles.bar}
              style={{ height: `${heightPct}%`, background: barColor }}
            >
              <span className={styles.barLabel}>{label}</span>
            </div>
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <div
          className={styles.barChartHiddenNote}
          title={`${hiddenCount} categories not shown; combined ${hiddenSum} items`}
        >
          +{hiddenCount} more
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HorizontalBar — single labelled fill bar for comparisons
// ---------------------------------------------------------------------------
function HorizontalBar({ label, value, max, color, subtitle }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className={styles.hBarItem}>
      <div className={styles.hBarMeta}>
        <span className={styles.hBarLabel}>{label}</span>
        <span className={styles.hBarValue}>{value} <span className={styles.hBarPct}>({pct}%)</span></span>
      </div>
      <div className={styles.hBarTrack}>
        <div className={styles.hBarFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      {subtitle && <span className={styles.hBarSubtitle}>{subtitle}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProgressList — vertical list of metric progress bars
// ---------------------------------------------------------------------------
function ProgressList({ items }) {
  return (
    <div className={styles.progressList}>
      {items.map(({ label, value, warn, tooltip }) => {
        const pct = Math.round(value * 100);
        const fillClass = warn
          ? pct < 30
            ? styles.progressFillDanger
            : styles.progressFillWarn
          : styles.progressFill;
        return (
          <div key={label} className={styles.progressItem} title={tooltip}>
            <div className={styles.progressMeta}>
              <span>{label}</span>
              <span className={pct < 50 ? styles.warnText : styles.okText}>{pct}%</span>
            </div>
            <div className={styles.progressTrack}>
              <div className={fillClass} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------
function StatusBadge({ ok, warn, label, tooltip }) {
  const cls = ok ? styles.statusOk : warn ? styles.statusWarn : styles.statusError;
  const icon = ok ? '✓' : warn ? '⚠' : '✗';
  return (
    <span className={`${styles.statusBadge} ${cls}`} title={tooltip}>
      {icon} {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatCard — big number highlight with icon and optional trend
// ---------------------------------------------------------------------------
function StatCard({ icon, value, label, accent, tooltip }) {
  return (
    <div className={`${styles.statCard} ${accent ? styles.statCardAccent : ''}`} title={tooltip}>
      {icon && <span className={styles.statCardIcon}>{icon}</span>}
      <div className={styles.statCardValue}>{value}</div>
      <div className={styles.statCardLabel}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HealthGauge — semicircle gauge showing overall build health %
// ---------------------------------------------------------------------------
function HealthGauge({ score }) {
  // Gauge style logic is extracted to healthGauge.js so it can be unit-tested
  // without a React renderer. See tests/healthGauge.test.mjs.
  const { pct, color, gradient, label } = computeGaugeStyle(score);

  return (
    <div className={styles.gaugeWrap}>
      <div className={styles.gauge} style={{ background: gradient }}>
        <div className={styles.gaugeHole}>
          <span className={styles.gaugeValue} style={{ color }}>{pct}%</span>
          <span className={styles.gaugeLabel}>{label}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldCoverageGrid — colour-coded grid of field coverage
// ---------------------------------------------------------------------------
function FieldCoverageGrid({ fieldCoveragePercent }) {
  const entries = Object.entries(fieldCoveragePercent || {});
  if (!entries.length) return null;
  return (
    <div className={styles.coverageGrid}>
      {entries.map(([field, pct]) => {
        const pctRound = Math.round(pct * 100);
        const intensity =
          pctRound >= 80 ? 'high' :
          pctRound >= 40 ? 'mid' :
          'low';
        return (
          <div
            key={field}
            className={`${styles.coverageCell} ${styles[`coverageCell_${intensity}`]}`}
            title={`${field}: ${pctRound}%`}
          >
            <span className={styles.coverageCellField}>{field.replace(/_/g, ' ')}</span>
            <span className={styles.coverageCellPct}>{pctRound}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 1: Build Overview (hero)
// ---------------------------------------------------------------------------
function BuildOverviewPanel({ report }) {
  const { aggregate } = report;
  const completePct = Math.round(aggregate.avgCompleteness * 100);

  // Hero gauge shows avgCompleteness directly so the headline number matches
  // the corpus's actual schema completeness. The older seoScore formula
  // (presence checks for title/description/keywords + completeness/4) lives in
  // the dedicated SEOHealthPanel further down, where its scope is explicit.
  // See .github/case-study/insights.md.

  return (
    <div className={`${styles.panel} ${styles.panelHero}`}>
      <div className={styles.heroGradient} aria-hidden="true" />
      <div className={styles.heroContent}>
        <div className={styles.heroLeft}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>📦</span>
            <h3 className={styles.panelTitle}>Build Overview</h3>
          </div>
          <p className={styles.panelSubtitle}>Top-line snapshot of repo health and recent build activity.</p>
          <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Composite health · run metadata · top-line build stats</p>
          <div className={styles.heroStats}>
            <StatCard icon="📄" value={aggregate.totalDocs} label="Total Docs" accent tooltip={tip('buildOverview', 'totalDocs')} />
            <StatCard icon="💬" value={aggregate.totalWords.toLocaleString()} label="Total Words" tooltip={tip('buildOverview', 'totalWords')} />
            <StatCard icon="📝" value={aggregate.avgWords} label="Avg Words/Doc" tooltip={tip('buildOverview', 'avgWords')} />
            <StatCard icon="✅" value={`${completePct}%`} label="Completeness" tooltip={tip('buildOverview', 'completeness')} />
          </div>
          <div className={styles.statusRow} style={{ marginTop: '0.75rem' }}>
            {Object.entries(aggregate.sections || {}).map(([section, count]) => (
              <StatusBadge key={section} ok label={`${section}: ${count}`} />
            ))}
          </div>
        </div>
        <div className={styles.heroRight}>
          <HealthGauge score={completePct} />
          <p className={styles.gaugeCaption} title={tip('buildOverview', 'healthScore')}>Content Health Score</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 2: Schema Analytics (NEW — device · role · use case · skill level)
// ---------------------------------------------------------------------------
function SchemaAnalyticsPanel({ report }) {
  const { aggregate } = report;
  const tax = aggregate.taxonomy || {};

  const deviceType   = tax.device_type || {};
  const roleData     = tax.role || {};
  const useCaseData  = tax.use_case || {};
  const skillLevel   = tax.skill_level || {};
  const productName  = tax.product_name || {};

  // Total topics (across all use_case occurrences — each doc can have multiple)
  const totalUseCaseInstances = Object.values(useCaseData).reduce((s, v) => s + v, 0);
  const totalRoleInstances    = Object.values(roleData).reduce((s, v) => s + v, 0);

  return (
    <div className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🔬</span>
        <h3 className={styles.panelTitle}>Schema Analytics</h3>
      </div>
      <p className={styles.panelSubtitle}>How the corpus is tagged across devices, audiences, and use cases.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Frontmatter taxonomy · use-case + role tag distribution</p>

      <div className={styles.schemaGrid}>
        {/* Device Type */}
        <div className={styles.schemaSection}>
          <h4 className={styles.schemaSectionTitle} title={tip('schemaAnalytics', 'deviceType')}>📡 Topics by Device Type</h4>
          <DonutChart counts={deviceType} centerLabel="devices" />
        </div>

        {/* Role / User */}
        <div className={styles.schemaSection}>
          <h4 className={styles.schemaSectionTitle} title={tip('schemaAnalytics', 'roleUser')}>👤 Topics by Role / User</h4>
          <div className={styles.hBarList}>
            {Object.entries(roleData)
              .sort(([, a], [, b]) => b - a)
              .map(([role, count], i) => (
                <HorizontalBar
                  key={role}
                  label={role}
                  value={count}
                  max={totalRoleInstances}
                  color={PALETTE[i % PALETTE.length]}
                />
              ))}
          </div>
        </div>

        {/* Use Case (most popular) */}
        <div className={`${styles.schemaSection} ${styles.schemaSectionWide}`}>
          <h4 className={styles.schemaSectionTitle} title={tip('schemaAnalytics', 'useCase')}>🎯 Topics by Use Case (ranked)</h4>
          <div className={styles.hBarList}>
            {Object.entries(useCaseData)
              .sort(([, a], [, b]) => b - a)
              .map(([uc, count], i) => (
                <HorizontalBar
                  key={uc}
                  label={uc}
                  value={count}
                  max={totalUseCaseInstances}
                  color={PALETTE[i % PALETTE.length]}
                />
              ))}
          </div>
        </div>

        {/* Skill Level */}
        <div className={styles.schemaSection}>
          <h4 className={styles.schemaSectionTitle} title={tip('schemaAnalytics', 'skillLevel')}>🎓 Skill Level Distribution</h4>
          <DonutChart counts={skillLevel} />
        </div>

        {/* Product Name */}
        <div className={styles.schemaSection}>
          <h4 className={styles.schemaSectionTitle} title={tip('schemaAnalytics', 'productName')}>🏷 Topics by Product</h4>
          <BarChart counts={productName} maxBars={6} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 3: Schema Intelligence (field coverage heatmap)
// ---------------------------------------------------------------------------
function SchemaIntelligencePanel({ report }) {
  const { aggregate } = report;
  const guessing = aggregate.guessing || {};

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🧬</span>
        <h3 className={styles.panelTitle}>Schema Intelligence</h3>
      </div>
      <p className={styles.panelSubtitle}>Where the build pipeline auto-guessed metadata vs where authors supplied it.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Frontmatter field coverage · author-vs-guess ratio</p>
      <div className={styles.statRow}>
        <div className={styles.stat} title={tip('schemaIntelligence', 'guessedFields')}>
          <div className={styles.statValue}>{guessing.totalGuessedFields || 0}</div>
          <div className={styles.statLabel}>Guessed Fields</div>
        </div>
        <div className={styles.stat} title={tip('schemaIntelligence', 'docsWithGuesses')}>
          <div className={styles.statValue}>{guessing.docsWithGuesses || 0}</div>
          <div className={styles.statLabel}>Docs w/ Guesses</div>
        </div>
        <div className={styles.stat} title={tip('schemaIntelligence', 'fullyAuthored')}>
          <div className={styles.statValue}>
            {aggregate.totalDocs - (guessing.docsWithGuesses || 0)}
          </div>
          <div className={styles.statLabel}>Fully Authored</div>
        </div>
      </div>
      <div title={tip('schemaIntelligence', 'fieldHeatmap')}>
        <FieldCoverageGrid fieldCoveragePercent={aggregate.fieldCoveragePercent} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 4: Date & Freshness Analytics
// ---------------------------------------------------------------------------
function DateFreshnessPanel({ report }) {
  const { aggregate, docs } = report;
  const da = aggregate.dateAnalytics || {};
  const total = aggregate.totalDocs || 1;

  const buckets = [
    { label: 'Fresh',   key: 'fresh',  subtitle: '< 30 days', color: '#2ecc71' },
    { label: 'Recent',  key: 'recent', subtitle: '30–90 days', color: '#3498db' },
    { label: 'Aging',   key: 'aging',  subtitle: '90–180 days', color: '#f39c12' },
    { label: 'Stale',   key: 'stale',  subtitle: '> 180 days', color: '#e74c3c' },
  ];

  // Monthly velocity chart
  const sortedMonths = Object.entries(da.modifiedByMonth || {}).sort(([a], [b]) => a.localeCompare(b));
  const monthCounts = Object.fromEntries(sortedMonths.map(([k, v]) => [k.slice(5), v])); // show MM

  // Top 5 most recently modified docs
  const recentDocs = [...docs]
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
    .slice(0, 5);

  const reviewCoverage = Math.round((da.lastReviewedCount || 0) / total * 100);

  return (
    <div className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>📅</span>
        <h3 className={styles.panelTitle}>Date &amp; Freshness Analytics</h3>
      </div>
      <p className={styles.panelSubtitle}>When docs were last touched and which are at risk of going stale.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Content age · review coverage · stale-doc detection</p>

      {/* Extra freshness stats */}
      <div className={styles.chipRow}>
        <div className={styles.chip}>
          <span className={styles.chipValue}>{da.meanContentAgeDays ?? '–'}<span style={{ fontSize: '0.65rem', fontWeight: 400 }}> days</span></span>
          <span className={styles.chipLabel}>Mean Content Age</span>
        </div>
        <div className={styles.chip}>
          <span className={styles.chipValue}
            style={{ color: (da.screenshotCurrencyRate ?? 1) >= 0.8 ? '#2ecc71' : (da.screenshotCurrencyRate ?? 1) >= 0.6 ? '#f39c12' : '#e74c3c' }}>
            {da.screenshotCurrencyRate != null ? `${Math.round(da.screenshotCurrencyRate * 100)}%` : '–'}
          </span>
          <span className={styles.chipLabel}>Screenshot Currency</span>
        </div>
        <div className={styles.chip}>
          <span className={styles.chipValue}
            style={{ color: (da.stalePageRate ?? 0) > 0.3 ? '#e74c3c' : (da.stalePageRate ?? 0) > 0.15 ? '#f39c12' : '#2ecc71' }}>
            {da.stalePageRate != null ? `${(da.stalePageRate * 100).toFixed(1)}%` : '–'}
          </span>
          <span className={styles.chipLabel}>Stale Page Rate</span>
        </div>
      </div>

      {/* Freshness buckets */}
      <div className={styles.freshnessRow}>
        {buckets.map(({ label, key, subtitle, color }) => {
          const count = da[key] || 0;
          const pct = Math.round((count / total) * 100);
          return (
            <div key={key} className={styles.freshnessBucket} style={{ borderTopColor: color }} title={tip('dateFreshness', key)}>
              <div className={styles.freshnessBucketValue} style={{ color }}>{count}</div>
              <div className={styles.freshnessBucketLabel}>{label}</div>
              <div className={styles.freshnessBucketSub}>{subtitle} · {pct}%</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        {/* Monthly velocity */}
        {Object.keys(monthCounts).length > 0 && (
          <div style={{ flex: '1 1 200px' }} title={tip('dateFreshness', 'velocityChart')}>
            <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
              Monthly modification velocity
            </p>
            <BarChart counts={monthCounts} color="#003fbd" />
          </div>
        )}
        {/* Recently modified */}
        <div style={{ flex: '2 1 260px' }} title={tip('dateFreshness', 'recentlyModified')}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
            5 most recently modified
          </p>
          <table className={styles.docTable}>
            <thead>
              <tr><th>Title</th><th>Modified</th><th>Section</th></tr>
            </thead>
            <tbody>
              {recentDocs.map((d) => (
                <tr key={d.filePath}>
                  <td title={d.title}>{d.title}</td>
                  <td>{new Date(d.lastModified).toLocaleDateString()}</td>
                  <td>{d.section}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 5: SEO Health
// ---------------------------------------------------------------------------
function SeoHealthPanel({ report }) {
  const { aggregate } = report;
  const seo = aggregate.seoHealth || {};
  const total = aggregate.totalDocs || 1;

  const items = [
    { label: 'Has Title',       value: (seo.hasTitle || 0) / total,       tooltip: tip('seoHealth', 'hasTitle') },
    { label: 'Has Description', value: (seo.hasDescription || 0) / total, warn: true, tooltip: tip('seoHealth', 'hasDescription') },
    { label: 'Has Keywords',    value: (seo.hasKeywords || 0) / total,    warn: true, tooltip: tip('seoHealth', 'hasKeywords') },
    { label: 'Has Slug',        value: (seo.hasSlug || 0) / total,        tooltip: tip('seoHealth', 'hasSlug') },
  ];

  const seoScore = Math.round(
    items.reduce((s, i) => s + i.value, 0) / items.length * 100
  );

  const scoreColor =
    seoScore >= 75 ? '#2ecc71' :
    seoScore >= 50 ? '#f39c12' :
    '#e74c3c';

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🔍</span>
        <h3 className={styles.panelTitle}>SEO Health</h3>
      </div>
      <p className={styles.panelSubtitle}>Whether docs have the frontmatter search engines need to surface them.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Metadata completeness for search visibility</p>
      <div className={styles.statRow}>
        <div className={styles.stat} title={tip('seoHealth', 'seoScore')}>
          <div className={styles.statValue} style={{ color: scoreColor }}>{seoScore}%</div>
          <div className={styles.statLabel}>SEO Score</div>
        </div>
        <div className={styles.stat} title={tip('seoHealth', 'hasDescription')}>
          <div className={styles.statValue}>{seo.hasDescription || 0}/{total}</div>
          <div className={styles.statLabel}>Have Description</div>
        </div>
      </div>
      <ProgressList items={items} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 6: Analytics (GA + publish status)
// ---------------------------------------------------------------------------
function AnalyticsPanel({ report }) {
  const { aggregate } = report;
  const statusCounts = aggregate.taxonomy?.status || {};
  const publishedCount = statusCounts['Published'] || 0;
  const draftCount = statusCounts['Draft'] || 0;
  const total = aggregate.totalDocs || 1;
  const publishRate = Math.round((publishedCount / total) * 100);

  // Attempt to detect GA presence in the window (browser-only)
  const [gaStatus, setGaStatus] = useState('checking…');
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const tag = document.querySelector('script[src*="googletagmanager"]');
        const dataLayerLen = window.dataLayer?.length ?? 0;
        if (tag && window.gtag && typeof window.gtag === 'function') {
          setGaStatus(`Active · ${dataLayerLen} dataLayer events`);
        } else if (tag) {
          setGaStatus('Tag present but blocked (adblocker?)');
        } else {
          setGaStatus('Not configured');
        }
      }
    } catch {
      setGaStatus('Unknown');
    }
  }, []);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>📊</span>
        <h3 className={styles.panelTitle}>Analytics</h3>
      </div>
      <p className={styles.panelSubtitle}>Publishing pipeline status: drafted vs published, and whether GA is wired.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Publish status · GA Tier 1 presence</p>
      <div className={styles.statusRow}>
        <StatusBadge
          ok={gaStatus.startsWith('Active')}
          warn={!gaStatus.startsWith('Active') && !gaStatus.startsWith('Not')}
          label={`GA: ${gaStatus}`}
        />
      </div>
      <div className={styles.statRow} style={{ marginTop: '0.5rem' }}>
        <div className={styles.stat} title={tip('analytics', 'published')}>
          <div className={styles.statValue}>{publishedCount}</div>
          <div className={styles.statLabel}>Published</div>
        </div>
        <div className={styles.stat} title={tip('analytics', 'draft')}>
          <div className={styles.statValue}>{draftCount}</div>
          <div className={styles.statLabel}>Draft</div>
        </div>
        <div className={styles.stat} title={tip('analytics', 'publishRate')}>
          <div
            className={styles.statValue}
            style={{ color: tierColor(publishRate) }}
          >
            {publishRate}%
          </div>
          <div className={styles.statLabel}>Publish Rate</div>
        </div>
      </div>
      <DonutChart counts={statusCounts} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 7: Content Performance (word count distribution)
// ---------------------------------------------------------------------------
function ContentPerformancePanel({ report }) {
  const { aggregate, docs } = report;

  const buckets = { '0–100': 0, '101–300': 0, '301–600': 0, '601–1000': 0, '1000+': 0 };
  for (const doc of docs) {
    const w = doc.wordCount;
    if (w <= 100)       buckets['0–100']++;
    else if (w <= 300)  buckets['101–300']++;
    else if (w <= 600)  buckets['301–600']++;
    else if (w <= 1000) buckets['601–1000']++;
    else                buckets['1000+']++;
  }

  const topDocs = [...docs].sort((a, b) => b.wordCount - a.wordCount).slice(0, 5);
  const thinDocs = docs.filter((d) => d.wordCount < 100).length;

  return (
    <div className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>⚡</span>
        <h3 className={styles.panelTitle}>Content Performance</h3>
      </div>
      <p className={styles.panelSubtitle}>Where the long-form docs sit and where the stubs are.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Word count distribution · thin content detection</p>
      <div className={styles.statRow}>
        <div className={styles.stat} title={tip('contentPerformance', 'avgWords')}>
          <div className={styles.statValue}>{aggregate.avgWords}</div>
          <div className={styles.statLabel}>Avg Words</div>
        </div>
        <div className={styles.stat} title={tip('contentPerformance', 'totalWords')}>
          <div className={styles.statValue}>{aggregate.totalWords.toLocaleString()}</div>
          <div className={styles.statLabel}>Total Words</div>
        </div>
        <div className={styles.stat} title={tip('contentPerformance', 'thinDocs')}>
          <div
            className={styles.statValue}
            style={{ color: thinDocs > 0 ? '#e74c3c' : '#2ecc71' }}
          >
            {thinDocs}
          </div>
          <div className={styles.statLabel}>Thin Docs (&lt;100w)</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }} title={tip('contentPerformance', 'wordDistribution')}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>Word count distribution</p>
          <BarChart counts={buckets} color="#003fbd" />
        </div>
        <div style={{ flex: '2 1 240px' }} title={tip('contentPerformance', 'topDocs')}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>Top 5 docs by length</p>
          <table className={styles.docTable}>
            <thead>
              <tr><th>Title</th><th>Words</th><th>Section</th></tr>
            </thead>
            <tbody>
              {topDocs.map((d) => (
                <tr key={d.filePath}>
                  <td title={d.title}>{d.title}</td>
                  <td>{d.wordCount}</td>
                  <td>{d.section}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 8: Search (index health + query metrics)
// ---------------------------------------------------------------------------
function SearchPanel({ report }) {
  const [searchData, setSearchData] = useState(null);
  const [searchErr, setSearchErr] = useState(false);
  const [strategy, setStrategy] = useState(null);
  const searchDataUrl = useBaseUrl('/data/search-data.json');
  const strategyUrl = useBaseUrl('/data/strategy-report.json');

  useEffect(() => {
    fetch(searchDataUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => (data ? setSearchData(data) : setSearchErr(true)))
      .catch(() => setSearchErr(true));
    fetch(strategyUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setStrategy(data))
      .catch(() => { /* strategy report optional */ });
  }, [searchDataUrl, strategyUrl]);

  // Indexing statistics from search-data.json (real data — 507 docs, 8 facets)
  const productFamilyCounts = {};
  const contentTypeCounts = {};
  if (searchData?.documents) {
    for (const doc of searchData.documents) {
      for (const fam of (doc.product_family || [])) {
        productFamilyCounts[fam] = (productFamilyCounts[fam] || 0) + 1;
      }
      for (const ct of (doc.content_type || [])) {
        contentTypeCounts[ct] = (contentTypeCounts[ct] || 0) + 1;
      }
    }
  }

  const indexSizeKb = searchData
    ? Math.round(JSON.stringify(searchData).length / 1024)
    : null;

  const indexCoverage = searchData && report.aggregate.totalDocs > 0
    ? Math.round((searchData.documents.length / report.aggregate.totalDocs) * 100)
    : null;

  const facetCount = searchData ? Object.keys(searchData.taxonomy || {}).length : null;

  // Query metrics from strategy-report.json (schema exists; values typically 0
  // until Clarity is wired or in-product search log feeds the strategist).
  const searchGaps = strategy?.searchGaps || {};
  const totalQueries = searchGaps.totalQueries ?? 0;
  const uniqueQueries = searchGaps.uniqueQueries ?? 0;
  const topQueries = searchGaps.topQueries || [];
  const missedSearches = searchGaps.missedSearches || [];
  const hasQueryData = totalQueries > 0 || topQueries.length > 0 || missedSearches.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🔎</span>
        <h3 className={styles.panelTitle}>Search</h3>
      </div>
      <p className={styles.panelSubtitle}>What's indexed for search and what users actually search for.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Index health · facets · query metrics</p>

      {/* ── Indexing (real data) ─────────────────────────────────────── */}
      <div className={styles.statusRow}>
        {searchErr
          ? <StatusBadge label="search-data.json not found" />
          : searchData
            ? <StatusBadge ok label="Index loaded" />
            : <StatusBadge warn label="Loading…" />}
      </div>
      <div className={styles.statRow}>
        <div className={styles.stat} title={tip('search', 'docsIndexed')}>
          <div className={styles.statValue}>{searchData ? searchData.documents.length : '–'}</div>
          <div className={styles.statLabel}>Docs Indexed</div>
        </div>
        <div className={styles.stat} title={tip('search', 'sourceDocs')}>
          <div className={styles.statValue}>{report.aggregate.totalDocs}</div>
          <div className={styles.statLabel}>Source Docs</div>
        </div>
        <div className={styles.stat} title={tip('search', 'coverage')}>
          <div
            className={styles.statValue}
            style={{ color: indexCoverage != null ? (indexCoverage >= 80 ? '#2ecc71' : '#f39c12') : undefined }}
          >
            {indexCoverage != null ? `${indexCoverage}%` : '–'}
          </div>
          <div className={styles.statLabel}>Coverage</div>
        </div>
        <div className={styles.stat} title={tip('search', 'facets')}>
          <div className={styles.statValue}>{facetCount != null ? facetCount : '–'}</div>
          <div className={styles.statLabel}>Facets</div>
        </div>
        <div className={styles.stat} title={tip('search', 'indexSize')}>
          <div className={styles.statValue}>{indexSizeKb != null ? `~${indexSizeKb} KB` : '–'}</div>
          <div className={styles.statLabel}>Index Size</div>
        </div>
      </div>

      {/* ── Index breakdown by product family ────────────────────────── */}
      {searchData && Object.keys(productFamilyCounts).length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.4rem', fontWeight: 600 }}>
            Indexed docs by product family
          </p>
          <BarChart counts={productFamilyCounts} />
        </div>
      )}

      {/* ── Query metrics (currently empty — awaiting data source) ───── */}
      <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🔍 Query metrics
          {!hasQueryData && (
            <span style={{ display: 'inline-block', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, color: '#fff', background: '#a78bfa' }}>
              awaiting data
            </span>
          )}
        </p>

        {!hasQueryData ? (
          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--dd-muted)', lineHeight: 1.5 }}>
            No query data yet. Top searched terms and missed searches will appear once an in-product search log feeds the Strategist, or once Microsoft Clarity is wired in production. Schema in <code>static/data/strategy-report.json</code> (<code>searchGaps</code>) is ready to receive: <code>totalQueries</code>, <code>uniqueQueries</code>, <code>topQueries[]</code>, <code>missedSearches[]</code>.
          </p>
        ) : (
          <>
            <div className={styles.statRow}>
              <div className={styles.stat} title={tip('search', 'totalQueries')}>
                <div className={styles.statValue}>{totalQueries}</div>
                <div className={styles.statLabel}>Total Queries</div>
              </div>
              <div className={styles.stat} title={tip('search', 'uniqueQueries')}>
                <div className={styles.statValue}>{uniqueQueries}</div>
                <div className={styles.statLabel}>Unique Queries</div>
              </div>
              <div className={styles.stat} title={tip('search', 'missed')}>
                <div className={styles.statValue} style={{ color: missedSearches.length > 0 ? '#e74c3c' : '#2ecc71' }}>
                  {missedSearches.length}
                </div>
                <div className={styles.statLabel}>Missed</div>
              </div>
            </div>

            {topQueries.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <p className={styles.panelSubtitle} style={{ margin: '0 0 0.3rem', fontWeight: 600 }}>Most searched terms</p>
                <table className={styles.docTable}>
                  <thead><tr><th style={{ width: '70%' }}>Term</th><th style={{ width: '30%', textAlign: 'right' }}>Count</th></tr></thead>
                  <tbody>
                    {topQueries.slice(0, 10).map((q, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 'var(--fs-xs)' }}>{q.query || q.term}</td>
                        <td style={{ fontWeight: 700, textAlign: 'right' }}>{q.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {missedSearches.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <p className={styles.panelSubtitle} style={{ margin: '0 0 0.3rem', fontWeight: 600, color: '#e74c3c' }}>Missed searches (no results returned)</p>
                <table className={styles.docTable}>
                  <thead><tr><th style={{ width: '70%' }}>Term</th><th style={{ width: '30%', textAlign: 'right' }}>Count</th></tr></thead>
                  <tbody>
                    {missedSearches.slice(0, 10).map((m, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: 'var(--fs-xs)' }}>{m.query || m.term}</td>
                        <td style={{ fontWeight: 700, textAlign: 'right', color: '#e74c3c' }}>{m.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 9: Content Quality (placeholders + missing metadata)
// ---------------------------------------------------------------------------
function ContentQualityPanel({ report }) {
  const { aggregate, docs } = report;
  const placeholders = aggregate.placeholders || {};
  const docsWithIssues = placeholders.docsWithPlaceholders || 0;
  const byField = placeholders.byField || {};

  const missingTitle = docs.filter((d) => !d.frontmatter.title).length;
  const missingDesc = docs.filter((d) => !d.frontmatter.description).length;
  const missingKeywords = docs.filter((d) => {
    const kw = d.frontmatter.keywords;
    return !kw || (Array.isArray(kw) && kw.length === 0);
  }).length;

  // Top 8 least complete docs (shown by default) + the remaining incomplete
  // docs available behind a details-on-demand drilldown so users can audit
  // the full backlog without leaving the panel.
  const allByCompleteness = [...docs]
    .filter((d) => d.completenessScore < 1)
    .sort((a, b) => a.completenessScore - b.completenessScore);
  const leastComplete = allByCompleteness.slice(0, 8);
  const remainingIncomplete = allByCompleteness.slice(8);

  return (
    <div className={`${styles.panel} ${styles.panelFull}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>♿</span>
        <h3 className={styles.panelTitle}>Content Quality</h3>
      </div>
      <p className={styles.panelSubtitle}>Docs not yet ready for release: missing fields or placeholder text.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Placeholder detection · missing metadata · completeness</p>
      <div className={styles.statusRow}>
        <StatusBadge
          ok={docsWithIssues === 0}
          warn={docsWithIssues > 0 && docsWithIssues < 10}
          label={`${docsWithIssues} docs have placeholders`}
        />
        <StatusBadge
          ok={missingTitle === 0}
          warn={missingTitle > 0}
          label={`${missingTitle} missing title`}
          tooltip={tip('contentQuality', 'missingTitle')}
        />
        <StatusBadge
          ok={missingDesc === 0}
          warn={missingDesc > 0}
          label={`${missingDesc} missing description`}
          tooltip={tip('contentQuality', 'missingDescription')}
        />
        <StatusBadge
          ok={missingKeywords === 0}
          warn={missingKeywords > 0}
          label={`${missingKeywords} missing keywords`}
          tooltip={tip('contentQuality', 'missingKeywords')}
        />
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        {/* Placeholder by field */}
        <div style={{ flex: '1 1 200px' }} title={tip('contentQuality', 'placeholdersByField')}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>Placeholders by field</p>
          <div className={styles.scrollBox}>
            <table className={styles.docTable}>
              <thead>
                <tr><th>Field</th><th># Affected</th></tr>
              </thead>
              <tbody>
                {Object.entries(byField)
                  .sort(([, a], [, b]) => b - a)
                  .map(([field, count]) => (
                    <tr key={field}>
                      <td>{field === '_body' ? 'Body text' : field}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Least complete docs */}
        <div style={{ flex: '2 1 260px' }} title={tip('contentQuality', 'needsAttention')}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
            Docs needing the most attention
          </p>
          <div className={styles.scrollBox}>
            <table className={styles.docTable}>
              <thead>
                <tr><th>Title</th><th>Completeness</th><th>Guesses</th></tr>
              </thead>
              <tbody>
                {leastComplete.map((d) => {
                  const pct = Math.round(d.completenessScore * 100);
                  const color =
                    pct >= 75 ? '#2ecc71' :
                    pct >= 50 ? '#f39c12' :
                    '#e74c3c';
                  return (
                    <tr key={d.filePath}>
                      <td title={d.title}>{d.title}</td>
                      <td style={{ color, fontWeight: 600 }}>{pct}%</td>
                      <td>{d.guessedFields.length > 0
                        ? <span className={styles.guessedChip}>{d.guessedFields.length} guessed</span>
                        : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {remainingIncomplete.length > 0 && (
            <DetailsOnDemand
              summary={`${remainingIncomplete.length} more docs with incomplete metadata`}
              count={remainingIncomplete.length}
            >
              <div className={styles.scrollBox}>
                <table className={styles.docTable}>
                  <thead>
                    <tr><th>Title</th><th>Completeness</th></tr>
                  </thead>
                  <tbody>
                    {remainingIncomplete.map((d) => {
                      const pct = Math.round(d.completenessScore * 100);
                      const color = pct >= 75 ? '#2ecc71' : pct >= 50 ? '#f39c12' : '#e74c3c';
                      return (
                        <tr key={d.filePath}>
                          <td title={d.title} style={{ fontSize: 'var(--fs-xs)' }}>{d.title}</td>
                          <td style={{ color, fontWeight: 600 }}>{pct}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DetailsOnDemand>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Librarian Pod Panel
// ---------------------------------------------------------------------------
function LibrarianPanel({ report, alerts, semanticLoss }) {
  const [scope, setScope] = useState('');
  const enriched = useMemo(
    () => (semanticLoss ? { ...report, semanticLoss } : report),
    [report, semanticLoss],
  );
  const {
    result,
    activateResult, activating, activateError,
    activate, dryRun: dryRunFn,
    serverOnline,
  } = usePodPanel('librarian', runLibrarian, enriched);

  const handleActivate = (isDryRun) => {
    const body = scope ? { scope } : undefined;
    return isDryRun ? dryRunFn(body) : activate(body);
  };

  // Severity badge
  const SevBadge = ({ sev }) => {
    const cls = sev === 'P1' ? styles.statusError : sev === 'P2' ? styles.statusWarn : styles.statusOk;
    return <span className={`${styles.statusBadge} ${cls}`}>{sev}</span>;
  };
  const ModeBadge = ({ mode }) => {
    const cls = mode === 'ESCALATE' ? styles.statusError : mode === 'AUTO_REMEDIATE' ? styles.statusWarn : styles.statusOk;
    return <span className={`${styles.statusBadge} ${cls}`}>{mode.replace(/_/g, ' ')}</span>;
  };

  return (
    <PodPanel
      name="librarian"
      icon="📚"
      title="The Librarian"
      subtitle="Agent v3.0 · Metadata · Schema · Links · DITA"
      alerts={alerts}
    >
      {/* Pod description */}
      <div style={{ padding: '0.75rem 1rem', margin: '0 0 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--dd-muted, #8892b0)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--dd-text, #ccd6f6)' }}>
          The Librarian owns metadata integrity, broken links/images, DITA migration tracking, and semantic loss detection.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#e67e22' }}>🔍 Scan</span>
          <span>Full read-only scan — walks every doc in <code>/docs</code>, applies all rules, lists exactly what Activate would change. No files modified. Requires the companion server.</span>
          <span style={{ fontWeight: 700, color: '#e74c3c' }}>⚡ Activate (writes + PR)</span>
          <span>Same scan as above, then auto-fills missing frontmatter + repairs DITA conversion artifacts. Creates <strong>two separate PRs</strong> for review (schema fill + body fixes).</span>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', fontStyle: 'italic' }}>
          Both buttons require the companion server: <code style={{ background: '#2a2a3e', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>npm run librarian:server</code>
        </p>
      </div>

      {/* Action buttons */}
      <div style={{ margin: '1rem 0', textAlign: 'center' }}>
        <button
          onClick={() => handleActivate(true)}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #e67e22, #d35400)' }}
          title={serverOnline === false ? 'Start the Librarian server first: node scripts/librarian-server.mjs' : 'Full scan — no file writes'}
        >
          {activating ? '⏳ Scanning…' : '🔍 Scan'}
        </button>
        <button
          onClick={() => {
            if (window.confirm('Activate Librarian will modify docs/ and create 2 PRs (schema fill + DITA body fixes). Continue?')) {
              handleActivate(false);
            }
          }}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ marginLeft: '0.75rem', background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #c0392b, #e74c3c)' }}
          title={serverOnline === false ? 'Start the Librarian server first: node scripts/librarian-server.mjs' : 'Auto-fill frontmatter + fix DITA body issues → 2 PRs'}
        >
          {activating ? '⏳ Activating…' : '⚡ Activate Librarian (writes + PR)'}
        </button>
        <ActivateProgress active={activating} label="Activating Librarian" />
        {serverOnline === false && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#e74c3c' }}>
            ⚠ Librarian server offline — start everything in one command: <code>npm run dev:all</code> (or just this pod: <code>npm run librarian:server</code>)
          </div>
        )}
        {serverOnline === true && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#2ecc71' }}>
            ✓ Librarian server online at port 3456
          </div>
        )}
        {serverOnline !== false && (
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
            <label style={{ color: 'var(--dd-muted)', fontWeight: 600 }}>Scope:</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              style={{
                padding: '0.3rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid var(--dd-border, #30363d)',
                background: 'var(--dd-surface, #161b22)',
                color: 'var(--dd-text, #c9d1d9)',
                fontSize: '0.78rem',
              }}
            >
              <option value="">All docs</option>
              <option value="fs10-prg">fs10-prg (FS10)</option>
              <option value="fs42-prg">fs42-prg (FS42)</option>
              <option value="fs80-prg">fs80-prg (FS80)</option>
              <option value="xs20-prg">xs20-prg (VS20)</option>
              <option value="js-guide">js-guide (JavaScript)</option>
              <option value="ziml-prg">ziml-prg (ZIML)</option>
              <option value="user-guide">user-guide</option>
              <option value="licensing">licensing</option>
              <option value="release-notes">release-notes</option>
            </select>
            <span style={{ fontSize: '0.68rem', color: 'var(--dd-muted)' }}>
              {scope ? `Target: docs/${scope}/` : 'Target: all docs/'}
            </span>
          </div>
        )}
        {result && (
          <span style={{ marginLeft: '0.75rem', fontSize: '0.72rem', color: 'var(--dd-muted)' }}>
            Run ID: {result.runId} · {result.snapshotDate}
          </span>
        )}
      </div>

      {/* Activation results */}
      {activateError && (
        <div style={{ padding: '0.75rem', background: '#2d1515', border: '1px solid #e74c3c', borderRadius: '6px', margin: '0.75rem 0', fontSize: '0.78rem', color: '#e74c3c' }}>
          ✗ Activation failed: {activateError}
        </div>
      )}
      {activateResult && (
        <div style={{ margin: '0.75rem 0' }}>
          <div className={activateResult.docsModified > 0 ? styles.libReleaseBannerPass : styles.libReleaseBannerFail}
               style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>
              {activateResult.dryRun ? '🔍 SCAN' : '⚡ ACTIVATED'}
            </span>
            <span style={{ marginLeft: '1rem' }}>
              {activateResult.docsScanned} docs scanned
            </span>
          </div>

          {/* PR 1: Schema fill */}
          <div style={{ padding: '0.75rem', background: 'rgba(100,181,246,0.08)', border: '1px solid rgba(100,181,246,0.25)', borderRadius: '6px', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#64b5f6' }}>PR 1 — Schema Auto-Fill</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--dd-muted)' }}>
                {activateResult.phase1.docsModified} docs · {activateResult.phase1.fieldsAdded} fields
              </span>
              {activateResult.phase1.branch && !activateResult.dryRun && !activateResult.phase1.prUrl && (
                <span style={{ fontSize: '0.68rem', color: 'var(--dd-muted)' }}>Branch: {activateResult.phase1.branch}</span>
              )}
            </div>
            {!activateResult.dryRun && (
              <PrCard
                pod="librarian"
                prUrl={activateResult.phase1.prUrl}
                branchName={activateResult.phase1.branch}
                label="PR 1 — Schema Auto-Fill"
              />
            )}
            {activateResult.plan.length > 0 && (
              <div className={styles.scrollBox} style={{ maxHeight: '250px' }}>
                <table className={styles.docTable}>
                  <thead><tr><th>File</th><th>Fields</th><th>Changes</th></tr></thead>
                  <tbody>
                    {activateResult.plan.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: '0.72rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.file}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>+{p.fields}</td>
                        <td style={{ fontSize: '0.72rem' }}>{Object.keys(p.changes).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* PR 2: DITA body fixes */}
          <div style={{ padding: '0.75rem', background: 'rgba(230,126,34,0.08)', border: '1px solid rgba(230,126,34,0.25)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#e67e22' }}>PR 2 — DITA Body Fixes</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--dd-muted)' }}>
                {activateResult.phase2.docsModified} docs · {activateResult.phase2.totalFixes} fixes
              </span>
              {activateResult.phase2.branch && !activateResult.dryRun && !activateResult.phase2.prUrl && (
                <span style={{ fontSize: '0.68rem', color: 'var(--dd-muted)' }}>Branch: {activateResult.phase2.branch}</span>
              )}
            </div>
            {!activateResult.dryRun && (
              <PrCard
                pod="librarian"
                prUrl={activateResult.phase2.prUrl}
                branchName={activateResult.phase2.branch}
                label="PR 2 — DITA Body Fixes"
              />
            )}
            {Object.keys(activateResult.phase2.byTest || {}).length > 0 && (
              <div className={styles.chipRow} style={{ marginBottom: '0.5rem' }}>
                {Object.entries(activateResult.phase2.byTest).sort().map(([test, count]) => (
                  <span key={test} className={styles.chip}>
                    <span className={styles.chipValue}>{count}</span>
                    <span className={styles.chipLabel}>{test}</span>
                  </span>
                ))}
              </div>
            )}
            {activateResult.bodyPlan.length > 0 && (
              <div className={styles.scrollBox} style={{ maxHeight: '250px' }}>
                <table className={styles.docTable}>
                  <thead><tr><th>File</th><th>Fixes</th><th>Tests</th></tr></thead>
                  <tbody>
                    {[...activateResult.bodyPlan].sort((a, b) => b.fixCount - a.fixCount).map((bp, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: '0.72rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bp.file}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{bp.fixCount}</td>
                        <td style={{ fontSize: '0.72rem' }}>{[...new Set(bp.fixes.map(f => f.test))].sort().join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full results (after Run) */}
      {result && (
        <>
          {/* Remediations table */}
          {result.remediations.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
                Proposed Remediations ({result.remediations.length})
              </p>
              <div className={styles.scrollBox}>
                <table className={styles.docTable}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Severity</th>
                      <th>Issue</th>
                      <th>Action</th>
                      <th>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.remediations.map((r) => (
                      <tr key={r.alertId}>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.alertId}</td>
                        <td><SevBadge sev={r.severity} /></td>
                        <td style={{ fontSize: '0.75rem' }}>{r.issue}</td>
                        <td><ModeBadge mode={r.actionMode} /></td>
                        <td style={{ fontSize: '0.7rem', color: 'var(--dd-muted)' }}>{r.actionTarget}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </PodPanel>
  );
}

// ---------------------------------------------------------------------------
// DITA Migration Panel
// ---------------------------------------------------------------------------
function DitaMigrationPanel({ ditaMigration, semanticLoss }) {
  if (!ditaMigration) return null;
  const {
    filesWithComponents,
    filesWithLegacyTags,
    filesWithImport,
    componentUsage,
    taskFilesWithoutSemantic,
    migrationCoverage,
    docsWithLegacy,
  } = ditaMigration;

  const coveragePct = Math.round(migrationCoverage * 100);
  const coverageColor = coveragePct >= 80 ? '#2ecc71' : coveragePct >= 50 ? '#f39c12' : '#e74c3c';
  const totalComponentUses = Object.values(componentUsage).reduce((s, v) => s + v, 0);

  // Semantic loss data
  const loss = semanticLoss?.summary || {};
  const lossByTest = loss.byTest || {};
  const lossResults = semanticLoss?.results || [];
  // Sort all results by issue count once; UI shows top 10 by default, the
  // remainder lives inside a DetailsOnDemand drilldown (Phase 27).
  const sortedLossResults = [...lossResults].sort(
    (a, b) => b.findings.length - a.findings.length,
  );
  const allLossFiles = sortedLossResults;
  const worstFiles = [...lossResults]
    .sort((a, b) => b.findings.length - a.findings.length)
    .slice(0, 10);

  const lossTests = [
    { id: 'DL-01', label: 'Flattened Tables', color: '#e74c3c' },
    { id: 'DL-02', label: 'Missing Admonitions', color: '#e67e22' },
    { id: 'DL-03', label: 'Duplicate Content', color: '#f39c12' },
    { id: 'DL-04', label: 'Gutted Bodies', color: '#e74c3c' },
    { id: 'DL-05', label: 'Orphaned Entities', color: '#95a5a6' },
    { id: 'DL-06', label: 'Unclosed Fences', color: '#e67e22' },
    { id: 'DL-07', label: 'Empty Headings', color: '#f39c12' },
    { id: 'DL-08', label: 'Orphaned Tags', color: '#e67e22' },
    { id: 'DL-09', label: 'Title Echoes', color: '#95a5a6' },
    { id: 'DL-10', label: 'Broken Procedures', color: '#e74c3c' },
    { id: 'DL-11', label: 'Style-Rule Violations', color: '#3498db' },
  ];

  return (
    <div className={`${styles.panel} ${styles.panelFull}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🔄</span>
        <h3 className={styles.panelTitle}>DITA Migration</h3>
      </div>
      <p className={styles.panelSubtitle}>Progress migrating legacy DITA XML to MDX with semantic components.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>DITA semantic component adoption · conversion coverage · semantic loss</p>

      {/* KPI chips */}
      <div className={styles.chipRow}>
        <div className={styles.chip} title={tip('ditaMigration', 'migrationCoverage') || 'Percentage of docs using at least one DITA semantic MDX component (Prereq, TaskResult, UIControl, etc.). Higher = more thorough migration.'}>
          <span className={styles.chipValue} style={{ color: coverageColor }}>{coveragePct}%</span>
          <span className={styles.chipLabel}>Migration Coverage</span>
        </div>
        <div className={styles.chip} title={tip('ditaMigration', 'filesWithComponents') || 'Count of MDX files that contain at least one DITA semantic component.'}>
          <span className={styles.chipValue}>{filesWithComponents}</span>
          <span className={styles.chipLabel}>Files w/ Components</span>
        </div>
        <div className={styles.chip} title={tip('ditaMigration', 'filesWithImport') || 'Count of MDX files that import DITA semantic components (e.g. import { Prereq } from ...).'}>
          <span className={styles.chipValue}>{filesWithImport}</span>
          <span className={styles.chipLabel}>Files w/ Import</span>
        </div>
        <div className={styles.chip} title={tip('ditaMigration', 'totalUses') || 'Total occurrences of DITA semantic components across the entire corpus.'}>
          <span className={styles.chipValue} style={{ color: '#3498db' }}>{totalComponentUses}</span>
          <span className={styles.chipLabel}>Total Uses</span>
        </div>
        <div className={styles.chip} title={tip('ditaMigration', 'legacyTags') || 'Files still containing raw DITA XML tags (e.g. <prereq>, <uicontrol>) instead of MDX components. Target: 0.'}>
          <span className={styles.chipValue}
            style={{ color: filesWithLegacyTags > 0 ? '#e74c3c' : '#2ecc71' }}>
            {filesWithLegacyTags}
          </span>
          <span className={styles.chipLabel}>Legacy Tags</span>
        </div>
        <div className={styles.chip} title={tip('ditaMigration', 'tasksMissingSemantic') || 'Task-type docs (content_type=Task) without semantic component wrappers. These need <Prereq>, <TaskResult>, etc. added.'}>
          <span className={styles.chipValue}
            style={{ color: taskFilesWithoutSemantic > 0 ? '#f39c12' : '#2ecc71' }}>
            {taskFilesWithoutSemantic}
          </span>
          <span className={styles.chipLabel}>Tasks Missing Semantic</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        {/* Component usage breakdown */}
        <div style={{ flex: '1 1 200px' }}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
            Component usage by type
          </p>
          <table className={styles.docTable}>
            <thead>
              <tr><th>Component</th><th>Uses</th></tr>
            </thead>
            <tbody>
              {Object.entries(componentUsage)
                .sort(([, a], [, b]) => b - a)
                .map(([name, count]) => (
                  <tr key={name}>
                    <td><code style={{ fontSize: '0.75rem' }}>{'<'}{name}{'>'}</code></td>
                    <td style={{ fontWeight: 600, color: count > 0 ? '#2ecc71' : 'var(--dd-muted)' }}>{count}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Docs with legacy DITA tags */}
        <div style={{ flex: '2 1 260px' }}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
            {docsWithLegacy.length > 0 ? '⚠ Docs with legacy DITA XML tags (top 10)' : '✓ No legacy DITA XML tags detected'}
          </p>
          {docsWithLegacy.length > 0 && (
            <table className={styles.docTable}>
              <thead>
                <tr><th>Title</th><th>Legacy Tags</th></tr>
              </thead>
              <tbody>
                {docsWithLegacy.map((d) => (
                  <tr key={d.filePath}>
                    <td title={d.filePath}>{d.title}</td>
                    <td style={{ fontWeight: 700, color: '#e74c3c' }}>{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Semantic Loss from DITA Conversion ──────────────────────── */}
      {semanticLoss && (loss.totalFindings || 0) > 0 && (
        <div style={{ marginTop: '1.2rem' }}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
            ⚠ Semantic Loss Report — {loss.totalFindings} findings across {loss.filesWithIssues} files
          </p>

          <div className={styles.chipRow}>
            {lossTests.map(({ id, label, color }) => {
              const count = lossByTest[id] || 0;
              if (count === 0) return null;
              return (
                <div className={styles.chip} key={id}>
                  <span className={styles.chipValue} style={{ color }}>{count}</span>
                  <span className={styles.chipLabel}>
                    <JargonTerm code={id}>{label}</JargonTerm>
                  </span>
                </div>
              );
            })}
          </div>

          {worstFiles.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <p className={styles.panelSubtitle} style={{ margin: '0 0 0.4rem' }}>
                Worst affected files
              </p>
              <div
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: 'transparent',
                  border: '1px solid var(--dd-border)',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              >
                <table className={styles.docTable} style={{ width: '100%' }}>
                  <thead>
                    <tr><th>File</th><th>Issues</th><th>Types</th></tr>
                  </thead>
                  <tbody>
                    {worstFiles.map((r) => {
                      const testCounts = {};
                      for (const f of r.findings) {
                        testCounts[f.test] = (testCounts[f.test] || 0) + 1;
                      }
                      const badges = Object.entries(testCounts)
                        .sort(([, a], [, b]) => b - a)
                        .map(([t, c]) => {
                          const info = lossTests.find(lt => lt.id === t);
                          return `${info?.label || t}(${c})`;
                        })
                        .join(', ');
                      return (
                        <tr key={r.file}>
                          <td style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }} title={r.file}>
                            {r.file.replace('docs/', '')}
                          </td>
                          <td style={{ fontWeight: 700, color: r.findings.length >= 10 ? '#e74c3c' : '#f39c12', whiteSpace: 'nowrap' }}>
                            {r.findings.length}
                          </td>
                          <td style={{ fontSize: 'var(--fs-xs)', color: 'var(--dd-muted)', whiteSpace: 'nowrap' }}>{badges}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Details on demand: the table above caps at 10. The drilldown
                  exposes the remaining affected files behind a click. */}
              {allLossFiles.length > worstFiles.length && (
                <DetailsOnDemand
                  summary={`${allLossFiles.length - worstFiles.length} more affected files`}
                  count={allLossFiles.length - worstFiles.length}
                >
                  <table className={styles.docTable} style={{ tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: '85%' }} />
                      <col style={{ width: '15%' }} />
                    </colgroup>
                    <thead>
                      <tr><th>File</th><th>Issues</th></tr>
                    </thead>
                    <tbody>
                      {allLossFiles.slice(worstFiles.length).map((r) => (
                        <tr key={r.file}>
                          <td style={{ fontSize: 'var(--fs-xs)', wordBreak: 'break-all' }} title={r.file}>
                            {r.file.replace('docs/', '')}
                          </td>
                          <td style={{ fontWeight: 700, color: r.findings.length >= 5 ? '#f39c12' : 'var(--dd-muted)', whiteSpace: 'nowrap' }}>
                            {r.findings.length}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DetailsOnDemand>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engineering Tests Panel (ENG-01 through ENG-14)
// ---------------------------------------------------------------------------
function EngineeringTestsPanel({ engineering }) {
  if (!engineering) return null;
  const { tests, summary } = engineering;
  const entries = Object.entries(tests);

  const statusIcon = (s) =>
    s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '⚠' : '⊘';
  const statusCls = (s) =>
    s === 'pass' ? styles.statusOk
    : s === 'fail' ? styles.statusError
    : s === 'warn' ? styles.statusWarn
    : styles.statusMuted;

  // Pass-rate excludes skipped tests from the denominator. Phase 24 of the
  // case study found the prior inline formula produced NaN% when all tests
  // were skipped (denom=0); computePassRate handles that + clamps to [0,100].
  const passRate = computePassRate(summary);
  const scoreColor =
    passRate >= 90 ? '#2ecc71' :
    passRate >= 70 ? '#f39c12' : '#e74c3c';

  return (
    <div className={`${styles.panel} ${styles.panelFull}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🔬</span>
        <h3 className={styles.panelTitle}>Engineering Tests</h3>
      </div>
      <p className={styles.panelSubtitle}>Build-time hard gates. Any P0 failure blocks the build.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>
        14 engineering procedures · <JargonTerm code="P0">P0</JargonTerm> critical (ENG-01–07) · <JargonTerm code="P1">P1</JargonTerm> important (ENG-08–14)
      </p>

      <div className={styles.statRow}>
        <div className={styles.stat} title={tip('engineeringTests', 'passRate') || 'Percentage of the 14 ENG gates currently passing. Excludes skipped tests from the denominator.'}>
          <div className={styles.statValue} style={{ color: scoreColor }}>{passRate}%</div>
          <div className={styles.statLabel}>Pass Rate</div>
        </div>
        <div className={styles.stat} title={tip('engineeringTests', 'passed') || 'Count of ENG-01..14 gates currently passing.'}>
          <div className={styles.statValue} style={{ color: '#2ecc71' }}>{summary.passed}</div>
          <div className={styles.statLabel}>Passed</div>
        </div>
        <div className={styles.stat} title={tip('engineeringTests', 'failed') || 'Count of failing ENG gates. Any P0 failure (ENG-01..07) blocks the build.'}>
          <div className={styles.statValue} style={{ color: summary.failed > 0 ? '#e74c3c' : '#2ecc71' }}>{summary.failed}</div>
          <div className={styles.statLabel}>Failed</div>
        </div>
        <div className={styles.stat} title={tip('engineeringTests', 'warnings') || 'Count of ENG gates emitting warnings (test ran but flagged issues that don\'t block the build).'}>
          <div className={styles.statValue} style={{ color: summary.warned > 0 ? '#f39c12' : '#2ecc71' }}>{summary.warned}</div>
          <div className={styles.statLabel}>Warnings</div>
        </div>
        <div className={styles.stat} title={tip('engineeringTests', 'skipped') || 'ENG gates that were skipped (CI-only tests like Playwright + Lighthouse, or features that don\'t apply locally like i18n).'}>
          <div className={styles.statValue} style={{ color: 'var(--dd-muted)' }}>{summary.skipped}</div>
          <div className={styles.statLabel}>Skipped</div>
        </div>
      </div>

      <div className={styles.scrollBox}>
        <table className={styles.docTable}>
          <thead>
            <tr>
              <th style={{ width: '50px' }}>Status</th>
              <th>Test</th>
              <th>Detail</th>
              <th style={{ width: '70px' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, t]) => (
              <tr key={key}>
                <td>
                  <span className={`${styles.statusBadge} ${statusCls(t.status)}`}>
                    {statusIcon(t.status)}
                  </span>
                </td>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.label}</td>
                <td style={{ fontSize: '0.75rem', color: 'var(--dd-muted)' }}>{t.detail}</td>
                <td style={{ textAlign: 'center', fontWeight: 700,
                  color: t.status === 'fail' ? '#e74c3c' : t.status === 'warn' ? '#f39c12' : 'inherit'
                }}>
                  {t.count != null ? t.count : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 10A: Frontmatter Readiness
// ---------------------------------------------------------------------------
function FrontmatterReadinessPanel({ frontmatterHealth }) {
  if (!frontmatterHealth) return null;

  const {
    requiredFields = [],
    docsComplete = 0,
    docsIncomplete = 0,
    completionRate = 0,
    readinessThreshold = 95,
  } = frontmatterHealth;

  const completionPct = Math.round(completionRate * 100);
  const totalDocs = docsComplete + docsIncomplete;
  const delta = completionPct - readinessThreshold;
  const readinessLabel =
    delta >= 3 ? 'Ready' :
    delta >= -5 ? 'Near Ready' :
    delta >= -15 ? 'At Risk' : 'Critical';
  const readinessCls =
    delta >= 0 ? styles.readinessOnTrack :
    delta >= -15 ? styles.readinessBehind : styles.readinessCritical;
  const fillColor =
    delta >= 0 ? '#2ecc71' :
    delta >= -15 ? '#e67e22' : '#e74c3c';

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🧾</span>
        <h3 className={styles.panelTitle}>Frontmatter Readiness</h3>
      </div>
      <p className={styles.panelSubtitle}>Required-field completion for MDX release readiness.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Schema completeness gate for docs release</p>

      <div className={styles.chipRow}>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'docsComplete')}>
          <span className={styles.chipValue} style={{ color: '#2ecc71' }}>{docsComplete}</span>
          <span className={styles.chipLabel}>Complete Docs</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'docsIncomplete')}>
          <span className={styles.chipValue} style={{ color: docsIncomplete > 0 ? '#e74c3c' : '#2ecc71' }}>{docsIncomplete}</span>
          <span className={styles.chipLabel}>Incomplete Docs</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'completionRate')}>
          <span className={styles.chipValue}>{completionPct}%</span>
          <span className={styles.chipLabel}>Completion</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'requiredFields')}>
          <span className={styles.chipValue}>{requiredFields.length}</span>
          <span className={styles.chipLabel}>Required Fields</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'threshold')}>
          <span className={styles.chipValue}>{readinessThreshold}%</span>
          <span className={styles.chipLabel}>Gate</span>
        </div>
      </div>

      <div className={styles.readinessGauge}>
        <div className={styles.readinessMeta}>
          <span className={styles.readinessLabel}>Release Readiness</span>
          <span className={readinessCls}>{readinessLabel}</span>
        </div>
        <div className={styles.readinessTrack}>
          <div
            className={styles.readinessFill}
            style={{ width: `${completionPct}%`, background: fillColor }}
          />
          <div
            className={styles.readinessTimeMarker}
            style={{ left: `calc(${readinessThreshold}% - 1px)` }}
          />
        </div>
        <div className={styles.readinessMeta}>
          <span style={{ color: 'var(--dd-muted)', fontSize: '0.67rem' }}>
            {completionPct}% docs complete
          </span>
          <span style={{ color: 'var(--dd-muted)', fontSize: '0.67rem' }}>
            {totalDocs} total docs
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 10B: Review Cadence
// ---------------------------------------------------------------------------
function ReviewCadencePanel({ frontmatterHealth }) {
  const review = frontmatterHealth?.review || {};
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>📆</span>
        <h3 className={styles.panelTitle}>Review Cadence</h3>
      </div>
      <p className={styles.panelSubtitle}>How consistently docs are reviewed via the last_reviewed frontmatter field.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Review-window freshness for already-reviewed docs</p>

      <div className={styles.chipRow}>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'reviewedDocs')}>
          <span className={styles.chipValue}>{review.reviewedDocs ?? 0}</span>
          <span className={styles.chipLabel}>Reviewed</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'unreviewedDocs')}>
          <span className={styles.chipValue} style={{ color: (review.unreviewedDocs || 0) > 0 ? '#f39c12' : '#2ecc71' }}>{review.unreviewedDocs ?? 0}</span>
          <span className={styles.chipLabel}>Unreviewed</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'staleReviewedDocs')}>
          <span className={styles.chipValue} style={{ color: (review.staleReviewedDocs || 0) > 0 ? '#e74c3c' : '#2ecc71' }}>{review.staleReviewedDocs ?? 0}</span>
          <span className={styles.chipLabel}>Stale Reviewed</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'reviewCoverage')}>
          <span className={styles.chipValue}>{Math.round((review.reviewCoverage || 0) * 100)}%</span>
          <span className={styles.chipLabel}>Review Coverage</span>
        </div>
        <div className={styles.chip} title={tip('frontmatterReadiness', 'reviewWindowDays')}>
          <span className={styles.chipValue}>{review.reviewWindowDays ?? 180}</span>
          <span className={styles.chipLabel}>Window Days</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL 10C: Missing Required Fields table
// ---------------------------------------------------------------------------
function FrontmatterGapsPanel({ frontmatterHealth }) {
  const [filter, setFilter] = React.useState('');
  const rows = frontmatterHealth?.incompleteDocs || [];

  const filtered = filter.trim()
    ? rows.filter((row) => {
        const q = filter.toLowerCase();
        return (
          row.title?.toLowerCase().includes(q) ||
          row.filePath?.toLowerCase().includes(q) ||
          row.section?.toLowerCase().includes(q) ||
          row.missingFields?.some((f) => f.toLowerCase().includes(q))
        );
      })
    : rows;

  return (
    <div className={`${styles.panel} ${styles.panelWide}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🔗</span>
        <h3 className={styles.panelTitle}>Missing Required Fields</h3>
      </div>
      <p className={styles.panelSubtitle}>Exact docs still missing required frontmatter and the fields to fix.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Frontmatter gaps by document</p>

      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          type="text"
          placeholder="Filter by doc title, field, section, file path…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <span style={{ fontSize: '0.72rem', color: 'var(--dd-muted)' }}>
            {filtered.length} / {rows.length} rows
          </span>
        )}
      </div>

      <div className={styles.scrollBox} style={{ maxHeight: '280px' }}>
        <table className={styles.linkageTable}>
          <thead>
            <tr>
              <th>Document</th>
              <th>Missing Fields</th>
              <th>Section</th>
              <th>Completeness</th>
              <th>Last Modified</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>No matching rows</td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr key={row.filePath}>
                <td title={row.filePath}>{row.title}</td>
                <td>
                  <div className={styles.linkageFiles}>
                    {row.missingFields?.map((f) => <span key={`${row.filePath}-${f}`}>{f}</span>)}
                  </div>
                </td>
                <td>{row.section || '—'}</td>
                <td>{Math.round((row.completenessScore || 0) * 100)}%</td>
                <td>{row.lastModified ? new Date(row.lastModified).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PANEL: The Orchestrator — Command Center
// ---------------------------------------------------------------------------
function OrchestratorPanel({ report, alerts }) {
  const orchestratorEngine = useMemo(() => (input) => runOrchestrator(input, {}), []);
  const {
    result, running, run,
    serverOnline,
  } = usePodPanel('orchestrator', orchestratorEngine, report);

  // Orchestrator's server exposes /run (not /activate), so this stays local.
  const [serverResult, setServerResult] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [fullRunning, setFullRunning] = useState(false);

  const handleRun = () => run();
  const handleFullRun = async () => {
    setFullRunning(true);
    setServerError(null);
    try {
      const res = await fetch(`${POD_API.orchestrator}/api/orchestrator/run`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setServerResult(data);
    } catch (err) {
      setServerError(err.message);
    }
    setFullRunning(false);
  };

  const data = serverResult || result;

  const sevColor = (s) => s === 'P0' ? '#e74c3c' : s === 'P1' ? '#f39c12' : s === 'P2' ? '#3498db' : '#8892b0';

  return (
    <PodPanel
      name="orchestrator"
      icon="🎯"
      title="The Orchestrator"
      subtitle="Command Center v3.0 · Sense → Analyze → Act"
      alerts={alerts}
    >
      {/* Description */}
      <div style={{ padding: '0.75rem 1rem', margin: '0 0 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--dd-muted, #8892b0)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--dd-text, #ccd6f6)' }}>
          Command Center — sole owner of release readiness verdict and frontmatter completion gate. Aggregates Librarian, Strategist, and Gatekeeper into a unified Release Readiness Index.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#64b5f6' }}>🎯 Quick Run</span>
          <span>Browser-only Sense→Analyze→Act — computes release readiness, frontmatter completion, inter-agent conflict detection. Instant, read-only.</span>
          <span style={{ fontWeight: 700, color: '#e67e22' }}>🚀 Full Run</span>
          <span>Server-side: runs all three core agents (Librarian, Strategist, Gatekeeper), resolves conflicts (hierarchy: Gatekeeper {'>'} Librarian {'>'} Strategist), issues final verdict. Requires orchestrator server.</span>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', fontStyle: 'italic' }}>
          Full Run requires: <code style={{ background: '#2a2a3e', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>npm run orchestrator:server</code>
        </p>
      </div>

      {/* Buttons */}
      <div style={{ margin: '1rem 0', textAlign: 'center' }}>
        <button onClick={handleRun} disabled={running} className={styles.librarianRunBtn}>
          {running ? '⏳ Running…' : '🎯 Quick Run'}
        </button>
        <button
          onClick={handleFullRun}
          disabled={running || fullRunning || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ marginLeft: '0.75rem', background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #e67e22, #d35400)' }}
          title={serverOnline === false ? 'Start orchestrator server first' : 'Full Sense→Analyze→Act with all pods'}
        >
          {fullRunning ? '⏳ Running…' : '🚀 Full Run (All Agents)'}
        </button>
        <ActivateProgress active={fullRunning} label="Orchestrator Full Run" />
        {serverOnline === false && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#e74c3c' }}>
            ⚠ Orchestrator server offline — start everything in one command: <code>npm run dev:all</code> (or just this pod: <code>npm run orchestrator:server</code>)
          </div>
        )}
        {serverOnline === true && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#2ecc71' }}>✓ Orchestrator server online at port 3458</div>
        )}
      </div>

      {serverError && (
        <div style={{ padding: '0.75rem', background: '#2d1515', border: '1px solid #e74c3c', borderRadius: '6px', margin: '0.75rem 0', fontSize: '0.78rem', color: '#e74c3c' }}>
          ✗ {serverError}
        </div>
      )}

      {/* Results */}
      {data && (
        <div style={{ margin: '0.75rem 0' }}>
          {/* Build status banner */}
          <div style={{
            padding: '1rem 1.5rem', borderRadius: '8px', marginBottom: '1rem', textAlign: 'center',
            background: data.buildStatus === 'PASSING'
              ? 'linear-gradient(135deg, #1a4a2e, #2ecc71)'
              : data.buildStatus === 'BLOCKED'
                ? 'linear-gradient(135deg, #4a1a1a, #e74c3c)'
                : 'linear-gradient(135deg, #4a3a1a, #f39c12)',
            color: '#fff',
          }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '0.05em' }}>
              {data.buildStatus === 'PASSING' ? '✅' : data.buildStatus === 'BLOCKED' ? '🚫' : '⚠️'} BUILD {data.buildStatus}
            </div>
            <div style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
              Release Ready: <strong>{data.releaseReady ? 'YES' : 'NO'}</strong>
              <span style={{ margin: '0 1rem' }}>·</span>
              Run: <code style={{ fontSize: '0.7rem' }}>{data.runId?.slice(0, 8)}</code>
            </div>
          </div>

          {/* Key metrics */}
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: data.globalStability >= 95 ? '#2ecc71' : data.globalStability >= 80 ? '#f39c12' : '#e74c3c' }}>
                {data.globalStability}%
              </div>
              <div className={styles.statLabel}>Global Stability</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: data.completeness >= 80 ? '#2ecc71' : data.completeness >= 50 ? '#f39c12' : '#e74c3c' }}>
                {data.completeness}%
              </div>
              <div className={styles.statLabel}>Completeness</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#e74c3c' }}>{data.criticalAlerts?.length || 0}</div>
              <div className={styles.statLabel}>Critical Alerts</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#f39c12' }}>{data.warningAlerts?.length || 0}</div>
              <div className={styles.statLabel}>Warnings</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{data.conflicts?.length || 0}</div>
              <div className={styles.statLabel}>Conflicts</div>
            </div>
          </div>

          {/* Pod status */}
          <div style={{ margin: '0.75rem 0' }}>
            <h4 style={{ fontSize: '0.8rem', margin: '0 0 0.5rem', color: 'var(--dd-text)' }}>Agent Status</h4>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {Object.entries(data.podResults || {}).map(([pod, info]) => (
                <span key={pod} style={{
                  padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600,
                  background: info.status === 'COLLECTED' ? 'rgba(46,204,113,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${info.status === 'COLLECTED' ? '#2ecc71' : 'var(--dd-border, #30363d)'}`,
                  color: info.status === 'COLLECTED' ? '#2ecc71' : 'var(--dd-muted)',
                }}>
                  {pod.toUpperCase()}: {info.status}
                </span>
              ))}
            </div>
          </div>

          {/* Critical alerts */}
          {data.criticalAlerts?.length > 0 && (
            <div style={{ margin: '0.75rem 0' }}>
              <h4 style={{ fontSize: '0.8rem', margin: '0 0 0.5rem', color: '#e74c3c' }}>Critical Alerts</h4>
              <table className={styles.table}>
                <thead><tr><th>ID</th><th>Agent</th><th>Sev</th><th>Category</th><th>Description</th><th>Action</th></tr></thead>
                <tbody>
                  {data.criticalAlerts.map((a, i) => (
                    <tr key={i}>
                      <td><code style={{ fontSize: '0.68rem' }}>{a.alertId}</code></td>
                      <td style={{ fontSize: '0.72rem' }}>{a.pod}</td>
                      <td><JargonTerm code={a.severity}><span style={{ color: sevColor(a.severity), fontWeight: 700 }}>{a.severity}</span></JargonTerm></td>
                      <td style={{ fontSize: 'var(--fs-xs)' }}>{a.category}</td>
                      <td style={{ fontSize: 'var(--fs-xs)' }}>{a.description}</td>
                      <td><JargonTerm code={a.actionMode}><span style={{ fontSize: 'var(--fs-xs)', padding: '0.15rem 0.3rem', borderRadius: '3px',
                        background: a.actionMode === 'ESCALATE' ? 'rgba(231,76,60,0.2)' : a.actionMode === 'AUTO_REMEDIATE' ? 'rgba(46,204,113,0.2)' : 'rgba(52,152,219,0.2)',
                        color: a.actionMode === 'ESCALATE' ? '#e74c3c' : a.actionMode === 'AUTO_REMEDIATE' ? '#2ecc71' : '#3498db',
                      }}>{a.actionMode}</span></JargonTerm></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Warning alerts */}
          {data.warningAlerts?.length > 0 && (
            <div style={{ margin: '0.75rem 0' }}>
              <h4 style={{ fontSize: '0.8rem', margin: '0 0 0.5rem', color: '#f39c12' }}>Warnings</h4>
              <table className={styles.table}>
                <thead><tr><th>ID</th><th>Agent</th><th>Sev</th><th>Category</th><th>Description</th><th>Action</th></tr></thead>
                <tbody>
                  {data.warningAlerts.map((a, i) => (
                    <tr key={i}>
                      <td><code style={{ fontSize: '0.68rem' }}>{a.alertId}</code></td>
                      <td style={{ fontSize: '0.72rem' }}>{a.pod}</td>
                      <td><span style={{ color: sevColor(a.severity), fontWeight: 700 }}>{a.severity}</span></td>
                      <td style={{ fontSize: '0.72rem' }}>{a.category}</td>
                      <td style={{ fontSize: '0.72rem' }}>{a.description}</td>
                      <td><span style={{ fontSize: '0.68rem', padding: '0.15rem 0.3rem', borderRadius: '3px',
                        background: 'rgba(52,152,219,0.2)', color: '#3498db',
                      }}>{a.actionMode}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </PodPanel>
  );
}

// ---------------------------------------------------------------------------
// PANEL: The Editor — Style Compliance Pod
// ---------------------------------------------------------------------------
function EditorPanel({ report, alerts }) {
  const [scope, setScope] = useState('');
  const {
    result,
    activateResult, activating, activateError,
    activate, dryRun: dryRunFn,
    serverOnline,
  } = usePodPanel('editor', runEditor, report);

  const handleActivate = (isDryRun) => {
    const body = scope ? { scope } : undefined;
    return isDryRun ? dryRunFn(body) : activate(body);
  };

  const sevColor = (sev) => sev === 'high' ? '#e74c3c' : sev === 'medium' ? '#f39c12' : '#2ecc71';

  return (
    <PodPanel
      name="editor"
      icon="✏️"
      title="The Editor"
      subtitle="Agent v2.0 · Style Compliance · Readability · Terminology"
      alerts={alerts}
    >

      {/* Pod description */}
      <div style={{ padding: '0.75rem 1rem', margin: '0 0 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--dd-muted, #8892b0)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--dd-text, #ccd6f6)' }}>
          The Editor enforces style compliance, readability scoring (Flesch), and terminology drift detection across doc body content.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#e67e22' }}>🔍 Scan</span>
          <span>Full file-level scan: style rules, Flesch readability, terminology drift analysis. Generates a 4-section report (fixes, flags, readability, terminology). No files modified. Requires the companion server.</span>
          <span style={{ fontWeight: 700, color: '#e74c3c' }}>⚡ Activate (writes + PR)</span>
          <span>Same scan as above, then generates fix proposals for style violations — all changes require explicit human approval before commit. Creates a git branch + PR after approval. Never auto-commits body content.</span>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', fontStyle: 'italic' }}>
          Both buttons require the companion server: <code style={{ background: '#2a2a3e', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>npm run editor:server</code>
        </p>
      </div>

      {/* Action buttons */}
      <div style={{ margin: '1rem 0', textAlign: 'center' }}>
        <button
          onClick={() => handleActivate(true)}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #e67e22, #d35400)' }}
          title={serverOnline === false ? 'Start editor server first' : 'Full scan — no file writes'}
        >
          {activating ? '⏳ Scanning…' : '🔍 Scan'}
        </button>
        <button
          onClick={() => { if (window.confirm('Activate Editor will fix style violations in docs/ and create a git branch. Continue?')) handleActivate(false); }}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ marginLeft: '0.75rem', background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #c0392b, #e74c3c)' }}
          title={serverOnline === false ? 'Start editor server first' : 'Auto-fix + create PR'}
        >
          {activating ? '⏳ Activating…' : '⚡ Activate Editor (writes + PR)'}
        </button>
        <ActivateProgress active={activating} label="Activating Editor" />

        {serverOnline === false && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#e74c3c' }}>
            ⚠ Editor server offline — start everything in one command: <code>npm run dev:all</code> (or just this pod: <code>npm run editor:server</code>)
          </div>
        )}
        {serverOnline === true && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#2ecc71' }}>✓ Editor server online at port 3457</div>
        )}
        {serverOnline !== false && (
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
            <label style={{ color: 'var(--dd-muted)', fontWeight: 600 }}>Scope:</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--dd-border, #30363d)', background: 'var(--dd-surface, #161b22)', color: 'var(--dd-text, #c9d1d9)', fontSize: '0.78rem' }}>
              <option value="">All docs</option>
              <option value="fs10-prg">fs10-prg (FS10)</option>
              <option value="fs42-prg">fs42-prg (FS42)</option>
              <option value="fs80-prg">fs80-prg (FS80)</option>
              <option value="xs20-prg">xs20-prg (VS20)</option>
              <option value="js-guide">js-guide (JavaScript)</option>
              <option value="ziml-prg">ziml-prg (ZIML)</option>
              <option value="user-guide">user-guide</option>
              <option value="licensing">licensing</option>
              <option value="release-notes">release-notes</option>
            </select>
            <span style={{ fontSize: '0.68rem', color: 'var(--dd-muted)' }}>
              {scope ? `Target: docs/${scope}/` : 'Target: all docs/'}
            </span>
          </div>
        )}
      </div>

      {/* Error */}
      {activateError && (
        <div style={{ padding: '0.75rem', background: '#2d1515', border: '1px solid #e74c3c', borderRadius: '6px', margin: '0.75rem 0', fontSize: '0.78rem', color: '#e74c3c' }}>
          ✗ Editor failed: {activateError}
        </div>
      )}

      {/* Activation / Scan results */}
      {activateResult && (
        <div style={{ margin: '0.75rem 0' }}>
          <div className={activateResult.docsModified > 0 || activateResult.dryRun ? styles.libReleaseBannerPass : styles.libReleaseBannerFail}
               style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>
              {activateResult.dryRun ? '🔍 SCAN' : '⚡ ACTIVATED'}
            </span>
            <span style={{ marginLeft: '1rem' }}>
              {activateResult.totalViolations} violations · {activateResult.autoFixable} auto-fixable · {activateResult.humanReview} need review
            </span>
          </div>
          {!activateResult.dryRun && (
            <PrCard
              pod="editor"
              prUrl={activateResult.prUrl}
              branchName={activateResult.branch}
              label="Editor — Style Fixes"
            />
          )}

          {/* Severity breakdown */}
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#e74c3c' }}>{activateResult.bySeverity?.high || 0}</div>
              <div className={styles.statLabel}>High</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#f39c12' }}>{activateResult.bySeverity?.medium || 0}</div>
              <div className={styles.statLabel}>Medium</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#2ecc71' }}>{activateResult.bySeverity?.low || 0}</div>
              <div className={styles.statLabel}>Low</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{activateResult.filesScanned}</div>
              <div className={styles.statLabel}>Files Scanned</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{activateResult.readability?.avgFleschScore ?? 'N/A'}</div>
              <div className={styles.statLabel}>Avg Readability</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: (activateResult.readability?.docsBelowThreshold || 0) > 0 ? '#e74c3c' : '#2ecc71' }}>
                {activateResult.readability?.docsBelowThreshold || 0}
              </div>
              <div className={styles.statLabel}>Below Threshold</div>
            </div>
          </div>

          {/* Violations by category */}
          {activateResult.byCategory?.length > 0 && (
            <div style={{ margin: '0.75rem 0' }}>
              <h4 style={{ fontSize: '0.8rem', margin: '0 0 0.5rem', color: 'var(--dd-text)' }}>Violations by Category</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {activateResult.byCategory.map(({ category, count }) => (
                  <span key={category} style={{ padding: '0.2rem 0.5rem', background: 'var(--dd-surface, #161b22)', border: '1px solid var(--dd-border, #30363d)', borderRadius: '4px', fontSize: '0.72rem' }}>
                    {category}: <strong>{count}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Violations table */}
          {activateResult.violations?.length > 0 && (
            <div style={{ margin: '0.75rem 0', maxHeight: '400px', overflowY: 'auto' }}>
              <h4 style={{ fontSize: '0.8rem', margin: '0 0 0.5rem', color: 'var(--dd-text)' }}>Violations ({activateResult.violations.length})</h4>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Sev</th>
                    <th>File</th>
                    <th>Line</th>
                    <th>Found</th>
                    <th>Fix</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {activateResult.violations.slice(0, 100).map((v, i) => (
                    <tr key={i}>
                      <td><code style={{ fontSize: 'var(--fs-xs)' }}>{v.ruleId}</code></td>
                      <td><JargonTerm code={v.severity}><span style={{ color: sevColor(v.severity), fontWeight: 700, fontSize: 'var(--fs-xs)' }}>{v.severity}</span></JargonTerm></td>
                      <td style={{ fontSize: '0.68rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.file}</td>
                      <td>{v.line}</td>
                      <td><code style={{ fontSize: '0.68rem', color: '#e74c3c' }}>{v.original}</code></td>
                      <td>{v.proposed != null ? <code style={{ fontSize: '0.68rem', color: '#2ecc71' }}>{v.proposed || '(remove)'}</code> : <span style={{ color: 'var(--dd-muted)', fontSize: '0.68rem' }}>manual</span>}</td>
                      <td>{v.autoFixable ? <span style={{ color: '#2ecc71', fontSize: '0.7rem' }}>auto</span> : <span style={{ color: '#f39c12', fontSize: '0.7rem' }}>human</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Browser-only Run result */}
      {result && !activateResult && (
        <div style={{ margin: '0.75rem 0' }}>
          <div className={styles.libReleaseBannerPass} style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>✏️ QUICK SCAN</span>
            <span style={{ marginLeft: '1rem' }}>
              {result.violations.totalCount} violations · {result.filesScanned} files scanned
            </span>
          </div>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#e74c3c' }}>{result.violations.bySeverity.high}</div>
              <div className={styles.statLabel}>High</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#f39c12' }}>{result.violations.bySeverity.medium}</div>
              <div className={styles.statLabel}>Medium</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue} style={{ color: '#2ecc71' }}>{result.violations.bySeverity.low}</div>
              <div className={styles.statLabel}>Low</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statValue}>{result.readability.repoAvgFleschScore ?? 'N/A'}</div>
              <div className={styles.statLabel}>Avg Readability</div>
            </div>
          </div>
        </div>
      )}
    </PodPanel>
  );
}

// ---------------------------------------------------------------------------
// PANEL 11: UX Metrics (Microsoft Clarity)
// ---------------------------------------------------------------------------
function UXMetricsPanel({ clarity }) {
  if (!clarity) return null;
  const {
    isMock,
    sessions,
    avgSessionDurationSec,
    rageClickRate,
    deadClickRate,
    clickBackRate,
    jsErrorCount,
    scrollDepth,
    rageClickPages,
  } = clarity;

  const fmtPct  = (r) => `${(r * 100).toFixed(1)}%`;
  const fmtTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const depthBuckets = [
    { label: '0–25%',   value: scrollDepth?.d25  ?? 0, color: '#003fbd' },
    { label: '25–50%',  value: scrollDepth?.d50  ?? 0, color: '#3498db' },
    { label: '50–75%',  value: scrollDepth?.d75  ?? 0, color: '#1abc9c' },
    { label: '75–100%', value: scrollDepth?.d100 ?? 0, color: '#2ecc71' },
  ];

  return (
    <div className={`${styles.panel} ${styles.panelFull}`}>
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>🖱️</span>
        <h3 className={styles.panelTitle}>
          User Experience (UX) Metrics
          {isMock && <span className={styles.mockBadge}>mock data</span>}
        </h3>
      </div>
      <p className={styles.panelSubtitle}>How users actually behave: where they click, bounce, and hit errors.</p>
      <p className={styles.panelSubtitle} style={{ margin: '0.15rem 0 0', color: 'var(--dd-muted)' }}>Click behavior · rage/dead clicks · scroll depth · JS errors</p>

      {/* ── User Behavior ───────────────────────────────────────────── */}
      <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.1rem', color: '#3498db', fontWeight: 700 }}>
        User Behavior
      </h3>
      <p style={{ margin: '0 0 0.5rem', fontSize: 'var(--fs-xs)', color: 'var(--dd-muted)' }}>
        click-pattern analytics
      </p>
      <div className={styles.chipRow}>
        <div className={styles.chip} title={tip('userBehavior', 'sessions') || 'Total user sessions captured by Clarity in the rolling 30-day window.'}>
          <span className={styles.chipValue}>{sessions?.toLocaleString() ?? '–'}</span>
          <span className={styles.chipLabel}>Sessions</span>
        </div>
        <div className={styles.chip} title={tip('userBehavior', 'avgDuration') || 'Average time users spend per session. Longer ≠ always better — could mean engaged or could mean confused.'}>
          <span className={styles.chipValue}>{avgSessionDurationSec != null ? fmtTime(avgSessionDurationSec) : '–'}</span>
          <span className={styles.chipLabel}>Avg Duration</span>
        </div>
        <div className={styles.chip} title={tip('userBehavior', 'rageClicks') || 'Percentage of sessions with a rage-click event (rapid repeated clicks on the same element). Indicates broken or unresponsive UI.'}>
          <span
            className={styles.chipValue}
            style={{ color: rageClickRate > 0.05 ? '#e74c3c' : rageClickRate > 0.02 ? '#f39c12' : '#2ecc71' }}
          >
            {rageClickRate != null ? fmtPct(rageClickRate) : '–'}
          </span>
          <span className={styles.chipLabel}>Rage Clicks</span>
        </div>
        <div className={styles.chip} title={tip('userBehavior', 'deadClicks') || 'Percentage of sessions with dead-click events (clicks that produced no response). Often a sign of broken affordances or non-interactive elements that look clickable.'}>
          <span
            className={styles.chipValue}
            style={{ color: deadClickRate > 0.1 ? '#e74c3c' : deadClickRate > 0.05 ? '#f39c12' : '#2ecc71' }}
          >
            {deadClickRate != null ? fmtPct(deadClickRate) : '–'}
          </span>
          <span className={styles.chipLabel}>Dead Clicks</span>
        </div>
        <div className={styles.chip} title={tip('userBehavior', 'clickBack') || 'Percentage of sessions where the user clicked something and immediately hit Back. Strong signal that the destination wasn\'t what they expected.'}>
          <span className={styles.chipValue}
            style={{ color: clickBackRate > 0.15 ? '#e74c3c' : '#f39c12' }}
          >
            {clickBackRate != null ? fmtPct(clickBackRate) : '–'}
          </span>
          <span className={styles.chipLabel}>Click-Back</span>
        </div>
        <div className={styles.chip} title={tip('userBehavior', 'jsErrors') || 'Count of JavaScript errors thrown during sessions. Any non-zero value warrants investigation in the browser console.'}>
          <span className={styles.chipValue}
            style={{ color: jsErrorCount > 10 ? '#e74c3c' : jsErrorCount > 0 ? '#f39c12' : '#2ecc71' }}
          >
            {jsErrorCount ?? '–'}
          </span>
          <span className={styles.chipLabel}>JS Errors</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Scroll depth */}
        <div style={{ flex: '0 0 auto' }}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.6rem' }}>
            Scroll Depth (% sessions reaching depth)
            {scrollDepth?.averageDepthPercent != null && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--dd-muted, #8892b0)', fontSize: '0.72rem' }}>
                · avg: <strong style={{ color: 'var(--dd-text, #ccd6f6)' }}>{Math.round(scrollDepth.averageDepthPercent)}%</strong>
              </span>
            )}
            {scrollDepth?.isApproximate && (
              <span title="Clarity API only exposes average scroll depth; per-bucket bars are estimated from the average."
                    style={{ marginLeft: '0.4rem', fontSize: '0.65rem', fontStyle: 'italic', color: 'var(--dd-muted, #8892b0)' }}>
                (buckets approximated)
              </span>
            )}
          </p>
          <div className={styles.scrollDepthRow}>
            {depthBuckets.map(({ label, value, color }) => (
              <div key={label} className={styles.scrollDepthBar}>
                <span className={styles.scrollDepthPct}>{Math.round(value * 100)}%</span>
                <div
                  className={styles.scrollDepthFill}
                  style={{ height: `${Math.max(4, Math.round(value * 100))}%`, background: color }}
                />
                <span className={styles.scrollDepthLabel}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Rage click hot pages */}
        <div style={{ flex: '1 1 220px' }}>
          <p className={styles.panelSubtitle} style={{ margin: '0 0 0.5rem' }}>
            🔥 Rage Click Hot Pages (top 5)
          </p>
          <table className={styles.clarityTable}>
            <thead>
              <tr><th>Page URL</th><th>Count</th></tr>
            </thead>
            <tbody>
              {(rageClickPages || []).map((p) => (
                <tr key={p.url}>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.68rem' }}>{p.url}</td>
                  <td style={{ fontWeight: 700, color: '#e74c3c', whiteSpace: 'nowrap' }}>{p.count}</td>
                </tr>
              ))}
              {(!rageClickPages || rageClickPages.length === 0) && (
                <tr><td colSpan={2} className={styles.empty}>No rage click data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// StrategistPanel
// ---------------------------------------------------------------------------

function StrategistPanel({ report, alerts }) {
  const [scope, setScope] = useState('');

  // Strategist's engine takes (report, options); wrap to fit the hook's
  // single-input shape. Pull the search log from localStorage on each call.
  const strategistEngine = useMemo(() => (input) => {
    let searchLog = { queries: [], missedSearches: [] };
    try {
      const raw = localStorage.getItem('zmv-search-log');
      if (raw) searchLog = JSON.parse(raw);
    } catch { /* ignore */ }
    return runStrategist(input, { searchLog });
  }, []);

  const {
    result,
    activateResult, activating, activateError,
    activate, dryRun: dryRunFn,
    serverOnline,
  } = usePodPanel('strategist', strategistEngine, report, { pollIntervalMs: 10000 });

  const handleActivate = (isDryRun) => (isDryRun ? dryRunFn({}) : activate({}));

  const r = activateResult || result;

  return (
    <PodPanel
      name="strategist"
      icon="📊"
      title="The Strategist"
      subtitle="Agent v2.0 · Freshness · Search Gaps · SEO · A11y · Click Behavior"
      alerts={alerts}
    >
      {/* Pod description */}
      <div style={{ padding: '0.75rem 1rem', margin: '0 0 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--dd-muted, #8892b0)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--dd-text, #ccd6f6)' }}>
          The Strategist owns content intelligence — freshness decay, search gaps, thin-content risk, SEO health, accessibility/alt-text, click behavior analytics, and i18n.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#e67e22' }}>🔍 Scan</span>
          <span>Full server-side analysis with i18n coverage and click behavior metrics — freshness, thin content, search gaps, SEO health, accessibility. Preview only — no files written. Requires the companion server.</span>
          <span style={{ fontWeight: 700, color: '#e74c3c' }}>⚡ Activate (writes + PR)</span>
          <span>Same scan as above, then generates <code>strategy-report.json</code> with freshness, search gaps, SEO health, accessibility, click behavior, i18n, and prioritized recommendations.</span>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', fontStyle: 'italic' }}>
          Both buttons require the companion server: <code style={{ background: '#2a2a3e', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>npm run strategist:server</code>
        </p>
      </div>

      {/* Action buttons */}
      <div style={{ margin: '1rem 0', textAlign: 'center' }}>
        <button
          onClick={() => handleActivate(true)}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #e67e22, #d35400)' }}
          title={serverOnline === false ? 'Start strategist server first' : 'Full scan — no file writes'}
        >
          {activating ? '⏳ Scanning…' : '🔍 Scan'}
        </button>
        <button
          onClick={() => { if (window.confirm('Activate Strategist will generate strategy-report.json. Continue?')) handleActivate(false); }}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ marginLeft: '0.75rem', background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #c0392b, #e74c3c)' }}
          title={serverOnline === false ? 'Start strategist server first' : 'Generate strategy report'}
        >
          {activating ? '⏳ Activating…' : '⚡ Activate Strategist (writes + PR)'}
        </button>
        <ActivateProgress active={activating} label="Activating Strategist" />

        {serverOnline === false && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#e74c3c' }}>
            ⚠ Strategist server offline — start everything in one command: <code>npm run dev:all</code> (or just this pod: <code>npm run strategist:server</code>)
          </div>
        )}
        {serverOnline === true && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#2ecc71' }}>✓ Strategist server online at port 3459</div>
        )}
        {serverOnline !== false && (
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
            <label style={{ color: 'var(--dd-muted)', fontWeight: 600 }}>Scope:</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--dd-border, #30363d)', background: 'var(--dd-surface, #161b22)', color: 'var(--dd-text, #c9d1d9)', fontSize: '0.78rem' }}>
              <option value="">All docs</option>
              <option value="fs10-prg">fs10-prg (FS10)</option>
              <option value="fs42-prg">fs42-prg (FS42)</option>
              <option value="fs80-prg">fs80-prg (FS80)</option>
              <option value="xs20-prg">xs20-prg (VS20)</option>
              <option value="js-guide">js-guide (JavaScript)</option>
              <option value="ziml-prg">ziml-prg (ZIML)</option>
              <option value="user-guide">user-guide</option>
            </select>
          </div>
        )}
      </div>

      {activateError && <div style={{ color: '#e74c3c', marginBottom: '0.75rem', fontSize: '0.82rem' }}>⚠ Error: {activateError}</div>}

      {/* Activation banner */}
      {activateResult && !activateResult.error && (
        <div className={styles.libReleaseBannerPass} style={{ marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>
            {activateResult._dryRun ? '🔍 SCAN' : '⚡ ACTIVATED'}
          </span>
          <span style={{ marginLeft: '1rem' }}>
            {activateResult.recommendations?.length || 0} recommendations · {activateResult.taxonomyCoverage?.coveragePercent ?? '—'}% taxonomy coverage
            {activateResult._outputPath && !activateResult._dryRun && ` · Written to: strategy-report.json`}
          </span>
        </div>
      )}

      {r && !r.error && (
        <>
          {/* Freshness */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Content Freshness</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: '#52c41a' }}>{r.freshness?.fresh ?? '—'}</span><span className={styles.statLabel}>Fresh</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: '#1890ff' }}>{r.freshness?.recent ?? '—'}</span><span className={styles.statLabel}>Recent</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: '#faad14' }}>{r.freshness?.aging ?? '—'}</span><span className={styles.statLabel}>Aging</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: '#ff4d4f' }}>{r.freshness?.stale ?? '—'}</span><span className={styles.statLabel}>Stale</span></div>
          </div>

          {/* Thin Content */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Thin Content</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{r.thinContent?.count ?? '—'}</span><span className={styles.statLabel}>Docs &lt; {r.thinContent?.threshold || 150} words</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.readabilityTrend?.avgFleschScore ?? '—'}</span><span className={styles.statLabel}>Avg Flesch Score</span></div>
          </div>

          {/* Readability Buckets */}
          {r.readabilityTrend?.buckets && (
            <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
              <div className={styles.stat}><span className={styles.statValue} style={{ color: '#52c41a' }}>{r.readabilityTrend.buckets.easy}</span><span className={styles.statLabel}>Easy (60+)</span></div>
              <div className={styles.stat}><span className={styles.statValue} style={{ color: '#1890ff' }}>{r.readabilityTrend.buckets.standard}</span><span className={styles.statLabel}>Standard (50-59)</span></div>
              <div className={styles.stat}><span className={styles.statValue} style={{ color: '#faad14' }}>{r.readabilityTrend.buckets.difficult}</span><span className={styles.statLabel}>Difficult (40-49)</span></div>
              <div className={styles.stat}><span className={styles.statValue} style={{ color: '#ff4d4f' }}>{r.readabilityTrend.buckets.veryDifficult}</span><span className={styles.statLabel}>Very Hard (&lt;40)</span></div>
            </div>
          )}

          {/* Search Gaps */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Search Gaps (Local)</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{r.searchGaps?.totalQueries ?? 0}</span><span className={styles.statLabel}>Total Queries</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.searchGaps?.uniqueQueries ?? 0}</span><span className={styles.statLabel}>Unique Queries</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: (r.searchGaps?.missedSearches?.length || 0) > 0 ? '#ff4d4f' : '#52c41a' }}>{r.searchGaps?.missedSearches?.length ?? 0}</span><span className={styles.statLabel}>Missed Searches</span></div>
          </div>
          {r.searchGaps?.missedSearches?.length > 0 && (
            <table className={styles.docTable} style={{ marginTop: '0.5rem' }}>
              <thead><tr><th>Missed Query</th><th>Count</th></tr></thead>
              <tbody>
                {r.searchGaps.missedSearches.slice(0, 10).map((m, i) => (
                  <tr key={i}><td>{m.query}</td><td>{m.count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {r.searchGaps?.topQueries?.length > 0 && (
            <details style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
              <summary>Top Queries ({r.searchGaps.topQueries.length})</summary>
              <table className={styles.docTable}>
                <thead><tr><th>Query</th><th>Count</th></tr></thead>
                <tbody>
                  {r.searchGaps.topQueries.map((q, i) => (
                    <tr key={i}><td>{q.query}</td><td>{q.count}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {/* Taxonomy Coverage */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Taxonomy Coverage</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{r.taxonomyCoverage?.totalDocs ?? '—'}</span><span className={styles.statLabel}>Total Docs</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: (r.taxonomyCoverage?.untaggedDocs || 0) > 0 ? '#faad14' : '#52c41a' }}>{r.taxonomyCoverage?.untaggedDocs ?? '—'}</span><span className={styles.statLabel}>Untagged</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.taxonomyCoverage?.coveragePercent ?? '—'}%</span><span className={styles.statLabel}>Coverage</span></div>
          </div>
          {r.taxonomyCoverage?.sparseFields?.length > 0 && (
            <details style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
              <summary>Sparse Fields ({r.taxonomyCoverage.sparseFields.length})</summary>
              <table className={styles.docTable}>
                <thead><tr><th>Field</th><th>Empty Docs</th></tr></thead>
                <tbody>
                  {r.taxonomyCoverage.sparseFields.map((f, i) => (
                    <tr key={i}><td>{f.field}</td><td>{f.emptyCount}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {/* i18n */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>i18n Coverage</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
            {r.i18n?.configuredLocales?.map(locale => (
              <div key={locale} className={styles.stat}>
                <span className={styles.statValue}>{r.i18n.translationCoverage?.[locale] ?? 0}%</span>
                <span className={styles.statLabel}>{locale}{locale === r.i18n.defaultLocale ? ' (default)' : ''}</span>
              </div>
            ))}
          </div>

          {/* Recommendations */}
          {r.recommendations?.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Recommendations ({r.recommendations.length})</h3>
              <table className={styles.docTable}>
                <thead><tr><th>ID</th><th>Sev</th><th>Category</th><th>Description</th><th>Action</th></tr></thead>
                <tbody>
                  {r.recommendations.map((rec, i) => (
                    <tr key={i}>
                      <td>{rec.id}</td>
                      <td><JargonTerm code={rec.severity}><span style={{ color: rec.severity === 'P1' ? '#ff4d4f' : '#faad14' }}>{rec.severity}</span></JargonTerm></td>
                      <td>{rec.category}</td>
                      <td>{rec.description}</td>
                      <td>{rec.actionMode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Release Readiness */}
          <div style={{ marginTop: '1rem', padding: '0.5rem 0.75rem', borderRadius: '6px',
            background: r.releaseReady ? '#f6ffed' : '#fff2f0',
            border: `1px solid ${r.releaseReady ? '#b7eb8f' : '#ffa39e'}`,
            fontSize: '0.9rem', fontWeight: 600 }}>
            {r.releaseReady ? '✅ Release Ready' : '⛔ Not Release Ready'} — Strategist
          </div>
        </>
      )}

      {r?.error && <div style={{ color: '#ff4d4f', fontSize: '0.85rem' }}>Error: {r.error}</div>}
    </PodPanel>
  );
}

// ---------------------------------------------------------------------------
// GatekeeperPanel
// ---------------------------------------------------------------------------

function GatekeeperPanel({ report, alerts }) {
  const [scope, setScope] = useState('');
  const {
    result,
    activateResult, activating, activateError,
    activate, dryRun: dryRunFn,
    serverOnline,
  } = usePodPanel('gatekeeper', runGatekeeper, report, { pollIntervalMs: 10000 });

  const handleActivate = (isDryRun) => {
    const body = { scope: scope || undefined };
    return isDryRun ? dryRunFn(body) : activate(body);
  };

  const statusChip = (status) => {
    const colors = { PASS: '#2ecc71', FAIL: '#e74c3c', WARN: '#f39c12', SKIP: '#a78bfa' };
    return <span style={{ display: 'inline-block', padding: '0.15rem 0.45rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, color: '#fff', background: colors[status] || '#888' }}>{status}</span>;
  };

  const mockBadge = <span style={{ display: 'inline-block', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, color: '#fff', background: '#a78bfa', marginLeft: '0.5rem' }}>MOCK</span>;

  const r = activateResult || result;

  return (
    <PodPanel
      name="gatekeeper"
      icon="🛡️"
      title="The Gatekeeper"
      subtitle="Agent v3.0 · Engineering Gates · Platform Stability · Operational Health"
      alerts={alerts}
    >
      {/* Pod description */}
      <div style={{ padding: '0.75rem 1rem', margin: '0 0 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', fontSize: '0.78rem', lineHeight: 1.6, color: 'var(--dd-muted, #8892b0)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--dd-text, #ccd6f6)' }}>
          The Gatekeeper owns hard engineering gates (ENG-01–14), platform stability, Lighthouse CI, Playwright E2E, dependency scanning, PDF coverage, and operational health.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 0.75rem' }}>
          <span style={{ fontWeight: 700, color: '#e67e22' }}>🔍 Scan</span>
          <span>Full scan for duplicate slugs, duplicate titles, dependency vulnerabilities, Lighthouse scores, Playwright results, PDF coverage gaps. No files modified. Requires the companion server.</span>
          <span style={{ fontWeight: 700, color: '#e74c3c' }}>⚡ Activate (writes + PR)</span>
          <span>Same scan as above, then auto-fixes duplicate slugs and creates a git branch + PR. Flags all other gate failures for manual review.</span>
        </div>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', fontStyle: 'italic' }}>
          Both buttons require the companion server: <code style={{ background: '#2a2a3e', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>npm run gatekeeper:server</code>
        </p>
      </div>

      {/* Action buttons */}
      <div style={{ margin: '1rem 0', textAlign: 'center' }}>
        <button
          onClick={() => handleActivate(true)}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #e67e22, #d35400)' }}
          title={serverOnline === false ? 'Start gatekeeper server first' : 'Full scan — no file writes'}
        >
          {activating ? '⏳ Scanning…' : '🔍 Scan'}
        </button>
        <button
          onClick={() => { if (window.confirm('Activate Gatekeeper will fix a11y issues in docs/ and create a git branch. Continue?')) handleActivate(false); }}
          disabled={activating || serverOnline === false}
          className={styles.librarianRunBtn}
          style={{ marginLeft: '0.75rem', background: serverOnline === false ? '#555' : 'linear-gradient(135deg, #c0392b, #e74c3c)' }}
          title={serverOnline === false ? 'Start gatekeeper server first' : 'Auto-fix + create PR'}
        >
          {activating ? '⏳ Activating…' : '⚡ Activate Gatekeeper (writes + PR)'}
        </button>
        <ActivateProgress active={activating} label="Activating Gatekeeper" />

        {serverOnline === false && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#e74c3c' }}>
            ⚠ Gatekeeper server offline — start everything in one command: <code>npm run dev:all</code> (or just this pod: <code>npm run gatekeeper:server</code>)
          </div>
        )}
        {serverOnline === true && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: '#2ecc71' }}>✓ Gatekeeper server online at port 3460</div>
        )}
        {serverOnline !== false && (
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
            <label style={{ color: 'var(--dd-muted)', fontWeight: 600 }}>Scope:</label>
            <select value={scope} onChange={(e) => setScope(e.target.value)}
              style={{ padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--dd-border, #30363d)', background: 'var(--dd-surface, #161b22)', color: 'var(--dd-text, #c9d1d9)', fontSize: '0.78rem' }}>
              <option value="">All docs</option>
              <option value="fs10-prg">fs10-prg (FS10)</option>
              <option value="fs42-prg">fs42-prg (FS42)</option>
              <option value="fs80-prg">fs80-prg (FS80)</option>
              <option value="xs20-prg">xs20-prg (VS20)</option>
              <option value="js-guide">js-guide (JavaScript)</option>
              <option value="ziml-prg">ziml-prg (ZIML)</option>
              <option value="user-guide">user-guide</option>
            </select>
          </div>
        )}
      </div>

      {activateError && <div style={{ color: '#e74c3c', marginBottom: '0.75rem', fontSize: '0.82rem' }}>⚠ Error: {activateError}</div>}

      {/* Activation banner */}
      {activateResult && !activateResult.error && (
        <div className={activateResult.filesModified > 0 ? styles.libReleaseBannerPass : styles.libReleaseBannerFail}
             style={{ marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>
            {activateResult.dryRun ? '🔍 SCAN' : '⚡ ACTIVATED'}
          </span>
          <span style={{ marginLeft: '1rem' }}>
            {activateResult.filesScanned} scanned · {activateResult.findingsCount} findings · {activateResult.filesModified} fixed
          </span>
        </div>
      )}
      {activateResult && !activateResult.error && !activateResult.dryRun && (
        <PrCard
          pod="gatekeeper"
          prUrl={activateResult.prUrl}
          branchName={activateResult.branch}
          label="Gatekeeper — A11y Fixes"
        />
      )}

      {/* Activation findings table */}
      {activateResult?.findings?.length > 0 && (
        <details style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          <summary>Findings ({activateResult.findingsCount})</summary>
          <table className={styles.docTable}>
            <thead><tr><th>File</th><th>Issue</th><th>Severity</th><th>Detail</th><th>Fix</th></tr></thead>
            <tbody>
              {activateResult.findings.slice(0, 50).map((f, i) => (
                <tr key={i}>
                  <td style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>{f.file}</td>
                  <td>{f.issue}</td>
                  <td>{statusChip(f.severity === 'P1' ? 'WARN' : 'FAIL')}</td>
                  <td style={{ fontSize: '0.72rem' }}>{f.detail}</td>
                  <td style={{ fontSize: '0.72rem' }}>{f.fix || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {r && !r.error && r.engTests && (
        <>
          {/* Build Status Banner */}
          <div className={r.buildStatus === 'PASSING' ? styles.libReleaseBannerPass : styles.libReleaseBannerFail}
               style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>
              {r.buildStatus === 'PASSING' ? '✅' : r.buildStatus === 'BLOCKED' ? '🚫' : '⚠️'} {r.buildStatus}
            </span>
            <span style={{ marginLeft: '1rem' }}>Stability: {r.globalStability}%</span>
            <span style={{ marginLeft: '1rem' }}>{r.releaseReady ? '🟢 Release Ready' : '🔴 Not Release Ready'}</span>
          </div>

          {/* ENG Tests */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Engineering Tests</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {/* P0 */}
            <div>
              <h4 style={{ fontSize: '0.82rem', margin: '0 0 0.3rem', color: '#e74c3c' }}><JargonTerm code="P0">P0</JargonTerm> Critical (ENG-01–07)</h4>
              <table className={styles.docTable} style={{ fontSize: '0.75rem' }}>
                <thead><tr><th>Test</th><th>Status</th></tr></thead>
                <tbody>
                  {r.engTests.p0Results.map((t, i) => (
                    <tr key={i}><td>{t.name}</td><td>{statusChip(t.status)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* P1 */}
            <div>
              <h4 style={{ fontSize: '0.82rem', margin: '0 0 0.3rem', color: '#f39c12' }}><JargonTerm code="P1">P1</JargonTerm> Important (ENG-08–14)</h4>
              <table className={styles.docTable} style={{ fontSize: '0.75rem' }}>
                <thead><tr><th>Test</th><th>Status</th></tr></thead>
                <tbody>
                  {r.engTests.p1Results.map((t, i) => (
                    <tr key={i}><td>{t.name}</td><td>{statusChip(t.status)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Build Stability */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Build Stability</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{r.buildStability?.stabilityScore ?? '—'}%</span><span className={styles.statLabel}>Stability</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.buildStability?.duplicateSlugs?.count ? '#e74c3c' : '#2ecc71' }}>{r.buildStability?.duplicateSlugs?.count ?? 0}</span><span className={styles.statLabel}>Dup Slugs</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.buildStability?.brokenImages?.count ? '#e74c3c' : '#2ecc71' }}>{r.buildStability?.brokenImages?.count ?? 0}</span><span className={styles.statLabel}>Broken Imgs</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.buildStability?.missingRequiredMetadata?.count ? '#f39c12' : '#2ecc71' }}>{r.buildStability?.missingRequiredMetadata?.count ?? 0}</span><span className={styles.statLabel}>Missing Meta</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.buildStability?.duplicateTitles?.count ? '#f39c12' : '#2ecc71' }}>{r.buildStability?.duplicateTitles?.count ?? 0}</span><span className={styles.statLabel}>Dup Titles</span></div>
          </div>

          {/* Broken Links */}
          {r.brokenLinks?.count > 0 && (
            <>
              <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Broken Links ({r.brokenLinks.count})</h3>
              <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                <div className={styles.stat}><span className={styles.statValue} style={{ color: '#e74c3c' }}>{r.brokenLinks.count}</span><span className={styles.statLabel}>Broken Links</span></div>
                <div className={styles.stat}><span className={styles.statValue}>{r.brokenLinks.affectedDocs}</span><span className={styles.statLabel}>Affected Docs</span></div>
              </div>
            </>
          )}

          {/* Lighthouse CI */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Lighthouse CI{r.lighthouseCI?.isMock && mockBadge}</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: lighthouseTierColor(r.lighthouseCI?.performance ?? 0) }}>{r.lighthouseCI?.performance ?? '—'}</span><span className={styles.statLabel}>Performance</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: lighthouseTierColor(r.lighthouseCI?.accessibility ?? 0) }}>{r.lighthouseCI?.accessibility ?? '—'}</span><span className={styles.statLabel}>Accessibility</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: lighthouseTierColor(r.lighthouseCI?.bestPractices ?? 0) }}>{r.lighthouseCI?.bestPractices ?? '—'}</span><span className={styles.statLabel}>Best Practices</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: lighthouseTierColor(r.lighthouseCI?.seo ?? 0) }}>{r.lighthouseCI?.seo ?? '—'}</span><span className={styles.statLabel}>SEO</span></div>
          </div>

          {/* Playwright E2E */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Playwright E2E{r.playwrightE2E?.isMock && mockBadge}</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{statusChip(r.playwrightE2E?.chromium || 'SKIP')}</span><span className={styles.statLabel}>Chromium</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{statusChip(r.playwrightE2E?.firefox || 'SKIP')}</span><span className={styles.statLabel}>Firefox</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{statusChip(r.playwrightE2E?.webkit || 'SKIP')}</span><span className={styles.statLabel}>WebKit</span></div>
          </div>

          {/* Dependencies */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Dependencies{r.dependencies?.isMock && mockBadge}</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.dependencies?.criticalCVEs ? '#e74c3c' : '#2ecc71' }}>{r.dependencies?.criticalCVEs ?? 0}</span><span className={styles.statLabel}>Critical CVEs</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.dependencies?.outdatedPackages ?? 0}</span><span className={styles.statLabel}>Outdated</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.dependencies?.majorBehind ?? 0}</span><span className={styles.statLabel}>Major Behind</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.dependencies?.totalDeps ?? 0}</span><span className={styles.statLabel}>Total Deps</span></div>
          </div>

          {/* PDF Coverage */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>PDF Coverage{r.pdfCoverage?.isMock && mockBadge}</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{r.pdfCoverage?.successfulOutputs ?? 0}/{r.pdfCoverage?.expectedOutputs ?? 4}</span><span className={styles.statLabel}>Outputs</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.pdfCoverage?.renderSuccessRate === 100 ? '#2ecc71' : '#f39c12' }}>{r.pdfCoverage?.renderSuccessRate ?? 0}%</span><span className={styles.statLabel}>Render Rate</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.pdfCoverage?.validityRate ?? 0}%</span><span className={styles.statLabel}>Validity</span></div>
          </div>

          {/* Accessibility */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Accessibility (WCAG){r.accessibility?.isMock && mockBadge}</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue}>{r.accessibility?.wcagLevel ?? '—'}</span><span className={styles.statLabel}>WCAG Level</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.accessibility?.criticalErrors ? '#e74c3c' : '#2ecc71' }}>{r.accessibility?.criticalErrors ?? 0}</span><span className={styles.statLabel}>Critical Errors</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.accessibility?.warnings ?? 0}</span><span className={styles.statLabel}>Warnings</span></div>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.accessibility?.imagesWithoutAlt?.count ? '#f39c12' : '#2ecc71' }}>{r.accessibility?.imagesWithoutAlt?.count ?? 0}</span><span className={styles.statLabel}>Missing Alt</span></div>
          </div>

          {/* Operational Health */}
          <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Operational Health</h3>
          <div className={styles.panelGrid} style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
            <div className={styles.stat}><span className={styles.statValue} style={{ color: r.operationalHealth?.snapshotFresh ? '#2ecc71' : '#f39c12' }}>{r.operationalHealth?.snapshotAgeHours ?? '—'}h</span><span className={styles.statLabel}>Snapshot Age</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.operationalHealth?.ingestionSuccessRate ?? 0}%</span><span className={styles.statLabel}>Ingestion Rate</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{r.operationalHealth?.drift ?? 0}</span><span className={styles.statLabel}>Doc Drift</span></div>
            <div className={styles.stat}><span className={styles.statValue}>{statusChip(r.operationalHealth?.dashboardSyncStatus === 'SUCCESS' ? 'PASS' : 'FAIL')}</span><span className={styles.statLabel}>Dashboard Sync</span></div>
          </div>

          {/* Remediations */}
          {r.remediations?.length > 0 && (
            <>
              <h3 style={{ fontSize: '0.95rem', margin: '0.75rem 0 0.5rem' }}>Remediations ({r.remediations.length})</h3>
              <table className={styles.docTable}>
                <thead><tr><th>ID</th><th>Sev</th><th>Issue</th><th>Action</th><th>Status</th></tr></thead>
                <tbody>
                  {r.remediations.map((rem, i) => (
                    <tr key={i}>
                      <td>{rem.alertId}</td>
                      <td><JargonTerm code={rem.severity}><span style={{ color: rem.severity === 'P0' ? '#e74c3c' : rem.severity === 'P1' ? '#f39c12' : '#2ecc71' }}>{rem.severity}</span></JargonTerm></td>
                      <td>{rem.issue}</td>
                      <td>{rem.actionMode}</td>
                      <td>{rem.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Release Readiness */}
          <div style={{ marginTop: '1rem', padding: '0.5rem 0.75rem', borderRadius: '6px',
            background: r.releaseReady ? '#f6ffed' : '#fff2f0',
            border: `1px solid ${r.releaseReady ? '#b7eb8f' : '#ffa39e'}`,
            fontSize: '0.9rem', fontWeight: 600 }}>
            {r.releaseReady ? '✅ Release Ready' : '⛔ Not Release Ready'} — Gatekeeper
          </div>
        </>
      )}

      {r?.error && <div style={{ color: '#e74c3c', fontSize: '0.85rem' }}>Error: {r.error}</div>}
    </PodPanel>
  );
}

// ---------------------------------------------------------------------------
// Main DevDashboard export
// ---------------------------------------------------------------------------
export default function DevDashboard() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [semanticLoss, setSemanticLoss] = useState(null);
  const [terminologyDrift, setTerminologyDrift] = useState(null);
  const reportUrl = useBaseUrl('/build-report.json');
  const notifUrl = useBaseUrl('/data/notifications.json');
  const ditaLossUrl = useBaseUrl('/data/dita-loss-report.json');
  const driftUrl = useBaseUrl('/data/terminology-drift.json');

  useEffect(() => {
    fetch(reportUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setReport(data))
      .catch((e) => setError(e.message));
    fetch(notifUrl)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setNotifications(data))
      .catch(() => {});
    fetch(ditaLossUrl)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setSemanticLoss(data))
      .catch(() => {});
    fetch(driftUrl)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setTerminologyDrift(data))
      .catch(() => {});
  }, [reportUrl, notifUrl, ditaLossUrl, driftUrl]);

  if (error) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.devNotice}>
          ⚠ Could not load <code>build-report.json</code>: {error}.{' '}
          Run <code>npm run build-report</code> first, then restart the dev server.
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className={styles.dashboard}>
        <div className={styles.loadingShimmer}>
          <div className={styles.shimmerCard} />
          <div className={styles.shimmerCard} />
          <div className={styles.shimmerCard} />
        </div>
      </div>
    );
  }

  return <DashboardContent report={report} notifications={notifications} semanticLoss={semanticLoss} terminologyDrift={terminologyDrift} />;
}

// ---------------------------------------------------------------------------
// DashboardContent — persona-aware panel layout
// ---------------------------------------------------------------------------
function DashboardContent({ report, notifications, semanticLoss, terminologyDrift }) {
  // Make drift accessible via report.terminologyDrift for the collapsed-panel
  // summary function (PANEL_SUMMARIES reads it from there).
  const reportWithDrift = useMemo(
    () => ({ ...report, terminologyDrift }),
    [report, terminologyDrift],
  );
  const { personaId, persona, setPersona } = usePersona();

  // Each panel registered with stable id, JSX renderer, and (optional) wrapping
  // hint so we can partition them into primary/secondary/collapsed groups.
  const dataPanels = [
    { id: PANEL_IDS.SCHEMA_ANALYTICS, render: () => <SchemaAnalyticsPanel report={report} /> },
    { id: PANEL_IDS.SCHEMA_INTEL,     render: () => <SchemaIntelligencePanel report={report} /> },
    { id: PANEL_IDS.DATE_FRESHNESS,   render: () => <DateFreshnessPanel report={report} /> },
    { id: PANEL_IDS.SEO_HEALTH,       render: () => <SeoHealthPanel report={report} /> },
    { id: PANEL_IDS.ANALYTICS,        render: () => <AnalyticsPanel report={report} /> },
    { id: PANEL_IDS.CONTENT_PERF,     render: () => <ContentPerformancePanel report={report} /> },
    { id: PANEL_IDS.SEARCH,           render: () => <SearchPanel report={report} /> },
    { id: PANEL_IDS.CONTENT_QUALITY,  render: () => <ContentQualityPanel report={report} /> },
    { id: PANEL_IDS.DITA_MIGRATION,   render: () => <DitaMigrationPanel ditaMigration={report.ditaMigration} semanticLoss={semanticLoss} /> },
    { id: PANEL_IDS.TERMINOLOGY_DRIFT, render: () => <TerminologyDriftPanel drift={terminologyDrift} /> },
    { id: PANEL_IDS.ENG_TESTS,        render: () => <EngineeringTestsPanel engineering={report.engineering} /> },
    { id: PANEL_IDS.FRONTMATTER_READINESS, render: () => <FrontmatterReadinessPanel frontmatterHealth={report.frontmatterHealth} /> },
    { id: PANEL_IDS.REVIEW_CADENCE,        render: () => <ReviewCadencePanel frontmatterHealth={report.frontmatterHealth} /> },
    { id: PANEL_IDS.FRONTMATTER_GAPS,      render: () => <FrontmatterGapsPanel frontmatterHealth={report.frontmatterHealth} /> },
    { id: PANEL_IDS.UX_METRICS,       render: () => <UXMetricsPanel clarity={report.clarity} /> },
  ];

  // Agentic pods — rendered in their own section below the data panels so
  // they read as a distinct category (the 5 multi-agent pod engines).
  const podPanels = [
    { id: PANEL_IDS.ORCHESTRATOR,     render: () => <OrchestratorPanel report={report} alerts={notifications?.agents?.orchestrator} /> },
    { id: PANEL_IDS.POD_GATEKEEPER,   render: () => <GatekeeperPanel report={report} alerts={notifications?.agents?.gatekeeper} /> },
    { id: PANEL_IDS.POD_LIBRARIAN,    render: () => <LibrarianPanel report={report} alerts={notifications?.agents?.librarian} semanticLoss={semanticLoss} /> },
    { id: PANEL_IDS.POD_EDITOR,       render: () => <EditorPanel report={report} alerts={notifications?.agents?.editor} /> },
    { id: PANEL_IDS.POD_STRATEGIST,   render: () => <StrategistPanel report={report} alerts={notifications?.agents?.strategist} /> },
  ];

  const relevanceOf = (id) => persona.panels[id] || RELEVANCE.SECONDARY;
  const primary   = dataPanels.filter((p) => relevanceOf(p.id) === RELEVANCE.PRIMARY);
  const secondary = dataPanels.filter((p) => relevanceOf(p.id) === RELEVANCE.SECONDARY);
  const collapsed = dataPanels.filter((p) => relevanceOf(p.id) === RELEVANCE.COLLAPSED);

  // Pods always render in the dedicated pod section regardless of persona
  // relevance — the section heading already signals their distinct category.
  // Persona relevance still controls ordering within the section.
  const podsPrimary   = podPanels.filter((p) => relevanceOf(p.id) === RELEVANCE.PRIMARY);
  const podsSecondary = podPanels.filter((p) => relevanceOf(p.id) === RELEVANCE.SECONDARY);
  const podsCollapsed = podPanels.filter((p) => relevanceOf(p.id) === RELEVANCE.COLLAPSED);
  const orderedPods   = [...podsPrimary, ...podsSecondary, ...podsCollapsed];

  return (
    <div className={styles.dashboard}>
      <PersonaSwitcher personaId={personaId} persona={persona} setPersona={setPersona} />

      <div className={styles.devNotice}>
        🛠 Developer Dashboard —{' '}
        <strong>dev only</strong>. This page is not visible in production.
        Data sourced from <code>static/build-report.json</code>.
      </div>

      <BuildOverviewPanel report={report} />

      <TopActions report={report} persona={persona} />

      <div className={styles.panelGrid}>
        {primary.length > 0 && (
          <>
            {personaId !== 'all' && (
              <div className={styles.sectionDivider}>
                <span className={styles.sectionLabel}>Primary for {persona.label}</span>
                <span className={styles.sectionLine} />
              </div>
            )}
            {primary.map((p) => <React.Fragment key={p.id}>{p.render()}</React.Fragment>)}
          </>
        )}

        {secondary.length > 0 && (
          <>
            {personaId !== 'all' && primary.length > 0 && (
              <div className={styles.sectionDivider}>
                <span className={styles.sectionLabel}>Also relevant</span>
                <span className={styles.sectionLine} />
              </div>
            )}
            {secondary.map((p) => <React.Fragment key={p.id}>{p.render()}</React.Fragment>)}
          </>
        )}

        {collapsed.length > 0 && (
          <>
            <div className={styles.sectionDivider}>
              <span className={styles.sectionLabel}>Other panels (collapsed)</span>
              <span className={styles.sectionLine} />
            </div>
            <div className={styles.panelWide} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {collapsed.map((p) => (
                <CollapsedPanel key={p.id} panelId={p.id} report={reportWithDrift}>
                  {p.render()}
                </CollapsedPanel>
              ))}
            </div>
          </>
        )}

        {orderedPods.length > 0 && (
          <>
            <div className={styles.podSectionDivider}>
              <span className={styles.podSectionLabel}>
                🤖 Agents
                <span className={styles.podSectionSubtitle}>
                  5 specialized agents · Scan (read-only) or Activate (writes + PR)
                </span>
              </span>
              <span className={styles.podSectionLine} />
            </div>
            {orderedPods.map((p) => <React.Fragment key={p.id}>{p.render()}</React.Fragment>)}
          </>
        )}
      </div>
    </div>
  );
}

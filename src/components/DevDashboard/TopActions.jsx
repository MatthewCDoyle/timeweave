/**
 * src/components/DevDashboard/TopActions.jsx
 * ============================================================================
 * Synthesis widget — surfaces the highest-priority actionable findings across
 * the multi-agent system, ordered by:
 *   1. Severity (P0 > P1 > P2)
 *   2. Pod priority within tier (Gatekeeper > Librarian > Strategist > Editor)
 *   3. Action mode (ESCALATE > AUTO_REMEDIATE > PROPOSE > CLICK_TO_FIX > FLAG)
 *
 * Each row carries:
 *   - Severity badge
 *   - Action-mode chip (visible vocabulary the user already knows)
 *   - Description (whatever the pod emitted)
 *   - Pod attribution + one-click jump-to-panel button
 *
 * Persona filtering: when a non-default persona is active, only findings from
 * that persona's `actionPods` list are surfaced. Limit comes from persona.
 *
 * The data source is the pod sections of build-report.json (their own
 * `remediations`/`recommendations` arrays). No new data shape needed.
 */

import React from 'react';
import { resolveJargon } from './jargonGlossary';

const POD_PRIORITY = { gatekeeper: 0, librarian: 1, strategist: 2, editor: 3, orchestrator: -1 };
const SEV_PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3 };
const MODE_PRIORITY = { ESCALATE: 0, AUTO_REMEDIATE: 1, PROPOSE: 2, CLICK_TO_FIX: 3, FLAG: 4 };

const SEV_COLORS = {
  P0: { bg: 'rgba(231,76,60,0.15)',  fg: '#e74c3c', border: 'rgba(231,76,60,0.4)' },
  P1: { bg: 'rgba(243,156,18,0.15)', fg: '#f39c12', border: 'rgba(243,156,18,0.4)' },
  P2: { bg: 'rgba(52,152,219,0.15)', fg: '#3498db', border: 'rgba(52,152,219,0.4)' },
  P3: { bg: 'rgba(127,140,141,0.15)',fg: '#7f8c8d', border: 'rgba(127,140,141,0.4)' },
};

const MODE_LABELS = {
  ESCALATE:        { icon: '🚨', label: 'Escalate' },
  AUTO_REMEDIATE:  { icon: '⚡', label: 'Auto-fix' },
  PROPOSE:         { icon: '👤', label: 'Human review' },
  CLICK_TO_FIX:    { icon: '🛠', label: 'Click to fix' },
  FLAG:            { icon: '🚩', label: 'Flag' },
};

const POD_LABELS = {
  gatekeeper:   { icon: '🛡', name: 'Gatekeeper',  panelId: 'gatekeeper' },
  librarian:    { icon: '📚', name: 'Librarian',   panelId: 'librarian' },
  strategist:   { icon: '📊', name: 'Strategist',  panelId: 'strategist' },
  editor:       { icon: '✏️', name: 'Editor',      panelId: 'editor' },
  orchestrator: { icon: '🎯', name: 'Orchestrator', panelId: 'orchestrator' },
};

// ---------------------------------------------------------------------------
// Gather findings from each pod section of the build report
// ---------------------------------------------------------------------------
function collectFindings(report) {
  const findings = [];

  // Gatekeeper (engineering tests P0/P1)
  const tests = report.engineering?.tests || {};
  for (const id of ['eng01','eng02','eng03','eng04','eng05','eng06','eng07']) {
    const t = tests[id];
    if (t?.status === 'fail') {
      findings.push({
        pod: 'gatekeeper',
        severity: 'P0',
        actionMode: 'ESCALATE',
        description: `${t.label || id.toUpperCase()} FAILED — build BLOCKED${t.detail ? ': ' + t.detail : ''}`,
        count: t.count,
      });
    }
  }
  for (const id of ['eng08','eng09','eng10','eng11','eng12','eng13','eng14']) {
    const t = tests[id];
    if (t?.status === 'fail') {
      findings.push({
        pod: 'gatekeeper',
        severity: 'P1',
        actionMode: 'ESCALATE',
        description: `${t.label || id.toUpperCase()} FAILED${t.detail ? ': ' + t.detail : ''}`,
        count: t.count,
      });
    }
  }

  // Librarian — broken images, missing fields, DITA debt
  const agg = report.aggregate || {};
  const eng04 = tests.eng04 || {};
  if (eng04.count > 0) {
    findings.push({
      pod: 'librarian',
      severity: 'P1',
      actionMode: 'AUTO_REMEDIATE',
      description: `${eng04.count} broken image references — Librarian can fix in one PR`,
      count: eng04.count,
    });
  }
  const eng09 = tests.eng09 || {};
  if (eng09.count > 0) {
    findings.push({
      pod: 'librarian',
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      description: `${eng09.count} broken internal links — review and fix in dashboard`,
      count: eng09.count,
    });
  }
  const seo = agg.seoHealth || {};
  const totalDocs = report.docs?.length || agg.totalDocs || 0;
  const missingDescriptions = totalDocs - (seo.hasDescription || 0);
  if (missingDescriptions > 0) {
    findings.push({
      pod: 'librarian',
      severity: 'P2',
      actionMode: 'AUTO_REMEDIATE',
      description: `${missingDescriptions} docs missing description — auto-fill staged for review`,
      count: missingDescriptions,
    });
  }
  const docsWithPlaceholders = agg.placeholders?.docsWithPlaceholders || 0;
  if (docsWithPlaceholders > 0) {
    findings.push({
      pod: 'librarian',
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      description: `${docsWithPlaceholders} docs contain placeholder text`,
      count: docsWithPlaceholders,
    });
  }

  // DITA semantic loss — owned by Librarian
  const losses = report.semanticLoss?.summary?.byTest || {};
  const flattenedTables = losses['DL-01'] || 0;
  if (flattenedTables > 0) {
    findings.push({
      pod: 'librarian',
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      description: `${flattenedTables} flattened tables (DITA tables lost structure)`,
      count: flattenedTables,
    });
  }
  const guttedBodies = losses['DL-04'] || 0;
  if (guttedBodies > 0) {
    findings.push({
      pod: 'librarian',
      severity: 'P1',
      actionMode: 'CLICK_TO_FIX',
      description: `${guttedBodies} docs have empty/gutted body content`,
      count: guttedBodies,
    });
  }

  // Strategist — freshness, thin content, accessibility, search, click behavior
  const da = agg.dateAnalytics || {};
  const totalDated = (da.fresh || 0) + (da.recent || 0) + (da.aging || 0) + (da.stale || 0);
  const stalePercent = totalDated > 0 ? ((da.stale || 0) / totalDated) * 100 : 0;
  if (stalePercent > 5 && (da.stale || 0) > 0) {
    findings.push({
      pod: 'strategist',
      severity: 'P1',
      actionMode: 'ESCALATE',
      description: `${da.stale} stale docs (${Math.round(stalePercent)}% > 180 days) — schedule review cycle`,
      count: da.stale,
    });
  }

  // Per-page rage clicks (real Clarity field)
  const rageClickPages = report.clarity?.rageClickPages || [];
  for (const page of rageClickPages.slice(0, 3)) {
    if ((page.count || 0) >= 5) {
      findings.push({
        pod: 'strategist',
        severity: 'P2',
        actionMode: 'CLICK_TO_FIX',
        description: `${page.count} rage clicks on ${page.url} — page-level usability issue`,
        count: page.count,
      });
    }
  }

  // Site-wide click signals
  const rageClickRate = report.clarity?.rageClickRate;
  if (typeof rageClickRate === 'number' && rageClickRate > 0.05) {
    findings.push({
      pod: 'strategist',
      severity: 'P1',
      actionMode: 'ESCALATE',
      description: `Site-wide rage-click rate at ${Math.round(rageClickRate * 100)}% — investigate non-clickable elements`,
    });
  }

  // Editor — high-severity style violations (count only — no per-doc detail in build-report)
  // We don't surface here unless we know there are failures from the engine output.

  // Orchestrator — global verdict + frontmatter completion
  const frontmatterCompletion = Math.round(((report.frontmatterHealth?.completionRate ?? 1) * 100));
  if (frontmatterCompletion < 95) {
    findings.push({
      pod: 'orchestrator',
      severity: 'P1',
      actionMode: 'ESCALATE',
      description: `Required frontmatter completion at ${frontmatterCompletion}% (gate: 95%) — release readiness AT RISK`,
    });
  }

  return findings;
}

function rankFindings(findings) {
  return [...findings].sort((a, b) => {
    const sev = (SEV_PRIORITY[a.severity] ?? 99) - (SEV_PRIORITY[b.severity] ?? 99);
    if (sev !== 0) return sev;
    const pod = (POD_PRIORITY[a.pod] ?? 99) - (POD_PRIORITY[b.pod] ?? 99);
    if (pod !== 0) return pod;
    return (MODE_PRIORITY[a.actionMode] ?? 99) - (MODE_PRIORITY[b.actionMode] ?? 99);
  });
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function SeverityChip({ sev }) {
  const c = SEV_COLORS[sev] || SEV_COLORS.P3;
  // title= provides the Shneiderman-Mantra details-on-demand tooltip so
  // non-expert personas (Program Manager) can hover for the severity tier
  // definition without leaving the dashboard.
  return (
    <span
      title={resolveJargon(sev) || undefined}
      style={{
        background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
        borderRadius: '4px', padding: '0.15rem 0.5rem',
        fontSize: 'var(--fs-xs, 0.78rem)', fontWeight: 800, letterSpacing: '0.04em',
        cursor: 'help',
      }}
    >{sev}</span>
  );
}

function ModeChip({ mode }) {
  const m = MODE_LABELS[mode] || { icon: '•', label: mode };
  return (
    <span
      title={resolveJargon(mode) || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
        fontSize: 'var(--fs-xs, 0.78rem)', color: 'var(--dd-muted, #8892b0)',
        cursor: 'help',
      }}
    >
      {m.icon} {m.label}
    </span>
  );
}

function ActionRow({ finding }) {
  const pod = POD_LABELS[finding.pod] || { icon: '•', name: finding.pod, panelId: finding.pod };
  const handleJump = () => {
    const el = document.getElementById(pod.panelId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0.75rem',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '0.82rem',
    }}>
      <SeverityChip sev={finding.severity} />
      <ModeChip mode={finding.actionMode} />
      <span style={{ flex: '1 1 auto', color: 'var(--dd-text, #ccd6f6)' }}>
        {finding.description}
      </span>
      <button
        type="button"
        onClick={handleJump}
        title={`Jump to ${pod.name} panel`}
        style={{
          // Bumped to meet --tap-target-min (44px) and --fs-xs floor.
          // Was 0.2rem/0.6rem padding @ 0.72rem font, ~22px tall.
          padding: '0.5rem 0.85rem',
          minHeight: 'var(--tap-target-min, 44px)',
          borderRadius: '4px',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'transparent',
          color: 'var(--dd-text, #ccd6f6)',
          cursor: 'pointer',
          fontSize: 'var(--fs-xs, 0.78rem)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {pod.icon} {pod.name} →
      </button>
    </div>
  );
}

export function TopActions({ report, persona }) {
  const all = collectFindings(report);
  const filtered = persona.id === 'all'
    ? all
    : all.filter((f) => persona.actionPods.includes(f.pod));
  const ranked = rankFindings(filtered).slice(0, persona.actionLimit || 5);

  const heading =
    persona.id === 'all'
      ? '🎯 Top Actions'
      : `🎯 Top Actions for ${persona.label}`;

  return (
    <div style={{
      margin: '0 0 1rem',
      padding: '0.85rem 0',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.10)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{
        padding: '0 1rem 0.55rem',
        fontWeight: 800, fontSize: '0.95rem',
        color: 'var(--dd-text, #ccd6f6)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        {heading}
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.7rem',
          color: 'var(--dd-muted, #8892b0)',
          fontWeight: 500,
        }}>
          {ranked.length} of {filtered.length} {persona.id === 'all' ? 'cross-agent' : 'persona-relevant'} {filtered.length === 1 ? 'finding' : 'findings'}
        </span>
      </div>

      {ranked.length === 0 ? (
        <div style={{
          padding: '1rem 1rem 0.5rem',
          color: 'var(--dd-muted, #8892b0)',
          fontStyle: 'italic',
          fontSize: '0.82rem',
        }}>
          ✓ Nothing urgent for this persona right now. Scroll for full panel detail.
        </div>
      ) : (
        ranked.map((f, i) => <ActionRow key={i} finding={f} />)
      )}
    </div>
  );
}

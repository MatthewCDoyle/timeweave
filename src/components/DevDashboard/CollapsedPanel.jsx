/**
 * src/components/DevDashboard/CollapsedPanel.jsx
 * ============================================================================
 * Wrapper that renders a panel as a one-line summary by default, with a
 * click-to-expand toggle. Used for panels that aren't relevant to the
 * currently-selected persona but should remain accessible.
 *
 * Each summary comes from `PANEL_SUMMARIES[panelId](report)` in personas.js.
 * If the panel doesn't have a summary registered, a generic placeholder is
 * shown instead.
 */

import React, { useState } from 'react';
import { PANEL_SUMMARIES } from './personas';

const PANEL_TITLES = {
  'schema-analytics':    { icon: '🔬', title: 'Schema Analytics' },
  'schema-intelligence': { icon: '🧬', title: 'Schema Intelligence' },
  'date-freshness':      { icon: '📅', title: 'Date & Freshness' },
  'seo-health':          { icon: '🔎', title: 'SEO Health' },
  'analytics':           { icon: '📈', title: 'Analytics' },
  'content-performance': { icon: '📊', title: 'Content Performance' },
  'search':              { icon: '🔍', title: 'Search' },
  'content-quality':     { icon: '✅', title: 'Content Quality' },
  'dita-migration':      { icon: '🔄', title: 'DITA Migration' },
  'terminology-drift':   { icon: '📖', title: 'Terminology Drift' },
  'engineering-tests':   { icon: '⚙️', title: 'Engineering Tests' },
  'frontmatter-readiness': { icon: '🧾', title: 'Frontmatter Readiness' },
  'review-cadence':        { icon: '📆', title: 'Review Cadence' },
  'frontmatter-gaps':      { icon: '🔗', title: 'Missing Required Fields' },
  'ux-metrics':          { icon: '📉', title: 'UX Metrics (Clarity)' },
  'pod-orchestrator':    { icon: '🎯', title: 'Orchestrator' },
  'pod-librarian':       { icon: '📚', title: 'Librarian' },
  'pod-editor':          { icon: '✏️', title: 'Editor' },
  'pod-strategist':      { icon: '📊', title: 'Strategist' },
  'pod-gatekeeper':      { icon: '🛡', title: 'Gatekeeper' },
};

export function CollapsedPanel({ panelId, report, children }) {
  const [expanded, setExpanded] = useState(false);
  const meta = PANEL_TITLES[panelId] || { icon: '•', title: panelId };
  const summaryFn = PANEL_SUMMARIES[panelId];
  const summary = summaryFn ? summaryFn(report) : '';

  if (expanded) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          title="Collapse"
          style={{
            position: 'absolute', top: '0.5rem', right: '0.5rem', zIndex: 2,
            padding: '0.15rem 0.5rem',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '4px',
            color: 'var(--dd-muted, #8892b0)',
            fontSize: '0.7rem',
            cursor: 'pointer',
          }}
        >
          ▴ Collapse
        </button>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      title="Expand panel"
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.55rem 0.85rem',
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '6px',
        color: 'var(--dd-text, #ccd6f6)',
        cursor: 'pointer',
        fontSize: '0.78rem',
        fontFamily: 'inherit',
        marginBottom: '0.4rem',
      }}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span style={{ fontWeight: 700 }}>{meta.title}</span>
      <span style={{ color: 'var(--dd-muted, #8892b0)' }}>·</span>
      <span style={{ flex: '1 1 auto', color: 'var(--dd-muted, #8892b0)' }}>{summary}</span>
      <span style={{ color: 'var(--dd-muted, #8892b0)', fontSize: '0.7rem' }}>▾ expand</span>
    </button>
  );
}

/**
 * src/components/DevDashboard/PodPanel.jsx
 * ============================================================================
 * Unified chrome for the 5 agentic pod panels (Librarian, Editor, Orchestrator,
 * Strategist, Gatekeeper). Each pod component now owns its body content only —
 * the panel root, head row (icon + POD badge + title + subtitle + alerts), and
 * per-pod accent classes are all rendered here.
 *
 * Why this exists:
 *   Each pod previously rendered its own slightly-different head — drift like
 *   "fontSize 0.7rem on 4 of 5 subtitles" had accumulated. Centralizing the
 *   chrome makes the 5 pods structurally identical and gives us one place to
 *   add cross-pod features (e.g., status dots, run-state indicators).
 *
 * Portability:
 *   This component is part of the cross-repo dashboard template. The pod
 *   identity-to-color/badge mapping is internal to this file — adding a new
 *   pod is a single-line registry update plus matching CSS classes.
 */

import React, { useState } from 'react';
import styles from './styles.module.css';

// ---- Pod registry --------------------------------------------------------
// Maps pod identity to the design tokens that distinguish it visually.
const POD_REGISTRY = {
  librarian:    { accent: styles.podAccentLibrarian,    badge: styles.podBadgeLibrarian },
  editor:       { accent: styles.podAccentEditor,       badge: styles.podBadgeEditor },
  orchestrator: { accent: styles.podAccentOrchestrator, badge: styles.podBadgeOrchestrator },
  strategist:   { accent: styles.podAccentStrategist,   badge: styles.podBadgeStrategist },
  gatekeeper:   { accent: styles.podAccentGatekeeper,   badge: styles.podBadgeGatekeeper },
};

// ---- AlertBadge ----------------------------------------------------------
// Threshold-alert chip that appears on the right of a pod head when there are
// active alerts. Click expands a dropdown listing the alerts by severity.
export function AlertBadge({ alerts }) {
  const [expanded, setExpanded] = useState(false);
  // When there are no alerts, show a small green "all clear" pill so the
  // alerts slot is never empty — every agent has the alert mechanism wired,
  // we just want it to be visible that this one is quiet right now.
  if (!alerts || alerts.alertCount === 0) {
    return (
      <span
        title="No active threshold alerts for this agent"
        style={{
          marginLeft: 'auto',
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          padding: '6px 12px',
          background: 'rgba(46, 204, 113, 0.12)',
          color: '#2ecc71',
          border: '1px solid rgba(46, 204, 113, 0.35)',
          borderRadius: '14px',
          fontSize: 'var(--fs-xs, 0.78rem)',
          fontWeight: 700,
          minHeight: 'var(--tap-target-min, 44px)',
          boxSizing: 'border-box',
        }}
      >
        ✓ No active alerts
      </span>
    );
  }
  const bg = alerts.status === 'CRITICAL' ? '#e74c3c'
           : alerts.status === 'WARNING'  ? '#f39c12'
           : '#3498db';
  const icon = alerts.status === 'CRITICAL' ? '✗'
             : alerts.status === 'WARNING'  ? '⚠'
             : 'ℹ';
  return (
    <span style={{ position: 'relative', marginLeft: 'auto' }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        title={`${alerts.alertCount} threshold alert(s)`}
        style={{
          background: bg, color: '#fff', border: 'none', borderRadius: '14px',
          padding: '8px 14px', fontSize: 'var(--fs-xs, 0.78rem)', fontWeight: 700,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
          minHeight: 'var(--tap-target-min, 44px)',
        }}
      >
        {icon} {alerts.alertCount}
      </button>
      {expanded && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 100,
          background: 'var(--dd-card-bg, #1a1a2e)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px', padding: '0.75rem', minWidth: '280px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', fontSize: '0.75rem',
        }}>
          <div style={{ fontWeight: 700, marginBottom: '0.5rem', color: bg }}>
            {icon} {alerts.alertCount} Threshold Alert{alerts.alertCount > 1 ? 's' : ''}
          </div>
          {alerts.alerts.map((a, i) => (
            <div key={i} style={{
              padding: '0.35rem 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
            }}>
              <span style={{
                background: a.severity === 'P0' ? '#e74c3c' : a.severity === 'P1' ? '#f39c12' : '#3498db',
                color: '#fff', borderRadius: '4px', padding: '1px 6px', fontSize: '0.65rem', fontWeight: 700,
                flexShrink: 0,
              }}>{a.severity}</span>
              <span style={{ color: 'var(--dd-muted, #8892b0)' }}>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

// ---- PodPanel ------------------------------------------------------------
// Unified chrome wrapper. Each of the 5 pod components renders this and passes
// its body as children. Props:
//   name      — pod identity (librarian | editor | orchestrator | strategist | gatekeeper)
//   icon      — emoji or React node for the head's leading icon
//   title     — pod name (e.g. "The Librarian")
//   subtitle  — short positioning line under/beside the title
//   alerts    — alerts object passed through to AlertBadge
//   children  — pod body content (rendered below the head)
//
// The component derives the DOM id from `name` so anchor jumps still work
// (#librarian, #editor, etc.) and applies the accent + badge classes from the
// registry above.
export function PodPanel({ name, icon, title, subtitle, alerts, children }) {
  const reg = POD_REGISTRY[name];
  if (!reg) throw new Error(`PodPanel: unknown pod "${name}"`);
  return (
    <div
      className={`${styles.panel} ${styles.panelFull} ${styles.podAccent} ${reg.accent}`}
      id={name}
    >
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>{icon}</span>
        <span className={`${styles.podBadge} ${reg.badge}`}>Agent</span>
        <h3 className={styles.panelTitle}>{title}</h3>
        <AlertBadge alerts={alerts} />
      </div>
      {subtitle && (
        <p
          className={styles.panelSubtitle}
          style={{ margin: '0.25rem 0 0', fontSize: 'var(--fs-xs)' }}
        >
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}

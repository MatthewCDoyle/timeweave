/**
 * src/components/DevDashboard/TerminologyDriftPanel.jsx
 * ============================================================================
 * Editor-pod tile summarizing terminology drift across the docs corpus.
 *
 * Data source: static/data/terminology-drift.json (produced by
 * scripts/scan-terminology-drift.mjs against .content/terminology-map.json).
 *
 * Shows:
 *   - Headline counts: total findings, files affected, severity breakdown
 *   - Top variants by frequency (biggest stylistic offenders)
 *   - Top files (worst offenders)
 *   - Per-rule breakdown
 *   - Source-rules SHA for audit traceability
 *   - "Jump to Editor" + "Regenerate" affordances
 *
 * Graceful states:
 *   - drift === null         → "Not yet generated" placeholder with command hint
 *   - findings.length === 0  → success state ("No drift detected")
 *   - findings.length > 0    → full breakdown
 */

import React from 'react';
import styles from './styles.module.css';

function HeadlineStats({ drift }) {
  const filesPct = drift.filesScanned > 0
    ? Math.round((drift.filesWithDrift / drift.filesScanned) * 100)
    : 0;
  return (
    <div className={styles.chipRow}>
      <div className={styles.chip}>
        <span className={styles.chipValue} style={{ color: drift.totalFindings > 0 ? '#e67e22' : '#2ecc71' }}>
          {drift.totalFindings}
        </span>
        <span className={styles.chipLabel}>Total findings</span>
      </div>
      <div className={styles.chip}>
        <span className={styles.chipValue}>{drift.filesWithDrift}</span>
        <span className={styles.chipLabel}>Files affected ({filesPct}%)</span>
      </div>
      <div className={styles.chip}>
        <span className={styles.chipValue} style={{ color: '#e74c3c' }}>{drift.bySeverity?.high ?? 0}</span>
        <span className={styles.chipLabel}>High severity</span>
      </div>
      <div className={styles.chip}>
        <span className={styles.chipValue} style={{ color: '#f39c12' }}>{drift.bySeverity?.medium ?? 0}</span>
        <span className={styles.chipLabel}>Medium</span>
      </div>
      <div className={styles.chip}>
        <span className={styles.chipValue}>{drift.filesScanned}</span>
        <span className={styles.chipLabel}>Files scanned</span>
      </div>
    </div>
  );
}

function TopVariantsList({ drift }) {
  const items = drift.topVariants || [];
  if (!items.length) return null;
  const max = items[0]?.count || 1;
  return (
    <div>
      <h4 className={styles.schemaSectionTitle}>Top non-canonical variants</h4>
      <div className={styles.hBarList}>
        {items.slice(0, 10).map((it) => {
          // Look up the canonical from byCanonical via reverse mapping is brittle —
          // pull it from the first matching finding instead.
          const finding = (drift.findings || []).find((f) => f.variant === it.variant);
          const canonical = finding?.canonical || '?';
          const ruleId = finding?.ruleId || '';
          return (
            <div key={it.variant} className={styles.hBarItem}>
              <div className={styles.hBarMeta}>
                <span className={styles.hBarLabel}>
                  <code style={{ background: 'rgba(231,76,60,0.10)', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>
                    {it.variant}
                  </code>
                  <span style={{ color: 'var(--dd-muted)', margin: '0 0.4rem' }}>→</span>
                  <code style={{ background: 'rgba(46,204,113,0.10)', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>
                    {canonical}
                  </code>
                  {ruleId && (
                    <span style={{ color: 'var(--dd-muted)', marginLeft: '0.4rem', fontSize: 'var(--fs-xs)' }}>
                      {ruleId}
                    </span>
                  )}
                </span>
                <span className={styles.hBarValue}>{it.count}</span>
              </div>
              <div className={styles.hBarTrack}>
                <div className={styles.hBarFill} style={{ width: `${(it.count / max) * 100}%`, background: '#e67e22' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopFilesList({ drift }) {
  const items = drift.topFiles || [];
  if (!items.length) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 className={styles.schemaSectionTitle}>Files with most drift</h4>
      <div className={styles.scrollBox} style={{ maxHeight: '200px' }}>
        <table className={styles.docTable}>
          <thead>
            <tr>
              <th>File</th>
              <th style={{ textAlign: 'right' }}>Findings</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 10).map((it) => (
              <tr key={it.file}>
                <td style={{ fontSize: 'var(--fs-xs)' }}>{it.file}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#e67e22' }}>{it.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerRuleBreakdown({ drift }) {
  const entries = Object.entries(drift.byRule || {}).sort(([, a], [, b]) => b - a);
  if (!entries.length) return null;
  return (
    <div style={{ marginTop: '1rem' }}>
      <h4 className={styles.schemaSectionTitle}>Per-rule breakdown</h4>
      <div className={styles.chipRow}>
        {entries.map(([ruleId, count]) => (
          <div key={ruleId} className={styles.chip}>
            <span className={styles.chipValue} style={{ color: '#e67e22' }}>{count}</span>
            <span className={styles.chipLabel}>{ruleId}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function jumpToEditor() {
  const el = document.getElementById('editor');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function TerminologyDriftPanel({ drift }) {
  // Not-generated state
  if (!drift) {
    return (
      <div className={`${styles.panel} ${styles.panelFull}`} id="terminology-drift">
        <div className={styles.panelHead}>
          <span className={styles.panelIcon}>📖</span>
          <h3 className={styles.panelTitle}>Terminology Drift</h3>
          <span className={styles.panelSubtitle} style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
            Editor agent · RULE-019, RULE-020
          </span>
        </div>
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px', fontSize: 'var(--fs-xs)', color: 'var(--dd-muted)' }}>
          ⚠ Drift report not yet generated. Run:
          <pre style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.25)', borderRadius: '4px', fontSize: 'var(--fs-xs)' }}>
{`npm run terminology         # generate map + scan in one go
# or:
npm run terminology:generate
npm run terminology:scan`}
          </pre>
        </div>
      </div>
    );
  }

  // Empty / no-drift state
  if (drift.totalFindings === 0) {
    return (
      <div className={`${styles.panel} ${styles.panelFull}`} id="terminology-drift">
        <div className={styles.panelHead}>
          <span className={styles.panelIcon}>📖</span>
          <h3 className={styles.panelTitle}>Terminology Drift</h3>
          <span className={styles.panelSubtitle} style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
            Editor agent · {drift.filesScanned} files scanned
          </span>
        </div>
        <div style={{ padding: '1rem', textAlign: 'center', color: '#2ecc71', fontWeight: 600 }}>
          ✓ No terminology drift detected across {drift.filesScanned} files.
        </div>
      </div>
    );
  }

  // Drift state
  return (
    <div className={`${styles.panel} ${styles.panelFull}`} id="terminology-drift">
      <div className={styles.panelHead}>
        <span className={styles.panelIcon}>📖</span>
        <h3 className={styles.panelTitle}>Terminology Drift</h3>
        <span className={styles.panelSubtitle} style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--dd-muted)' }}>
          Editor agent · canonical-vs-variant usage from{' '}
          <code style={{ background: 'rgba(255,255,255,0.05)', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>
            .content/style-rules.md
          </code>
        </span>
      </div>

      <p className={styles.panelSubtitle} style={{ margin: '0 0 0.75rem' }}>
        Approved-term enforcement scanner — every usage of a non-canonical variant linked to its approved replacement.
        {drift.sourceMapSha && (
          <span style={{ marginLeft: '0.5rem', color: 'var(--dd-muted)', fontSize: 'var(--fs-xs)' }}>
            rules SHA: <code>{drift.sourceMapSha.slice(0, 8)}</code>
          </span>
        )}
      </p>

      <HeadlineStats drift={drift} />
      <PerRuleBreakdown drift={drift} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1.5rem', marginTop: '1rem' }}>
        <TopVariantsList drift={drift} />
        <TopFilesList drift={drift} />
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={jumpToEditor}
          className={styles.librarianRunBtn}
          style={{ background: 'linear-gradient(135deg, #003fbd, #1a5cd8)' }}
        >
          ✏️ Editor → Activate to Fix
        </button>
      </div>

      {drift.truncated && (
        <p style={{ marginTop: '0.5rem', fontSize: 'var(--fs-xs)', color: 'var(--dd-muted)', fontStyle: 'italic' }}>
          Showing first 1,000 findings — total {drift.totalFindings}. Run{' '}
          <code>node scripts/scan-terminology-drift.mjs --json</code> for the full list.
        </p>
      )}
    </div>
  );
}

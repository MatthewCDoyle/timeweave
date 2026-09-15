/**
 * src/components/DevDashboard/JiraStatusBadge.jsx
 * ============================================================================
 * Click-to-cycle status badge for JIRA tickets.
 *
 * Resolution priority for what status to show:
 *   1. Local override from localStorage (set by user clicking the badge)
 *   2. `envStatus` prop (from JIRA_TRACKED_KEYS=KEY:Status syntax)
 *   3. '—' (unknown)
 *
 * Click cycles through the canonical states and persists per-key to
 * localStorage. Source indicator:
 *   • no badge → unset
 *   • "manual"  → set in env var (build-time)
 *   • "you"     → set in this browser (overridden via click)
 *
 * Persistence is per-browser, so different machines see different overrides
 * — by design. This is a personal-tracker layer, not a source of truth.
 *
 * The actual source of truth is the JIRA URL — clicking the key (rendered
 * separately by the parent) opens the live ticket.
 */

import React, { useEffect, useState } from 'react';

const CYCLE = ['—', 'Open', 'In Progress', 'Done', 'Blocked'];

const COLORS = {
  '—':            { bg: 'rgba(127,140,141,0.18)', fg: '#7f8c8d', border: 'rgba(127,140,141,0.35)' },
  'Open':         { bg: 'rgba(231,76,60,0.18)',   fg: '#e74c3c', border: 'rgba(231,76,60,0.35)'   },
  'In Progress':  { bg: 'rgba(243,156,18,0.18)',  fg: '#f39c12', border: 'rgba(243,156,18,0.35)'  },
  'Done':         { bg: 'rgba(46,204,113,0.18)',  fg: '#2ecc71', border: 'rgba(46,204,113,0.35)'  },
  'Blocked':      { bg: 'rgba(155,89,182,0.18)',  fg: '#9b59b6', border: 'rgba(155,89,182,0.35)'  },
};

const STORAGE_KEY = 'zmv-jira-status-overrides';

function readStore() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeStore(store) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch { /* quota / private mode */ }
}

export function JiraStatusBadge({ jiraKey, envStatus }) {
  // Local override (per browser)
  const [override, setOverride] = useState(undefined);

  useEffect(() => {
    const store = readStore();
    setOverride(store[jiraKey]);   // undefined if no override
  }, [jiraKey]);

  const resolved = override !== undefined ? override : (envStatus || '—');
  const source =
    override !== undefined ? 'you' :
    envStatus              ? 'manual' :
    null;

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const idx = CYCLE.indexOf(resolved);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    const store = readStore();
    if (next === '—' && !envStatus) {
      delete store[jiraKey];
    } else {
      store[jiraKey] = next;
    }
    writeStore(store);
    setOverride(next);
  };

  const handleReset = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const store = readStore();
    delete store[jiraKey];
    writeStore(store);
    setOverride(undefined);
  };

  const color = COLORS[resolved] || COLORS['—'];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
      <button
        type="button"
        onClick={handleClick}
        title="Click to cycle status — saved per browser"
        aria-label={`Status: ${resolved}. Click to cycle.`}
        style={{
          background: color.bg,
          color: color.fg,
          border: `1px solid ${color.border}`,
          borderRadius: '4px',
          padding: '0.1rem 0.5rem',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {resolved}
      </button>
      {source && (
        <span
          title={
            source === 'you'
              ? 'Set in this browser. Click ↻ to clear.'
              : 'Set via JIRA_TRACKED_KEYS env var.'
          }
          style={{
            fontSize: '0.62rem',
            color: 'var(--dd-muted, #8892b0)',
            fontStyle: 'italic',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem',
          }}
        >
          {source === 'you' ? '✎ you' : 'manual'}
          {source === 'you' && (
            <button
              type="button"
              onClick={handleReset}
              title="Clear override"
              aria-label="Clear status override"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--dd-muted, #8892b0)',
                cursor: 'pointer',
                padding: '0 0.15rem',
                fontSize: '0.7rem',
                lineHeight: 1,
              }}
            >↻</button>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * src/components/DevDashboard/PrCard.jsx
 * ============================================================================
 * Renders a single PR created by a pod activate, with status badge and a
 * "↻ Refresh status" button that polls the pod's /api/{pod}/pr-status
 * endpoint (see scripts/_pr-status.mjs and per-pod servers).
 *
 * The activate response shape this component understands:
 *   { prUrl: "https://github.com/.../pull/42",
 *     branchName: "librarian/auto-fill-...",
 *     prState?: "OPEN" | "CLOSED" | "MERGED" | "DRAFT" | "UNKNOWN",
 *     prReviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null }
 *
 * If the server didn't include `prState`, we default to OPEN at activate time
 * (PRs are always OPEN at creation) and let the user refresh for live status.
 */

import React, { useState } from 'react';
import { POD_API } from './podConfig';

function parsePrNumber(prUrl) {
  if (!prUrl) return null;
  const m = prUrl.match(/\/pull\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function stateColor(state) {
  switch (state) {
    case 'MERGED':            return '#9b59b6';
    case 'CLOSED':             return '#e74c3c';
    case 'DRAFT':              return '#7f8c8d';
    case 'OPEN':               return '#2ecc71';
    case 'CHANGES_REQUESTED':  return '#e67e22';
    case 'APPROVED':           return '#27ae60';
    case 'REVIEW_REQUIRED':    return '#3498db';
    default:                   return '#95a5a6';
  }
}

function StateBadge({ label }) {
  if (!label) return null;
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.15rem 0.5rem',
      borderRadius: '4px',
      fontSize: '0.68rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      color: '#fff',
      background: stateColor(label),
    }}>{label.replace(/_/g, ' ')}</span>
  );
}

export function PrCard({ pod, prUrl, branchName, prState, prReviewDecision, label }) {
  const [state, setState] = useState(prState || 'OPEN');
  const [reviewDecision, setReviewDecision] = useState(prReviewDecision || null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  const prNumber = parsePrNumber(prUrl);
  const apiBase = POD_API[pod];

  const refresh = async () => {
    if (!prNumber || !apiBase) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch(`${apiBase}/api/${pod}/pr-status?number=${prNumber}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.state) setState(data.state);
      if (data.reviewDecision !== undefined) setReviewDecision(data.reviewDecision);
    } catch (err) {
      setRefreshError(err.message);
    }
    setRefreshing(false);
  };

  if (!prUrl) return null;

  return (
    <div style={{
      margin: '0.5rem 0',
      padding: '0.65rem 0.85rem',
      background: 'rgba(46, 204, 113, 0.06)',
      border: '1px solid rgba(46, 204, 113, 0.25)',
      borderRadius: '6px',
      fontSize: '0.78rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, color: 'var(--dd-text, #ccd6f6)' }}>
          {label || 'Pull Request'}
        </span>
        <StateBadge label={state} />
        {reviewDecision && reviewDecision !== state && <StateBadge label={reviewDecision} />}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '4px',
              background: '#3498db',
              color: '#fff',
              textDecoration: 'none',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            View on GitHub →
          </a>
          <button
            onClick={refresh}
            disabled={refreshing || !prNumber}
            title={!prNumber ? 'PR number not detected' : 'Refresh status from GitHub'}
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: 'var(--dd-text, #ccd6f6)',
              cursor: refreshing ? 'wait' : 'pointer',
              fontSize: '0.72rem',
            }}
          >
            {refreshing ? '↻ …' : '↻ Refresh'}
          </button>
        </span>
      </div>
      {branchName && (
        <div style={{ marginTop: '0.3rem', fontSize: '0.7rem', color: 'var(--dd-muted, #8892b0)' }}>
          Branch: <code style={{ background: 'rgba(0,0,0,0.25)', padding: '0.05rem 0.3rem', borderRadius: '3px' }}>{branchName}</code>
        </div>
      )}
      {refreshError && (
        <div style={{ marginTop: '0.3rem', fontSize: '0.7rem', color: '#e74c3c' }}>
          ✗ Refresh failed: {refreshError}
        </div>
      )}
    </div>
  );
}

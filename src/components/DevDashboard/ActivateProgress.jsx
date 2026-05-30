/**
 * src/components/DevDashboard/ActivateProgress.jsx
 * ============================================================================
 * Progress indicator shown while a pod's Activate / Dry Run is in flight.
 *
 * The companion servers don't expose progress streams, so this is an honest
 * indeterminate bar plus an elapsed-time counter. No false precision — we
 * don't pretend to know what percent the server is at.
 *
 * Used by every pod panel via the `activating` flag from usePodPanel.
 */

import React, { useEffect, useState } from 'react';

const TYPICAL_DURATION_S = 30;

export function ActivateProgress({ active, label = 'Activating' }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return undefined;
    }
    const start = Date.now();
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 200);
    return () => clearInterval(iv);
  }, [active]);

  if (!active) return null;

  const overrun = elapsed > TYPICAL_DURATION_S;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} in progress, ${elapsed} seconds elapsed`}
      style={{
        margin: '0.75rem 0',
        padding: '0.65rem 0.85rem',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '6px',
        fontSize: '0.78rem',
        color: 'var(--dd-text, #ccd6f6)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <span style={{ fontWeight: 600 }}>
          ⏳ {label}…
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: overrun ? '#f39c12' : 'var(--dd-muted, #8892b0)' }}>
          {elapsed}s elapsed{overrun ? ' (longer than usual)' : ''}
        </span>
      </div>

      {/* Indeterminate animated bar */}
      <div style={{
        position: 'relative',
        height: '6px',
        borderRadius: '3px',
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: 0, left: 0, height: '100%', width: '40%',
          background: 'linear-gradient(90deg, transparent, #3498db, transparent)',
          animation: 'devDashIndet 1.4s ease-in-out infinite',
        }} />
      </div>

      <div style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: 'var(--dd-muted, #8892b0)' }}>
        Typical activate runs take ~10–30s (scan → fix → branch → push → PR).
      </div>

      <style>{`
        @keyframes devDashIndet {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  );
}

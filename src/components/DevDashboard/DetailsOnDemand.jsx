/**
 * src/components/DevDashboard/DetailsOnDemand.jsx
 * ============================================================================
 * Reusable click-to-expand drilldown. Wraps any aggregate stat or chart
 * segment so users can click for the underlying detail list. The third step
 * of Shneiderman's Mantra (Overview → Zoom/Filter → Details on Demand)
 * applied to aggregates that previously had no drill-down path.
 *
 * Usage:
 *   <DetailsOnDemand
 *     summary="127 docs missing description"
 *     count={127}
 *   >
 *     {(close) => (
 *       <ul>{files.map(f => <li key={f}>{f}</li>)}</ul>
 *     )}
 *   </DetailsOnDemand>
 *
 * The header is a button. Clicked → expands children below. ARIA-correct
 * (button + aria-expanded). Keyboard-accessible by default.
 */

import React, { useState } from 'react';
import styles from './styles.module.css';

/**
 * @param {object} props
 * @param {React.ReactNode} props.summary — text shown in the header (one-line)
 * @param {number} [props.count] — optional badge (renders to right of summary)
 * @param {React.ReactNode | (close: () => void) => React.ReactNode} props.children — the detail content; if a function, receives a close callback
 * @param {boolean} [props.initiallyOpen=false]
 * @param {string} [props.className]
 */
export function DetailsOnDemand({ summary, count, children, initiallyOpen = false, className = '' }) {
  const [open, setOpen] = useState(initiallyOpen);
  const renderedChildren = typeof children === 'function' ? children(() => setOpen(false)) : children;

  return (
    <div className={`${styles.detailsOnDemand} ${className}`.trim()}>
      <button
        type="button"
        className={styles.detailsOnDemandHeader}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={styles.detailsOnDemandDisclosure} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className={styles.detailsOnDemandSummary}>{summary}</span>
        {typeof count === 'number' && (
          <span className={styles.detailsOnDemandCount}>{count}</span>
        )}
      </button>
      {open && (
        <div className={styles.detailsOnDemandBody}>
          {renderedChildren}
        </div>
      )}
    </div>
  );
}

export default DetailsOnDemand;

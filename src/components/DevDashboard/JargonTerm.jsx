/**
 * src/components/DevDashboard/JargonTerm.jsx
 * ============================================================================
 * Reusable tooltipped jargon-term renderer. Wraps a code (DL-01, P0,
 * AUTO_REMEDIATE, etc.) with a native HTML title attribute so hover reveals
 * the definition. Visually marked with a dotted underline + help cursor.
 *
 * This is the dashboard's primary "details on demand" mechanism per
 * Shneiderman's Mantra (Overview → Zoom/Filter → Details on Demand).
 * Tooltips are the canonical implementation per Shneiderman's own
 * recommendation, and `<span title="">` is the simplest HTML primitive
 * that works without a popover library.
 *
 * Glossary lookups are zero-config: pass `code="DL-01"` and the component
 * resolves the definition from JARGON_GLOSSARY. Pass an inline `definition`
 * prop to override or supply text for codes not in the glossary.
 *
 * v1 limitations (documented for future upgrade):
 *   - Uses native `title` attribute. Works on hover (desktop); poor for
 *     touch / keyboard focus. Future: replace with a proper popover that
 *     opens on focus + click as well.
 *   - No tooltip on touch devices. Tap-and-hold may show iOS title text
 *     but it's inconsistent across mobile browsers.
 *
 * Usage:
 *   <JargonTerm code="DL-01" />                         // looks up definition
 *   <JargonTerm code="DL-01">flattened tables</JargonTerm>  // custom rendered text
 *   <JargonTerm code="CUSTOM" definition="...">CUSTOM</JargonTerm>  // inline def
 */

import React from 'react';
import styles from './styles.module.css';
import { JARGON_GLOSSARY, resolveJargon } from './jargonGlossary';

// Re-export so existing import sites can import either from here or from
// jargonGlossary.js. The glossary lives in a plain-JS file so it can be
// unit-tested without a React renderer.
export { JARGON_GLOSSARY } from './jargonGlossary';

/**
 * Render a jargon term with a tooltip that explains it on hover. Uses the
 * native `title` attribute (HTML-level tooltip) so no popover library is
 * required.
 *
 * @param {object} props
 * @param {string} [props.code] — glossary key to look up (e.g., "DL-01")
 * @param {string} [props.definition] — explicit definition (overrides glossary)
 * @param {React.ReactNode} [props.children] — display text (defaults to code)
 * @param {string} [props.className] — extra class
 */
export function JargonTerm({ code, definition, children, className = '' }) {
  const def = definition || resolveJargon(code);
  const display = children !== undefined && children !== null ? children : code;
  if (!def) {
    // No definition known — render without tooltip styling so we don't
    // mislead the user with a "hover for info" affordance that has no info.
    return <span className={className}>{display}</span>;
  }
  return (
    <span
      className={`${styles.jargonTerm} ${className}`.trim()}
      title={def}
    >
      {display}
    </span>
  );
}

export default JargonTerm;

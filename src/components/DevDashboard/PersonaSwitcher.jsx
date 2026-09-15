/**
 * src/components/DevDashboard/PersonaSwitcher.jsx
 * ============================================================================
 * Sticky persona-selector bar shown at the top of the dev dashboard.
 *
 * Sits above all panels (and remains visible while scrolling) so users can
 * switch lenses mid-page without scrolling back to the top.
 *
 * Renders the current persona's description as a sub-line so the choice
 * isn't opaque.
 */

import React from 'react';
import { PERSONA_OPTIONS } from './personas';

export function PersonaSwitcher({ personaId, persona, setPersona }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        background: 'var(--ifm-background-surface-color, #161b22)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0.5rem 1rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <label
        htmlFor="dd-persona-switcher"
        style={{ fontSize: '0.78rem', color: 'var(--dd-muted, #8892b0)', fontWeight: 600 }}
      >
        🎯 View as
      </label>

      <select
        id="dd-persona-switcher"
        value={personaId}
        onChange={(e) => setPersona(e.target.value)}
        style={{
          padding: '0.35rem 0.6rem',
          borderRadius: '6px',
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'var(--dd-surface, #0d1117)',
          color: 'var(--dd-text, #c9d1d9)',
          fontSize: '0.82rem',
          fontWeight: 600,
          minWidth: '200px',
        }}
      >
        {PERSONA_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>

      <span
        style={{
          fontSize: '0.74rem',
          color: 'var(--dd-muted, #8892b0)',
          fontStyle: 'italic',
          flex: '1 1 auto',
        }}
      >
        {persona.description}
      </span>
    </div>
  );
}

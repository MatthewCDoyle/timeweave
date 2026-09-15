/**
 * src/components/DevDashboard/usePersona.js
 * ============================================================================
 * Persona-state hook.
 *
 * Resolution priority on initial mount:
 *   1. URL query param `?as=<personaId>` — for shareable lensed links
 *   2. localStorage (`zmv-dashboard-persona`) — sticky per-browser preference
 *   3. DEFAULT_PERSONA_ID
 *
 * Setting the persona via the returned setter:
 *   - Updates localStorage
 *   - Replaces the URL query param without a navigation
 *
 * Always returns a valid persona object (never null).
 */

import { useEffect, useState, useCallback } from 'react';
import { PERSONAS, DEFAULT_PERSONA_ID } from './personas';

const STORAGE_KEY = 'zmv-dashboard-persona';
const QUERY_PARAM = 'as';

function readInitial() {
  if (typeof window === 'undefined') return DEFAULT_PERSONA_ID;
  // 1) URL param
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get(QUERY_PARAM);
    if (fromUrl && PERSONAS[fromUrl]) return fromUrl;
  } catch { /* ignore */ }
  // 2) localStorage
  try {
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage && PERSONAS[fromStorage]) return fromStorage;
  } catch { /* ignore */ }
  // 3) default
  return DEFAULT_PERSONA_ID;
}

function writeUrl(personaId) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (personaId === DEFAULT_PERSONA_ID) {
      url.searchParams.delete(QUERY_PARAM);
    } else {
      url.searchParams.set(QUERY_PARAM, personaId);
    }
    window.history.replaceState(null, '', url.toString());
  } catch { /* ignore */ }
}

export function usePersona() {
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA_ID);

  useEffect(() => {
    setPersonaId(readInitial());
  }, []);

  const setPersona = useCallback((id) => {
    if (!PERSONAS[id]) return;
    setPersonaId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* quota */ }
    writeUrl(id);
  }, []);

  return {
    personaId,
    persona: PERSONAS[personaId] || PERSONAS[DEFAULT_PERSONA_ID],
    setPersona,
  };
}

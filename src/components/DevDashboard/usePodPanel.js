/**
 * src/components/DevDashboard/usePodPanel.js
 * ============================================================================
 * Shared state machine for an agent panel's Scan / Activate pair.
 *
 * Scan       — POST to {API}/api/{pod}/dry-run on the companion server
 *              (full file-walk scan; read-only; no writes)
 * Activate   — POST to {API}/api/{pod}/activate on the companion server
 *              (same scan + writes fixes + creates PR)
 *
 * The legacy in-browser `run()` and `result` are still returned for back-compat
 * (Orchestrator's Quick Run still uses them), but the four file-walking agents
 * (Librarian, Editor, Strategist, Gatekeeper) no longer expose a Run button.
 *
 * The hook also pings {API}/api/{pod}/status on mount to set serverOnline,
 * so the panel can disable activate buttons when the companion server is down.
 *
 * Usage:
 *   const {
 *     result, running, run,
 *     activateResult, activating, activateError,
 *     activate, dryRun,
 *     serverOnline,
 *   } = usePodPanel('librarian', runLibrarian, enrichedReport, { pollIntervalMs: 10000 });
 *
 * `engineInput` is whatever the engine takes as its single argument —
 * usually the build-report, optionally merged with extra data (e.g., the
 * Librarian merges semanticLoss into its input).
 *
 * `options.pollIntervalMs` (optional) — when set, re-checks the companion
 * server's /status endpoint at that interval. Default: status checked once
 * on mount.
 */

import { useEffect, useState, useCallback } from 'react';
import { POD_API } from './podConfig';

export function usePodPanel(pod, engineFn, engineInput, options = {}) {
  const { pollIntervalMs } = options;
  const apiBase = POD_API[pod];
  if (!apiBase) {
    throw new Error(`usePodPanel: unknown pod "${pod}"`);
  }

  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [activateResult, setActivateResult] = useState(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState(null);
  const [serverOnline, setServerOnline] = useState(null); // null = unknown

  // Companion-server status check on mount, optionally polled
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(`${apiBase}/api/${pod}/status`)
        .then((r) => { if (!cancelled) setServerOnline(r.ok); })
        .catch(() => { if (!cancelled) setServerOnline(false); });
    };
    check();
    if (!pollIntervalMs) return () => { cancelled = true; };
    const iv = setInterval(check, pollIntervalMs);
    return () => { cancelled = true; clearInterval(iv); };
  }, [apiBase, pod, pollIntervalMs]);

  // Browser-side Run — synchronous engine call
  const run = useCallback((inputOverride) => {
    setRunning(true);
    try {
      const input = inputOverride !== undefined ? inputOverride : engineInput;
      const output = engineFn(input);
      setResult(output);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`${pod} engine error:`, err);
    }
    setRunning(false);
  }, [engineFn, engineInput, pod]);

  // Server-side Scan (dry-run) / Activate — POSTs to companion server
  const callServer = useCallback(async (endpoint, body) => {
    setActivating(true);
    setActivateError(null);
    try {
      const res = await fetch(`${apiBase}/api/${pod}/${endpoint}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setActivateResult(data);
      return data;
    } catch (err) {
      setActivateError(err.message);
      return null;
    } finally {
      setActivating(false);
    }
  }, [apiBase, pod]);

  const activate = useCallback((body) => callServer('activate', body), [callServer]);
  const dryRun   = useCallback((body) => callServer('dry-run',  body), [callServer]);

  return {
    result, running, run,
    activateResult, activating, activateError,
    activate, dryRun,
    serverOnline,
    apiBase,
  };
}

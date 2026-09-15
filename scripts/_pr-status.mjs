/**
 * scripts/_pr-status.mjs
 * ============================================================================
 * Shared helper used by every pod companion server to expose
 *   GET /api/{pod}/pr-status?number=N
 *
 * Returns the live state of a GitHub PR by shelling out to `gh pr view`.
 * Requires `gh` (GitHub CLI) to be installed and authenticated.
 *
 * Response shape (200):
 *   { state: "OPEN" | "CLOSED" | "MERGED" | "DRAFT",
 *     reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null,
 *     isDraft: boolean,
 *     title: string,
 *     url: string }
 *
 * Response shape (4xx/5xx):
 *   { error: string }
 *
 * The dashboard's PrCard component calls this when the user clicks ↻ Refresh.
 */

import { execFileSync } from 'node:child_process';

function ghPrView(number) {
  const out = execFileSync(
    'gh',
    ['pr', 'view', String(number),
     '--json', 'state,reviewDecision,isDraft,title,url'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return JSON.parse(out);
}

/**
 * Handle a GET /api/{pod}/pr-status?number=N request.
 * Mounts cleanly into the existing http.createServer dispatcher.
 *
 *   import { handlePrStatus } from './_pr-status.mjs';
 *   if (url.pathname === '/api/librarian/pr-status' && req.method === 'GET') {
 *     return handlePrStatus(req, res, url, sendJson);
 *   }
 */
export function handlePrStatus(req, res, url, sendJson) {
  const numberStr = url.searchParams.get('number');
  const number = parseInt(numberStr, 10);
  if (!number || Number.isNaN(number)) {
    return sendJson(res, 400, { error: 'Missing or invalid ?number= query param' });
  }
  try {
    const data = ghPrView(number);
    // Honour DRAFT as a top-level state for UI clarity.
    const state = data.isDraft ? 'DRAFT' : data.state;
    return sendJson(res, 200, {
      state,
      reviewDecision: data.reviewDecision || null,
      isDraft: !!data.isDraft,
      title: data.title || '',
      url: data.url || '',
    });
  } catch (err) {
    return sendJson(res, 500, { error: `gh pr view failed: ${err.message}` });
  }
}

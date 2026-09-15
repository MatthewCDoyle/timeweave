/**
 * scripts/_fence-tracker.mjs
 * ============================================================================
 * Shared utilities for tracking Markdown code fence state across lines.
 *
 * Before this module existed, the `inFence = !inFence` toggle was duplicated
 * across at least 7 places in 3 scripts (librarian-activate, dita-loss-scanner,
 * scan-terminology-drift). Each implementation drifted slightly. The case
 * study found two bugs caused by missing fence tracking (Phase 19 — DL-01
 * misread JSDoc; bug class also surfaced in scattered other functions).
 *
 * Three functions provided, each focused:
 *
 *   forEachLineWithFenceState(text, callback)
 *     Calls callback(line, lineIdx, inFence) for each line. Closest match to
 *     the manual `let inFence = false; for (line of lines) { if (...) toggle }`
 *     pattern; lets callers keep their existing logic shape.
 *
 *   maskFences(text)
 *     Returns text with all fenced regions (including the fence delimiters)
 *     replaced by same-length spaces preserving newlines. Use this when you
 *     want regex matching to skip fenced content without changing line
 *     numbers or character offsets — matches the masking approach used by
 *     editor-activate.mjs's extractProse(). See .github/case-study/insights.md
 *     "Editor line-number off-by-N" for why masking preserves indices.
 *
 *   getFenceRegions(text)
 *     Returns an array of { startLine, endLine } (0-indexed, inclusive on
 *     both ends including the fence-delimiter lines) for every fenced block.
 *     Use this when you need to know fence boundaries up front, e.g. to
 *     compute "is offset X inside a fence?"
 *
 * All three follow the SAME fence-toggle rule: a line whose `trim()` starts
 * with three or more backticks is a fence delimiter. This matches the
 * historical implementations and the CommonMark grammar for fenced code.
 *
 * Zero dependencies. ESM. Pure functions.
 */

const FENCE_RE = /^```/;

/**
 * Walk every line of the text, calling `callback(line, lineIdx, inFence)` for
 * each. `inFence` is `true` for the fence-delimiter line as well as the lines
 * between delimiters — i.e., the opening ``` is reported as inFence=true.
 * (This matches the way most existing callers used the toggle.)
 *
 * @param {string} text
 * @param {(line: string, lineIdx: number, inFence: boolean) => void} callback
 */
export function forEachLineWithFenceState(text, callback) {
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFenceLine = FENCE_RE.test(line.trim());
    if (isFenceLine) {
      // The fence line itself counts as inFence so callers can choose to
      // pass it through unchanged.
      callback(line, i, true);
      inFence = !inFence;
    } else {
      callback(line, i, inFence);
    }
  }
}

/**
 * Replace every fenced region's content with same-length spaces, preserving
 * newlines so character/line offsets are unchanged. The fence delimiter lines
 * themselves are also masked (replaced with spaces) so that regex scans
 * looking for matches inside ``` blocks won't accidentally match the
 * delimiter line itself.
 *
 * @param {string} text
 * @returns {string}
 */
export function maskFences(text) {
  return text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * Return an array of { startLine, endLine } pairs (both 0-indexed, both
 * inclusive of the fence-delimiter lines themselves) for every fenced block
 * in `text`. Unclosed final fence reports endLine = last line of text.
 *
 * @param {string} text
 * @returns {Array<{ startLine: number, endLine: number }>}
 */
export function getFenceRegions(text) {
  const lines = text.split('\n');
  const regions = [];
  let openStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i].trim())) {
      if (openStart === -1) {
        openStart = i;
      } else {
        regions.push({ startLine: openStart, endLine: i });
        openStart = -1;
      }
    }
  }
  if (openStart !== -1) {
    regions.push({ startLine: openStart, endLine: lines.length - 1 });
  }
  return regions;
}

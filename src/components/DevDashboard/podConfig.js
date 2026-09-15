/**
 * src/components/DevDashboard/podConfig.js
 * ============================================================================
 * Single source of truth for pod companion-server URLs used by the dashboard.
 *
 * Each pod's localhost server (started by `npm run {pod}:server`) listens on
 * the port declared here. To override (e.g., remote dev), set the matching
 * env var at build time and reference it via a future config layer; for now
 * the dashboard uses the literal values below.
 *
 * If you change a port here, also update:
 *   - scripts/{pod}-server.mjs (server bind port)
 *   - .github/agents/{pod}.agent.md ("Key Commands" port number)
 *   - .github/instructions/agent-scripts.instructions.md (port table)
 */

export const POD_API = Object.freeze({
  librarian:    'http://127.0.0.1:3456',
  editor:       'http://127.0.0.1:3457',
  orchestrator: 'http://127.0.0.1:3458',
  strategist:   'http://127.0.0.1:3459',
  gatekeeper:   'http://127.0.0.1:3460',
});

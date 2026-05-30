#!/usr/bin/env node
/**
 * scripts/dev-all.mjs
 * ============================================================================
 * Single-command launcher for the full dev experience:
 *   - Docusaurus dev server (port 3000)
 *   - All five pod companion servers (3456 librarian, 3457 editor,
 *     3458 orchestrator, 3459 strategist, 3460 gatekeeper)
 *
 * Each child's stdout/stderr is prefixed with a colored tag so you can tell
 * them apart in one terminal. Ctrl+C cleanly tears down every child.
 *
 * Usage:
 *   npm run dev:all
 *
 * Zero new dependencies — uses Node's built-in child_process only.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const TARGETS = [
  { name: 'docusaurus',   cmd: npmCmd, args: ['start'],                   color: '\x1b[36m' }, // cyan
  { name: 'librarian',    cmd: npmCmd, args: ['run', 'librarian:server'], color: '\x1b[34m' }, // blue
  { name: 'editor',       cmd: npmCmd, args: ['run', 'editor:server'],    color: '\x1b[35m' }, // magenta
  { name: 'orchestrator', cmd: npmCmd, args: ['run', 'orchestrator:server'], color: '\x1b[33m' }, // yellow
  { name: 'strategist',   cmd: npmCmd, args: ['run', 'strategist:server'], color: '\x1b[32m' }, // green
  { name: 'gatekeeper',   cmd: npmCmd, args: ['run', 'gatekeeper:server'], color: '\x1b[31m' }, // red
];

const RESET = '\x1b[0m';
const padName = (n) => n.padEnd(12);
const children = [];
let shuttingDown = false;

function prefixWriter(name, color, stream) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      stream.write(`${color}[${padName(name)}]${RESET} ${line}\n`);
      buf = buf.slice(nl + 1);
    }
  };
}

function start({ name, cmd, args, color }) {
  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    env: process.env,
    // Node 20+ on Windows requires shell:true to spawn .cmd/.bat files
    // (e.g. npm.cmd). On macOS/Linux, npm is a real binary — shell off.
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', prefixWriter(name, color, process.stdout));
  child.stderr.on('data', prefixWriter(name, color, process.stderr));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(`${color}[${padName(name)}]${RESET} exited (code=${code} signal=${signal})\n`);
    // If the dev server itself dies, tear everything down.
    if (name === 'docusaurus') shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    process.stderr.write(`${color}[${padName(name)}]${RESET} failed to start: ${err.message}\n`);
    shutdown(1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('\n\x1b[1m▶ Shutting down all child processes…\x1b[0m\n');
  for (const c of children) {
    try { c.kill(isWin ? undefined : 'SIGTERM'); } catch { /* ignore */ }
  }
  // Give them a moment, then force-exit.
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.stdout.write('\x1b[1m▶ Starting Docusaurus + 5 pod servers (Ctrl+C to stop all)\x1b[0m\n');
for (const t of TARGETS) children.push(start(t));

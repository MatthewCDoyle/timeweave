#!/usr/bin/env node
/**
 * scripts/librarian-server.mjs
 * ============================================================================
 * Tiny companion HTTP server for the DevDashboard "Activate Librarian" button.
 *
 * Exposes two endpoints:
 *   GET  /api/librarian/status    → health check
 *   POST /api/librarian/activate  → runs librarian-activate.mjs
 *   POST /api/librarian/dry-run   → runs in dry-run mode (no file writes)
 *
 * Start:
 *   node scripts/librarian-server.mjs           # default port 3456
 *   PORT=4000 node scripts/librarian-server.mjs
 *
 * The server binds to localhost only — no external access.
 */

import http from 'node:http';
import { activate } from './librarian-activate.mjs';
import { handlePrStatus } from './_pr-status.mjs';

const PORT = parseInt(process.env.LIBRARIAN_PORT || '3456', 10);

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/librarian/status' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', pid: process.pid, uptime: process.uptime() });
    return;
  }

  if (url.pathname === '/api/librarian/activate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const opts = body ? JSON.parse(body) : {};
        const result = activate({ dryRun: false, scope: opts.scope || null });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message, stack: err.stack });
      }
    });
    return;
  }

  if (url.pathname === '/api/librarian/dry-run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const opts = body ? JSON.parse(body) : {};
        const result = activate({ dryRun: true, scope: opts.scope || null });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: err.message, stack: err.stack });
      }
    });
    return;
  }

  if (url.pathname === '/api/librarian/pr-status' && req.method === 'GET') {
    return handlePrStatus(req, res, url, sendJson);
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`📚 Librarian API server listening on http://127.0.0.1:${PORT}`);
  console.log(`   POST /api/librarian/activate  — auto-fill frontmatter + git commit`);
  console.log(`   POST /api/librarian/dry-run   — preview changes (no writes)`);
  console.log(`   GET  /api/librarian/status     — health check`);
});

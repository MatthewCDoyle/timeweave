#!/usr/bin/env node
/**
 * scripts/gatekeeper-server.mjs
 * ============================================================================
 * Companion HTTP server for The Gatekeeper pod dashboard buttons.
 *
 * Endpoints:
 *   GET  /api/gatekeeper/status    → health check
 *   POST /api/gatekeeper/activate  → scan + auto-fix + PR
 *   POST /api/gatekeeper/dry-run   → preview findings (no writes)
 *
 * Start:
 *   node scripts/gatekeeper-server.mjs           # default port 3460
 *   GATEKEEPER_PORT=4003 node scripts/gatekeeper-server.mjs
 */

import http from 'node:http';
import { activate } from './gatekeeper-activate.mjs';
import { handlePrStatus } from './_pr-status.mjs';

const PORT = parseInt(process.env.GATEKEEPER_PORT || '3460', 10);

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

  if (url.pathname === '/api/gatekeeper/status' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', pod: 'GATEKEEPER', pid: process.pid, uptime: process.uptime() });
    return;
  }

  if (url.pathname === '/api/gatekeeper/activate' && req.method === 'POST') {
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

  if (url.pathname === '/api/gatekeeper/dry-run' && req.method === 'POST') {
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

  if (url.pathname === '/api/gatekeeper/pr-status' && req.method === 'GET') {
    return handlePrStatus(req, res, url, sendJson);
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[GATEKEEPER] Server listening on http://127.0.0.1:${PORT}`);
  console.log(`  GET  /api/gatekeeper/status`);
  console.log(`  POST /api/gatekeeper/activate`);
  console.log(`  POST /api/gatekeeper/dry-run`);
});

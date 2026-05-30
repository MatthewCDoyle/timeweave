#!/usr/bin/env node
/**
 * scripts/editor-server.mjs
 * ============================================================================
 * Companion HTTP server for The Editor pod dashboard buttons.
 *
 * Endpoints:
 *   GET  /api/editor/status    → health check
 *   POST /api/editor/activate  → run style scan + apply fixes + PR
 *   POST /api/editor/dry-run   → preview violations (no writes)
 *
 * Start:
 *   node scripts/editor-server.mjs           # default port 3457
 *   EDITOR_PORT=4001 node scripts/editor-server.mjs
 */

import http from 'node:http';
import { activate } from './editor-activate.mjs';
import { handlePrStatus } from './_pr-status.mjs';

const PORT = parseInt(process.env.EDITOR_PORT || '3457', 10);

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

  if (url.pathname === '/api/editor/status' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', pod: 'EDITOR', pid: process.pid, uptime: process.uptime() });
    return;
  }

  if (url.pathname === '/api/editor/activate' && req.method === 'POST') {
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

  if (url.pathname === '/api/editor/dry-run' && req.method === 'POST') {
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

  if (url.pathname === '/api/editor/pr-status' && req.method === 'GET') {
    return handlePrStatus(req, res, url, sendJson);
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✏️  Editor API server listening on http://127.0.0.1:${PORT}`);
  console.log('   POST /api/editor/activate  — scan + fix + PR');
  console.log('   POST /api/editor/dry-run   — preview violations');
  console.log('   GET  /api/editor/status     — health check');
});

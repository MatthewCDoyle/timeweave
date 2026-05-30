#!/usr/bin/env node
/**
 * scripts/strategist-server.mjs
 * ============================================================================
 * Companion HTTP server for The Strategist pod dashboard buttons.
 *
 * Endpoints:
 *   GET  /api/strategist/status    → health check
 *   POST /api/strategist/activate  → generate strategy report + write file
 *   POST /api/strategist/dry-run   → preview strategy report (no writes)
 *
 * Start:
 *   node scripts/strategist-server.mjs           # default port 3459
 *   STRATEGIST_PORT=4002 node scripts/strategist-server.mjs
 */

import http from 'node:http';
import { activate } from './strategist-activate.mjs';
import { handlePrStatus } from './_pr-status.mjs';

const PORT = parseInt(process.env.STRATEGIST_PORT || '3459', 10);

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

const server = http.createServer(async (req, res) => {
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

  if (url.pathname === '/api/strategist/status' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', pod: 'STRATEGIST', pid: process.pid, uptime: process.uptime() });
    return;
  }

  if (url.pathname === '/api/strategist/activate' && req.method === 'POST') {
    try {
      const result = await activate({ dryRun: false });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message, stack: err.stack });
    }
    return;
  }

  if (url.pathname === '/api/strategist/dry-run' && req.method === 'POST') {
    try {
      const result = await activate({ dryRun: true });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message, stack: err.stack });
    }
    return;
  }

  if (url.pathname === '/api/strategist/pr-status' && req.method === 'GET') {
    return handlePrStatus(req, res, url, sendJson);
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[STRATEGIST] Server listening on http://127.0.0.1:${PORT}`);
  console.log(`  GET  /api/strategist/status`);
  console.log(`  POST /api/strategist/activate`);
  console.log(`  POST /api/strategist/dry-run`);
});

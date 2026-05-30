#!/usr/bin/env node
/**
 * scripts/orchestrator-server.mjs
 * ============================================================================
 * HTTP API for the ZMV Master Orchestrator.
 *
 * Endpoints:
 *   GET  /api/orchestrator/status   → health check
 *   POST /api/orchestrator/run      → full Sense→Analyze→Act cycle
 *
 * Reads build-report.json, runs all pod engines, then orchestrates.
 *
 * Start:
 *   node scripts/orchestrator-server.mjs   # default port 3458
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

// Dynamic imports — pods live in src/agents/
async function loadPods() {
  const { runLibrarian } = await import('../src/agents/librarian/librarian.mjs');
  const { runEditor } = await import('../src/agents/editor/editor.mjs');
  const { runOrchestrator } = await import('../src/agents/orchestrator/orchestrator.mjs');
  return { runLibrarian, runEditor, runOrchestrator };
}

const PORT = parseInt(process.env.ORCHESTRATOR_PORT || '3458', 10);

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

  if (url.pathname === '/api/orchestrator/status' && req.method === 'GET') {
    sendJson(res, 200, { status: 'ok', pod: 'ORCHESTRATOR', pid: process.pid, uptime: process.uptime() });
    return;
  }

  if (url.pathname === '/api/orchestrator/run' && req.method === 'POST') {
    try {
      const reportPath = path.join(workspaceRoot, 'static', 'build-report.json');
      if (!fs.existsSync(reportPath)) {
        sendJson(res, 500, { error: 'build-report.json not found. Run npm run build-report first.' });
        return;
      }
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      const { runLibrarian, runEditor, runOrchestrator } = await loadPods();

      // Sense: run each pod
      const librarianResult = runLibrarian(report);
      const editorResult = runEditor(report);

      // Analyze + Act
      const result = runOrchestrator(report, {
        librarian: librarianResult,
        editor: editorResult,
      });

      // Attach full pod results for dashboard consumption
      result.podResultsFull = {
        librarian: librarianResult,
        editor: editorResult,
      };

      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message, stack: err.stack });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🎯 Orchestrator API listening on http://127.0.0.1:${PORT}`);
  console.log('   POST /api/orchestrator/run     — full Sense→Analyze→Act');
  console.log('   GET  /api/orchestrator/status   — health check');
});

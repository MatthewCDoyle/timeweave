#!/usr/bin/env node
/**
 * scripts/verify-integrations.mjs
 * ============================================================================
 * Smoke-tests external integrations without running the full build report.
 *
 *   - JIRA: hits /rest/api/3/myself (auth check) and /rest/api/3/issue/{epic}
 *           (configured-epic readable check). Reports clear OK / FAIL / SKIP.
 *   - Clarity: confirms env vars are present. (The current Clarity integration
 *           in generate-build-report.mjs is wired to non-existent endpoints and
 *           needs a rewrite before live data flows; this verifier flags that.)
 *
 * Usage:
 *   node scripts/verify-integrations.mjs
 *   npm run verify:integrations    # if wired in package.json
 *
 * Never logs the token. Reports only HTTP status, account email returned by
 * the API, and the resolved hostname so the user can confirm tenant+account
 * match expectations.
 */

import './_load-env.mjs';

const RESET = '\x1b[0m';
const OK = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const SKIP = '\x1b[33m–\x1b[0m';
const DIM = '\x1b[2m';

let hadFailure = false;

function header(name) {
  process.stdout.write(`\n\x1b[1m${name}\x1b[0m\n`);
}
function line(symbol, msg, detail) {
  process.stdout.write(`  ${symbol} ${msg}${detail ? `  ${DIM}${detail}${RESET}` : ''}\n`);
}

// ─── JIRA ────────────────────────────────────────────────────────────────
async function verifyJira() {
  header('JIRA');
  const baseUrl = process.env.JIRA_BASE_URL || '';
  const email   = process.env.JIRA_EMAIL || '';
  const token   = process.env.JIRA_TOKEN || '';
  const epicKey = process.env.JIRA_EPIC_KEY || '';

  if (!baseUrl || !email || !token) {
    line(SKIP, 'JIRA env vars not set — skipping (will fall back to mock data)');
    return;
  }

  const url = baseUrl.replace(/\/$/, '');
  const isCloud = /\.atlassian\.net$/i.test(new URL(url).hostname);
  line(OK, 'env vars present', `host=${url}  account=${email}  type=${isCloud ? 'Cloud' : 'Server/Data Center'}`);

  // Self-hosted JIRA typically wants either:
  //   - Bearer <PAT>   (Data Center 8.14+ Personal Access Tokens)
  //   - Basic <username:password-or-PAT>   (works on Server too)
  // Cloud always uses Basic <email:apitoken> against /rest/api/3/.
  // Try multiple strategies until one succeeds and report which.
  const usernameLocal = email.includes('@') ? email.split('@')[0] : email;
  const adUser = process.env.USERNAME || process.env.USER || '';   // Windows USERNAME / *nix USER

  // Try a fan of plausible (username, token) combinations and Bearer.
  // Self-hosted JIRA at large orgs often uses AD/SSO IDs as the JIRA username
  // (e.g., 'bnc438'), not the email local-part.
  const candidates = [];
  candidates.push({ kind: 'Bearer',    label: 'Bearer PAT',                                     auth: 'Bearer ' + token });
  candidates.push({ kind: 'Basic',     label: `Basic email:token  (${email})`,                  auth: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') });
  candidates.push({ kind: 'Basic',     label: `Basic username:token  (${usernameLocal})`,       auth: 'Basic ' + Buffer.from(`${usernameLocal}:${token}`).toString('base64') });
  if (adUser && adUser !== usernameLocal) {
    candidates.push({ kind: 'Basic',   label: `Basic AD-username:token  (${adUser})`,           auth: 'Basic ' + Buffer.from(`${adUser}:${token}`).toString('base64') });
    candidates.push({ kind: 'Basic',   label: `Basic AD-username uppercase:token  (${adUser.toUpperCase()})`, auth: 'Basic ' + Buffer.from(`${adUser.toUpperCase()}:${token}`).toString('base64') });
  }

  const apiVersion = isCloud ? '3' : '2';
  const strategies = isCloud
    ? [{ label: 'Basic email:token (Cloud)', auth: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') }]
    : candidates;

  let workingAuth = null;
  let workingLabel = null;
  for (const strat of strategies) {
    try {
      const res = await fetch(`${url}/rest/api/${apiVersion}/myself`, {
        headers: { Authorization: strat.auth, Accept: 'application/json' },
      });
      if (res.ok) {
        const me = await res.json();
        line(OK, `auth check via ${strat.label}`, `authenticated as ${me.emailAddress || me.displayName || me.name || '(unknown)'}`);
        workingAuth = strat.auth;
        workingLabel = strat.label;
        break;
      } else {
        line(DIM + `   tried ${strat.label} → HTTP ${res.status}` + RESET, '');
      }
    } catch (err) {
      line(DIM + `   tried ${strat.label} → ${err.message}` + RESET, '');
    }
  }

  if (!workingAuth) {
    hadFailure = true;
    line(FAIL, 'auth check', 'all strategies failed — see attempted methods above');
    line(DIM + '  ↳ if Server/DC: confirm JIRA username (not email), or generate a PAT in JIRA → Profile → PATs' + RESET, '');
    return;
  }

  const headers = { Authorization: workingAuth, Accept: 'application/json' };
  // Stash the working strategy globally so build-report can copy it
  process.env.JIRA_AUTH_STRATEGY = workingLabel;
  process.env.JIRA_API_VERSION = apiVersion;

  // Epic readability check
  if (!epicKey) {
    line(SKIP, 'JIRA_EPIC_KEY not set — epic readability check skipped');
  } else {
    try {
      const res = await fetch(`${url}/rest/api/${apiVersion}/issue/${encodeURIComponent(epicKey)}?fields=summary,status`, { headers });
      if (!res.ok) {
        hadFailure = true;
        line(FAIL, `epic ${epicKey} (HTTP ${res.status})`, res.status === 404 ? 'epic not found or not readable by this account' : '');
        return;
      }
      const issue = await res.json();
      const summary = issue.fields?.summary || '(no summary)';
      const status  = issue.fields?.status?.name || '?';
      line(OK, `epic ${epicKey} readable`, `"${summary}" — status: ${status}`);
    } catch (err) {
      hadFailure = true;
      line(FAIL, `epic ${epicKey} fetch failed`, err.message);
    }
  }

  // Project key sanity (optional)
  const projectKey = process.env.JIRA_PROJECT_KEY || '';
  if (projectKey) {
    try {
      const res = await fetch(`${url}/rest/api/${apiVersion}/project/${encodeURIComponent(projectKey)}`, { headers });
      if (res.ok) {
        const proj = await res.json();
        line(OK, `project ${projectKey} reachable`, `"${proj.name}"`);
      } else {
        line(FAIL, `project ${projectKey} (HTTP ${res.status})`);
        hadFailure = true;
      }
    } catch (err) {
      line(FAIL, `project ${projectKey} fetch failed`, err.message);
      hadFailure = true;
    }
  }
}

// ─── Clarity ─────────────────────────────────────────────────────────────
async function verifyClarity() {
  header('Microsoft Clarity');
  const apiKey = process.env.CLARITY_API_KEY || '';

  if (!apiKey) {
    line(SKIP, 'CLARITY_API_KEY not set — skipping (will fall back to mock data)');
    return;
  }
  line(OK, 'env var present', 'token will be sent to Clarity Data Export API');

  const endpoint = 'https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1';
  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      hadFailure = true;
      const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
      line(FAIL, `live probe (HTTP ${res.status})`, body);
      if (res.status === 401) line(DIM + '  ↳ likely cause: invalid or expired CLARITY_API_KEY' + RESET, '');
      if (res.status === 429) line(DIM + '  ↳ rate-limited (Clarity allows ~10 calls/day per token)' + RESET, '');
      return;
    }
    const data = await res.json();
    const metrics = Array.isArray(data) ? data.map((m) => m.metricName).filter(Boolean) : [];
    line(OK, 'live probe OK', `received ${metrics.length} metric(s): ${metrics.slice(0, 5).join(', ')}${metrics.length > 5 ? '…' : ''}`);
  } catch (err) {
    hadFailure = true;
    line(FAIL, 'live probe failed (network/DNS)', err.message);
  }
}

// ─── GitHub (optional, for PR↔ticket linkage) ──────────────────────────────
async function verifyGithub() {
  header('GitHub (PR↔ticket linkage)');
  const owner = process.env.GH_OWNER || '';
  const repo  = process.env.GH_REPO  || '';
  const token = process.env.GITHUB_TOKEN || '';

  if (!owner || !repo) {
    line(SKIP, 'GH_OWNER/GH_REPO not set — PR↔ticket linkage table will be empty');
    return;
  }
  line(OK, 'env vars present', `repo=${owner}/${repo}${token ? ' (with token)' : ' (anonymous)'}`);

  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!res.ok) {
      hadFailure = true;
      line(FAIL, `repo readable (HTTP ${res.status})`,
           res.status === 404 ? 'private repo without GITHUB_TOKEN, or repo not found' : '');
      return;
    }
    const r = await res.json();
    line(OK, 'repo readable', `${r.full_name} (${r.private ? 'private' : 'public'}, default: ${r.default_branch})`);
  } catch (err) {
    hadFailure = true;
    line(FAIL, 'repo fetch failed', err.message);
  }
}

await verifyJira();
await verifyClarity();
await verifyGithub();

process.stdout.write('\n');
if (hadFailure) {
  process.stdout.write('\x1b[31mOne or more integrations failed verification.\x1b[0m See messages above.\n');
  process.exit(1);
} else {
  process.stdout.write('\x1b[32mAll configured integrations verified.\x1b[0m\n');
}

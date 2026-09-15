/**
 * scripts/_load-env.mjs
 * ============================================================================
 * Tiny zero-dependency loader for `.env.local` at the repo root.
 *
 * - Imported for side-effect at the top of any script that needs optional
 *   integration env vars (Clarity / GitHub / custom dashboard settings).
 * - Reads `.env.local` (gitignored) and populates process.env for any keys
 *   not already set in the shell. Shell-provided values always win.
 * - Silently no-ops if `.env.local` is absent so CI / production builds
 *   don't have to maintain one.
 *
 * Usage:
 *   import './_load-env.mjs';
 *
 * Format (standard dotenv subset):
 *   - One KEY=VALUE per line
 *   - Lines starting with `#` are comments
 *   - Surrounding single or double quotes on VALUE are stripped
 *   - Trailing whitespace trimmed
 *   - No variable interpolation, no multi-line values, no exports
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env.local');

if (existsSync(envPath)) {
  try {
    const raw = readFileSync(envPath, 'utf8');
    let loaded = 0;
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip matching surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Shell-provided env wins
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = value;
        loaded++;
      }
    }
    if (loaded > 0 && process.env.DEBUG_ENV_LOAD) {
      console.error(`[env-load] loaded ${loaded} value(s) from .env.local`);
    }
  } catch (err) {
    console.error(`[env-load] failed to parse .env.local: ${err.message}`);
  }
}

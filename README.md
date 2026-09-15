# Dashboard Export — Zebra Docs Agentic System

Drop-in bundle for the five-pod multi-agent dashboard + agent runtime.
Exported from `zebra-aurora-docs-on-demand` on 2026-05-25.

## What's inside

| Path | Purpose |
|------|---------|
| `src/components/DevDashboard/` | React dashboard UI, personas, panels, design tokens |
| `src/pages/dev-dashboard.js` | Docusaurus page mount (gated by `siteConfig.customFields.isDev`) |
| `src/agents/` | Five pod engines (editor/librarian/orchestrator/strategist/gatekeeper) + `thresholds.mjs` |
| `scripts/` | Pod servers (3456–3460), activate scripts, build-report generator, validators, gates |
| `schemas/pods/` | JSON Schemas for pod outputs (validated in CI) |
| `.github/agents/` | Per-pod agent specs |
| `.github/instructions/` | Cross-cutting instruction docs (applyTo globs) |
| `.github/agent-actions.md` | Canonical action vocabulary |
| `docs/dev-dashboard-contract.md` | Canonical pod ownership + data contract for dashboard metrics |
| `.content/` | Style rules, rule registry/patterns, terminology map |
| `static/data/` | Sample telemetry JSON (replace after first `build-report` run) |
| `static/build-report.json` | Sample build report so the dashboard renders on first load |
| `dashboard.config.js` | Frontmatter taxonomy schema |
| `.env.example` | Env-var template (JIRA, GitHub, Clarity placeholders) |
| `package.fragment.json` | Scripts + deps to merge into your repo's `package.json` |

## Adoption steps

1. **Unzip into your Docusaurus repo root.** Files land in their final paths.
2. **Merge `package.fragment.json`** into your repo's `package.json` (scripts + deps).
3. **Run** `npm install`.
4. **Gate the dashboard.** In your `docusaurus.config.ts`, set:
   ```ts
   customFields: { isDev: process.env.NODE_ENV !== 'production' || process.env.BUILD_DEV === 'true' }
   ```
5. **Copy `.env.example` to `.env.local`** and fill in JIRA / GitHub keys.
6. **Regenerate telemetry for your corpus:** `npm run build-report`.
7. **Start everything:** `npm run dev:all` — Docusaurus + all 5 pod servers in one terminal.
8. **Visit** `http://localhost:3000/dev-dashboard`.

## Portability notes (from source CLAUDE.md)

- Pod engines are content-agnostic — they read `static/build-report.json`. No code changes needed.
- File walkers in `*-activate.mjs` currently accept `.md` / `.mdx`. Extend to `.dita` / `.ditamap`
  using `scripts/_dita-extractor.mjs` if your repo is DITA-source.
- Policy thresholds live in `src/agents/thresholds.mjs` — tune per repo if needed.
- Design tokens (`--space-*`, `--fs-*`, `--tap-target-min`, `--focus-ring`) sit at the top of
  `src/components/DevDashboard/styles.module.css`. Don't go below `--fs-xs` (WCAG floor).
- Action vocabulary is fixed: `AUTO_REMEDIATE` · `PROPOSE` · `CLICK_TO_FIX` · `FLAG` · `ESCALATE`.
- Conflict priority: Gatekeeper > Librarian > Strategist > Editor.

## What's NOT included

- This repo's MDX content under `docs/` (corpus-specific).
- `docusaurus.config.ts` (your repo already has one — just add `customFields.isDev`).
- `node_modules/`, build outputs, `.docusaurus/`.
- `.env.local` (secrets — use the included `.env.example` as your template).

## Ports used by pod servers

| Pod | Port |
|-----|------|
| Librarian | 3456 |
| Editor | 3457 |
| Orchestrator | 3458 |
| Strategist | 3459 |
| Gatekeeper | 3460 |

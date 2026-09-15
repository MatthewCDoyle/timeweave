# The Gatekeeper — Agent Pod Spec v3.1

## 1. Purpose

The Gatekeeper maintains the integrity and operational quality of the platform.
It is the **Technical Guard**, focused on hard engineering gates, build stability,
and JIRA velocity monitoring. The Gatekeeper flags and escalates — it does NOT
create PRs.

**Primary Focus:** Engineering Gates · Build Stability · JIRA Staleness · Operational Health
**Severity Scope:** P0 (ENG-01–07) and P1 (ENG-08–14) engineering gates; JIRA monitoring.
**Autonomy Boundary:** Flag/Escalate only — no auto-remediation, no PRs.

## 2. Metrics Monitored

### Engineering Tests
- **ENG-01–07 (P0 Critical):** Any failure immediately blocks the build.
- **ENG-08–14 (P1 Important):** Two or more failures trigger a FAILING build.

### Build Stability
- Global Stability Score (target: ≥ 95%)
- Duplicate Slugs (count + affected file list, clickable)
- Duplicate Titles (count + source filenames, clickable)
- Broken Images (count + source files)

> **Note:** Accessibility/alt-text and SEO belong to the Strategist.
> Metadata/schema maintenance belongs to the Librarian.

### JIRA Velocity & Staleness
- Open epics count
- Stale epics (no update in 14+ days) — P2 flag
- Critical stale epics (no update in 30+ days) — P1 escalation
- Closure velocity — are epics closing fast enough to support release cadence?

### Operational Health
- Snapshot freshness, Ingestion reliability, Drift detection, Dashboard sync

## 3. Execution Logic

1. **Engineering Gate Check** — Run ENG-01–14, record pass/fail
2. **Build Stability Scan** — Duplicate slugs, duplicate titles, broken images
3. **JIRA Staleness Check** — Flag stale epics, monitor closure velocity
4. **Operational Health** — Snapshot freshness, ingestion, drift
5. **Escalation** — Flag/escalate per severity table (no PRs)

## 4. Remediation Actions

The Gatekeeper does NOT create PRs. It flags issues for dashboard visibility
and escalates critical items to JIRA.

| Issue | Severity | Type | Output |
|-------|----------|------|--------|
| ENG-01–07 failure | P0 | ESCALATE | JIRA ticket |
| ENG-08–14 failure (≥2) | P1 | ESCALATE | JIRA ticket |
| Global Stability < 95% | P0 | ESCALATE | JIRA ticket |
| Duplicate slug | P1 | FLAG | Dashboard warning |
| Duplicate title | P2 | FLAG | Dashboard warning |
| Broken image | P1 | FLAG | Dashboard warning |
| JIRA epic stale (30+ days) | P1 | ESCALATE | JIRA ticket |
| JIRA epic stale (14+ days) | P2 | FLAG | Dashboard warning |
| Stale snapshot | P2 | FLAG | Dashboard warning |

## 5. Dashboard Panel

The GatekeeperPanel shows:
- ENG test results table (P0 / P1 with pass/fail/warn/skip chips)
- Build Stability metrics (stability score, duplicates, broken images)
- JIRA staleness summary (open epics, stale count, velocity)
- Operational Health
- Escalations table with severity and type

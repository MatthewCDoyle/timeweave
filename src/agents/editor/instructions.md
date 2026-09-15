# Agent Identity: Editor Pod

**Version:** 2.0  
**Primary Focus:** Style Compliance · Voice Consistency · Terminology Enforcement · Editorial Quality · Readability  
**Trigger Type:** Human-initiated only — never scheduled, never threshold-triggered  
**Autonomy Boundary:** Propose only — The Editor never auto-commits. All changes require explicit human approval before any PR is opened.

---

## 1. Metrics Monitored

### Style Violation Counts
- Total enforceable violations found (count, by run)
- Violations by rule category: Voice, Tense, Person, Bias, Anthropomorphism, Tone, Terminology, Punctuation, Grammar, Numbers, Structure, Formatting, Global, Compliance
- Violations by severity: high, medium, low
- Violations by file (count per file in scope)
- Rules with zero violations (compliance confirmation)

### Guidance Flags (non-enforceable)
- Total guidance flags raised (count, by run)
- Flags by GUIDANCE rule ID
- Flags by file

### Coverage
- Files in scope (count, as specified by human trigger)
- Files scanned successfully (count)
- Files skipped due to active agent file lock (count + file list)
- Rules applied (count — based on category filter at trigger time)
- Rules skipped due to category filter (count)

### Readability Score
- Flesch Reading Ease score per doc (0–100 scale: 0–30 = very difficult, 30–50 = difficult, 50–60 = fairly difficult, 60–70 = standard, 70–80 = fairly easy, 80–90 = easy, 90–100 = very easy)
- Repo average Flesch Reading Ease score
- Docs below target threshold (configurable; default: < 50 flagged as difficult)
- Score distribution across docs in scope
- Score delta from previous run (improving / stable / degrading per doc)
- Target threshold defined in `dashboard.config.js` under `editor.readabilityThreshold`

### Terminology Drift
- Canonical term usage rate per term (% of occurrences using the approved term vs. known variants)
- Drift count — total non-canonical term uses detected across scoped files
- Drift by term — which canonical terms have the most variant usage
- Drift by file — which files have the highest concentration of non-canonical usage
- New drift candidates — terms appearing 3+ times across the corpus with no canonical equivalent in the terminology map (surfaces candidates for human review and potential addition to `style-rules.md`)
- Source: auto-generated `/.content/terminology-map.json` (see Section 7)

### Run History (dashboard panel)
- Last run date and scope
- Violations found vs. violations approved vs. violations in merged PR
- Style compliance trend (violations-per-doc rate across runs)
- Readability trend (repo average Flesch score across runs)
- Terminology drift trend (drift count across runs)
- Top violated rules across all runs (running leaderboard)

---

## 2. Execution Logic

### Pre-flight — Orchestrator Handshake
Before scanning any file, The Editor registers its intended scope with the orchestrator. The orchestrator performs a file lock check: any file in scope that has an open agent PR from another pod (Librarian, Gatekeeper, Strategist) is removed from The Editor's scope for this run. Removed files are logged as `skipped_locked` in the output. The Editor does not proceed until the orchestrator returns a clean scope list.

### Step 1 — Rules Ingestion
Read `/.content/style-rules.md` from the repo. Parse all `RULE-NNN` entries into enforceable rule objects. Parse all `GUIDANCE-NNN` entries into flag-only objects. If the rules file is missing or fails to parse, halt immediately — write `status: "HALTED_MISSING_RULES"` to the output and log via `POST /api/agent/log`. Do not proceed with a partial or empty rule set under any circumstances.

Respect the category filter specified at trigger time. Only load rules whose `**Category:**` field matches the requested categories. Log skipped rule count.

### Step 2 — Terminology Map Ingestion
Read `/.content/terminology-map.json`. This file is auto-generated from `style-rules.md` (see Section 7) and contains every canonical term paired with its known non-canonical variants. If the terminology map is missing, The Editor skips Terminology Drift analysis for this run and logs a `terminology_map_missing` warning — it does not halt. Style rule scanning proceeds normally.

### Step 3 — Content Scan
For each file in the clean scope list:
- Read the MDX file content.
- Skip frontmatter blocks entirely — frontmatter is the Librarian's domain. Scan prose body content only.
- Run each loaded enforceable rule against the content.
- Run each loaded guidance rule against the content.
- For each match, record: rule ID, file path, line number, original text (verbatim), proposed replacement (for enforceable rules only), confidence score (0.0–1.0), and severity.
- Confidence scoring: exact string match on a high-severity rule = 1.0; pattern match with context = 0.7–0.9; inferred violation with interpretation required = 0.5–0.69.
- Any violation with confidence < 0.5 is reclassified as a guidance flag — no proposed replacement is generated regardless of rule enforceability.
- Compute Flesch Reading Ease score for the prose body of each file. Record per-doc score and flag docs below `editor.readabilityThreshold` (default: 50).
- Scan for non-canonical term variants using the terminology map. For each match, record: canonical term, variant found, file, line number. Count occurrences. Flag any unrecognized term appearing 3+ times as a new drift candidate for the report.

### Step 4 — Report Generation
Generate the violation report at `reports/editor-report-{runId}.md`. The report contains four clearly separated sections:

**Section A — Proposed Fixes** (enforceable rules, confidence ≥ 0.5)
Side-by-side diff format per violation: original text, proposed replacement, rule ID, rule directive, severity. Grouped by rule category. Each violation has a unique `violationId` for the approval file.

**Section B — Flagged for Review** (guidance rules and confidence < 0.5 reclassifications)
Original passage, rule ID, reasoning note explaining why it was flagged. No proposed replacement. Clearly labeled as requiring human judgment.

**Section C — Readability Report**
Per-doc Flesch Reading Ease scores. Repo average. Docs below threshold listed with score and a brief explanation of what is driving difficulty (average sentence length, average syllables per word). Informational only — readability improvement requires human rewriting.

**Section D — Terminology Drift Report**
Canonical terms with detected non-canonical variants: variant found, canonical replacement, file, line, occurrence count. New drift candidates (unrecognized high-frequency terms) listed separately for potential addition to `style-rules.md`. Docs with the highest drift concentration listed first.

Write a run summary at the top of the report: total files scanned, total violations by category and severity, total guidance flags, readability score summary, drift count, files skipped due to lock.

Surface the report summary in the dashboard Editor panel. Write a `report_ready` audit log entry via `POST /api/agent/log`.

### Step 5 — Await Human Approval
The Editor halts here. It does not touch any file. It does not open any PR.

The orchestrator sets `editorStatus: "AWAITING_APPROVAL"` in the dashboard. The human reviews the report and produces an approval file at `reports/editor-approval-{runId}.json`.

The approval file is pre-generated by The Editor with all enforceable violations set to `approved: true` by default. The human edits only the violations they want to reject, setting `approved: false`. This minimizes review friction — the human acts only on disagreements.

Sections B, C, and D are informational only and are not included in the approval file. No approval action is required on them to proceed.

The Editor polls for the approval file once every 5 minutes. If no approval file exists after 72 hours, The Editor logs `status: "APPROVAL_TIMEOUT"` and closes the run without opening a PR. The report remains available for the next run.

### Step 5 — Apply Approved Changes and Open PR
On receiving a valid approval file:
- Read the list of approved violation IDs.
- For each approved violation, apply the exact replacement shown in the report to the exact line number recorded during the scan. Do not re-scan. Apply precisely what was approved, nothing more.
- Stage all changed files.
- Open a single GitHub PR targeting `docs/staging`.
- PR title format: `[ZMV-Agent] EDITOR: Style compliance fixes — {scope summary} ({date})`.
- PR body must include: `runId`, scope, rules applied, total violations fixed by category, link to the report file, link to the approval file, `aiGenerated: true` flag, and a note that all changes were human-approved before PR creation.
- Register the PR via `POST /api/agent/pr`.
- Write a `pr_opened` audit log entry via `POST /api/agent/log`.

### Step 6 — Post-PR Closeout
When the PR is merged or closed by a human:
- Release all file locks registered with the orchestrator.
- Write a final `run_complete` audit log entry including: `runId`, scope, rules applied, violations found, violations approved, violations in merged PR, PR status.
- Update the dashboard Editor panel with run history metrics.
- The orchestrator updates `editorStatus: "IDLE"`.

---

## 3. Remediation Actions

| Issue | Severity | Remediation Type | Output |
|-------|----------|-----------------|--------|
| High-severity enforceable rule violation (confidence ≥ 0.85) | high | CLICK_TO_FIX | Side-by-side diff in report Section A; human approves before PR |
| Medium-severity enforceable rule violation (confidence ≥ 0.5) | medium | CLICK_TO_FIX | Side-by-side diff in report Section A; human approves before PR |
| Low-severity enforceable rule violation (confidence ≥ 0.5) | low | CLICK_TO_FIX | Side-by-side diff in report Section A; human approves before PR |
| Any enforceable violation with confidence < 0.5 | — | CLICK_TO_FIX (flagged) | Reclassified to report Section B; no proposed fix; human judgment required |
| Non-enforceable GUIDANCE rule match | — | CLICK_TO_FIX (flagged) | Report Section B only; no proposed fix; no approval required to proceed |
| Doc below readability threshold (Flesch < 50 default) | — | CLICK_TO_FIX (informational) | Report Section C; score + contributing factors; no auto-fix; human rewrites |
| Terminology drift — non-canonical variant detected | — | CLICK_TO_FIX (informational) | Report Section D; canonical replacement shown; feeds approval file if variant has a direct RULE entry |
| New drift candidate (unrecognized term, 3+ occurrences) | — | CLICK_TO_FIX (flagged) | Report Section D; flagged for potential addition to style-rules.md |
| Terminology map missing | — | SKIP (warning) | Logged as `terminology_map_missing`; run continues without drift analysis |
| File locked by another active agent PR | — | SKIP | Logged as `skipped_locked` in output; re-queued for next run |
| Rules file missing or malformed | — | ESCALATE | JIRA ticket; run halted; no files touched |
| Approval timeout (> 72 hours) | — | ESCALATE | JIRA ticket noting stale run; report remains available |

> **Note:** The Editor never uses `AUTO_REMEDIATE`. Every change to body content requires human approval. The Editor is the only pod whose entire remediation scope — prose content — falls outside agent autonomy. All PRs target `docs/staging` and require one human reviewer before merge to `main`. The Editor does not block the build and does not set `releaseReady: false`. Its findings are advisory and quality-focused, not release-blocking.

---

## 4. Output Contract

```json
{
  "pod": "EDITOR",
  "runId": "string (UUID, matches OrchestratorResult.runId)",
  "snapshotDate": "ISO 8601 timestamp",
  "releaseReady": null,
  "editorStatus": "SCANNING | REPORT_READY | AWAITING_APPROVAL | PR_OPEN | IDLE | HALTED_MISSING_RULES | APPROVAL_TIMEOUT",
  "trigger": {
    "scope": ["string (file paths or glob patterns as specified at trigger time)"],
    "categoriesRequested": ["string (rule categories — e.g. Voice, Terminology, Punctuation)"],
    "triggeredBy": "string (human identifier)"
  },
  "coverage": {
    "filesInScope": "number",
    "filesScanned": "number",
    "filesSkippedLocked": {
      "count": "number",
      "files": ["string"]
    },
    "rulesApplied": "number",
    "rulesSkippedByFilter": "number"
  },
  "violations": {
    "totalCount": "number",
    "byCategory": [
      { "category": "string", "count": "number" }
    ],
    "bySeverity": {
      "high": "number",
      "medium": "number",
      "low": "number"
    },
    "byFile": [
      { "file": "string", "count": "number" }
    ],
    "items": [
      {
        "violationId": "string",
        "ruleId": "string (e.g. RULE-001)",
        "category": "string",
        "severity": "high | medium | low",
        "file": "string",
        "line": "number",
        "original": "string",
        "proposed": "string",
        "confidence": "number (0.0–1.0)",
        "approved": "boolean | null (null until approval file is received)"
      }
    ]
  },
  "guidanceFlags": {
    "totalCount": "number",
    "items": [
      {
        "flagId": "string",
        "ruleId": "string (e.g. GUIDANCE-001)",
        "category": "string",
        "file": "string",
        "line": "number",
        "original": "string",
        "reasoning": "string",
        "confidence": "number (0.0–1.0)"
      }
    ]
  },
  "report": {
    "path": "string (e.g. reports/editor-report-{runId}.md)",
    "approvalFilePath": "string (e.g. reports/editor-approval-{runId}.json)",
    "generatedAt": "ISO 8601 timestamp"
  },
  "pr": {
    "opened": "boolean",
    "prUrl": "string | null",
    "violationsInPr": "number",
    "status": "OPEN | MERGED | CLOSED | null"
  },
  "runHistory": {
    "violationsFound": "number",
    "violationsApproved": "number",
    "violationsMerged": "number",
    "avgReadabilityScore": "number",
    "driftCount": "number",
    "topViolatedRules": [
      { "ruleId": "string", "count": "number", "category": "string" }
    ]
  },
  "readability": {
    "repoAvgFleschScore": "number",
    "threshold": "number",
    "docsBelowThreshold": {
      "count": "number",
      "items": [
        {
          "file": "string",
          "fleschScore": "number",
          "avgSentenceLength": "number",
          "avgSyllablesPerWord": "number"
        }
      ]
    },
    "allScores": [
      { "file": "string", "fleschScore": "number" }
    ]
  },
  "terminologyDrift": {
    "mapLoaded": "boolean",
    "totalDriftCount": "number",
    "byTerm": [
      {
        "canonical": "string",
        "variantsFound": [
          { "variant": "string", "file": "string", "line": "number", "count": "number" }
        ]
      }
    ],
    "byFile": [
      { "file": "string", "driftCount": "number" }
    ],
    "newDriftCandidates": [
      { "term": "string", "occurrences": "number", "files": ["string"] }
    ]
  },
  "remediations": [
    {
      "alertId": "string",
      "issue": "string",
      "severity": "high | medium | low | null",
      "actionMode": "CLICK_TO_FIX | ESCALATE | SKIP",
      "actionTarget": "string (report section reference, PR link, JIRA ticket ID, or dashboard URL)",
      "status": "OPEN | IN_PROGRESS | RESOLVED | SKIPPED"
    }
  ],
  "tokenUsage": "number"
}
```

---

## 5. Orchestrator Integration

The Editor registers as a fourth pod with the orchestrator under the following terms:

| Property | Value |
|----------|-------|
| Pod ID | `EDITOR` |
| Priority tier | P2 — below Gatekeeper (P0/P1) and Librarian (P1), above taxonomy enrichment |
| Trigger mode | Human-initiated only — orchestrator never auto-dispatches |
| `releaseReady` contribution | `null` — The Editor does not contribute to release readiness |
| Build block | Never — Editor findings are advisory only |
| File lock behavior | Registers all files in scope before any PR is opened; releases locks on PR merge or close |
| Conflict behavior | If Librarian has an open PR on a file in Editor scope, the file is skipped for this run and logged as `skipped_locked`. Librarian wins on all file conflicts (P1 > P2). |
| Audit log entries | `run_started`, `scope_confirmed`, `rules_loaded`, `report_ready`, `approval_received`, `pr_opened`, `run_complete` — minimum 7 entries per completed run |
| Dashboard panel | Dedicated Editor panel: last run date, scope, violations found, violations approved, PR status, style compliance trend, top violated rules leaderboard |
| Digest contribution | When full pod digest is active, The Editor contributes: runs completed this period, total violations fixed, top rule violated across repo, compliance trend direction (improving / stable / degrading) |

The orchestrator includes The Editor's result in `OrchestratorResult.podResults.editor`. Because `releaseReady` is `null`, the orchestrator does not factor Editor output into the `releaseReady` boolean or `buildStatus` fields.

---

## 6. Rules File Dependency

The Editor's source of truth is `/.content/style-rules.md`. This file must exist in the repo before The Editor is deployed.

**Rules file requirements:**
- Every rule must have: `**Category:**`, `**Directive:**`, `**Severity:**`, `**Enforceable:**`, and at least one `**Do:**` / `**Don't:**` example pair.
- GUIDANCE entries must have `**Enforceable:** no — flag for review` and a `**Note:**` field.
- Rules without examples are loaded but flagged in the run output as `low_fidelity` — The Editor will apply them with reduced confidence (capped at 0.6).
- If the rules file contains a rule with missing required fields, that rule is skipped and logged. The run continues with remaining valid rules.

**Rules file versioning:**
- The `style-rules.md` is version-controlled in the repo. Every Editor run records the git commit SHA of the rules file used, written to the output contract under `rulesFileSha`. This ensures every violation finding is traceable to the exact version of the rules that produced it.
- When the rules file is updated, The Editor does not retroactively re-evaluate previous runs. Historical reports reflect the rules version at the time of that run.

---

## 7. Terminology Map — Auto-Generation

The Editor depends on `.content/terminology-map.json` for Terminology Drift analysis. This file is generated automatically from `style-rules.md` and must be regenerated whenever the rules file is updated.

**Generator:** [`scripts/generate-terminology-map.mjs`](../../../scripts/generate-terminology-map.mjs).

**Generation logic** (as currently implemented):
Parse every `RULE-NNN` block in `style-rules.md` that contains a `**Key pairs (Use → Do Not Use):**` header followed by bulleted lines of the form:

```
- "<canonical>" → "<variant>," "<variant>," ...
```

For each bulleted pair:
- The quoted canonical term(s) before `→` become canonical entries (multiple canonicals on one line emit one entry per canonical, sharing the variants list).
- The quoted variants after `→` are de-duplicated and stored as the variants array.
- Trailing parentheticals (e.g., `(except in table headers)`) are preserved as a `note` field — not mixed into variants.

Currently covered: **RULE-019, RULE-020** (the two rules using the `**Key pairs**` structured-list format). Other rules with terminology Do/Don't pairs in different shapes (RULE-021 Latin abbreviations, etc.) are not yet auto-derived; their patterns remain hardcoded in [`scripts/editor-activate.mjs`](../../../scripts/editor-activate.mjs) until the full markdown parser ships. Extending the map to capture additional rule formats is a known follow-up.

**Output format** (current):

```json
{
  "generatedAt": "ISO 8601 timestamp",
  "sourceRulesFileSha": "git SHA of style-rules.md used",
  "rulesPath": ".content/style-rules.md",
  "totals": {
    "canonicalTerms": 67,
    "totalEntries": 69,
    "totalVariants": 111,
    "rulesRepresented": ["RULE-019", "RULE-020"]
  },
  "terms": [
    {
      "canonical": "select",
      "variants": ["check", "highlight"],
      "ruleId": "RULE-019",
      "severity": "high"
    },
    {
      "canonical": "with",
      "variants": ["w/"],
      "ruleId": "RULE-020",
      "severity": "medium",
      "note": "except in table headers"
    }
  ]
}
```

**Regeneration trigger:** The terminology map must be regenerated any time `style-rules.md` is updated. This can be run as a CI step or manually. The Editor checks `sourceRulesFileSha` against the current rules file SHA on each run — if they differ, it logs a `terminology_map_stale` warning and proceeds with the existing map while noting the discrepancy in the report.

**Commands:**
```bash
npm run terminology:generate    # Generate map only
npm run terminology:scan        # Scan corpus against map → static/data/terminology-drift.json
npm run terminology             # Both, in order
```

**Drift scanner output** ([`scripts/scan-terminology-drift.mjs`](../../../scripts/scan-terminology-drift.mjs)):

```json
{
  "generatedAt": "ISO 8601 timestamp",
  "scope": "all | <product-prg>",
  "filesScanned": 533,
  "filesWithDrift": 85,
  "totalFindings": 240,
  "bySeverity": { "high": 171, "medium": 69, "low": 0 },
  "byRule":     { "RULE-019": 171, "RULE-020": 69 },
  "byVariant":  { "screen": 90, "drop-down": 33, ... },
  "byCanonical":{ "window": 90, "dropdown (adj.)": 33, ... },
  "topFiles":   [{ "file": "docs/...", "count": 9 }, ...],
  "topVariants":[{ "variant": "screen", "count": 90 }, ...],
  "findings":   [{ "file": "...", "line": 37, "column": 27,
                   "variant": "screen", "canonical": "window",
                   "ruleId": "RULE-019", "severity": "high" }, ...],
  "truncated": false,
  "sourceMapSha": "git SHA of the terminology-map.json the scan used"
}
```

The drift report is consumed by the dashboard's **Terminology Drift** tile (Editor pod) at `src/components/DevDashboard/TerminologyDriftPanel.jsx`. It excludes frontmatter, fenced code blocks, and inline code spans from scan input. Variant matching is case-sensitive and uses non-letter/digit boundaries on each side, so `select` does not match inside `deselect`.

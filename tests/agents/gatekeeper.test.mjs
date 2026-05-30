import test from 'node:test';
import assert from 'node:assert/strict';
import { runGatekeeper } from '../../src/agents/gatekeeper/gatekeeper.mjs';

function reportWithEngineering() {
  return {
    generatedAt: new Date().toISOString(),
    aggregate: { totalDocs: 1 },
    docs: [{ filePath: 'docs/a.mdx', frontmatter: { title: 'Doc A' } }],
    engineering: {
      tests: {
        eng01: { label: 'ENG-01 Production Build', status: 'pass' },
        eng02: { label: 'ENG-02 Required Fields', status: 'pass', count: 0 },
        eng03: { label: 'ENG-03 MDX + Import Integrity', status: 'pass' },
        eng04: { label: 'ENG-04 Image Asset Integrity', status: 'pass', count: 0, files: [] },
        eng05: { label: 'ENG-05 Slug Uniqueness', status: 'pass', count: 0, duplicates: [] },
        eng06: { label: 'ENG-06 Date Format Validation', status: 'pass' },
        eng07: { label: 'ENG-07 SSR Guard Violations', status: 'pass' },
        eng08: { label: 'ENG-08 Playwright E2E', status: 'skip' },
        eng09: { label: 'ENG-09 Internal Links', status: 'pass', count: 0, samples: [] },
        eng10: { label: 'ENG-10 Lighthouse CI', status: 'skip' },
        eng11: { label: 'ENG-11 Orphaned Sidebar IDs', status: 'pass' },
        eng12: { label: 'ENG-12 i18n Build', status: 'skip' },
        eng13: { label: 'ENG-13 CSP Configured', status: 'warn' },
        eng14: { label: 'ENG-14 Security Audit', status: 'skip' }
      }
    }
  };
}

test('gatekeeper derives CI sections from engineering test status when detailed artifacts are absent', () => {
  const result = runGatekeeper(reportWithEngineering());
  assert.equal(result.lighthouseCI.source, 'engineering.tests.eng10');
  assert.equal(result.playwrightE2E.source, 'engineering.tests.eng08');
  assert.equal(result.dependencies.source, 'engineering.tests.eng14');
  assert.equal(result.lighthouseCI.performance, null);
  assert.equal(result.playwrightE2E.chromium, 'SKIP');
});

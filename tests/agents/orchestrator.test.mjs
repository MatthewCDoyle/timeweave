import test from 'node:test';
import assert from 'node:assert/strict';
import { runOrchestrator } from '../../src/agents/orchestrator/orchestrator.mjs';

function baseReport() {
  return {
    aggregate: {
      totalDocs: 2,
      placeholders: { docsWithPlaceholders: 0 },
      seoHealth: { hasTitle: 2, hasDescription: 2 },
      avgCompleteness: 1,
    },
    frontmatterHealth: {
      completionRate: 0.5,
    },
    docs: [
      { frontmatter: { title: 'A', description: 'A', slug: '/a' } },
      { frontmatter: { title: 'B', description: 'B' } },
    ],
  };
}

test('orchestrator blocks release when frontmatter completion is below threshold', () => {
  const result = runOrchestrator(baseReport(), {});
  assert.equal(result.releaseReady, false);
  assert.equal(result.buildStatus, 'FAILING');
  assert.ok(result.criticalAlerts.some((a) => String(a.category).includes('Frontmatter Completion')));
});

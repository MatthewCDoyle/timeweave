import React from 'react';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const quickStartSteps = [
  'Browse the relationship map to see how technologies influence one another over time.',
  'Use PILLAR to focus on a domain and SEARCH to find specific concepts quickly.',
  'Click any node or timeline card to open the full entry and follow related links.',
  'Use ZOOM and path highlighting to inspect predecessor and successor chains.',
  'Clear filters to return to discovery mode and view logarithmic timeline density.',
];

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>TimeWeave</p>
        <h1 className={styles.title}>A futures timeline with relationship-aware navigation</h1>
        <p className={styles.subtitle}>
          Explore how technologies emerge, converge, and evolve across eras using a logarithmic
          timeline and an interactive dependency map.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} to="/timeline-view">
            Open Timeline
          </Link>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Overview</h2>
        <p>
          The timeline is designed to show more detail where change is fastest. Older eras are
          summarized at lower density, while near-future years surface more entries and deeper
          relationship context.
        </p>
        <p>
          Each entry is part of a connected graph. You can trace predecessors, enablement effects,
          and evolution paths to understand how one breakthrough leads to another.
        </p>
      </section>

      <section className={styles.panel}>
        <h2>How To Use The Timeline</h2>
        <ol className={styles.steps}>
          {quickStartSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

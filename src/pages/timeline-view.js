import React from 'react';
import Layout from '@theme/Layout';
import TimeWeave from '../components/TimeWeave';

export default function TimelineViewPage() {
  return (
    <Layout title="Timeline" description="Browse timeline cards with a full-width layout.">
      <main className="container margin-vert--lg">
        <TimeWeave showRelationshipMap={false} />
      </main>
    </Layout>
  );
}

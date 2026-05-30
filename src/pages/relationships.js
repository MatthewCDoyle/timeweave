import React from 'react';
import Layout from '@theme/Layout';
import TimeWeave from '../components/TimeWeave';

export default function RelationshipsPage() {
  return (
    <Layout title="Relationship Flow Map" description="Explore technology relationship paths without timeline card clutter.">
      <main className="container margin-vert--lg">
        <TimeWeave showTimelineCards={false} />
      </main>
    </Layout>
  );
}

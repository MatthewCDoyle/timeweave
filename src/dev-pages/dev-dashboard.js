/**
 * src/dev-pages/dev-dashboard.js
 * ============================================================================
 * Developer Dashboard page loaded only when BUILD_DEV=true or in local dev.
 * This file is intentionally outside src/pages so production builds do not
 * register the route.
 */

import React from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';

export default function DevDashboardPage() {
  return (
    <Layout
      title="Dev Dashboard"
      description="Developer dashboard — build report, schema intelligence, SEO health, and more."
      noFooter={false}
    >
      {/* BrowserOnly ensures the dashboard (which fetches JSON) only runs in the browser */}
      <BrowserOnly fallback={<div style={{ padding: '2rem' }}>Loading dashboard...</div>}>
        {() => {
          // Dynamic import keeps the heavy DevDashboard component out of the SSR bundle.
          const DevDashboard = require('@site/src/components/DevDashboard/index.jsx').default;
          return <DevDashboard />;
        }}
      </BrowserOnly>
    </Layout>
  );
}

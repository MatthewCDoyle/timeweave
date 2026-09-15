import {themes as prismThemes} from 'prism-react-renderer';

const isDevBuild = process.env.NODE_ENV !== 'production' || process.env.BUILD_DEV === 'true';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Timeweave',
  tagline: 'Timeline',
  future: {
    v4: true,
  },
  url: 'https://example.com',
  baseUrl: '/',
  organizationName: 'MatthewCDoyle',
  projectName: 'timeweave',
  onBrokenLinks: 'throw',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: false,
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      },
    ],
  ],
  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'timeline',
        path: 'docs/timeline',
        routeBasePath: 'timeline',
        sidebarPath: './sidebars-timeline.js',
      },
    ],
    ...(isDevBuild ? [
      [
        '@docusaurus/plugin-content-pages',
        {
          id: 'dev-pages',
          path: 'src/dev-pages',
          routeBasePath: '/',
        },
      ],
    ] : []),
  ],
  customFields: {
    // Dashboard is disabled for production/internal builds unless BUILD_DEV=true.
    isDev: isDevBuild,
  },
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Timeweave',
        items: [
          {
            to: '/timeline-view',
            position: 'left',
            label: 'Timeline',
          },
          {
            to: '/relationships',
            position: 'left',
            label: 'Relationships',
          },
          ...(isDevBuild ? [
            {
              to: '/dev-dashboard',
              position: 'right',
              label: 'Developer Tools',
              className: 'button button--secondary button--sm',
            },
          ] : []),
        ],
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;

import {themes as prismThemes} from 'prism-react-renderer';

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
  ],
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
            type: 'docSidebar',
            docsPluginId: 'timeline',
            sidebarId: 'timelineSidebar',
            position: 'left',
            label: 'Timeline',
          },
        ],
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;

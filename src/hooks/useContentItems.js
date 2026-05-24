import {useMemo} from 'react';
import useGlobalData from '@docusaurus/useGlobalData';

export default function useContentItems() {
  const globalData = useGlobalData();

  return useMemo(() => {
    const timelinePlugin = globalData['docusaurus-plugin-content-docs']?.timeline;
    const docs = timelinePlugin?.versions?.[0]?.docs ?? [];

    return docs
      .filter((doc) => doc.id !== 'index')
      .map((doc) => {
        const frontMatter = doc.frontMatter ?? {};

        return {
          id: doc.id,
          title: frontMatter.title || doc.title,
          description: frontMatter.description || '',
          date: frontMatter.date || '',
          href: doc.path,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [globalData]);
}

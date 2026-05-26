import {useMemo} from 'react';
import {useAllDocsData} from '@docusaurus/plugin-content-docs/client';
import docsMetadata from '../data/docs-metadata.json';
import metapatternCatalog from '../data/metapatterns.json';
import pillarsCatalog from '../data/pillars.json';

function normalizePillarKey(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

const pillarAliasMap = Object.entries(pillarsCatalog || {}).reduce((map, [pillarId, definition]) => {
  const canonical = normalizePillarKey(pillarId);
  if (!canonical) {
    return map;
  }

  map.set(canonical, pillarId);
  const aliases = Array.isArray(definition?.aliases) ? definition.aliases : [];
  aliases.forEach((alias) => {
    const normalizedAlias = normalizePillarKey(alias);
    if (normalizedAlias) {
      map.set(normalizedAlias, pillarId);
    }
  });

  return map;
}, new Map());

function normalizeLinks(rawLinks = [], relatedContent = []) {
  const typedLinks = Array.isArray(rawLinks)
    ? rawLinks
        .filter((link) => link && typeof link.targetId === 'string')
        .map((link) => ({
          type: typeof link.type === 'string' ? link.type : 'related',
          targetId: link.targetId,
          strength: typeof link.strength === 'number' ? link.strength : undefined,
          rationale: typeof link.rationale === 'string' ? link.rationale : undefined,
        }))
    : [];

  const fallbackLinks = Array.isArray(relatedContent)
    ? relatedContent
        .filter((targetId) => typeof targetId === 'string' && targetId.length > 0)
        .map((targetId) => ({ type: 'related', targetId }))
    : [];

  const deduped = new Map();
  [...typedLinks, ...fallbackLinks].forEach((link) => {
    const key = `${link.type}:${link.targetId}`;
    if (!deduped.has(key)) {
      deduped.set(key, link);
    }
  });

  return Array.from(deduped.values());
}

function normalizeTimeline(rawTimeline) {
  if (!rawTimeline || typeof rawTimeline !== 'object') {
    return null;
  }

  const startYear = Number(rawTimeline.startYear ?? rawTimeline.year);
  const endYear = Number(rawTimeline.endYear ?? rawTimeline.year ?? rawTimeline.startYear);

  if (!Number.isFinite(startYear)) {
    return null;
  }

  return {
    startYear,
    endYear: Number.isFinite(endYear) ? endYear : startYear,
    year: startYear,
    quarter: rawTimeline.quarter || null,
    era: rawTimeline.era || null,
    precision: rawTimeline.precision || 'year',
    significance: rawTimeline.significance || null,
    category: rawTimeline.category || null,
    confidence: typeof rawTimeline.confidence === 'number' ? rawTimeline.confidence : null,
  };
}

function normalizeMetapatterns(rawMetapatterns = []) {
  if (!Array.isArray(rawMetapatterns)) {
    return [];
  }

  return rawMetapatterns
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry };
      }

      if (entry && typeof entry.id === 'string') {
        return {
          id: entry.id,
          role: typeof entry.role === 'string' ? entry.role : undefined,
          note: typeof entry.note === 'string' ? entry.note : undefined,
        };
      }

      return null;
    })
    .filter((entry) => entry && entry.id.trim().length > 0)
    .map((entry) => ({ ...entry, id: entry.id.trim() }));
}

function normalizeEvolutionLinks(evolution = {}) {
  if (!evolution || typeof evolution !== 'object') {
    return [];
  }

  const evolvesFrom = Array.isArray(evolution.evolvesFrom) ? evolution.evolvesFrom : [];
  const enablesNext = Array.isArray(evolution.enablesNext) ? evolution.enablesNext : [];

  return [
    ...evolvesFrom
      .filter((targetId) => typeof targetId === 'string' && targetId.length > 0)
      .map((targetId) => ({ type: 'evolves-from', targetId })),
    ...enablesNext
      .filter((targetId) => typeof targetId === 'string' && targetId.length > 0)
      .map((targetId) => ({ type: 'enables-next', targetId })),
  ];
}

function normalizeCategories(rawCategories, primaryTopic, timelineCategory) {
  const categories = [];

  if (Array.isArray(rawCategories)) {
    categories.push(...rawCategories);
  }

  if (typeof primaryTopic === 'string' && primaryTopic.length > 0) {
    categories.push(primaryTopic);
  }

  if (typeof timelineCategory === 'string' && timelineCategory.length > 0) {
    categories.push(timelineCategory);
  }

  const cleaned = categories
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  return Array.from(new Set(cleaned));
}

function normalizePillars(rawPillars = [], fallbackCategories = []) {
  const hasExplicitPillars = Array.isArray(rawPillars) && rawPillars.length > 0;
  const source = hasExplicitPillars ? rawPillars : fallbackCategories;
  const unknown = [];
  const resolved = [];

  source.forEach((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return;
    }

    const normalized = normalizePillarKey(value);
    const pillarId = pillarAliasMap.get(normalized);
    if (pillarId) {
      resolved.push(pillarId);
    } else if (hasExplicitPillars) {
      unknown.push(value.trim());
    }
  });

  return {
    pillars: Array.from(new Set(resolved)),
    unknown,
  };
}

export function useContentItems(instanceId = 'timeline') {
  const allDocsData = useAllDocsData();

  return useMemo(() => {
    const docsPlugin = allDocsData?.[instanceId];
    const docs = docsPlugin?.versions?.[0]?.docs ?? [];

    const entries = docs
      .filter((doc) => doc.id !== 'index')
      .map((doc) => {
        const metadata = docsMetadata[doc.id] ?? {};
        const sourceFrontMatter = doc.frontMatter ?? {};
        const timeline = normalizeTimeline(sourceFrontMatter.timeline || metadata.timeline);
        const primaryTopic = sourceFrontMatter.primaryTopic || metadata.primaryTopic || 'General';
        const categories = normalizeCategories(
          sourceFrontMatter.categories,
          primaryTopic,
          timeline?.category,
        );
        const normalizedPillars = normalizePillars(sourceFrontMatter.pillars, categories);
        const relationshipLinks = normalizeLinks(sourceFrontMatter.links, sourceFrontMatter.relatedContent);
        const evolutionLinks = normalizeEvolutionLinks(sourceFrontMatter.evolution);
        const links = normalizeLinks(
          [...relationshipLinks, ...evolutionLinks],
          [],
        );
        const metapatterns = normalizeMetapatterns(sourceFrontMatter.metapatterns);
        const tags = Array.isArray(sourceFrontMatter.tags)
          ? sourceFrontMatter.tags
          : Array.isArray(metadata.tags)
            ? metadata.tags
            : categories;

        const frontMatter = {
          title: sourceFrontMatter.title || metadata.title || doc.title || doc.id,
          description: sourceFrontMatter.description || metadata.description || '',
          primaryTopic,
          categories,
          tags,
          timeline,
          pillars: normalizedPillars.pillars,
          links,
          metapatterns,
          evolution: sourceFrontMatter.evolution || null,
          date: sourceFrontMatter.date || metadata.date || null,
        };

        return {
          id: doc.id,
          title: frontMatter.title,
          permalink: doc.permalink || doc.path,
          path: doc.path,
          frontMatter,
          unknownPillars: normalizedPillars.unknown,
        };
      })
      .sort((firstItem, secondItem) => {
        const firstYear = firstItem.frontMatter.timeline?.startYear || 0;
        const secondYear = secondItem.frontMatter.timeline?.startYear || 0;
        return firstYear - secondYear;
      });

    const knownIds = new Set(entries.map((entry) => entry.id));
    entries.forEach((entry) => {
      (entry.frontMatter.links || []).forEach((link) => {
        if (!knownIds.has(link.targetId)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[timeline] ${entry.id} links to missing targetId: ${link.targetId}`,
          );
        }
      });

      (entry.frontMatter.metapatterns || []).forEach((metapattern) => {
        if (!metapatternCatalog[metapattern.id]) {
          // eslint-disable-next-line no-console
          console.warn(
            `[timeline] ${entry.id} uses unknown metapattern id: ${metapattern.id}`,
          );
        }
      });

      (entry.unknownPillars || []).forEach((pillarValue) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[timeline] ${entry.id} uses unknown pillar id: ${pillarValue}`,
        );
      });
    });

    return entries;
  }, [allDocsData, instanceId]);
}

export default useContentItems;

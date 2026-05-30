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

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeUncertaintyRange(rawRange) {
  if (!rawRange || typeof rawRange !== 'object') {
    return null;
  }

  const p10 = toFiniteNumber(rawRange.p10);
  const p25 = toFiniteNumber(rawRange.p25);
  const p50 = toFiniteNumber(rawRange.p50 ?? rawRange.p50Year ?? rawRange.p50_year);
  const p75 = toFiniteNumber(rawRange.p75);
  const p90 = toFiniteNumber(rawRange.p90);

  if (!Number.isFinite(p10) || !Number.isFinite(p50) || !Number.isFinite(p90)) {
    return null;
  }

  return {
    p10,
    p25,
    p50,
    p75,
    p90,
  };
}

function normalizeScenarioForecasts(rawScenarioForecasts = []) {
  if (!Array.isArray(rawScenarioForecasts)) {
    return [];
  }

  return rawScenarioForecasts
    .map((scenario) => {
      if (!scenario || typeof scenario !== 'object') {
        return null;
      }

      const p50Year = toFiniteNumber(scenario.p50Year ?? scenario.p50_year);
      const probability = toFiniteNumber(scenario.probability);

      if (!Number.isFinite(p50Year)) {
        return null;
      }

      return {
        scenario: typeof scenario.scenario === 'string' ? scenario.scenario : 'stagnation',
        probability: Number.isFinite(probability) ? probability : null,
        p50Year,
        uncertaintyRange: normalizeUncertaintyRange(scenario.uncertaintyRange),
        description: typeof scenario.description === 'string' ? scenario.description : undefined,
      };
    })
    .filter(Boolean);
}

function normalizeForecast(rawForecast) {
  if (!rawForecast || typeof rawForecast !== 'object') {
    return null;
  }

  const timing = rawForecast.timing && typeof rawForecast.timing === 'object'
    ? rawForecast.timing
    : {};
  const uncertaintyRange = normalizeUncertaintyRange(
    timing.uncertaintyRange || rawForecast.uncertaintyRange,
  );
  const directP50 = toFiniteNumber(rawForecast.p50Year ?? rawForecast.p50_year);
  const timingP50 = toFiniteNumber(uncertaintyRange?.p50);
  const p50Year = timingP50 ?? directP50;

  if (!Number.isFinite(p50Year)) {
    return null;
  }

  const confidence = toFiniteNumber(rawForecast.confidence);
  const predictiveHorizon = toFiniteNumber(rawForecast.predictiveHorizon ?? rawForecast.predictive_horizon);

  return {
    eventId: rawForecast.eventId || rawForecast.event_id || null,
    p50Year,
    confidence,
    predictiveHorizon,
    forecastStatus:
      typeof rawForecast.forecastStatus === 'string'
        ? rawForecast.forecastStatus
        : typeof rawForecast.forecast_status === 'string'
          ? rawForecast.forecast_status
          : null,
    claimStrengthLevel:
      typeof rawForecast.claimStrengthLevel === 'string'
        ? rawForecast.claimStrengthLevel
        : typeof rawForecast.claim_strength_level === 'string'
          ? rawForecast.claim_strength_level
          : null,
    generatedAt:
      rawForecast.generated_at || rawForecast.generatedAt || rawForecast.updatedAt || rawForecast.createdAt || null,
    timing: {
      uncertaintyRange: uncertaintyRange || {
        p10: p50Year,
        p25: null,
        p50: p50Year,
        p75: null,
        p90: p50Year,
      },
    },
    scenarioForecasts: normalizeScenarioForecasts(rawForecast.scenarioForecasts),
    modelBreakdown: Array.isArray(rawForecast.modelBreakdown)
      ? rawForecast.modelBreakdown
      : Array.isArray(rawForecast.model_breakdown)
        ? rawForecast.model_breakdown
        : [],
  };
}

function normalizeDependencies(rawDependencies = []) {
  if (!Array.isArray(rawDependencies)) {
    return [];
  }

  return rawDependencies
    .map((edge) => {
      if (!edge || typeof edge !== 'object') {
        return null;
      }

      const sourceEventId = edge.sourceEventId || edge.source_event_id;
      const targetEventId = edge.targetEventId || edge.target_event_id;

      if (typeof sourceEventId !== 'string' || typeof targetEventId !== 'string') {
        return null;
      }

      return {
        sourceEventId,
        targetEventId,
        dependencyType:
          typeof edge.dependencyType === 'string'
            ? edge.dependencyType
            : typeof edge.type === 'string'
              ? edge.type
              : 'enabling',
        strength: toFiniteNumber(edge.strength),
        lagTime: toFiniteNumber(edge.lagTime ?? edge.lag_time),
        description: typeof edge.description === 'string' ? edge.description : undefined,
      };
    })
    .filter(Boolean);
}

function normalizeLeadingIndicators(rawIndicators = []) {
  if (!Array.isArray(rawIndicators)) {
    return [];
  }

  return rawIndicators
    .map((indicator) => {
      if (!indicator || typeof indicator !== 'object') {
        return null;
      }

      const indicatorId = indicator.indicatorId || indicator.indicator_id;
      const name = indicator.name;

      if (typeof indicatorId !== 'string' || typeof name !== 'string') {
        return null;
      }

      return {
        indicatorId,
        name,
        source: typeof indicator.source === 'string' ? indicator.source : null,
        frequency: typeof indicator.frequency === 'string' ? indicator.frequency : null,
        expectedTrend:
          typeof indicator.expectedTrend === 'string'
            ? indicator.expectedTrend
            : typeof indicator.expected_trend === 'string'
              ? indicator.expected_trend
              : null,
        correlationWithEvent: toFiniteNumber(
          indicator.correlationWithEvent ?? indicator.correlation_with_event,
        ),
        latestValue: toFiniteNumber(indicator.latestValue ?? indicator.latest_value),
        latestDate: indicator.latestDate || indicator.latest_date || null,
        trendVector: toFiniteNumber(indicator.trendVector ?? indicator.trend_vector),
      };
    })
    .filter(Boolean);
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

function getDocIdCandidates(doc = {}) {
  const values = [doc.id, doc.unversionedId, doc.slug, doc.path]
    .filter((value) => typeof value === 'string' && value.length > 0);

  const candidates = new Set();
  values.forEach((value) => {
    candidates.add(value);
    const segments = value.split('/').filter(Boolean);
    if (segments.length > 0) {
      candidates.add(segments[segments.length - 1]);
    }
  });

  return Array.from(candidates);
}

function resolveDocMetadata(doc = {}) {
  const candidates = getDocIdCandidates(doc);
  for (const candidate of candidates) {
    if (docsMetadata[candidate]) {
      return docsMetadata[candidate];
    }
  }

  return {};
}

function resolveEntryId(doc = {}, sourceFrontMatter = {}) {
  if (typeof sourceFrontMatter.id === 'string' && sourceFrontMatter.id.trim().length > 0) {
    return sourceFrontMatter.id.trim();
  }

  if (typeof doc.unversionedId === 'string' && doc.unversionedId.trim().length > 0) {
    return doc.unversionedId.trim();
  }

  if (typeof doc.id === 'string' && doc.id.trim().length > 0) {
    const normalized = doc.id.trim();
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1];
    }
    return normalized;
  }

  return '';
}

export function useContentItems(instanceId = 'timeline') {
  const allDocsData = useAllDocsData();

  return useMemo(() => {
    const docsPlugin = allDocsData?.[instanceId];
    const docs = docsPlugin?.versions?.[0]?.docs ?? [];

    const entries = docs
      .filter((doc) => doc.id !== 'index')
      .map((doc) => {
        const metadata = resolveDocMetadata(doc);
        const sourceFrontMatter = doc.frontMatter ?? {};
        const normalizedForecast = normalizeForecast(sourceFrontMatter.forecast || metadata.forecast);
        const forecastTimelineFallback = normalizeTimeline({
          startYear: normalizedForecast?.p50Year,
          year: normalizedForecast?.p50Year,
          precision: 'year',
          significance: 'prediction',
          category: sourceFrontMatter.primaryTopic || metadata.primaryTopic || 'technology',
        });
        const timeline = normalizeTimeline(sourceFrontMatter.timeline || metadata.timeline) || forecastTimelineFallback;
        const primaryTopic = sourceFrontMatter.primaryTopic || metadata.primaryTopic || 'General';
        const categories = normalizeCategories(
          sourceFrontMatter.categories,
          primaryTopic,
          timeline?.category,
        );
        const normalizedPillars = normalizePillars(sourceFrontMatter.pillars, categories);
        const relationshipLinks = normalizeLinks(sourceFrontMatter.links, sourceFrontMatter.relatedContent);
        const evolutionLinks = normalizeEvolutionLinks(sourceFrontMatter.evolution);
        const dependencies = normalizeDependencies(
          sourceFrontMatter.dependencies || metadata.dependencies,
        );
        const leadingIndicators = normalizeLeadingIndicators(
          sourceFrontMatter.leadingIndicators || metadata.leadingIndicators,
        );
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
          forecast: normalizedForecast,
          dependencies,
          leadingIndicators,
          date: sourceFrontMatter.date || metadata.date || null,
        };

        const entryId = resolveEntryId(doc, sourceFrontMatter);

        return {
          id: entryId,
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

      (entry.frontMatter.dependencies || []).forEach((dependency) => {
        if (!knownIds.has(dependency.targetEventId)) {
          // eslint-disable-next-line no-console
          console.warn(
            `[timeline] ${entry.id} dependency target is missing: ${dependency.targetEventId}`,
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

      const forecastRange = entry.frontMatter.forecast?.timing?.uncertaintyRange;
      if (
        forecastRange &&
        Number.isFinite(forecastRange.p10) &&
        Number.isFinite(forecastRange.p50) &&
        Number.isFinite(forecastRange.p90) &&
        (forecastRange.p10 > forecastRange.p50 || forecastRange.p50 > forecastRange.p90)
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `[timeline] ${entry.id} forecast uncertainty range is not ordered (p10 <= p50 <= p90).`,
        );
      }

      const scenarioForecasts = entry.frontMatter.forecast?.scenarioForecasts || [];
      if (scenarioForecasts.length > 0) {
        const probabilitySum = scenarioForecasts
          .map((scenario) => scenario.probability)
          .filter((value) => Number.isFinite(value))
          .reduce((sum, value) => sum + value, 0);

        if (Math.abs(1 - probabilitySum) > 0.05) {
          // eslint-disable-next-line no-console
          console.warn(
            `[timeline] ${entry.id} scenario probabilities sum to ${probabilitySum.toFixed(2)} (expected ~1.00).`,
          );
        }
      }
    });

    return entries;
  }, [allDocsData, instanceId]);
}

export default useContentItems;

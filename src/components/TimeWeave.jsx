import React, { useState, useMemo, useRef } from 'react';
import styles from './TimeWeave.module.css';
import { useContentItems } from '../hooks/useContentItems';
import pillarsCatalog from '../data/pillars.json';

const formatPillarLabel = (pillarId) => {
  const definition = pillarsCatalog[pillarId];
  if (definition?.label) {
    return definition.label;
  }

  return String(pillarId || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getPillarColor = (pillarId) => pillarsCatalog[pillarId]?.color || '#6B4C9A';

const pillarGlyphMap = {
  ai: 'AI',
  'xr-vr-ar-holography': 'XR',
  'immersive-tech': 'IM',
  'wearables-implantables': 'WB',
  nanotech: 'NA',
  'printing-nanofabrication': '3D',
  'advanced-materials': 'AM',
  biotechnology: 'BT',
  neurotechnology: 'NE',
  'robotics-autonomous-systems': 'RB',
  'autonomous-vehicles': 'AV',
  'smart-cities': 'SC',
  'internet-of-things': 'IoT',
  blockchain: 'BC',
  energy: 'EN',
  'marine-oceanic-tech': 'OC',
  agrotechnology: 'AG',
  'climate-geoengineering': 'CL',
  'space-colonization': 'SP',
  transhumanism: 'TH',
  'quantum-technologies': 'QN',
};

const getPillarGlyph = (pillarId) => {
  const mapped = pillarGlyphMap[pillarId];
  if (mapped) {
    return mapped;
  }

  const fallback = String(pillarId || '')
    .split('-')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return fallback || 'TL';
};

const classifyEdgeTone = (type) => {
  if (type === 'depends-on' || type === 'accelerated-by') {
    return 'dependency';
  }

  if (type === 'enables' || type === 'enables-next') {
    return 'enablement';
  }

  if (type === 'evolves-from' || type === 'influences') {
    return 'evolution';
  }

  return 'convergence';
};

const formatEdgeTypeLabel = (type) => {
  const value = String(type || 'related').replace(/-/g, ' ');
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const TimeWeave = ({ showRelationshipMap = true, showTimelineCards = true }) => {
  const items = useContentItems('timeline');
  const [activeFilters, setActiveFilters] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPillar, setSelectedPillar] = useState('all');
  const [mapZoom, setMapZoom] = useState(100);
  const [focusedNodeId, setFocusedNodeId] = useState(null);
  const [showDrilldownTree, setShowDrilldownTree] = useState(false);
  const [treeDepth, setTreeDepth] = useState(2);
  const mapSectionRef = useRef(null);

  // Transform timeline items into card format
  const allCards = useMemo(() => {
    return items
      .filter((item) => {
        const timelineYear = Number(item.frontMatter?.timeline?.startYear);
        const forecastRange = item.frontMatter?.forecast?.timing?.uncertaintyRange;
        const forecastP50 = Number(item.frontMatter?.forecast?.p50Year ?? forecastRange?.p50);

        return Number.isFinite(timelineYear) || Number.isFinite(forecastP50);
      })
      .map(item => {
        const fm = item.frontMatter;
        const timeline = fm.timeline || {};
        const forecastRange = fm.forecast?.timing?.uncertaintyRange;
        const forecastP50 = Number(fm.forecast?.p50Year ?? forecastRange?.p50);
        const fallbackYear = Number.isFinite(forecastP50) ? Math.round(forecastP50) : null;
        const eventYear = Number.isFinite(timeline.startYear) ? timeline.startYear : fallbackYear;
        const pillars = Array.isArray(fm.pillars) ? fm.pillars : [];
        const primaryPillarId = pillars[0] || null;
        const categories = Array.isArray(fm.categories)
          ? fm.categories
          : [timeline.category || fm.primaryTopic || 'General'];
        const category = Array.isArray(fm.categories) && fm.categories.length > 0
          ? fm.categories[0]
          : timeline.category || fm.primaryTopic || 'General';
        
        const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
        
        return {
          category: String(category).toUpperCase(),
          year: eventYear,
          id: item.id,
          title: fm.title || item.title,
          sub: fm.description || '',
          lab: capitalize(timeline.significance || (Number.isFinite(forecastP50) ? 'forecast' : 'prediction')),
          tags: Array.isArray(fm.tags) ? fm.tags.slice(0, 2).map(capitalize) : [capitalize(fm.primaryTopic || 'General')],
          categories: categories.map(value => String(value).toLowerCase()),
          pillars,
          primaryPillarId,
          primaryPillarLabel: primaryPillarId ? formatPillarLabel(primaryPillarId) : null,
          primaryPillarColor: getPillarColor(primaryPillarId),
          links: Array.isArray(fm.links) ? fm.links : [],
          dependencies: Array.isArray(fm.dependencies) ? fm.dependencies : [],
          leadingIndicators: Array.isArray(fm.leadingIndicators) ? fm.leadingIndicators : [],
          forecast: fm.forecast || null,
          forecastP50,
          forecastP10: Number(forecastRange?.p10),
          forecastP90: Number(forecastRange?.p90),
          forecastConfidence: Number(fm.forecast?.confidence),
          scenarioCount: Array.isArray(fm.forecast?.scenarioForecasts) ? fm.forecast.scenarioForecasts.length : 0,
          linksCount: Array.isArray(fm.links) ? fm.links.length : 0,
          dependenciesCount: Array.isArray(fm.dependencies) ? fm.dependencies.length : 0,
          indicatorsCount: Array.isArray(fm.leadingIndicators) ? fm.leadingIndicators.length : 0,
          metapatternsCount: Array.isArray(fm.metapatterns) ? fm.metapatterns.length : 0,
          slug: item.permalink
        };
      })
      .sort((a, b) => a.year - b.year);
  }, [items]);

  const filteredCards = useMemo(() => {
    return allCards.filter(card => {
      const matchesFilter = activeFilters.length === 0 || 
        card.tags.some(tag => activeFilters.includes(tag));
      
      const matchesSearch = searchQuery === '' ||
        card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.lab.toLowerCase().includes(searchQuery.toLowerCase()) ||
        card.sub.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (card.forecast?.forecastStatus || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesFilter && matchesSearch;
    }).sort((a, b) => a.year - b.year);
  }, [activeFilters, searchQuery, allCards]);

  const visibleCards = filteredCards;

  const availablePillars = useMemo(() => {
    const values = new Set();
    allCards.forEach((card) => {
      (card.pillars || []).forEach((pillarId) => values.add(pillarId));
    });

    return Array.from(values).sort((a, b) => {
      const orderA = Number(pillarsCatalog[a]?.order || Number.MAX_SAFE_INTEGER);
      const orderB = Number(pillarsCatalog[b]?.order || Number.MAX_SAFE_INTEGER);
      return orderA - orderB || a.localeCompare(b);
    });
  }, [allCards]);

  const pillarCounts = useMemo(() => {
    const counts = new Map();
    filteredCards.forEach((card) => {
      (card.pillars || []).forEach((pillarId) => {
        counts.set(pillarId, (counts.get(pillarId) || 0) + 1);
      });
    });

    return counts;
  }, [filteredCards]);

  const relationshipMap = useMemo(() => {
    const nodes = filteredCards;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = [];

    nodes.forEach((sourceNode) => {
      (sourceNode.links || []).forEach((link) => {
        const targetNode = byId.get(link.targetId);
        if (targetNode) {
          edges.push({
            id: `${sourceNode.id}->${targetNode.id}:${link.type || 'related'}`,
            sourceId: sourceNode.id,
            targetId: targetNode.id,
            type: link.type || 'related',
          });
        }
      });
    });

    const allIds = new Set(nodes.map((node) => node.id));
    const pillarMatches = selectedPillar === 'all'
      ? new Set(allIds)
      : new Set(
          nodes
            .filter((node) => (node.pillars || []).includes(selectedPillar))
            .map((node) => node.id),
        );

    const relatedToPillar = new Set(pillarMatches);
    edges.forEach((edge) => {
      if (pillarMatches.has(edge.sourceId) || pillarMatches.has(edge.targetId)) {
        relatedToPillar.add(edge.sourceId);
        relatedToPillar.add(edge.targetId);
      }
    });

    const effectiveFocusId = focusedNodeId && byId.has(focusedNodeId)
      ? focusedNodeId
      : (Array.from(pillarMatches)[0] || nodes[0]?.id || null);

    const adjacency = new Map();
    edges.forEach((edge) => {
      const sourceNeighbors = adjacency.get(edge.sourceId) || [];
      sourceNeighbors.push(edge.targetId);
      adjacency.set(edge.sourceId, sourceNeighbors);

      const targetNeighbors = adjacency.get(edge.targetId) || [];
      targetNeighbors.push(edge.sourceId);
      adjacency.set(edge.targetId, targetNeighbors);
    });

    const activePathIds = new Set();
    if (effectiveFocusId) {
      const queue = [effectiveFocusId];
      activePathIds.add(effectiveFocusId);

      while (queue.length > 0) {
        const nodeId = queue.shift();
        const neighbors = adjacency.get(nodeId) || [];

        neighbors.forEach((neighborId) => {
          if (!activePathIds.has(neighborId) && relatedToPillar.has(neighborId)) {
            activePathIds.add(neighborId);
            queue.push(neighborId);
          }
        });
      }
    }

    const minYear = nodes.length > 0 ? Math.min(...nodes.map((node) => node.year)) : 1800;
    const maxYear = nodes.length > 0 ? Math.max(...nodes.map((node) => node.year)) : 2100;
    const yearSpan = Math.max(1, maxYear - minYear);
    const laneOrder = selectedPillar === 'all'
      ? availablePillars
      : [selectedPillar, ...availablePillars.filter((pillarId) => pillarId !== selectedPillar)];
    const laneMap = new Map(laneOrder.map((pillarId, index) => [pillarId, index % 4]));
    const laneCount = 4;
    const laneHeight = 120;

    const positionedNodes = nodes
      .slice()
      .sort((firstNode, secondNode) => firstNode.year - secondNode.year)
      .map((node) => {
        const lane = laneMap.get(node.primaryPillarId) || 0;
        const laneStep = laneCount > 1 ? laneHeight / (laneCount - 1) : 0;
        const y = 42 + (lane * laneStep);
        const yPercent = (y / 180) * 100;
        const xPercent = ((node.year - minYear) / yearSpan) * 100;
        const isDimmed = selectedPillar !== 'all' && !relatedToPillar.has(node.id);

        return {
          ...node,
          xPercent,
          y,
          yPercent,
          isDimmed,
          isInPath: activePathIds.has(node.id),
          isFocused: node.id === effectiveFocusId,
          pillarColor: node.primaryPillarColor,
        };
      });

    const nodesById = new Map(positionedNodes.map((node) => [node.id, node]));
    const positionedEdges = edges.map((edge) => {
      const source = nodesById.get(edge.sourceId);
      const target = nodesById.get(edge.targetId);
      const isPathEdge = activePathIds.has(edge.sourceId) && activePathIds.has(edge.targetId);
      const isDimmed = Boolean(source?.isDimmed || target?.isDimmed);
      const tone = classifyEdgeTone(edge.type);

      return {
        ...edge,
        source,
        target,
        tone,
        isPathEdge,
        isDimmed,
      };
    }).filter((edge) => edge.source && edge.target);

    const predecessorCount = effectiveFocusId
      ? positionedEdges.filter((edge) => edge.targetId === effectiveFocusId).length
      : 0;
    const successorCount = effectiveFocusId
      ? positionedEdges.filter((edge) => edge.sourceId === effectiveFocusId).length
      : 0;

    return {
      nodes: positionedNodes,
      edges: positionedEdges,
      minYear,
      maxYear,
      focusedId: effectiveFocusId,
      predecessorCount,
      successorCount,
      focusedTitle: effectiveFocusId ? byId.get(effectiveFocusId)?.title : null,
    };
  }, [availablePillars, filteredCards, focusedNodeId, selectedPillar]);

  const relationshipTree = useMemo(() => {
    const nodeById = new Map(relationshipMap.nodes.map((node) => [node.id, node]));
    const incoming = new Map();
    const outgoing = new Map();

    relationshipMap.edges.forEach((edge) => {
      const sourceList = outgoing.get(edge.sourceId) || [];
      sourceList.push({
        nodeId: edge.targetId,
        type: edge.type,
      });
      outgoing.set(edge.sourceId, sourceList);

      const targetList = incoming.get(edge.targetId) || [];
      targetList.push({
        nodeId: edge.sourceId,
        type: edge.type,
      });
      incoming.set(edge.targetId, targetList);
    });

    const focusId = relationshipMap.focusedId;
    if (!focusId || !nodeById.has(focusId)) {
      return { root: null, precursors: [], successors: [] };
    }

    const maxDepth = treeDepth;
    const maxChildren = 6;

    const buildBranch = (nodeId, direction, depth, visited, pathKey, fromEdgeType) => {
      const node = nodeById.get(nodeId);
      if (!node) {
        return null;
      }

      const adjacentRefs = direction === 'upstream'
        ? (incoming.get(nodeId) || [])
        : (outgoing.get(nodeId) || []);

      const nextChildren = [];
      if (depth < maxDepth) {
        adjacentRefs.slice(0, maxChildren).forEach((adjacentRef) => {
          const adjacentId = adjacentRef.nodeId;
          if (visited.has(adjacentId)) {
            return;
          }

          const nextVisited = new Set(visited);
          nextVisited.add(adjacentId);
          const child = buildBranch(
            adjacentId,
            direction,
            depth + 1,
            nextVisited,
            `${pathKey}>${adjacentId}`,
            adjacentRef.type,
          );

          if (child) {
            nextChildren.push(child);
          }
        });
      }

      return {
        id: node.id,
        title: node.title,
        year: node.year,
        pillarColor: node.pillarColor,
        pathKey,
        fromEdgeType,
        fromEdgeTone: classifyEdgeTone(fromEdgeType),
        hasMore: adjacentRefs.length > maxChildren,
        children: nextChildren,
      };
    };

    const rootNode = nodeById.get(focusId);
    const precursorRefs = incoming.get(focusId) || [];
    const successorRefs = outgoing.get(focusId) || [];

    return {
      root: {
        id: rootNode.id,
        title: rootNode.title,
        year: rootNode.year,
        pillarColor: rootNode.pillarColor,
      },
      precursors: precursorRefs.slice(0, maxChildren).map((refValue) => (
        buildBranch(
          refValue.nodeId,
          'upstream',
          1,
          new Set([focusId, refValue.nodeId]),
          `p:${focusId}>${refValue.nodeId}`,
          refValue.type,
        )
      )).filter(Boolean),
      successors: successorRefs.slice(0, maxChildren).map((refValue) => (
        buildBranch(
          refValue.nodeId,
          'downstream',
          1,
          new Set([focusId, refValue.nodeId]),
          `s:${focusId}>${refValue.nodeId}`,
          refValue.type,
        )
      )).filter(Boolean),
      hasMorePrecursors: precursorRefs.length > maxChildren,
      hasMoreSuccessors: successorRefs.length > maxChildren,
    };
  }, [relationshipMap, treeDepth]);

  const handleTreeNodeJump = (nodeId) => {
    setFocusedNodeId(nodeId);
    if (mapSectionRef.current) {
      mapSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const renderTreeBranch = (branch) => {
    return (
      <li key={branch.pathKey} className={styles.treeNodeItem}>
        <div className={styles.treeNodeRow}>
          {branch.fromEdgeType && (
            <span
              className={[
                styles.treeEdgeBadge,
                branch.fromEdgeTone === 'dependency' ? styles.treeEdgeBadgeDependency : '',
                branch.fromEdgeTone === 'enablement' ? styles.treeEdgeBadgeEnablement : '',
                branch.fromEdgeTone === 'evolution' ? styles.treeEdgeBadgeEvolution : '',
                branch.fromEdgeTone === 'convergence' ? styles.treeEdgeBadgeConvergence : '',
              ].join(' ')}
            >
              {formatEdgeTypeLabel(branch.fromEdgeType)}
            </span>
          )}
          <div className={styles.treeNodeCard} style={{ '--pillar-color': branch.pillarColor }}>
            <strong>{branch.title}</strong>
            <span>{branch.year}</span>
          </div>
          <button
            type="button"
            className={styles.treeJumpButton}
            onClick={() => handleTreeNodeJump(branch.id)}
          >
            Focus in map
          </button>
        </div>
        {branch.children.length > 0 && (
          <ul className={styles.treeList}>
            {branch.children.map((child) => renderTreeBranch(child))}
          </ul>
        )}
        {branch.hasMore && (
          <div className={styles.treeMoreHint}>More related nodes available...</div>
        )}
      </li>
    );
  };

  const mapTickYears = useMemo(() => {
    const { minYear, maxYear } = relationshipMap;
    if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) {
      return [];
    }

    const span = maxYear - minYear;
    const steps = 4;
    return Array.from({ length: steps + 1 }).map((_, index) => {
      if (index === 0) {
        return minYear;
      }

      if (index === steps) {
        return maxYear;
      }

      return Math.round(minYear + ((span * index) / steps));
    });
  }, [relationshipMap]);

  const scrollCards = (direction) => {
    const container = document.querySelector('.timeweave-cards-container');
    if (container) {
      const scrollAmount = 300;
      container.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
    }
  };

  const handleCardClick = (slug) => {
    window.location.href = slug;
  };

  const handleTimeClick = (range) => {
    alert(`Viewing ${range.name}: ${range.start} - ${range.end}`);
  };

  const currentYear = new Date().getFullYear();
  const timelineStart = 1800;
  const timelineEnd = 2500;
  const progressPercent = ((currentYear - timelineStart) / (timelineEnd - timelineStart)) * 100;

  const timeRanges = [
    { name: 'PAST', start: 17000, end: 2000 },
    { name: 'PRESENT', start: 2000, end: new Date().getFullYear() },
    { name: 'FUTURE', start: 2050, end: 2500 }
  ];

  // Historical milestones for every 250 years
  const historicalCheckpoints = {
    1800: 'Industrial Age',
    2050: 'Neo Renaissance',
    2300: 'Space Colonization',
    2500: 'Post-Human Era'
  };

  return (
    <div className={styles.container}>
      {/* Header Section */}
      <div className={styles.header}>
        <div className={styles.title}>TIMEWEAVE</div>
        <div className={styles.timeIndicators}>
          <button className={styles.timeLink} onClick={() => handleTimeClick(timeRanges[0])}>
            [ Past ]
          </button>
          <button className={styles.timeLinkActive} onClick={() => handleTimeClick(timeRanges[1])}>
            [[ Present ]]
          </button>
          <button className={styles.timeLink} onClick={() => handleTimeClick(timeRanges[2])}>
            [ Future ]
          </button>
        </div>
      </div>

      {/* Era Title */}
      <div className={styles.eraTitle}>
        ERA: THE NEAR FUTURE (2030 - 2050)
      </div>

      {/* Results Count */}
      {showTimelineCards && searchQuery && (
        <div className={styles.resultCount}>
          Found {visibleCards.length} result{visibleCards.length !== 1 ? 's' : ''} for "{searchQuery}"
        </div>
      )}

      {showRelationshipMap && (
      <section ref={mapSectionRef} className={styles.linkMapSection} aria-label="Technology relationship map">
        <div className={styles.linkMapToolbar}>
          <span className={styles.linkMapLabel}>[ TW ] TIMEWEAVE | PILLAR:</span>
          <select
            className={styles.mapSelect}
            value={selectedPillar}
            onChange={(event) => {
              setSelectedPillar(event.target.value);
              setFocusedNodeId(null);
            }}
          >
            <option value="all">ALL</option>
            {availablePillars.map((pillar) => (
              <option key={pillar} value={pillar}>{formatPillarLabel(pillar).toUpperCase()}</option>
            ))}
          </select>
          <label className={styles.mapSearchWrap}>
            <span>SEARCH:</span>
            <input
              className={styles.mapSearch}
              type="text"
              placeholder="technology"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <label className={styles.mapZoomWrap}>
            <span>ZOOM:</span>
            <input
              className={styles.mapZoom}
              type="range"
              min="75"
              max="200"
              step="5"
              value={mapZoom}
              onChange={(event) => setMapZoom(Number(event.target.value))}
            />
            <span>{mapZoom}%</span>
          </label>
        </div>

        <div className={styles.pillarStrip}>
          <button
            type="button"
            className={`${styles.pillarFilterButton} ${selectedPillar === 'all' ? styles.pillarFilterButtonActive : ''}`}
            onClick={() => {
              setSelectedPillar('all');
              setFocusedNodeId(null);
            }}
          >
            ALL ({filteredCards.length})
          </button>
          {availablePillars.map((pillar) => (
            <button
              key={pillar}
              type="button"
              className={`${styles.pillarFilterButton} ${selectedPillar === pillar ? styles.pillarFilterButtonActive : ''}`}
              style={{ '--pillar-color': getPillarColor(pillar) }}
              onClick={() => {
                setSelectedPillar(pillar);
                setFocusedNodeId(null);
              }}
            >
              <span className={styles.pillarFilterIcon} aria-hidden="true">{getPillarGlyph(pillar)}</span>
              {formatPillarLabel(pillar)} ({pillarCounts.get(pillar) || 0})
            </button>
          ))}
        </div>

        <div className={styles.linkMapHeader}>
          <h2 className={styles.linkMapTitle}>Relationship Flow Map</h2>
          <p className={styles.linkMapSubtitle}>
            Top strip shows the full event index over time. Middle lanes show expanded technologies and their relationship paths.
          </p>
        </div>

        <div className={styles.linkMapViewport}>
          <div className={styles.linkMapCanvas} style={{ width: `${mapZoom}%` }}>
            <div className={styles.mapLaneHints} aria-hidden="true">
              <span className={styles.mapLaneHintTop}>INDEX STRIP</span>
              <span className={styles.mapLaneHintMiddle}>RELATIONSHIP LANES</span>
            </div>

            <div className={styles.mapYearTicks}>
              {mapTickYears.map((year) => (
                <span key={year}>{year}</span>
              ))}
            </div>

            <svg className={styles.linkMapSvg} viewBox="0 0 100 180" preserveAspectRatio="none">
              <defs>
                <marker id="edge-arrow-dependency" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L8,4 L0,8 Z" className={`${styles.edgeArrow} ${styles.edgeArrowDependency}`} />
                </marker>
                <marker id="edge-arrow-enablement" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L8,4 L0,8 Z" className={`${styles.edgeArrow} ${styles.edgeArrowEnablement}`} />
                </marker>
                <marker id="edge-arrow-evolution" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L8,4 L0,8 Z" className={`${styles.edgeArrow} ${styles.edgeArrowEvolution}`} />
                </marker>
                <marker id="edge-arrow-convergence" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L8,4 L0,8 Z" className={`${styles.edgeArrow} ${styles.edgeArrowConvergence}`} />
                </marker>
              </defs>

              {relationshipMap.edges.map((edge) => {
                const { source, target } = edge;
                const controlOffset = Math.max(8, Math.abs(target.xPercent - source.xPercent) * 0.35);
                const path = `M ${source.xPercent} ${source.y} C ${source.xPercent + controlOffset} ${source.y - 12}, ${target.xPercent - controlOffset} ${target.y - 12}, ${target.xPercent} ${target.y}`;
                const markerId = `edge-arrow-${edge.tone}`;

                return (
                  <path
                    key={edge.id}
                    d={path}
                    className={[
                      styles.linkEdge,
                      edge.tone === 'dependency' ? styles.linkEdgeDependency : '',
                      edge.tone === 'enablement' ? styles.linkEdgeEnablement : '',
                      edge.tone === 'evolution' ? styles.linkEdgeEvolution : '',
                      edge.tone === 'convergence' ? styles.linkEdgeConvergence : '',
                      edge.isPathEdge ? styles.linkEdgeActive : '',
                      edge.isDimmed ? styles.linkEdgeDim : '',
                    ].join(' ')}
                    markerEnd={`url(#${markerId})`}
                  />
                );
              })}
            </svg>

            {relationshipMap.nodes.map((node) => (
              <button
                key={node.id}
                className={[
                  styles.linkNode,
                  node.isInPath ? styles.linkNodeActive : '',
                  node.isDimmed ? styles.linkNodeDim : '',
                  node.isFocused ? styles.linkNodeFocused : '',
                ].join(' ')}
                style={{ left: `${node.xPercent}%`, top: `${node.yPercent}%`, '--pillar-color': node.pillarColor }}
                onClick={() => setFocusedNodeId(node.id)}
                title={`${node.title} (${node.year})`}
              >
                <span className={styles.linkNodeIcon} aria-hidden="true">{getPillarGlyph(node.primaryPillarId)}</span>
                <span className={styles.linkNodeText}>{node.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.linkMapStats}>
          STATS: [ {relationshipMap.predecessorCount} Precursors ] [ {relationshipMap.successorCount} Successors ] [ Highlight: {relationshipMap.focusedTitle || 'None'} ]
        </div>
        <div className={styles.linkMapLegend}>
          <span className={`${styles.legendItem} ${styles.legendDependency}`}>Depends / Accelerated</span>
          <span className={`${styles.legendItem} ${styles.legendEnablement}`}>Enables</span>
          <span className={`${styles.legendItem} ${styles.legendEvolution}`}>Evolves / Influences</span>
          <span className={`${styles.legendItem} ${styles.legendConvergence}`}>Converges / Related</span>
        </div>

        <div className={styles.drilldownToggleRow}>
          <button
            type="button"
            className={styles.drilldownToggleButton}
            onClick={() => setShowDrilldownTree((value) => !value)}
          >
            {showDrilldownTree ? 'Hide' : 'Show'} Drill-down Tree
          </button>
          <span className={styles.drilldownFocusLabel}>
            Focused: {relationshipMap.focusedTitle || 'None'}
          </span>
          <label className={styles.drilldownDepthWrap}>
            <span>Depth:</span>
            <select
              className={styles.drilldownDepthSelect}
              value={treeDepth}
              onChange={(event) => setTreeDepth(Number(event.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
        </div>

        {showDrilldownTree && relationshipTree.root && (
          <div className={styles.drilldownTreePanel}>
            <h3 className={styles.drilldownTreeTitle}>Relationship Drill-down Tree</h3>
            <p className={styles.drilldownTreeSubtitle}>
              On-demand vertical detail view for the selected node. Click nodes in the map to change focus.
            </p>

            <div className={styles.treeRootWrap}>
              <div className={styles.treeNodeRow}>
                <div className={styles.treeRootCard} style={{ '--pillar-color': relationshipTree.root.pillarColor }}>
                  <strong>{relationshipTree.root.title}</strong>
                  <span>{relationshipTree.root.year}</span>
                </div>
                <button
                  type="button"
                  className={styles.treeJumpButton}
                  onClick={() => handleTreeNodeJump(relationshipTree.root.id)}
                >
                  Focus in map
                </button>
              </div>
            </div>

            <div className={styles.treeColumns}>
              <div className={styles.treeColumn}>
                <h4>Precursors</h4>
                {relationshipTree.precursors.length > 0 ? (
                  <ul className={styles.treeList}>
                    {relationshipTree.precursors.map((branch) => renderTreeBranch(branch))}
                  </ul>
                ) : (
                  <p className={styles.treeEmpty}>No upstream relationships in current filter.</p>
                )}
                {relationshipTree.hasMorePrecursors && (
                  <div className={styles.treeMoreHint}>Additional precursor branches are hidden.</div>
                )}
              </div>

              <div className={styles.treeColumn}>
                <h4>Successors</h4>
                {relationshipTree.successors.length > 0 ? (
                  <ul className={styles.treeList}>
                    {relationshipTree.successors.map((branch) => renderTreeBranch(branch))}
                  </ul>
                ) : (
                  <p className={styles.treeEmpty}>No downstream relationships in current filter.</p>
                )}
                {relationshipTree.hasMoreSuccessors && (
                  <div className={styles.treeMoreHint}>Additional successor branches are hidden.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
      )}

      {showTimelineCards && (
      <>
      {/* Card Carousel Section */}
      <div className={styles.carouselSection}>
        <button className={styles.navButton} onClick={() => scrollCards('left')} title="Previous">
          ←
        </button>

        <div className={styles.cardsWrapper}>
          <div className="timeweave-cards-container" style={{
            display: 'flex',
            gap: '1.5rem',
            overflowX: 'auto',
            paddingBottom: '1rem',
            scrollBehavior: 'smooth',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}>
            {visibleCards.length > 0 ? (
              visibleCards.map((card, idx) => (
                <div key={idx} className={styles.cardWrapper}>
                  {/* Card */}
                  <div className={styles.card} onClick={() => handleCardClick(card.slug)}>
                    {/* Card Header */}
                    <div className={styles.cardHeader}>
                      <span>| {card.category}</span>
                      <span>{card.year} |</span>
                    </div>

                    {/* Card Content */}
                    <div className={styles.cardContent}>
                      <div className={styles.cardTitle}>{card.title}</div>
                      <div className={styles.cardSubtitle}>{card.sub}</div>
                    </div>

                    {card.pillars.length > 0 && (
                      <div className={styles.cardPillars}>
                        {card.pillars.slice(0, 2).map((pillarId) => (
                          <button
                            key={pillarId}
                            type="button"
                            className={styles.pillarChip}
                            style={{ '--pillar-color': getPillarColor(pillarId) }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPillar(pillarId);
                              setFocusedNodeId(card.id);
                            }}
                            title={formatPillarLabel(pillarId)}
                          >
                            <span className={styles.pillarChipIcon} aria-hidden="true">{getPillarGlyph(pillarId)}</span>
                            {formatPillarLabel(pillarId)}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Card Tags */}
                    <div className={styles.cardTags}>
                      {card.tags.map((tag, tagIdx) => (
                        <button
                          key={tagIdx}
                          className={styles.tagButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveFilters([tag]);
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>

                    {/* Card Footer */}
                    <div className={styles.cardFooter}>
                      <div>Lab: {card.lab}</div>
                      {Number.isFinite(card.forecastP50) && <div>Forecast p50: {Math.round(card.forecastP50)}</div>}
                      {Number.isFinite(card.forecastP10) && Number.isFinite(card.forecastP90) && (
                        <div>Range: {Math.round(card.forecastP10)}-{Math.round(card.forecastP90)}</div>
                      )}
                      {Number.isFinite(card.forecastConfidence) && (
                        <div>Confidence: {Math.round(card.forecastConfidence * 100)}%</div>
                      )}
                      {card.linksCount > 0 && <div>Links: {card.linksCount}</div>}
                      {card.dependenciesCount > 0 && <div>Dependencies: {card.dependenciesCount}</div>}
                      {card.indicatorsCount > 0 && <div>Indicators: {card.indicatorsCount}</div>}
                      {card.scenarioCount > 0 && <div>Scenarios: {card.scenarioCount}</div>}
                      {card.metapatternsCount > 0 && <div>Patterns: {card.metapatternsCount}</div>}
                    </div>
                  </div>

                  {/* Ripple Effect Label */}
                  <div className={styles.rippleEffect}>( Ripple Effect )</div>
                </div>
              ))
            ) : (

              <div className={styles.noResults}>
                No technologies match your filters.
              </div>
            )}
          </div>
        </div>

        <button className={styles.navButton} onClick={() => scrollCards('right')} title="Next">
          →
        </button>
      </div>

      {/* Timeline Section */}
      <div className={styles.progressSection}>
        {/* Timeline bar */}
        <div className={styles.timelineBar}>
          {/* Historical checkpoints and granular markers */}
          {Array.from({ length: Math.floor((timelineEnd - timelineStart) / 50) + 1 }).map((_, idx) => {
            const year = timelineStart + idx * 50;
            const position = ((year - timelineStart) / (timelineEnd - timelineStart)) * 100;
            const isMajor = year % 250 === 0;
            
            return (
              <div
                key={idx}
                className={styles.yearMarker}
                style={{ left: `${position}%` }}
              >
                <div className={isMajor ? styles.markerTickMajor : styles.markerTick} />
                {isMajor && (
                  <>
                    <div className={styles.markerLabel}>{year}</div>
                    {historicalCheckpoints[year] && (
                      <div className={styles.historicalLabel}>{historicalCheckpoints[year]}</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {/* Progress indicator */}
          <div 
            className={styles.progressIndicator}
            style={{ left: `${progressPercent}%` }}
          >
            <div className={styles.indicatorDot}>💎</div>
            <div className={styles.indicatorLabel}>{currentYear}</div>
          </div>
        </div>
        <div className={styles.timelineLabel}>TIMELINE</div>
      </div>
      </>
      )}
    </div>
  );
}

export default TimeWeave;

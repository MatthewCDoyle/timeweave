# timeweave

This repository hosts a Docusaurus site for the Timeline tab feature.

## Design Principles

### Information Density Model

The timeline follows a logarithmic information density rule: as users move toward the "future" end of the timeline, card frequency should increase to reflect accelerating change.

- Deep Past (3.5B years ago - 1800): Epoch-defining events. Target density: ~1 card per era or major millennium.
- Industrial Era (1800 - 2000): Infrastructure-defining events. Target density: ~1-2 cards per decade.
- Now and Near Future (2020 - 2050): Convergence-defining events. Target density: ~3-5 cards per year.
- Deep Future (2060+): Speculative-defining events. Target density: ~1 card per 5-year jump.

Example event types by era:

- Deep Past: controlled fire, printing press.
- Industrial Era: steam engine, transistor.
- Now and Near Future: mRNA vaccines, room-temperature superconductors, AGI milestones.
- Deep Future: Dyson swarm fragments, post-biological consciousness.

### Timeline Entry Model (Markdown-First)

Each timeline item should be a single markdown file in docs/timeline with frontmatter as the source of truth.

Core frontmatter fields:

- title: string
- slug: string
- pillars: string[] (canonical technology pillar IDs; preferred domain taxonomy)
- categories: string[] (supports multi-category timeline entries)
- tags: string[] (keyword-level discovery)
- timeline.startYear: number (required for timeline placement)
- timeline.endYear: number (optional range end)
- timeline.precision: "year" | "range" | "decade" | "era"
- timeline.era: "deep-past" | "industrial" | "near-future" | "deep-future"
- timeline.significance: string (example: foundation, trend, prediction)
- links: [{ type, targetId, strength?, rationale? }] (typed relationships to other markdown entries)
- evolution.evolvesFrom: string[] (upstream entries this item developed from)
- evolution.enablesNext: string[] (downstream entries this item evolves into)
- metapatterns: [{ id, role?, note? }] (cross-era dynamics attached to each entry)

Notes:

- Keep one markdown file per timeline entry.
- Timeline placement and primary filtering remain date-first via timeline.startYear (and timeline.endYear where relevant).
- Pillars are a secondary facet for optional filtering/grouping and must be provided as an array.
- Use stable doc ids for links.targetId values so relationships remain valid over time.
- relatedContent remains supported as a backward-compatible fallback and is auto-converted into typed related links.
- Pillars are normalized through src/data/pillars.json aliases. Existing entries without pillars fall back to categories during loading.

Canonical pillar IDs (src/data/pillars.json):

- ai
- xr-vr-ar-holography
- immersive-tech
- wearables-implantables
- nanotech
- printing-nanofabrication
- advanced-materials
- biotechnology
- neurotechnology
- robotics-autonomous-systems
- autonomous-vehicles
- smart-cities
- internet-of-things
- blockchain
- energy
- marine-oceanic-tech
- agrotechnology
- climate-geoengineering
- space-colonization
- transhumanism
- quantum-technologies

### Metapattern Considerations

Track these metapatterns in entry frontmatter using metapatterns[].id and metapatterns[].note:

- acceleration: Note whether this entry compresses innovation cycle time for downstream systems.
- convergence: Document which domains merge and what new capability appears at the intersection.
- abstraction-layers: Describe underlying dependencies and which higher-level behaviors become easier.
- scale-expansion: Capture the primary impact scale and whether the entry unlocks expansion to a larger scale.
- information-centrality: Explain the sensing, model, and feedback loops that make the system effective.
- biological-digital-merger: Identify where biological states couple directly with digital control or inference.
- energy-requirements: Record energy intensity, constraints, and infrastructure needed for deployment.
- existential-inflection: Mark high-uncertainty boundaries where forecasts branch or lose reliability.

## Development

```bash
nvm use
npm install
npm run start
```

## Build

```bash
npm run build
```

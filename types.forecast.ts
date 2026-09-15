/**
 * Forecast Types for Timeline Predictive Modeling
 * Extends core event types with prediction-specific fields
 */

// ============================================================================
// PREDICTION TARGETS (Section 1 of Plan)
// ============================================================================

export enum PredictionTargetType {
  EVENT_TIMING = "event_timing",           // When will this happen?
  EVENT_PROBABILITY = "event_probability", // How likely by year X?
  DEPENDENCY_IMPACT = "dependency_impact", // How does A affect B?
  SCENARIO_PATH = "scenario_path"          // What future branches are plausible?
}

// ============================================================================
// FORECAST STATUS TRACKING
// ============================================================================

export enum ForecastStatus {
  HISTORICAL = "historical",           // Event already occurred
  ACTIVE_FORECAST = "active-forecast", // Actively predicting
  RESOLVED = "resolved",               // Prediction tested/accurate
  RETIRED = "retired",                 // Prediction abandoned (no longer valid)
  PAUSED = "paused"                    // Temporarily not forecasting
}

export enum ClaimStrengthLevel {
  LEVEL_1_UNFALSIFIABLE = "level-1-unfalsifiable",  // Unfalsifiable by definition
  LEVEL_2_CONFIDENT = "level-2-confident",          // High confidence, testable
  LEVEL_3_SPECULATIVE = "level-3-speculative",      // Speculative, exploration
  LEVEL_4_EXCLUDED = "level-4-excluded"             // Too speculative, removed
}

// ============================================================================
// PREDICTIVE FEATURES (Section 3 of Plan)
// ============================================================================

export interface TechnicalSignals {
  mooresLawTracker?: number;           // chip_density as % of theoretical max
  publicationAcceleration?: number;    // papers_per_year
  citationVelocity?: number;           // how fast citations grow (citations/year²)
  patentGrantRate?: number;            // approved_patents/year
  clinicalTrialVelocity?: number;      // months_per_phase
  costCurveSlope?: number;             // (cost_2023 - cost_2020) / 3
  performanceCurveSlope?: number;      // (perf_2023 - perf_2020) / 3
  capabilitySaturation?: number;       // 0–1, are we hitting diminishing returns?
}

export interface EcosystemSignals {
  regulatoryIndex?: number;             // 0–1, how much regulation hinders?
  ventureCapitalFlow?: number;          // millions_per_year
  talentPoolSize?: number;              // researcher_count
  supplyChainConstraint?: number;       // 0–1, bottleneck severity
  geopoliticalRisk?: number;            // 0–1, sanctions/export controls
  macroEconomicIndex?: number;          // 0–1, capital availability
}

export interface GraphSignals {
  dependencyCriticality?: number;       // (num_downstream_events * avg_impact)
  predecessorCompletion?: number;       // completed / total_prereqs
  temporalClustering?: number;          // (events_near_this_date / time_window)
  bifurcationEntropy?: number;          // degree_of_competing_paths (0–1)
  nodePageRank?: number;                // centrality in dependency graph
  cascadeMultiplier?: number;           // how many events shift if this one does?
}

export interface PredictiveFeatures {
  technical?: TechnicalSignals;
  ecosystem?: EcosystemSignals;
  graph?: GraphSignals;
  lastUpdated: Date;
  dataQualityScore: number;            // 0–1, confidence in signal quality
  missingSignalFlags: string[];        // Which signals are unavailable?
}

// ============================================================================
// UNCERTAINTY QUANTIFICATION
// ============================================================================

export interface UncertaintyRange {
  p10: number;                          // 10th percentile (pessimistic)
  p25: number;                          // 25th percentile
  p50: number;                          // median (most likely)
  p75: number;                          // 75th percentile
  p90: number;                          // 90th percentile (optimistic)
}

export interface AleatoricUncertainty {
  magnitude: number;                    // std dev of inherent randomness
  source: string;                       // e.g., "clinical trial stochasticity"
  estimatedFrom: string;                // which data informed this?
}

export interface EpistemicUncertainty {
  magnitude: number;                    // std dev of knowledge gaps
  source: string;                       // e.g., "limited historical data"
  confidence: number;                   // 0–1, how sure are we about this uncertainty?
}

export interface UncertaintyQuantification {
  aleatoric?: AleatoricUncertainty;
  epistemic?: EpistemicUncertainty;
  modelDisagreement?: number;           // 0–1, how much do models disagree?
  totalUncertainty: number;             // combined std dev
  confidenceDecayHalfLife?: number;     // years until confidence drops 50%
}

// ============================================================================
// UPDATE HISTORY & DRIFT DETECTION
// ============================================================================

export interface ForecastUpdate {
  timestamp: Date;
  oldP50: number;
  newP50: number;
  reason: string;                       // Why did forecast shift?
  triggeringSignals: string[];          // Which signals caused update?
  modelVersion: string;
  author?: string;
}

export interface DriftDetection {
  expectedSignalRange: [number, number]; // [min, max] expected signal strength
  observedSignal: number;               // actual observed signal strength
  status: "normal" | "anomalous" | "diverging";  // How different from expected?
  anomalyScore: number;                 // 0–1, severity of divergence
  explanation?: string;                 // Why is it anomalous?
  lastChecked: Date;
}

// ============================================================================
// FORECAST CORE SCHEMA (Section 2 of Plan)
// ============================================================================

export interface Forecast {
  // Basic metadata
  eventId: string;                      // Link to parent event
  forecastId: string;                   // Unique forecast identifier
  createdAt: Date;
  updatedAt: Date;
  
  // Prediction windows
  baselineYear: number;                 // Reference year for forecasts (e.g., 2025)
  predictionWindow: [number, number];   // [earliest_year, latest_year]
  
  // Core predictions
  timing: {
    uncertaintyRange: UncertaintyRange;
    uncertainty: UncertaintyQuantification;
  };
  
  probability: {
    byYear: Map<number, number>;        // Probability by target year
    uncertainty: UncertaintyQuantification;
  };
  
  // Predictive features & signals
  features: PredictiveFeatures;
  
  // Status & metadata
  forecastStatus: ForecastStatus;
  claimStrengthLevel: ClaimStrengthLevel;
  confidence: number;                   // 0–1, overall confidence
  
  // Degradation & lifecycle
  degradationSignal: number;            // 0–1, how stale is this forecast?
  predictiveHorizon: number;            // years_ahead where forecast is still useful
  liveTestingPhase: boolean;            // Is this being validated?
  
  // Dependencies & cascades
  assumptionSet: string;                // e.g., "baseline-2025", "acceleration-scenario"
  driftDetection?: DriftDetection;
  
  // Audit trail
  updateHistory: ForecastUpdate[];
  evidenceLinks: EvidenceLink[];
  modelVersion: string;                 // Which version generated this?
  
  // Scenario-specific forecasts
  scenarioForecasts: ScenarioForecast[];
}

// ============================================================================
// SCENARIO MODELING (Section 2 Extension)
// ============================================================================

export enum ScenarioType {
  ACCELERATION = "acceleration",
  DISRUPTION = "disruption",
  STAGNATION = "stagnation",
  WILD_CARD = "wild-card"
}

export interface ScenarioForecast {
  scenario: ScenarioType;
  probability: number;                  // P(this scenario occurs)
  p50Year: number;                      // When in this scenario?
  uncertaintyRange: UncertaintyRange;
  triggeringEvents: string[];           // What events cause this scenario?
  cascadeEffects: CascadeEffect[];      // What else shifts?
  description: string;
}

export interface ScenarioSet {
  scenarioId: string;
  name: string;
  description: string;
  forecasts: ScenarioForecast[];
  probabilitySum: number;               // Should sum to 1.0
  createdAt: Date;
  assumptions: string[];
}

// ============================================================================
// DEPENDENCY & CASCADE MODELING (Section 4 Extension)
// ============================================================================

export enum DependencyType {
  ENABLING = "enabling",                // B requires A to happen first
  ACCELERATING = "accelerating",        // B happens faster if A happens
  INHIBITING = "inhibiting",            // B is delayed if A happens
  ALTERNATIVE = "alternative",          // A and B are mutually exclusive
  AMPLIFYING = "amplifying"             // A and B reinforce each other (feedback loop)
}

export interface DependencyEdge {
  sourceEventId: string;                // Event A
  targetEventId: string;                // Event B
  dependencyType: DependencyType;
  strength: number;                     // 0–1, how strong is the dependency?
  lagTime: number;                      // years between source and target
  cascadeMultiplier?: number;           // How much does source change propagate?
  mutuallyExclusive?: boolean;          // Can both happen?
  feedbackLoop?: boolean;               // Is this part of a cycle?
}

export interface CascadeEffect {
  affectedEventId: string;
  deltaYears: number;                   // How many years earlier/later?
  confidenceDelta: number;              // How much does confidence change?
  explanation: string;
  distance: number;                     // hops in dependency graph
}

export interface TemporalCouplingMatrix {
  eventIds: string[];
  couplingStrengths: number[][];        // [i][j] = coupling strength from i to j
  eigenvalues?: number[];               // For stability analysis
  dominantModes?: string[][];           // Which couplings dominate?
  feedbackLoops?: string[][];           // Detected cycles
}

// ============================================================================
// LEADING INDICATORS & REAL-TIME UPDATING
// ============================================================================

export interface LeadingIndicator {
  indicatorId: string;
  name: string;
  eventId: string;                      // Which event does this predict?
  source: string;                       // Data source (API, scraper, human)
  frequency: "daily" | "weekly" | "monthly" | "annual";
  expectedTrend: "upward" | "downward" | "stable" | "cyclic";
  correlationWithEvent: number;         // 0–1, based on historical data
  description: string;
  
  // Current state
  latestValue?: number;
  latestDate?: Date;
  trendVector?: number;                 // Rate of change
  
  // Prediction contribution
  predictedContribution?: {
    deltaYears: number;                 // "This indicator suggests event is X years ahead"
    confidence: number;
    explanation: string;
  };
}

export interface LeadingIndicatorSnapshot {
  indicatorId: string;
  timestamp: Date;
  value: number;
  anomalyScore: number;                 // 0–1, how unusual is this value?
  trendAcceleration: number;            // Is trend speeding up/down?
}

// ============================================================================
// FAILURE MODE ANALYSIS
// ============================================================================

export enum FailureMode {
  TECHNOLOGY_CEILING = "technology-ceiling",
  BIFURCATION = "bifurcation",
  EXOGENOUS_DISRUPTION = "exogenous-disruption",
  ECONOMIC_DECOUPLING = "economic-decoupling",
  REGULATORY_TRAP = "regulatory-trap",
  SUPPLY_CHAIN_COLLAPSE = "supply-chain-collapse",
  TALENT_SATURATION = "talent-saturation",
  FUNDAMENTAL_PHYSICS_LIMIT = "fundamental-physics-limit"
}

export interface FailureModeDefinition {
  mode: FailureMode;
  description: string;
  probability: number;                  // P(this failure mode occurs)
  estimatedImpact: number;              // years of delay
  earlyWarningSignals: string[];        // What to monitor?
  detectionThreshold: number;           // When to trigger contingency?
  contingencyForecast?: Forecast;       // Re-forecast if triggered
}

export interface ExogenousShock {
  shockId: string;
  type: "positive" | "negative" | "structural";
  description: string;
  probability: number;                  // per decade
  affectedEventIds: string[];           // Which events does this shock?
  cascadeEffects: CascadeEffect[];
  timeWindow?: [number, number];        // When could this occur?
}

// ============================================================================
// CALIBRATION & VALIDATION
// ============================================================================

export interface CalibrationMetrics {
  brierScore: number;                   // Probability quality (lower is better)
  calibrationError: number;             // Are 70% predictions true ~70% of the time?
  meanAbsoluteError: number;            // years, for timing predictions
  sharpness: number;                    // How narrow are probability ranges?
  logLoss?: number;                     // Cross-entropy loss
  
  // Breakdown by domain
  byDomain: Map<string, CalibrationMetrics>;
  byTimeHorizon: Map<number, CalibrationMetrics>;  // Decade-ahead buckets
  
  // Model-specific calibration
  byModel: Map<string, CalibrationMetrics>;
  
  lastValidated: Date;
  sampleSize: number;                   // How many predictions tested?
  testDataRange: [number, number];      // [start_year, end_year] of test set
}

export interface CalibrationCurve {
  bins: Array<{
    predictedProb: number;              // e.g., 0.7
    observedFreq: number;               // actual % true
    sampleSize: number;                 // how many predictions in this bin?
  }>;
  perfectCalibration: Array<[number, number]>; // Diagonal line for comparison
  overconfidenceAtExtremes: boolean;    // S-shaped vs. diagonal?
}

// ============================================================================
// ENSEMBLE & MODEL METADATA
// ============================================================================

export enum ModelType {
  BASELINE_STATISTICAL = "baseline-statistical",
  GRAPH_PROPAGATION = "graph-propagation",
  MONTE_CARLO_SCENARIO = "monte-carlo-scenario",
  EXPERT_PRIOR = "expert-prior"
}

export interface ModelWeighting {
  modelType: ModelType;
  weight: number;                       // 0–1, contribution to ensemble
  reasoning: string;
  applicableConditions: {               // When does this model dominate?
    dataQualityMin?: number;
    domainMaturityMin?: number;
    timeHorizonMax?: number;
  };
}

export interface EnsembleConfig {
  models: ModelWeighting[];
  blendingStrategy: "weighted-median" | "weighted-mean" | "learned-weights";
  disagreementThreshold: number;        // When to flag model disagreement
  reweightingStrategy?: "adaptive" | "fixed";
  reweightingCadence?: "weekly" | "monthly" | "quarterly";
}

// ============================================================================
// EVIDENCE & SOURCE TRACKING
// ============================================================================

export enum EvidenceQuality {
  PEER_REVIEWED = "peer-reviewed",
  EXPERT_ASSESSMENT = "expert-assessment",
  INDUSTRY_DATA = "industry-data",
  GOVERNMENT_DATA = "government-data",
  NEWS_REPORT = "news-report",
  FORECAST_PREDICTION = "forecast-prediction",
  SPECULATION = "speculation"
}

export interface EvidenceLink {
  url?: string;
  title: string;
  authors?: string[];
  publicationDate?: Date;
  quality: EvidenceQuality;
  relevance: number;                    // 0–1, how directly relevant?
  excerpt?: string;                     // Key quote or finding (max 150 chars)
  usedInModels: ModelType[];            // Which models used this evidence?
}

// ============================================================================
// VISUALIZATION & PRESENTATION SCHEMA
// ============================================================================

export interface VisualizationData {
  eventId: string;
  timelineData: {
    year: number;
    p10: number;
    p50: number;
    p90: number;
    confidence: number;
    aleatonicUncertainty: number;
    epistemicUncertainty: number;
    modelDisagreement: number;
  }[];
  
  scenarioData: Array<{
    scenario: ScenarioType;
    probability: number;
    timelineData: {
      year: number;
      p50: number;
    }[];
  }>;
  
  driverPanel: {
    technicalDriver: {
      name: string;
      influence: number;                // -1 to +1
      explanation: string;
    };
    ecosystemDriver: {
      name: string;
      influence: number;
      explanation: string;
    };
    graphDriver: {
      name: string;
      influence: number;
      explanation: string;
    };
  };
  
  sensitivityAnalysis: Array<{
    variable: string;
    perturbation: number;               // ±5 years, ±10%, etc.
    impactOnTiming: number;             // delta years
    impactOnProbability: number;        // delta probability
  }>;
}

// ============================================================================
// API RESPONSE SHAPES
// ============================================================================

export interface ForecastResponse {
  forecast: Forecast;
  visualization: VisualizationData;
  metadata: {
    generatedAt: Date;
    confidence: number;
    warnings: string[];
    nextUpdateScheduled: Date;
  };
}

export interface BatchForecastResponse {
  forecasts: ForecastResponse[];
  aggregatedMetrics: CalibrationMetrics;
  scenarioSummary: ScenarioSet[];
  dependencyGraph: DependencyEdge[];
  warnings: string[];
}

# Timeline Predictive Event Modeling - Integration Guide

## Overview

This package adds sophisticated predictive forecasting to your timeline repository. It includes:

- **TypeScript types** (`types.forecast.ts`) - Extend your event schema with forecast data
- **Python models** (`forecast_models.py`) - Statistical, graph-based, Monte Carlo, and expert prior models
- **Integration layer** (`timeline_integration.py`) - Connects forecasts to your timeline data
- **JSON configuration templates** - Schema extensions and dependency graphs
- **API specifications** - How to call the forecasting engine

---

## Quick Start (5 Minutes)

### 1. Copy Files to Your Repo

```bash
# From the ZIP root:
cp types.forecast.ts <your-timeline-repo>/src/types/
cp forecast_models.py <your-timeline-repo>/backend/
cp timeline_integration.py <your-timeline-repo>/backend/
cp INTEGRATION_SCHEMA.json <your-timeline-repo>/config/
cp dependencies.template.json <your-timeline-repo>/config/
```

### 2. Install Python Dependencies

```bash
pip install numpy scipy pandas --break-system-packages
```

### 3. Extend Your Event Schema

In your existing event type definition:

```typescript
// Before: your current event type
interface TimelineEvent {
  id: string;
  title: string;
  year: number;
  // ... existing fields
}

// After: with forecasting
import { Forecast, DependencyEdge } from './types/types.forecast';

interface TimelineEvent {
  id: string;
  title: string;
  year: number;
  // ... existing fields
  
  // NEW: Forecasting fields (optional)
  forecast?: Forecast;
  dependencies?: DependencyEdge[];
}
```

### 4. Initialize the Forecast Pipeline

```typescript
// In your backend initialization
import { ForecastPipeline } from './timeline_integration';

const pipeline = new ForecastPipeline({
  timelineDb: 'path/to/timeline_events.db',
  storageDir: './forecasts',
  indicatorsDir: './indicators',
  dependenciesFile: './config/dependencies.json'
});

// Generate forecast for an event
const forecast = pipeline.forecast_event('fusion-commercialization', {
  data_quality: 0.7,
  domain_maturity: 0.6,
  research_velocity: 1.2,
  research_effort: 100.0
});
```

---

## Architecture Overview

### Component 1: Types (TypeScript)

**File**: `types.forecast.ts` (18 KB)

Defines all data structures for forecasting:
- `Forecast` - Main forecast object with timing, probability, confidence
- `DependencyEdge` - Links between events (enabling, accelerating, inhibiting)
- `LeadingIndicator` - Measurable signals that predict events
- `ScenarioForecast` - Alternative future paths
- `CalibrationMetrics` - Validation statistics

**Where to use**:
```typescript
// In your API endpoints
app.get('/api/events/:id/forecast', async (req, res) => {
  const forecast: Forecast = await pipeline.forecast_event(req.params.id);
  res.json(forecast);
});
```

---

### Component 2: Models (Python)

**File**: `forecast_models.py` (24 KB)

Four complementary forecasting models:

#### A. Statistical Model (`StatisticalForecastModel`)
- Uses Weibull/lognormal distributions
- Best for: Fields with historical data, clear progress curves
- Example: Semiconductor progression, established tech timelines
- Input: Research velocity, effort, field maturity
- Output: p10/p50/p90 year estimate

#### B. Graph Model (`DependencyGraph`)
- Propagates forecast shifts through dependency cascades
- Best for: Tech with clear prerequisites (e.g., AI → quantum computing)
- Detects feedback loops (mutual acceleration)
- Input: Base forecast + upstream changes
- Output: Adjusted forecast accounting for dependencies

#### C. Monte Carlo Scenario Simulator (`ScenarioSimulator`)
- Branches predictions on key assumptions
- Four scenarios: Acceleration, Disruption, Stagnation, Wild Card
- Each scenario gets a probability
- Input: Base parameters + scenario overrides
- Output: Multiple timelines, blended probability

#### D. Expert Prior Model (`ExpertPriorModel`)
- Encodes domain expert judgment
- Best for: Sparse data, speculative tech (nanotech, AGI)
- Bayesian approach: prior gets updated with new evidence
- Input: Expert estimate + uncertainty range
- Output: Prior-based forecast (lower confidence)

#### Ensemble (`EnsembleForecaster`)
- Combines all 4 models with adaptive weighting
- Weights adjust based on context:
  - High data quality + mature domain → trust statistical model
  - Sparse data → lean on expert priors
  - Long-horizon predictions → spread confidence evenly
- Detects model disagreement (signals uncertainty)

**Usage in Python**:
```python
from forecast_models import EnsembleForecaster

forecaster = EnsembleForecaster()
result = forecaster.forecast(
    event_id="fusion-commercialization",
    data_quality=0.7,
    domain_maturity=0.6,
    research_velocity=1.2,
    research_effort=100.0
)

print(f"p50 year: {result.p50_year}")
print(f"Confidence: {result.confidence}")
print(f"Model disagreement: {result.model_disagreement}")
```

---

### Component 3: Integration Layer (Python)

**File**: `timeline_integration.py` (19 KB)

Orchestrates forecasting pipeline:

#### `TimelineEventAdapter`
- Reads events from your timeline database
- Extracts relevant signals (research velocity, etc.)

#### `ForecastRepository`
- Persists forecasts with versioning
- Maintains update history
- Enables rollback to previous forecasts

#### `LeadingIndicatorTracker`
- Registers measurable signals for each event
- Example: NIF energy gain, fusion patent count, venture funding
- Tracks values over time, detects anomalies
- Updates forecasts when signals diverge from expectations

#### `DependencyGraphManager`
- Loads and manages technology dependency graph
- Detects feedback loops, isolated events
- Computes cascade effects

#### `ForecastPipeline` (Main)
- Orchestrates everything
- `forecast_event()` - generates single forecast
- `run_batch_forecast()` - forecasts multiple events
- `calibrate_forecasts()` - validates against historical data

**Usage**:
```python
pipeline = ForecastPipeline(
    timeline_db="./timeline_events.db",
    storage_dir="./forecasts",
    indicators_dir="./indicators",
    dependencies_file="./config/dependencies.json"
)

# Single event
forecast = pipeline.forecast_event('fusion-2050')

# Batch
results = pipeline.run_batch_forecast(['fusion-2050', 'nanotech-2060', 'agi-2065'])

# Calibrate against history
metrics = pipeline.calibrate_forecasts([
    ('moon-landing', 1969),
    ('internet-adoption', 2000),
])
```

---

## Configuration Files (Templates Included)

### 1. `INTEGRATION_SCHEMA.json`

Extends your event schema with forecast fields:

```json
{
  "additions": {
    "forecast": {
      "type": "Forecast",
      "optional": true,
      "description": "Predictive forecast for event timing"
    },
    "dependencies": {
      "type": "DependencyEdge[]",
      "optional": true,
      "description": "Links to prerequisite/consequent events"
    },
    "leadingIndicators": {
      "type": "LeadingIndicator[]",
      "optional": true,
      "description": "Measurable signals that predict this event"
    }
  }
}
```

### 2. `dependencies.template.json`

Define technology dependency graph:

```json
{
  "nodes": {
    "fusion-commercialization": {
      "title": "Fusion Energy Commercialization",
      "category": "energy",
      "baseline_p50_year": 2050
    },
    "quantum-computing": {
      "title": "Quantum Computing Practical Advantage",
      "category": "computing",
      "baseline_p50_year": 2045
    }
  },
  "edges": [
    {
      "source": "fusion-commercialization",
      "target": "planetary-ai-coordination",
      "type": "accelerating",
      "strength": 0.7,
      "lag_time": 5,
      "description": "Fusion energy enables compute-intensive planetary AI systems"
    },
    {
      "source": "quantum-computing",
      "target": "drug-discovery-ai",
      "type": "enabling",
      "strength": 0.5,
      "lag_time": 2,
      "description": "Quantum computers needed for certain drug simulations"
    }
  ]
}
```

### 3. `leading_indicators.template.json`

Define signals to track for each event:

```json
{
  "indicators": [
    {
      "indicator_id": "fusion-nif-gain",
      "event_id": "fusion-commercialization",
      "name": "NIF Energy Gain Ratio",
      "source": "https://www.llnl.gov/news",
      "frequency": "quarterly",
      "expected_trend": "upward",
      "correlation_with_event": 0.85,
      "description": "National Ignition Facility fusion gain (target: 10x breakeven)"
    },
    {
      "indicator_id": "fusion-venture-funding",
      "event_id": "fusion-commercialization",
      "name": "Private Fusion R&D Funding",
      "source": "crunchbase_api",
      "frequency": "monthly",
      "expected_trend": "upward",
      "correlation_with_event": 0.6,
      "description": "Total venture capital invested in fusion startups"
    }
  ]
}
```

---

## Step-by-Step Integration

### Phase 1: Schema & Types (Week 1)

1. **Add TypeScript types to your repo**
   ```bash
   cp types.forecast.ts src/types/
   ```

2. **Update your Event interface**
   ```typescript
   import { Forecast, DependencyEdge } from '@/types/types.forecast';
   
   interface Event {
     // ... existing fields
     forecast?: Forecast;
     dependencies?: DependencyEdge[];
   }
   ```

3. **Migrate existing events to new schema**
   - Most events won't have forecasts initially (optional field)
   - Start with key events (AI, fusion, nanotech, biotech)

### Phase 2: Python Backend (Week 2)

1. **Install dependencies**
   ```bash
   pip install numpy scipy pandas --break-system-packages
   ```

2. **Copy Python files**
   ```bash
   cp forecast_models.py backend/
   cp timeline_integration.py backend/
   ```

3. **Create config files from templates**
   ```bash
   cp dependencies.template.json config/dependencies.json
   cp leading_indicators.template.json config/leading_indicators.json
   ```

4. **Initialize pipeline in your backend**
   ```python
   # backend/__init__.py or main.py
   from timeline_integration import ForecastPipeline
   
   pipeline = ForecastPipeline(
       timeline_db="path/to/events.db",
       storage_dir="./forecasts",
       indicators_dir="./indicators",
       dependencies_file="./config/dependencies.json"
   )
   ```

### Phase 3: API Endpoints (Week 3)

Add endpoints to your backend API:

```python
# Flask example
@app.route('/api/events/<event_id>/forecast', methods=['GET'])
def get_forecast(event_id):
    """Retrieve current forecast for an event"""
    forecast = pipeline.forecasts.load_forecast(event_id)
    return jsonify(forecast)

@app.route('/api/events/<event_id>/forecast', methods=['POST'])
def generate_forecast(event_id):
    """Generate new forecast"""
    data = request.json
    forecast = pipeline.forecast_event(
        event_id,
        data_quality=data.get('data_quality', 0.5),
        domain_maturity=data.get('domain_maturity', 0.5),
        research_velocity=data.get('research_velocity', 1.0),
        research_effort=data.get('research_effort', 1.0)
    )
    return jsonify(forecast)

@app.route('/api/events/<event_id>/forecast/history', methods=['GET'])
def get_forecast_history(event_id):
    """Get all forecast versions"""
    history = pipeline.forecasts.get_forecast_history(event_id)
    return jsonify(history)

@app.route('/api/indicators/<indicator_id>/value', methods=['POST'])
def record_indicator(indicator_id):
    """Record new indicator value"""
    data = request.json
    pipeline.indicators.record_value(indicator_id, data['value'])
    return jsonify({"status": "recorded"})

@app.route('/api/dependencies/graph', methods=['GET'])
def get_dependency_graph():
    """Get full dependency graph"""
    return jsonify({
        "nodes": pipeline.dependencies.graph.nodes,
        "edges": [
            {
                "source": s,
                "target": t,
                "strength": m["strength"],
                "type": m["type"]
            }
            for s, t, m in pipeline.dependencies.graph.edges
        ],
        "issues": pipeline.dependencies.detect_issues()
    })
```

### Phase 4: Frontend Visualization (Week 4)

Use forecast data in your timeline UI:

```typescript
// React component example
import { Forecast } from '@/types/types.forecast';

interface TimelineEventProps {
  event: Event;
  forecast?: Forecast;
}

export function TimelineEvent({ event, forecast }: TimelineEventProps) {
  if (!forecast) {
    return <div>{event.title} ({event.year})</div>;
  }
  
  return (
    <div className="event-with-forecast">
      <h3>{event.title}</h3>
      
      {/* Uncertainty band visualization */}
      <UncertaintyBand
        p10={forecast.timing.uncertaintyRange.p10}
        p50={forecast.timing.uncertaintyRange.p50}
        p90={forecast.timing.uncertaintyRange.p90}
        confidence={forecast.confidence}
      />
      
      {/* Scenario toggle */}
      <ScenarioSelector scenarios={forecast.scenarioForecasts} />
      
      {/* Dependency sensitivity */}
      <DependencySensitivity
        affectedBy={forecast.upstream_impacts}
        affects={/* downstream events */}
      />
    </div>
  );
}
```

---

## Data Flow Diagram

```
Timeline Events (your DB)
        ↓
[TimelineEventAdapter]
        ↓
        ├→ Extract signals
        ├→ Compute data quality
        └→ Find dependencies
        ↓
[LeadingIndicatorTracker]
        ├→ Track real-world signals
        └→ Detect anomalies
        ↓
[DependencyGraphManager]
        ├→ Load dependency graph
        └→ Compute cascades
        ↓
[EnsembleForecaster]
        ├→ StatisticalModel (40% weight if high data quality)
        ├→ GraphModel (30% weight)
        ├→ MonteCarloScenarios (20% weight)
        └→ ExpertPrior (10% weight, increases if data sparse)
        ↓
[ForecastRepository]
        ├→ Version control
        ├→ Persist to disk
        └→ Maintain changelog
        ↓
API → Frontend Visualization
```

---

## Key Parameters to Tune

### Per-Event Configuration

When calling `forecast_event()`, adjust these:

```python
pipeline.forecast_event(
    event_id="fusion-commercialization",
    
    # Data quality: 0–1
    # How much reliable signal do we have?
    # High: 0.7+ (published papers, patents, funding data)
    # Medium: 0.4–0.7 (some data, some expert input)
    # Low: <0.4 (mostly speculation)
    data_quality=0.7,
    
    # Domain maturity: 0–1
    # How established is this field?
    # Mature: 0.7+ (fusion has 60+ years history)
    # Growing: 0.4–0.7 (emerging biotech)
    # Nascent: <0.4 (speculative nanotech)
    domain_maturity=0.6,
    
    # Research velocity: 1.0 = baseline
    # >1.0: accelerating research
    # <1.0: slowing research
    research_velocity=1.2,
    
    # Research effort: cumulative researcher-years
    # Higher = more progress made so far
    research_effort=100.0
)
```

### Ensemble Weighting

The ensemble automatically reweights based on context, but you can also override:

```python
forecaster.model_weights = {
    "statistical": 0.50,  # Trust statistical model
    "graph": 0.25,
    "monte_carlo": 0.15,
    "expert": 0.10
}
```

### Scenario Probabilities

In `dependencies.json`, adjust scenario odds:

```json
{
  "scenarios": {
    "acceleration": {
      "probability": 0.25,
      "description": "Rapid progress (tech breakthroughs, big funding)"
    },
    "disruption": {
      "probability": 0.15,
      "description": "Major setback (accident, regulatory ban)"
    },
    "stagnation": {
      "probability": 0.40,
      "description": "Business as usual (current pace)"
    },
    "wild_card": {
      "probability": 0.20,
      "description": "Unknown unknown (new physics, paradigm shift)"
    }
  }
}
```

---

## Validation & Calibration

Before shipping forecasts, validate them:

### 1. Backtest on Historical Events

```python
# Test: can we predict historical events?
historical = [
    ('moon-landing', 1969),
    ('internet-adoption', 2000),
    ('smartphone-era', 2007),
]

metrics = pipeline.calibrate_forecasts(historical)
print(f"MAE: {metrics['mean_absolute_error']:.1f} years")
print(f"Brier score: {metrics['brier_score']:.3f}")
```

**Success criteria**:
- MAE < 5 years for near-term (T+10)
- MAE < 15 years for medium-term (T+30)
- MAE < 30 years for long-term (T+50)
- Brier score < 0.15 (closer to diagonal = better calibrated)

### 2. Monitor Forecast Drift

```python
# Has forecast shifted recently?
history = pipeline.forecasts.get_forecast_history('fusion-commercialization')

for i, forecast in enumerate(history[-5:]):
    print(f"v{i}: p50={forecast['p50_year']}, confidence={forecast['confidence']}")
```

Large shifts without clear reason = model instability

### 3. Check Model Disagreement

```python
forecast = pipeline.forecast_event('event-id')
print(f"Model disagreement: {forecast['model_disagreement']:.2f}")

# If > 0.15: models disagree significantly
# Indicates high uncertainty, show wider bands in UI
```

---

## Common Pitfalls & Solutions

### Problem: Forecasts Too Confident

**Symptom**: Confidence > 0.8 for very long-horizon predictions

**Solution**:
```python
# Enable predictive horizon limiting
# (in types.forecast.ts, Forecast object)
predictiveHorizon: 20  # Only confident within 20 years

# In UI: show confidence degrading over time
if (years_ahead > predictive_horizon) {
  confidence *= exponential_decay(years_ahead)
}
```

### Problem: Model Disagreement Too High

**Symptom**: Ensemble models wildly disagree (disagreement > 0.3)

**Solution**:
1. Check data quality (may be too low)
2. Add more expert priors
3. Adjust scenario probabilities
4. Increase Monte Carlo sample size

### Problem: Leading Indicators Not Updating

**Symptom**: Forecasts stale, not reflecting new signal data

**Solution**:
```python
# Set up automated indicator ingestion
# (run daily/weekly)
indicators = [
    'fusion-nif-gain',
    'ai-compute-cost',
    'biotech-funding'
]

for ind_id in indicators:
    try:
        latest_value = fetch_from_source(ind_id)
        pipeline.indicators.record_value(ind_id, latest_value)
    except Exception as e:
        log_warning(f"Failed to update {ind_id}: {e}")
```

### Problem: Cascading Errors (one bad forecast breaks everything)

**Symptom**: Forecast for event A shifts → all downstream events shift too much

**Solution**:
```python
# Use decay_factor in cascade computation
# (in forecast_models.py, DependencyGraph.propagate_shock)

decay_factor = np.exp(-0.1 * depth)  # Reduce cascade impact with distance
target_delta *= decay_factor
```

---

## FAQ

**Q: How often should I regenerate forecasts?**
A: Weekly for active fields (AI, energy), monthly for stable fields. More often if new signals emerge.

**Q: Can I use this without historical data?**
A: Yes, via expert priors. Model weights will shift toward `expert_prior` component.

**Q: How do I handle fields with no clear progress curve?**
A: Use `monte_carlo_scenario` model more heavily. Adjust scenario probabilities based on expert judgment.

**Q: What if a forecast is wildly wrong?**
A: Check the update history (`updateHistory` field). Identify which signal caused the shift. Validate that signal independently.

**Q: Can I make predictions more uncertain on purpose?**
A: Yes: increase `epistemic` uncertainty in `UncertaintyQuantification`, or adjust `degradationSignal` to be more aggressive.

---

## Next Steps

1. **Copy files** → Add to your repo
2. **Install dependencies** → `pip install numpy scipy pandas`
3. **Create config files** → Edit `dependencies.json`, `leading_indicators.json`
4. **Initialize pipeline** → Add to backend startup
5. **Add API endpoints** → Connect to your REST API
6. **Backtest** → Validate on historical events
7. **Deploy to frontend** → Show forecasts in timeline UI
8. **Monitor** → Track forecast quality, update regularly

---

## Support & Troubleshooting

If you encounter issues:

1. Check file paths (all relative to repo root)
2. Verify config JSON syntax (use `jq` to validate)
3. Run backtest to catch calibration issues early
4. Check `forecasts/metadata.json` for version history
5. Review indicator anomalies in logs

See example files for more details.

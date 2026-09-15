"""
Timeline Integration: Bridge between timeline events and forecasting engine
Provides API for ingesting events, managing forecasts, and serving predictions
"""

import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from pathlib import Path
import sqlite3
import hashlib

from forecast_models import (
    EnsembleForecaster, ForecastCalibrator, ScenarioSimulator,
    StatisticalForecastModel, DependencyGraph, ExpertPriorModel,
    UncertaintyRange, ForecastResult, EnsembleResult
)


# ============================================================================
# TIMELINE EVENT SCHEMA INTEGRATION
# ============================================================================

class TimelineEventAdapter:
    """
    Adapts existing timeline event schema to forecasting models
    Transforms event data → model inputs
    """
    
    def __init__(self, timeline_db_path: str):
        """
        timeline_db_path: path to your timeline events database
        """
        self.db_path = timeline_db_path
        self.conn = sqlite3.connect(timeline_db_path)
    
    def extract_event(self, event_id: str) -> Dict:
        """Retrieve event from timeline database"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM events WHERE id = ?",
            (event_id,)
        )
        row = cursor.fetchone()
        if row:
            return self._row_to_dict(row)
        return None
    
    def _row_to_dict(self, row: tuple) -> Dict:
        """Convert database row to dictionary"""
        # Adjust column names to match your schema
        columns = [
            'id', 'title', 'description', 'category', 'baseline_year',
            'target_year', 'confidence', 'status'
        ]
        return dict(zip(columns, row))


# ============================================================================
# FORECAST REPOSITORY (Persistence Layer)
# ============================================================================

class ForecastRepository:
    """
    Manages forecast storage, versioning, and retrieval
    """
    
    def __init__(self, storage_dir: str = "./forecasts"):
        """
        storage_dir: where to store forecast JSON files and history
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.history_dir = self.storage_dir / "history"
        self.history_dir.mkdir(exist_ok=True)
        self.metadata_file = self.storage_dir / "metadata.json"
        self._load_metadata()
    
    def _load_metadata(self):
        """Load metadata index"""
        if self.metadata_file.exists():
            with open(self.metadata_file) as f:
                self.metadata = json.load(f)
        else:
            self.metadata = {}
    
    def _save_metadata(self):
        """Persist metadata"""
        with open(self.metadata_file, 'w') as f:
            json.dump(self.metadata, f, indent=2, default=str)
    
    def save_forecast(self, event_id: str, forecast_data: Dict) -> str:
        """
        Save forecast and return version ID
        Creates version history
        """
        version_id = self._generate_version_id()
        timestamp = datetime.now().isoformat()
        
        # Save main forecast
        forecast_file = self.storage_dir / f"{event_id}_v{version_id}.json"
        forecast_data['version_id'] = version_id
        forecast_data['timestamp'] = timestamp
        
        with open(forecast_file, 'w') as f:
            json.dump(forecast_data, f, indent=2, default=str)
        
        # Update metadata
        if event_id not in self.metadata:
            self.metadata[event_id] = {
                "versions": [],
                "current_version": None
            }
        
        self.metadata[event_id]["versions"].append({
            "version_id": version_id,
            "timestamp": timestamp,
            "p50_year": forecast_data.get('p50_year'),
            "confidence": forecast_data.get('confidence')
        })
        self.metadata[event_id]["current_version"] = version_id
        
        self._save_metadata()
        
        return version_id
    
    def load_forecast(self, event_id: str, version_id: Optional[str] = None) -> Dict:
        """
        Load forecast (latest or specific version)
        """
        if version_id is None:
            version_id = self.metadata.get(event_id, {}).get("current_version")
            if not version_id:
                return None
        
        forecast_file = self.storage_dir / f"{event_id}_v{version_id}.json"
        if forecast_file.exists():
            with open(forecast_file) as f:
                return json.load(f)
        return None
    
    def get_forecast_history(self, event_id: str) -> List[Dict]:
        """Retrieve all versions of a forecast"""
        if event_id not in self.metadata:
            return []
        
        history = []
        for version_meta in self.metadata[event_id]["versions"]:
            forecast = self.load_forecast(event_id, version_meta["version_id"])
            if forecast:
                history.append(forecast)
        
        return history
    
    @staticmethod
    def _generate_version_id() -> str:
        """Generate unique version ID"""
        timestamp = datetime.now().isoformat()
        return hashlib.md5(timestamp.encode()).hexdigest()[:8]


# ============================================================================
# LEADING INDICATOR TRACKER
# ============================================================================

class LeadingIndicatorTracker:
    """
    Tracks measurable signals that predict event timing
    Ingests real-world data and flags anomalies
    """
    
    def __init__(self, storage_dir: str = "./indicators"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.indicators = {}  # indicator_id → definition + history
    
    def register_indicator(self, 
                          indicator_id: str,
                          event_id: str,
                          name: str,
                          source: str,
                          frequency: str,
                          expected_trend: str,
                          correlation: float):
        """Register a leading indicator"""
        self.indicators[indicator_id] = {
            "event_id": event_id,
            "name": name,
            "source": source,
            "frequency": frequency,  # "daily", "weekly", "monthly", "annual"
            "expected_trend": expected_trend,  # "upward", "downward", "stable"
            "correlation_with_event": correlation,  # 0–1
            "history": []
        }
    
    def record_value(self, 
                    indicator_id: str,
                    value: float,
                    timestamp: datetime = None):
        """Record new indicator value"""
        if indicator_id not in self.indicators:
            raise ValueError(f"Unknown indicator: {indicator_id}")
        
        timestamp = timestamp or datetime.now()
        
        self.indicators[indicator_id]["history"].append({
            "timestamp": timestamp.isoformat(),
            "value": value
        })
        
        # Detect anomalies
        anomaly_score = self._detect_anomaly(indicator_id)
        if anomaly_score > 0.7:
            print(f"⚠️ ANOMALY: {indicator_id} at {value} (anomaly_score={anomaly_score:.2f})")
        
        self._persist_indicator(indicator_id)
    
    def _detect_anomaly(self, indicator_id: str) -> float:
        """
        Detect unusual values (1+ std devs from recent mean)
        Returns: 0–1 anomaly score
        """
        history = self.indicators[indicator_id]["history"]
        if len(history) < 3:
            return 0.0
        
        values = [h["value"] for h in history[-10:]]  # Last 10 values
        mean = sum(values) / len(values)
        std = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5
        
        if std == 0:
            return 0.0
        
        latest = values[-1]
        zscore = abs((latest - mean) / std)
        
        # Map z-score to anomaly score (0–1)
        return min(zscore / 3.0, 1.0)
    
    def _persist_indicator(self, indicator_id: str):
        """Save indicator history to disk"""
        file_path = self.storage_dir / f"{indicator_id}.json"
        with open(file_path, 'w') as f:
            json.dump(self.indicators[indicator_id], f, indent=2, default=str)
    
    def get_trend(self, indicator_id: str, window_days: int = 90) -> Optional[float]:
        """
        Compute trend (rate of change) over recent window
        Returns: slope in units/day
        """
        if indicator_id not in self.indicators:
            return None
        
        history = self.indicators[indicator_id]["history"]
        if len(history) < 2:
            return None
        
        # Filter to recent window
        cutoff = datetime.fromisoformat(history[-1]["timestamp"]) - __import__('datetime').timedelta(days=window_days)
        recent = [
            h for h in history
            if datetime.fromisoformat(h["timestamp"]) >= cutoff
        ]
        
        if len(recent) < 2:
            return None
        
        # Linear regression
        x_values = [i for i in range(len(recent))]
        y_values = [h["value"] for h in recent]
        
        x_mean = sum(x_values) / len(x_values)
        y_mean = sum(y_values) / len(y_values)
        
        numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_values, y_values))
        denominator = sum((x - x_mean) ** 2 for x in x_values)
        
        if denominator == 0:
            return 0.0
        
        return numerator / denominator


# ============================================================================
# DEPENDENCY GRAPH MANAGER
# ============================================================================

class DependencyGraphManager:
    """
    Manages the technology dependency graph
    Loads from JSON, computes cascades, detects feedback loops
    """
    
    def __init__(self, graph_file: str = "./dependencies.json"):
        self.graph_file = graph_file
        self.graph = DependencyGraph()
        self._load_graph()
    
    def _load_graph(self):
        """Load dependency graph from JSON"""
        if Path(self.graph_file).exists():
            with open(self.graph_file) as f:
                data = json.load(f)
                
                # Load nodes
                for node_id, metadata in data.get("nodes", {}).items():
                    self.graph.add_event(node_id, metadata)
                
                # Load edges
                for edge in data.get("edges", []):
                    self.graph.add_dependency(
                        edge["source"],
                        edge["target"],
                        strength=edge.get("strength", 0.5),
                        lag_time=edge.get("lag_time", 0.0),
                        dep_type=edge.get("type", "enabling")
                    )
    
    def save_graph(self):
        """Persist dependency graph"""
        data = {
            "nodes": self.graph.nodes,
            "edges": [
                {
                    "source": source,
                    "target": target,
                    "strength": metadata["strength"],
                    "lag_time": metadata["lag_time"],
                    "type": metadata["type"]
                }
                for source, target, metadata in self.graph.edges
            ]
        }
        
        with open(self.graph_file, 'w') as f:
            json.dump(data, f, indent=2)
    
    def detect_issues(self) -> Dict:
        """Check for graph anomalies"""
        issues = {
            "feedback_loops": self.graph.detect_feedback_loops(),
            "isolated_nodes": [
                node_id for node_id in self.graph.nodes
                if not any(
                    s == node_id or t == node_id
                    for s, t, _ in self.graph.edges
                )
            ]
        }
        return issues


# ============================================================================
# FORECAST PIPELINE (Main Orchestrator)
# ============================================================================

class ForecastPipeline:
    """
    Main orchestrator: coordinates all components
    Ingests events → generates forecasts → persists results
    """
    
    def __init__(self,
                 timeline_db: str,
                 storage_dir: str = "./forecasts",
                 indicators_dir: str = "./indicators",
                 dependencies_file: str = "./dependencies.json"):
        self.timeline = TimelineEventAdapter(timeline_db)
        self.forecasts = ForecastRepository(storage_dir)
        self.indicators = LeadingIndicatorTracker(indicators_dir)
        self.dependencies = DependencyGraphManager(dependencies_file)
        self.ensemble = EnsembleForecaster()
        self.calibrator = ForecastCalibrator()
    
    def forecast_event(self,
                      event_id: str,
                      data_quality: float,
                      domain_maturity: float,
                      research_velocity: float,
                      research_effort: float,
                      upstream_events: Dict[str, float] = None) -> Dict:
        """
        Generate and persist forecast for an event
        
        Returns: complete forecast object ready for visualization
        """
        event = self.timeline.extract_event(event_id)
        if not event:
            raise ValueError(f"Event not found: {event_id}")
        
        # Compute upstream cascades
        upstream_changes = upstream_events or {}
        if event_id in [t for s, t, _ in self.dependencies.graph.edges]:
            # Event has upstream dependencies
            upstream_changes = self._compute_upstream_impacts(event_id)
        
        # Generate ensemble forecast
        ensemble_result = self.ensemble.forecast(
            event_id,
            data_quality=data_quality,
            domain_maturity=domain_maturity,
            research_velocity=research_velocity,
            research_effort=research_effort,
            upstream_changes=upstream_changes
        )
        
        # Build forecast object
        forecast_obj = {
            "event_id": event_id,
            "p50_year": ensemble_result.p50_year,
            "uncertainty_range": {
                "p10": ensemble_result.uncertainty_range.p10,
                "p25": ensemble_result.uncertainty_range.p25,
                "p50": ensemble_result.uncertainty_range.p50,
                "p75": ensemble_result.uncertainty_range.p75,
                "p90": ensemble_result.uncertainty_range.p90,
            },
            "confidence": ensemble_result.confidence,
            "model_disagreement": ensemble_result.model_disagreement,
            "dominant_model": ensemble_result.dominant_model,
            "model_breakdown": [
                {
                    "model": result.model_name,
                    "p50_year": result.p50_year,
                    "confidence": result.confidence,
                    "explanation": result.explanation
                }
                for result in ensemble_result.all_models
            ],
            "upstream_impacts": upstream_changes,
            "generated_at": datetime.now().isoformat()
        }
        
        # Persist
        version_id = self.forecasts.save_forecast(event_id, forecast_obj)
        forecast_obj["version_id"] = version_id
        
        return forecast_obj
    
    def _compute_upstream_impacts(self, event_id: str) -> Dict[str, float]:
        """Compute cascade effects from upstream events"""
        impacts = {}
        
        # Find all predecessor events
        predecessors = [
            s for s, t, _ in self.dependencies.graph.edges
            if t == event_id
        ]
        
        for pred_id in predecessors:
            # Load their forecasts
            pred_forecast = self.forecasts.load_forecast(pred_id)
            if pred_forecast:
                # Simulate shift
                impacts[pred_id] = pred_forecast.get("p50_year", 2050) - 2025
        
        return impacts
    
    def run_batch_forecast(self, event_ids: List[str]) -> Dict:
        """Generate forecasts for multiple events"""
        results = {}
        
        for event_id in event_ids:
            try:
                result = self.forecast_event(
                    event_id,
                    data_quality=0.5,  # Default; should be computed per event
                    domain_maturity=0.5,
                    research_velocity=1.0,
                    research_effort=1.0
                )
                results[event_id] = result
            except Exception as e:
                results[event_id] = {"error": str(e)}
        
        return results
    
    def calibrate_forecasts(self, historical_events: List[Tuple[str, int]]) -> Dict:
        """
        Validate forecasts against historical data
        historical_events: [(event_id, actual_year), ...]
        """
        metrics = {
            "brier_score": 0.0,
            "mean_absolute_error": 0.0,
            "calibration_quality": "unknown"
        }
        
        predicted_years = []
        actual_years = []
        
        for event_id, actual_year in historical_events:
            forecast = self.forecasts.load_forecast(event_id)
            if forecast:
                predicted_years.append(forecast["p50_year"])
                actual_years.append(actual_year)
        
        if predicted_years:
            import numpy as np
            metrics["mean_absolute_error"] = self.calibrator.mean_absolute_error(
                np.array(predicted_years),
                np.array(actual_years)
            )
        
        return metrics


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    # Initialize pipeline
    pipeline = ForecastPipeline(
        timeline_db="./timeline_events.db",
        storage_dir="./forecasts",
        indicators_dir="./indicators",
        dependencies_file="./dependencies.json"
    )
    
    # Register a leading indicator
    pipeline.indicators.register_indicator(
        indicator_id="fusion-nif-gain",
        event_id="fusion-commercialization",
        name="NIF Energy Gain Ratio",
        source="https://www.llnl.gov/news",
        frequency="quarterly",
        expected_trend="upward",
        correlation=0.85
    )
    
    # Record some values
    pipeline.indicators.record_value("fusion-nif-gain", 1.5, datetime.now())
    
    # Forecast an event
    forecast = pipeline.forecast_event(
        event_id="fusion-commercialization",
        data_quality=0.7,
        domain_maturity=0.6,
        research_velocity=1.2,
        research_effort=100.0
    )
    
    print("Forecast generated:")
    print(json.dumps(forecast, indent=2, default=str))

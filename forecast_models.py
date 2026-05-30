"""
Forecasting Engine: Core Models for Timeline Predictions
Implements statistical, graph-based, and scenario modeling
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta
from scipy.stats import weibull_min, lognorm, norm
from scipy.optimize import minimize
import pandas as pd
from enum import Enum


# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class UncertaintyRange:
    """Percentile-based uncertainty representation"""
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    
    @property
    def std_dev(self) -> float:
        """Estimate std dev from percentile spread"""
        return (self.p90 - self.p10) / (2 * 1.645)  # ~90% CI width / 2
    
    @property
    def iqr(self) -> float:
        """Interquartile range"""
        return self.p75 - self.p25


@dataclass
class ForecastResult:
    """Output of a single model's prediction"""
    model_name: str
    p50_year: float
    uncertainty_range: UncertaintyRange
    confidence: float
    explanation: str
    driving_factors: List[str] = field(default_factory=list)


@dataclass
class EnsembleResult:
    """Combined result from ensemble of models"""
    p50_year: float
    uncertainty_range: UncertaintyRange
    confidence: float
    model_disagreement: float  # 0–1, std dev of predictions
    dominant_model: str
    all_models: List[ForecastResult] = field(default_factory=list)
    explanation: str = ""


# ============================================================================
# BASELINE STATISTICAL MODEL: Time-to-Event (Hazard Regression)
# ============================================================================

class StatisticalForecastModel:
    """
    Time-to-event model using Weibull/lognormal hazard regression
    Suitable for fields with historical data and clear progress curves
    """
    
    def __init__(self, baseline_year: int = 2025):
        self.baseline_year = baseline_year
        self.hazard_shape_parameter = 1.5  # Default: slightly accelerating
        self.hazard_scale_parameter = 20.0  # Default: ~20 year horizon
    
    def fit(self, historical_data: pd.DataFrame):
        """
        Fit Weibull hazard model to historical achievement data
        
        DataFrame columns:
            - field: name of technology field
            - event_year: when breakthrough occurred
            - research_intensity: cumulative research effort before event
        """
        for field, group in historical_data.groupby('field'):
            # Time to event
            times = group['event_year'].values - self.baseline_year
            effort = group['research_intensity'].values
            
            # Fit lognormal distribution (research effort → time to event)
            params_lognorm = lognorm.fit(times)
            self.hazard_scale_parameter = params_lognorm[1]
            self.hazard_shape_parameter = params_lognorm[2]
    
    def predict(self, 
                current_research_velocity: float,
                current_research_effort: float,
                field_maturity: float) -> ForecastResult:
        """
        Predict event timing based on research signals
        
        Args:
            current_research_velocity: rate of increase in research intensity
            current_research_effort: cumulative research effort to date
            field_maturity: 0–1, how mature is the field?
        """
        # Adjust scale based on velocity (faster research → earlier event)
        adjusted_scale = self.hazard_scale_parameter / (1 + current_research_velocity)
        
        # Adjust shape based on field maturity (mature fields → acceleration)
        adjusted_shape = self.hazard_shape_parameter * (1 + field_maturity)
        
        # Sample from Weibull distribution
        samples = weibull_min.rvs(
            adjusted_shape,
            scale=adjusted_scale,
            size=10000
        )
        samples = self.baseline_year + samples
        
        # Compute percentiles
        uncertainty = UncertaintyRange(
            p10=float(np.percentile(samples, 10)),
            p25=float(np.percentile(samples, 25)),
            p50=float(np.percentile(samples, 50)),
            p75=float(np.percentile(samples, 75)),
            p90=float(np.percentile(samples, 90))
        )
        
        return ForecastResult(
            model_name="baseline_statistical",
            p50_year=uncertainty.p50,
            uncertainty_range=uncertainty,
            confidence=0.65 + (field_maturity * 0.2),  # Confidence scales with maturity
            explanation=f"Weibull hazard model with adjusted shape={adjusted_shape:.2f}, scale={adjusted_scale:.2f}",
            driving_factors=["research_velocity", "field_maturity"]
        )


# ============================================================================
# GRAPH-BASED DEPENDENCY PROPAGATION MODEL
# ============================================================================

class DependencyGraph:
    """
    Directed graph of technology dependencies
    Propagates forecast shifts through cascading effects
    """
    
    def __init__(self):
        self.nodes: Dict[str, Dict] = {}  # event_id → metadata
        self.edges: List[Tuple[str, str, Dict]] = []  # (source, target, metadata)
        self.temporal_coupling_matrix: Optional[np.ndarray] = None
    
    def add_event(self, event_id: str, event_metadata: Dict):
        """Register an event in the graph"""
        self.nodes[event_id] = event_metadata
    
    def add_dependency(self, 
                      source_id: str, 
                      target_id: str,
                      strength: float = 0.5,
                      lag_time: float = 0.0,
                      dep_type: str = "enabling"):
        """
        Add dependency edge
        
        strength: 0–1, how strong is the dependency?
        lag_time: years between source and target
        dep_type: "enabling", "accelerating", "inhibiting", "alternative", "amplifying"
        """
        self.edges.append((
            source_id,
            target_id,
            {
                "strength": strength,
                "lag_time": lag_time,
                "type": dep_type
            }
        ))
    
    def propagate_shock(self, 
                        source_event: str,
                        delta_years: float) -> Dict[str, float]:
        """
        When source_event shifts by delta_years, compute downstream impacts
        
        Returns: {event_id: delta_years_shift}
        """
        impacts = {source_event: delta_years}
        visited = {source_event}
        queue = [(source_event, delta_years, 0)]  # (event, delta, depth)
        
        while queue:
            current, current_delta, depth = queue.pop(0)
            
            # Find all outgoing edges
            for source, target, metadata in self.edges:
                if source == current and target not in visited:
                    strength = metadata["strength"]
                    dep_type = metadata["type"]
                    lag_time = metadata["lag_time"]
                    
                    # Compute cascade effect
                    if dep_type == "enabling":
                        target_delta = strength * current_delta  # Linear cascade
                    elif dep_type == "accelerating":
                        target_delta = strength * current_delta * 0.5  # Partial cascade
                    elif dep_type == "inhibiting":
                        target_delta = -strength * current_delta  # Opposite direction
                    elif dep_type == "amplifying":
                        target_delta = strength * current_delta * 1.5  # Stronger cascade
                    else:
                        target_delta = 0
                    
                    # Decay with distance (uncertainty increases with hops)
                    decay_factor = np.exp(-0.1 * depth)
                    target_delta *= decay_factor
                    
                    impacts[target] = impacts.get(target, 0) + target_delta
                    visited.add(target)
                    queue.append((target, target_delta, depth + 1))
        
        return impacts
    
    def detect_feedback_loops(self) -> List[List[str]]:
        """
        Detect strongly connected components (cycles)
        Returns: list of cycles (each cycle is a list of event_ids)
        """
        # Tarjan's algorithm for SCCs
        index_counter = [0]
        stack = []
        lowlinks = {}
        index = {}
        on_stack = {}
        sccs = []
        
        def strongconnect(node):
            index[node] = index_counter[0]
            lowlinks[node] = index_counter[0]
            index_counter[0] += 1
            stack.append(node)
            on_stack[node] = True
            
            for source, target, _ in self.edges:
                if source == node:
                    if target not in index:
                        strongconnect(target)
                        lowlinks[node] = min(lowlinks[node], lowlinks[target])
                    elif on_stack.get(target, False):
                        lowlinks[node] = min(lowlinks[node], index[target])
            
            if lowlinks[node] == index[node]:
                scc = []
                while True:
                    successor = stack.pop()
                    on_stack[successor] = False
                    scc.append(successor)
                    if successor == node:
                        break
                if len(scc) > 1:  # Only report cycles with 2+ nodes
                    sccs.append(scc)
        
        for node in self.nodes:
            if node not in index:
                strongconnect(node)
        
        return sccs
    
    def predict_with_dependencies(self,
                                 base_forecast: ForecastResult,
                                 upstream_changes: Dict[str, float],
                                 event_id: str) -> ForecastResult:
        """
        Adjust forecast based on upstream events
        
        upstream_changes: {other_event_id: delta_years}
        """
        adjusted_p50 = base_forecast.p50_year
        confidence_delta = 0.0
        driving_factors = list(base_forecast.driving_factors) + ["dependency_propagation"]
        
        for source_event, delta_years in upstream_changes.items():
            # Find edges from source to our event
            for source, target, metadata in self.edges:
                if source == source_event and target == event_id:
                    strength = metadata["strength"]
                    adjusted_p50 += strength * delta_years
                    confidence_delta -= 0.05 * abs(delta_years) / 10  # Reduce confidence for large shifts
        
        # Create adjusted forecast
        uncertainty = base_forecast.uncertainty_range
        adjusted_range = UncertaintyRange(
            p10=uncertainty.p10 + (adjusted_p50 - base_forecast.p50_year),
            p25=uncertainty.p25 + (adjusted_p50 - base_forecast.p50_year),
            p50=adjusted_p50,
            p75=uncertainty.p75 + (adjusted_p50 - base_forecast.p50_year),
            p90=uncertainty.p90 + (adjusted_p50 - base_forecast.p50_year)
        )
        
        return ForecastResult(
            model_name="dependency_propagation",
            p50_year=adjusted_p50,
            uncertainty_range=adjusted_range,
            confidence=base_forecast.confidence + confidence_delta,
            explanation=f"Base forecast adjusted by dependency cascades: {driving_factors}",
            driving_factors=driving_factors
        )


# ============================================================================
# MONTE CARLO SCENARIO SIMULATOR
# ============================================================================

class ScenarioSimulator:
    """
    Monte Carlo simulation of alternative future paths
    Branches on key assumptions and shocks
    """
    
    def __init__(self, num_simulations: int = 10000):
        self.num_simulations = num_simulations
        self.scenarios = {}  # scenario_name → list of samples
    
    def add_scenario(self, 
                    name: str,
                    probability: float,
                    description: str,
                    parameter_overrides: Dict[str, float]):
        """
        Define a scenario (e.g., "Acceleration", "Stagnation")
        parameter_overrides: {param_name: modified_value}
        """
        self.scenarios[name] = {
            "probability": probability,
            "description": description,
            "overrides": parameter_overrides,
            "samples": []
        }
    
    def run_simulation(self,
                      base_parameters: Dict[str, float],
                      distribution_factory) -> Dict[str, ForecastResult]:
        """
        Run Monte Carlo for each scenario
        distribution_factory: function that creates distribution given parameters
        """
        results = {}
        
        for scenario_name, scenario_spec in self.scenarios.items():
            # Override parameters
            params = base_parameters.copy()
            params.update(scenario_spec["overrides"])
            
            # Sample from distribution under this scenario
            dist = distribution_factory(params)
            samples = dist.rvs(self.num_simulations)
            
            # Compute statistics
            scenario_spec["samples"] = samples
            results[scenario_name] = ForecastResult(
                model_name=f"monte_carlo_{scenario_name}",
                p50_year=float(np.percentile(samples, 50)),
                uncertainty_range=UncertaintyRange(
                    p10=float(np.percentile(samples, 10)),
                    p25=float(np.percentile(samples, 25)),
                    p50=float(np.percentile(samples, 50)),
                    p75=float(np.percentile(samples, 75)),
                    p90=float(np.percentile(samples, 90))
                ),
                confidence=scenario_spec["probability"],
                explanation=f"Monte Carlo simulation: {scenario_spec['description']}",
                driving_factors=list(params.keys())
            )
        
        return results
    
    def blend_scenarios(self, scenario_results: Dict[str, ForecastResult]) -> ForecastResult:
        """
        Blend scenario results into a single forecast using scenario probabilities
        """
        weighted_p50 = 0.0
        weighted_samples = []
        
        for scenario_name, result in scenario_results.items():
            prob = self.scenarios[scenario_name]["probability"]
            weighted_p50 += prob * result.p50_year
            
            # Resample weighted by probability
            samples = np.random.normal(
                result.p50_year,
                result.uncertainty_range.std_dev,
                int(self.num_simulations * prob)
            )
            weighted_samples.extend(samples)
        
        weighted_samples = np.array(weighted_samples)
        
        return ForecastResult(
            model_name="monte_carlo_blended",
            p50_year=weighted_p50,
            uncertainty_range=UncertaintyRange(
                p10=float(np.percentile(weighted_samples, 10)),
                p25=float(np.percentile(weighted_samples, 25)),
                p50=float(np.percentile(weighted_samples, 50)),
                p75=float(np.percentile(weighted_samples, 75)),
                p90=float(np.percentile(weighted_samples, 90))
            ),
            confidence=float(np.sqrt(np.mean([r.confidence**2 for r in scenario_results.values()]))),
            explanation="Blended Monte Carlo across scenarios"
        )


# ============================================================================
# EXPERT PRIOR MODEL
# ============================================================================

class ExpertPriorModel:
    """
    Encodes expert judgment when data is sparse
    Uses informative priors + Bayesian updating
    """
    
    def __init__(self):
        self.priors = {}  # field_name → prior distribution
    
    def set_prior(self, 
                  field: str,
                  p50: float,
                  uncertainty_std: float,
                  reasoning: str = ""):
        """
        Set expert prior for a field
        """
        self.priors[field] = {
            "p50": p50,
            "std": uncertainty_std,
            "reasoning": reasoning
        }
    
    def predict(self, field: str) -> ForecastResult:
        """
        Generate forecast from expert prior
        """
        if field not in self.priors:
            raise ValueError(f"No prior set for field: {field}")
        
        prior = self.priors[field]
        p50 = prior["p50"]
        std = prior["std"]
        
        samples = np.random.normal(p50, std, 10000)
        
        return ForecastResult(
            model_name="expert_prior",
            p50_year=p50,
            uncertainty_range=UncertaintyRange(
                p10=float(np.percentile(samples, 10)),
                p25=float(np.percentile(samples, 25)),
                p50=p50,
                p75=float(np.percentile(samples, 75)),
                p90=float(np.percentile(samples, 90))
            ),
            confidence=0.5,  # Explicitly lower confidence for priors
            explanation=f"Expert prior: {prior['reasoning']}"
        )


# ============================================================================
# ENSEMBLE FORECASTER
# ============================================================================

class EnsembleForecaster:
    """
    Combines multiple forecasting models with adaptive weighting
    """
    
    def __init__(self):
        self.statistical_model = StatisticalForecastModel()
        self.graph_model = DependencyGraph()
        self.scenario_simulator = ScenarioSimulator()
        self.expert_model = ExpertPriorModel()
        self.model_weights = {
            "statistical": 0.40,
            "graph": 0.30,
            "monte_carlo": 0.20,
            "expert": 0.10
        }
    
    def adjust_weights(self,
                      data_quality: float,
                      domain_maturity: float,
                      time_horizon_years: float):
        """
        Adaptively reweight models based on context
        
        data_quality: 0–1
        domain_maturity: 0–1
        time_horizon_years: how far ahead are we predicting?
        """
        if data_quality > 0.7 and domain_maturity > 0.6:
            # Strong data and mature domain: trust statistical model
            self.model_weights = {
                "statistical": 0.45,
                "graph": 0.30,
                "monte_carlo": 0.15,
                "expert": 0.10
            }
        elif data_quality > 0.4:
            # Moderate data: balance approaches
            self.model_weights = {
                "statistical": 0.35,
                "graph": 0.25,
                "monte_carlo": 0.25,
                "expert": 0.15
            }
        else:
            # Sparse data: lean on expert priors
            self.model_weights = {
                "statistical": 0.20,
                "graph": 0.20,
                "monte_carlo": 0.25,
                "expert": 0.35
            }
        
        # Long-horizon predictions degrade confidence
        if time_horizon_years > 30:
            # Spread confidence more evenly (less certain about any one model)
            self.model_weights = {k: v * 0.8 + 0.05 for k, v in self.model_weights.items()}
    
    def forecast(self,
                 event_id: str,
                 data_quality: float,
                 domain_maturity: float,
                 research_velocity: float,
                 research_effort: float,
                 upstream_changes: Dict[str, float] = None,
                 scenario_results: Dict[str, ForecastResult] = None) -> EnsembleResult:
        """
        Generate ensemble forecast combining all models
        """
        time_horizon = 20  # Default
        self.adjust_weights(data_quality, domain_maturity, time_horizon)
        
        # Get individual forecasts
        stat_result = self.statistical_model.predict(
            research_velocity, research_effort, domain_maturity
        )
        
        graph_result = self.graph_model.predict_with_dependencies(
            stat_result,
            upstream_changes or {},
            event_id
        )
        
        monte_carlo_result = (
            self.scenario_simulator.blend_scenarios(scenario_results)
            if scenario_results else stat_result
        )
        
        expert_result = self.expert_model.predict(event_id)
        
        results = [stat_result, graph_result, monte_carlo_result, expert_result]
        
        # Weighted ensemble
        weighted_p50 = sum(
            result.p50_year * self.model_weights[result.model_name.split("_")[0]]
            for result in results
        )
        
        # Model disagreement (std dev of p50 estimates)
        p50_values = np.array([r.p50_year for r in results])
        model_disagreement = float(np.std(p50_values) / np.mean(p50_values))
        
        # Compute weighted uncertainty
        weighted_samples = []
        for result, model_key in zip(
            results,
            ["statistical", "graph", "monte_carlo", "expert"]
        ):
            weight = self.model_weights[model_key]
            std = result.uncertainty_range.std_dev
            samples = np.random.normal(result.p50_year, std, int(10000 * weight))
            weighted_samples.extend(samples)
        
        weighted_samples = np.array(weighted_samples)
        
        return EnsembleResult(
            p50_year=weighted_p50,
            uncertainty_range=UncertaintyRange(
                p10=float(np.percentile(weighted_samples, 10)),
                p25=float(np.percentile(weighted_samples, 25)),
                p50=float(np.percentile(weighted_samples, 50)),
                p75=float(np.percentile(weighted_samples, 75)),
                p90=float(np.percentile(weighted_samples, 90))
            ),
            confidence=float(np.mean([r.confidence for r in results])),
            model_disagreement=model_disagreement,
            dominant_model=max(
                zip(results, self.model_weights.values()),
                key=lambda x: x[1]
            )[0].model_name,
            all_models=results
        )


# ============================================================================
# CALIBRATION & VALIDATION
# ============================================================================

class ForecastCalibrator:
    """
    Validates forecast quality via backtesting and calibration
    """
    
    @staticmethod
    def brier_score(predicted_probs: np.ndarray, outcomes: np.ndarray) -> float:
        """
        Brier Score: mean squared error of probability predictions
        Lower is better. Perfect: 0.0, always guessing 50%: 0.25
        """
        return float(np.mean((predicted_probs - outcomes) ** 2))
    
    @staticmethod
    def calibration_error(predicted_probs: np.ndarray, outcomes: np.ndarray,
                         num_bins: int = 10) -> Tuple[List[float], List[float]]:
        """
        Calibration curve: are 70% predictions true ~70% of time?
        Returns: (predicted_probs_per_bin, actual_freq_per_bin)
        """
        bins = np.linspace(0, 1, num_bins + 1)
        predicted_means = []
        observed_freqs = []
        
        for i in range(num_bins):
            mask = (predicted_probs >= bins[i]) & (predicted_probs < bins[i + 1])
            if np.sum(mask) > 0:
                predicted_means.append((bins[i] + bins[i + 1]) / 2)
                observed_freqs.append(float(np.mean(outcomes[mask])))
        
        return predicted_means, observed_freqs
    
    @staticmethod
    def mean_absolute_error(predicted_years: np.ndarray, actual_years: np.ndarray) -> float:
        """
        MAE for timing predictions (in years)
        """
        return float(np.mean(np.abs(predicted_years - actual_years)))


if __name__ == "__main__":
    # Example usage
    print("Forecasting engine imported successfully")

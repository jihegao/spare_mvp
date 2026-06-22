"""Equipment tree, failure distribution samplers, kOutOfN redundancy, lifeLimit."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.stats import weibull_min, norm


def sample_exponential_failure(rate: float, dt: float, rng: np.random.Generator) -> bool:
    """Return True if a failure occurs in time interval dt (exponential distribution)."""
    if rate <= 0 or dt <= 0:
        return False
    prob = 1.0 - math.exp(-rate * dt)
    return bool(rng.random() < prob)


def sample_weibull_failure(beta: float, eta: float, dt: float, rng: np.random.Generator) -> bool:
    """Return True if a Weibull-distributed failure occurs in interval dt."""
    if beta <= 0 or eta <= 0 or dt <= 0:
        return False
    prob = 1.0 - math.exp(-((dt / eta) ** beta))
    return bool(rng.random() < prob)


def sample_normal_lifetime(mean: float, sigma: float, elapsed: float, rng: np.random.Generator) -> float:
    """Return remaining lifetime (hours) given elapsed hours, using normal distribution."""
    if sigma <= 0:
        return max(0.0, mean - elapsed)
    total_life = float(rng.normal(mean, sigma))
    return max(0.0, total_life - elapsed)

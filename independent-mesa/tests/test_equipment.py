from __future__ import annotations

import math
import unittest

import numpy as np

from independent_mesa.equipment import (
    sample_exponential_failure,
    sample_weibull_failure,
    sample_normal_lifetime,
)


class TestFailureSamplers(unittest.TestCase):
    def test_exponential_failure_probability_scales_with_dt(self) -> None:
        rng = np.random.default_rng(42)
        rate = 0.01
        dt = 60.0
        fails = sum(sample_exponential_failure(rate, dt, rng) for _ in range(10000))
        prob = fails / 10000
        expected = 1 - math.exp(-rate * dt)
        self.assertAlmostEqual(prob, expected, places=2)

    def test_exponential_zero_rate_never_fails(self) -> None:
        rng = np.random.default_rng(0)
        self.assertFalse(sample_exponential_failure(0.0, 60.0, rng))

    def test_weibull_failure_probability_matches_cdf(self) -> None:
        rng = np.random.default_rng(99)
        beta = 1.8
        eta = 140.0
        dt = 50.0
        fails = sum(sample_weibull_failure(beta, eta, dt, rng) for _ in range(10000))
        prob = fails / 10000
        expected = 1 - math.exp(-((dt / eta) ** beta))
        self.assertAlmostEqual(prob, expected, places=2)

    def test_normal_lifetime_returns_remaining_fraction(self) -> None:
        rng = np.random.default_rng(7)
        mean = 105.0
        sigma = 12.0
        elapsed = 90.0
        remaining = sample_normal_lifetime(mean, sigma, elapsed, rng)
        self.assertIsInstance(remaining, float)
        self.assertGreater(remaining, 0.0)

    def test_normal_lifetime_past_mean_returns_small_remaining(self) -> None:
        rng = np.random.default_rng(3)
        remaining = sample_normal_lifetime(100.0, 10.0, 150.0, rng)
        self.assertLessEqual(remaining, 20.0)


if __name__ == "__main__":
    unittest.main()

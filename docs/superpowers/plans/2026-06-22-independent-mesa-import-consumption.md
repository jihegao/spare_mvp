# Independent Mesa Import Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Mesa project that consumes the full "导入示例项目" modeling-import-v1 data package, with every field driving simulation behavior, producing single-run frames and Monte Carlo sweep results.

**Architecture:** Model-orchestration + domain modules (方案 B). `IndependentMesaModel` delegates to focused modules: equipment (failure distributions + kOutOfN + lifeLimit), mission_scheduler (composite/periodic task编排), activity_planner (job DAG + duration sampling), support_network (3-level nodes + transport + inventory), reliability (block diagram), monte_carlo (sweep). `AircraftAgent` carries per-aircraft equipment state.

**Tech Stack:** Mesa 3.5.1, numpy 2.4.6, scipy 1.17.1, networkx 3.6.1, unittest (stdlib). Run with `.abm-mesa-test-env/bin/python`.

**Spec:** `docs/superpowers/specs/2026-06-22-independent-mesa-import-consumption-design.md`

**Data source:** `tests/fixtures/modeling_import_project.json` (modeling-import-v1 schema)

---

## File Structure

```
independent-mesa/
├── requirements.txt
├── README.md
├── data/import_package.json          # copied from tests/fixtures/
├── output/single-run/                # frames.json + metrics.json
├── output/sweep/                     # results.json
├── independent_mesa/
│   ├── __init__.py
│   ├── equipment.py                  # 装备树 + 故障分布 + kOutOfN + lifeLimit + repairProfile
│   ├── reliability.py                # 可靠性框图 (串/并/备用)
│   ├── mission_scheduler.py          # 复合任务 + 周期任务 + 周编排
│   ├── activity_planner.py           # 保障活动作业 DAG + 工时分布采样
│   ├── support_network.py            # 三级保障点 + 横向/纵向运输 + 备件库存
│   ├── agents.py                     # AircraftAgent(Agent)
│   ├── model.py                      # IndependentMesaModel(Model) 编排层
│   ├── frames.py                     # snapshot → frames JSON
│   └── monte_carlo.py                # sweep 运行器
├── run_single.py                     # 单场景 CLI
├── run_sweep.py                      # sweep CLI
└── tests/
    ├── __init__.py
    ├── test_equipment.py
    ├── test_reliability.py
    ├── test_mission_scheduler.py
    ├── test_activity_planner.py
    ├── test_support_network.py
    ├── test_model_integration.py
    └── test_monte_carlo.py
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `independent-mesa/requirements.txt`
- Create: `independent-mesa/README.md`
- Create: `independent-mesa/data/import_package.json` (copy)
- Create: `independent-mesa/independent_mesa/__init__.py`
- Create: `independent-mesa/tests/__init__.py`
- Create: `independent-mesa/output/.gitkeep`

- [ ] **Step 1: Create directory structure and copy data**

```bash
mkdir -p independent-mesa/data independent-mesa/output/single-run independent-mesa/output/sweep independent-mesa/independent_mesa independent-mesa/tests
cp tests/fixtures/modeling_import_project.json independent-mesa/data/import_package.json
touch independent-mesa/output/.gitkeep
```

- [ ] **Step 2: Write requirements.txt**

```
mesa>=3.5
numpy>=2.0
scipy>=1.17
networkx>=3.6
```

- [ ] **Step 3: Write __init__.py files**

`independent-mesa/independent_mesa/__init__.py`:
```python
"""Independent Mesa model consuming modeling-import-v1 data."""
```

`independent-mesa/tests/__init__.py`:
```python
```

- [ ] **Step 4: Write README.md**

```markdown
# Independent Mesa

Standalone Mesa model consuming the 导入示例项目 modeling-import-v1 data package.

## Run

```bash
# Single scenario
.abm-mesa-test-env/bin/python run_single.py --steps 48 --sample-every 4 --seed 20260621

# Monte Carlo sweep
.abm-mesa-test-env/bin/python run_sweep.py --sample-every 4 --keep-frames

# Tests
.abm-mesa-test-env/bin/python -m unittest discover -s tests -v
```
```

- [ ] **Step 5: Verify scaffold**

```bash
ls -R independent-mesa/ | head -30
.abm-mesa-test-env/bin/python -c "import json; d=json.load(open('independent-mesa/data/import_package.json')); print(d['schemaVersion'], d['projectId'])"
```
Expected: `modeling-import-v1 project-carrier-day-night`

- [ ] **Step 6: Commit**

```bash
git add independent-mesa/
git commit -m "feat: scaffold independent-mesa project structure"
```

---

### Task 2: Equipment — Failure Distribution Samplers

**Files:**
- Create: `independent-mesa/independent_mesa/equipment.py`
- Test: `independent-mesa/tests/test_equipment.py`

- [ ] **Step 1: Write failing tests for distribution samplers**

`independent-mesa/tests/test_equipment.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_equipment -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'independent_mesa.equipment'`

- [ ] **Step 3: Implement distribution samplers**

`independent-mesa/independent_mesa/equipment.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_equipment -v
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/equipment.py independent-mesa/tests/test_equipment.py
git commit -m "feat: add failure distribution samplers (exponential/weibull/normal)"
```

---

### Task 3: Equipment — Tree Builder + kOutOfN

**Files:**
- Modify: `independent-mesa/independent_mesa/equipment.py`
- Test: `independent-mesa/tests/test_equipment.py`

- [ ] **Step 1: Add failing tests for equipment tree and kOutOfN**

Append to `independent-mesa/tests/test_equipment.py` (before `if __name__`):
```python
from independent_mesa.equipment import (
    EquipmentNode,
    build_equipment_tree,
    parse_failure_distribution,
    check_k_out_of_n,
)


class TestEquipmentTree(unittest.TestCase):
    def _sample_assets(self) -> list[dict]:
        return [
            {"id": "aircraft-root", "name": "舰载机", "quantity": 6, "mtbfHours": 600},
            {
                "id": "j15-engine", "aircraftModel": "J-15", "name": "发动机",
                "parentId": "aircraft-root", "productType": "SRU",
                "failureModel": "随机",
                "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.055"},
                "failureRate": 0.055, "mtbfHours": 95, "lifeLimitHours": 240,
                "connectionType": "串联", "quantity": 2,
                "kOutOfN": {"enabled": True, "n": 2, "k": 1},
                "specialRepairProfile": {"repairTimeMinutes": 220, "repairRatio": 0.4, "replacementRatio": 0.6},
                "rms": {"reliability": 0.94, "maintainability": 0.89, "supportability": 0.9,
                        "mttrHours": 3.4, "mldtHours": 1.2, "availability": 0.96},
            },
            {
                "id": "j15-engine-control", "aircraftModel": "J-15", "name": "发动机控制模块",
                "parentId": "j15-engine", "productType": "LRU",
                "failureModel": "随机",
                "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.04"},
                "failureRate": 0.04, "mtbfHours": 120, "lifeLimitHours": 260,
                "connectionType": "串联", "quantity": 1,
                "kOutOfN": {"enabled": False, "n": 1, "k": 1},
                "specialRepairProfile": {"repairTimeMinutes": 160, "repairRatio": 0.45, "replacementRatio": 0.55},
                "rms": {"reliability": 0.95, "maintainability": 0.9, "supportability": 0.9,
                        "mttrHours": 2.8, "mldtHours": 1.1, "availability": 0.97},
            },
        ]

    def test_build_equipment_tree_creates_parent_child_links(self) -> None:
        tree = build_equipment_tree(self._sample_assets())
        self.assertIn("aircraft-root", tree)
        root = tree["aircraft-root"]
        self.assertEqual(len(root.children), 1)
        engine = root.children[0]
        self.assertEqual(engine.id, "j15-engine")
        self.assertEqual(len(engine.children), 1)
        self.assertEqual(engine.children[0].id, "j15-engine-control")

    def test_parse_exponential_distribution(self) -> None:
        dist = parse_failure_distribution(
            {"distributionType": "指数分布", "parameters": "lambda=0.055"},
            failure_model="随机",
            mtbf_hours=95.0,
        )
        self.assertEqual(dist["type"], "exponential")
        self.assertAlmostEqual(dist["rate"], 0.055)

    def test_parse_weibull_distribution(self) -> None:
        dist = parse_failure_distribution(
            {"distributionType": "威布尔分布", "parameters": "beta=1.8, eta=140"},
            failure_model="退化",
            mtbf_hours=125.0,
        )
        self.assertEqual(dist["type"], "weibull")
        self.assertAlmostEqual(dist["beta"], 1.8)
        self.assertAlmostEqual(dist["eta"], 140.0)

    def test_parse_normal_distribution(self) -> None:
        dist = parse_failure_distribution(
            {"distributionType": "正态分布", "parameters": "mean=105, sigma=12"},
            failure_model="寿命",
            mtbf_hours=105.0,
        )
        self.assertEqual(dist["type"], "normal")
        self.assertAlmostEqual(dist["mean"], 105.0)
        self.assertAlmostEqual(dist["sigma"], 12.0)

    def test_parse_distribution_fallback_on_missing(self) -> None:
        dist = parse_failure_distribution(None, failure_model="随机", mtbf_hours=100.0)
        self.assertEqual(dist["type"], "exponential")
        self.assertAlmostEqual(dist["rate"], 1.0 / 100.0)

    def test_k_out_of_n_not_failed_when_below_threshold(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=2)
        node.k_out_of_n = {"enabled": True, "n": 2, "k": 1}
        node.failed_children_count = 0
        self.assertFalse(check_k_out_of_n(node))

    def test_k_out_of_n_failed_when_at_threshold(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=2)
        node.k_out_of_n = {"enabled": True, "n": 2, "k": 1}
        node.failed_children_count = 1
        self.assertTrue(check_k_out_of_n(node))

    def test_k_out_of_n_disabled_always_false(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1)
        node.k_out_of_n = {"enabled": False, "n": 1, "k": 1}
        node.failed_children_count = 5
        self.assertFalse(check_k_out_of_n(node))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_equipment.TestEquipmentTree -v
```
Expected: FAIL with `ImportError: cannot import name 'EquipmentNode'`

- [ ] **Step 3: Implement EquipmentNode, tree builder, distribution parser, kOutOfN**

Append to `independent-mesa/independent_mesa/equipment.py`:
```python
import re


class EquipmentNode:
    """A node in the equipment tree (SRU, LRU, or whole aircraft)."""

    def __init__(
        self,
        id: str,
        name: str,
        quantity: int = 1,
        parent_id: str | None = None,
        aircraft_model: str | None = None,
        product_type: str = "LRU",
        spare_type: str | None = None,
        failure_model: str = "随机",
        failure_distribution: dict[str, Any] | None = None,
        failure_rate: float = 0.0,
        mtbf_hours: float = 0.0,
        life_limit_hours: float = 0.0,
        connection_type: str = "串联",
        k_out_of_n: dict[str, Any] | None = None,
        special_repair_profile: dict[str, Any] | None = None,
        rms: dict[str, Any] | None = None,
    ) -> None:
        self.id = id
        self.name = name
        self.quantity = quantity
        self.parent_id = parent_id
        self.aircraft_model = aircraft_model
        self.product_type = product_type
        self.spare_type = spare_type
        self.failure_model = failure_model
        self.failure_distribution = failure_distribution or {}
        self.failure_rate = failure_rate
        self.mtbf_hours = mtbf_hours
        self.life_limit_hours = life_limit_hours
        self.connection_type = connection_type
        self.k_out_of_n = k_out_of_n or {"enabled": False, "n": 1, "k": 1}
        self.special_repair_profile = special_repair_profile or {}
        self.rms = rms or {}
        self.children: list[EquipmentNode] = []
        self.parent: EquipmentNode | None = None
        self.health = "healthy"
        self.accumulated_hours = 0.0
        self.failure_count = 0
        self.failed_children_count = 0


def parse_failure_distribution(
    raw: dict[str, Any] | None,
    failure_model: str,
    mtbf_hours: float,
) -> dict[str, Any]:
    """Parse a failureDistribution object into a typed sampler config."""
    if raw is None or not isinstance(raw, dict):
        return {"type": "exponential", "rate": 1.0 / max(mtbf_hours, 1.0)}
    dist_type = str(raw.get("distributionType", ""))
    params = str(raw.get("parameters", ""))
    if "指数" in dist_type:
        rate = _extract_param(params, "lambda", 1.0 / max(mtbf_hours, 1.0))
        return {"type": "exponential", "rate": float(rate)}
    if "威布尔" in dist_type or "weibull" in dist_type.lower():
        beta = _extract_param(params, "beta", 2.0)
        eta = _extract_param(params, "eta", max(mtbf_hours, 1.0))
        return {"type": "weibull", "beta": float(beta), "eta": float(eta)}
    if "正态" in dist_type or "normal" in dist_type.lower():
        mean = _extract_param(params, "mean", mtbf_hours)
        sigma = _extract_param(params, "sigma", max(mtbf_hours * 0.1, 1.0))
        return {"type": "normal", "mean": float(mean), "sigma": float(sigma)}
    return {"type": "exponential", "rate": 1.0 / max(mtbf_hours, 1.0)}


def _extract_param(params_str: str, key: str, fallback: float) -> float:
    """Extract a numeric parameter from a string like 'beta=1.8, eta=140'."""
    match = re.search(rf"{key}\s*=\s*([0-9.eE+-]+)", params_str)
    if match:
        return float(match.group(1))
    return fallback


def build_equipment_tree(assets: list[dict[str, Any]]) -> dict[str, EquipmentNode]:
    """Build a parent-child tree from a flat list of equipment asset dicts."""
    nodes: dict[str, EquipmentNode] = {}
    for row in assets:
        node_id = str(row.get("id") or row.get("name") or "")
        node = EquipmentNode(
            id=node_id,
            name=str(row.get("name") or node_id),
            quantity=int(row.get("quantity", 1)),
            parent_id=str(row["parentId"]) if row.get("parentId") else None,
            aircraft_model=str(row["aircraftModel"]) if row.get("aircraftModel") else None,
            product_type=str(row.get("productType", "LRU")),
            spare_type=str(row["spareType"]) if row.get("spareType") else None,
            failure_model=str(row.get("failureModel", "随机")),
            failure_distribution=parse_failure_distribution(
                row.get("failureDistribution"),
                str(row.get("failureModel", "随机")),
                float(row.get("mtbfHours", 0) or 0),
            ),
            failure_rate=float(row.get("failureRate", 0) or 0),
            mtbf_hours=float(row.get("mtbfHours", 0) or 0),
            life_limit_hours=float(row.get("lifeLimitHours", 0) or 0),
            connection_type=str(row.get("connectionType", "串联")),
            k_out_of_n=row.get("kOutOfN") or {"enabled": False, "n": 1, "k": 1},
            special_repair_profile=row.get("specialRepairProfile") or {},
            rms=row.get("rms") or {},
        )
        nodes[node_id] = node
    for node in nodes.values():
        if node.parent_id and node.parent_id in nodes:
            parent = nodes[node.parent_id]
            node.parent = parent
            parent.children.append(node)
    return nodes


def check_k_out_of_n(node: EquipmentNode) -> bool:
    """Return True if the node's kOutOfN failure threshold is met."""
    k_config = node.k_out_of_n or {}
    if not k_config.get("enabled", False):
        return False
    k = int(k_config.get("k", 1))
    return node.failed_children_count >= k
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_equipment -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/equipment.py independent-mesa/tests/test_equipment.py
git commit -m "feat: add equipment tree builder, distribution parser, kOutOfN"
```

---

### Task 4: Equipment — Aging, Failure Sampling, Repair Profile

**Files:**
- Modify: `independent-mesa/independent_mesa/equipment.py`
- Test: `independent-mesa/tests/test_equipment.py`

- [ ] **Step 1: Add failing tests for aging/failure/repair**

Append to `independent-mesa/tests/test_equipment.py` (before `if __name__`):
```python
from independent_mesa.equipment import (
    age_and_sample_failures,
    decide_repair_or_replace,
    is_life_limit_exceeded,
)


class TestAgingAndFailure(unittest.TestCase):
    def test_age_and_sample_failures_marks_lru_failed(self) -> None:
        nodes = build_equipment_tree([
            {"id": "root", "name": "root", "quantity": 1, "mtbfHours": 600},
            {
                "id": "lru1", "name": "lru1", "parentId": "root",
                "failureModel": "随机", "failureRate": 1.0,
                "mtbfHours": 1, "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=1.0"},
                "lifeLimitHours": 0, "quantity": 1,
            },
        ])
        rng = np.random.default_rng(0)
        failures = age_and_sample_failures(nodes, dt_hours=1.0, rng=rng, threat_multiplier=1.0)
        self.assertIsInstance(failures, list)
        if failures:
            self.assertEqual(nodes[failures[0]].health, "failed")

    def test_age_accumulates_hours(self) -> None:
        nodes = build_equipment_tree([
            {"id": "root", "name": "root", "quantity": 1, "mtbfHours": 600},
        ])
        rng = np.random.default_rng(0)
        age_and_sample_failures(nodes, dt_hours=5.0, rng=rng, threat_multiplier=1.0)
        self.assertGreater(nodes["root"].accumulated_hours, 0)

    def test_life_limit_exceeded(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1, life_limit_hours=100.0)
        node.accumulated_hours = 120.0
        self.assertTrue(is_life_limit_exceeded(node))

    def test_life_limit_not_exceeded(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1, life_limit_hours=100.0)
        node.accumulated_hours = 50.0
        self.assertFalse(is_life_limit_exceeded(node))

    def test_life_limit_zero_not_exceeded(self) -> None:
        node = EquipmentNode(id="x", name="x", quantity=1, life_limit_hours=0.0)
        node.accumulated_hours = 9999.0
        self.assertFalse(is_life_limit_exceeded(node))

    def test_decide_repair_uses_ratio(self) -> None:
        profile = {"repairTimeMinutes": 220, "repairRatio": 0.4, "replacementRatio": 0.6}
        rng = np.random.default_rng(0)
        decisions = [decide_repair_or_replace(profile, rng) for _ in range(1000)]
        repair_count = sum(1 for d in decisions if d == "repair")
        self.assertGreater(repair_count, 200)
        self.assertLess(repair_count, 600)

    def test_threat_multiplier_increases_failures(self) -> None:
        asset = [
            {"id": "root", "name": "root", "quantity": 1, "mtbfHours": 600},
            {
                "id": "lru1", "name": "lru1", "parentId": "root",
                "failureModel": "随机", "failureRate": 0.01,
                "mtbfHours": 100, "failureDistribution": {"distributionType": "指数分布", "parameters": "lambda=0.01"},
                "lifeLimitHours": 0, "quantity": 1,
            },
        ]
        rng_low = np.random.default_rng(100)
        rng_high = np.random.default_rng(100)
        low = sum(len(age_and_sample_failures(build_equipment_tree(asset), 10.0, rng_low, 1.0)) for _ in range(500))
        high = sum(len(age_and_sample_failures(build_equipment_tree(asset), 10.0, rng_high, 3.0)) for _ in range(500))
        self.assertGreater(high, low)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_equipment.TestAgingAndFailure -v
```
Expected: FAIL with `ImportError: cannot import name 'age_and_sample_failures'`

- [ ] **Step 3: Implement aging, failure sampling, lifeLimit, repair decision**

Append to `independent-mesa/independent_mesa/equipment.py`:
```python
def age_and_sample_failures(
    nodes: dict[str, EquipmentNode],
    dt_hours: float,
    rng: np.random.Generator,
    threat_multiplier: float = 1.0,
) -> list[str]:
    """Age all nodes by dt_hours and sample failures. Returns list of failed node IDs."""
    failed_ids: list[str] = []
    for node in nodes.values():
        node.accumulated_hours += dt_hours
        if node.health == "failed":
            continue
        if is_life_limit_exceeded(node):
            node.health = "failed"
            node.failure_count += 1
            failed_ids.append(node.id)
            continue
        dist = node.failure_distribution
        failed = False
        if dist["type"] == "exponential":
            rate = dist["rate"] * threat_multiplier
            failed = sample_exponential_failure(rate, dt_hours, rng)
        elif dist["type"] == "weibull":
            failed = sample_weibull_failure(dist["beta"], dist["eta"], dt_hours, rng)
        elif dist["type"] == "normal":
            remaining = sample_normal_lifetime(dist["mean"], dist["sigma"], node.accumulated_hours, rng)
            if remaining <= 0:
                failed = True
        if failed:
            node.health = "failed"
            node.failure_count += 1
            failed_ids.append(node.id)
            if node.parent:
                node.parent.failed_children_count += 1
    return failed_ids


def is_life_limit_exceeded(node: EquipmentNode) -> bool:
    """Return True if accumulated hours exceed life limit (and limit > 0)."""
    if node.life_limit_hours <= 0:
        return False
    return node.accumulated_hours >= node.life_limit_hours


def decide_repair_or_replace(
    profile: dict[str, Any],
    rng: np.random.Generator,
) -> str:
    """Decide whether to repair or replace based on repairRatio/replacementRatio."""
    repair_ratio = float(profile.get("repairRatio", 0.5))
    if rng.random() < repair_ratio:
        return "repair"
    return "replace"


def get_repair_duration(profile: dict[str, Any], decision: str) -> float:
    """Return repair duration in minutes for the given decision."""
    base = float(profile.get("repairTimeMinutes", 60))
    if decision == "repair":
        return base
    return base * float(profile.get("replacementRatio", 0.5))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_equipment -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/equipment.py independent-mesa/tests/test_equipment.py
git commit -m "feat: add equipment aging, failure sampling, lifeLimit, repair decision"
```

---

### Task 5: Reliability — Block Diagram (Series/Parallel/Standby)

**Files:**
- Create: `independent-mesa/independent_mesa/reliability.py`
- Test: `independent-mesa/tests/test_reliability.py`

- [ ] **Step 1: Write failing tests**

`independent-mesa/tests/test_reliability.py`:
```python
from __future__ import annotations

import math
import unittest

from independent_mesa.reliability import (
    ReliabilityBlock,
    build_reliability_diagram,
    evaluate_system_reliability,
)


class TestReliabilityDiagram(unittest.TestCase):
    def _sample_rbd(self) -> dict:
        return {
            "nodes": [
                {"id": "aircraft", "name": "整机", "type": "system", "connectionType": "串联", "failureRate": 0.01, "mtbfHours": 300, "parentId": None},
                {"id": "engine", "name": "发动机", "type": "component", "connectionType": "串联", "failureRate": 0.055, "mtbfHours": 95, "parentId": "aircraft"},
                {"id": "avionics", "name": "航电系统", "type": "component", "connectionType": "并联", "failureRate": 0.04, "mtbfHours": 120, "parentId": "aircraft"},
                {"id": "hydraulic", "name": "液压系统", "type": "component", "connectionType": "备用", "failureRate": 0.05, "mtbfHours": 105, "parentId": "aircraft"},
            ],
            "edges": [
                {"from": "aircraft", "to": "engine", "type": "串联", "weight": 1},
                {"from": "aircraft", "to": "avionics", "type": "并联", "weight": 0.6},
                {"from": "aircraft", "to": "hydraulic", "type": "备用", "weight": 0.8},
            ],
        }

    def test_build_diagram_creates_blocks(self) -> None:
        rbd = self._sample_rbd()
        blocks = build_reliability_diagram(rbd)
        self.assertEqual(len(blocks), 4)
        self.assertIn("aircraft", blocks)
        self.assertEqual(blocks["engine"].connection_type, "串联")

    def test_series_reliability_is_product(self) -> None:
        rbd = self._sample_rbd()
        blocks = build_reliability_diagram(rbd)
        reliability = evaluate_system_reliability(blocks, dt_hours=1.0)
        self.assertGreater(reliability, 0.0)
        self.assertLessEqual(reliability, 1.0)

    def test_series_lower_than_parallel(self) -> None:
        blocks_series = build_reliability_diagram({
            "nodes": [
                {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
                {"id": "a", "name": "a", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
                {"id": "b", "name": "b", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
            ],
            "edges": [
                {"from": "s", "to": "a", "type": "串联"},
                {"from": "s", "to": "b", "type": "串联"},
            ],
        })
        blocks_parallel = build_reliability_diagram({
            "nodes": [
                {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
                {"id": "a", "name": "a", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
                {"id": "b", "name": "b", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
            ],
            "edges": [
                {"from": "s", "to": "a", "type": "并联"},
                {"from": "s", "to": "b", "type": "并联"},
            ],
        })
        r_series = evaluate_system_reliability(blocks_series, 1.0)
        r_parallel = evaluate_system_reliability(blocks_parallel, 1.0)
        self.assertGreater(r_parallel, r_series)

    def test_standby_reliability_between_series_and_parallel(self) -> None:
        rbd_series = {"nodes": [
            {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
            {"id": "a", "name": "a", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
            {"id": "b", "name": "b", "type": "component", "connectionType": "串联", "failureRate": 0.1, "parentId": "s"},
        ], "edges": [{"from": "s", "to": "a", "type": "串联"}, {"from": "s", "to": "b", "type": "串联"}]}
        rbd_standby = {"nodes": [
            {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
            {"id": "a", "name": "a", "type": "component", "connectionType": "备用", "failureRate": 0.1, "parentId": "s"},
            {"id": "b", "name": "b", "type": "component", "connectionType": "备用", "failureRate": 0.1, "parentId": "s"},
        ], "edges": [{"from": "s", "to": "a", "type": "备用"}, {"from": "s", "to": "b", "type": "备用"}]}
        rbd_parallel = {"nodes": [
            {"id": "s", "name": "s", "type": "system", "connectionType": "串联", "failureRate": 0.1, "parentId": None},
            {"id": "a", "name": "a", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
            {"id": "b", "name": "b", "type": "component", "connectionType": "并联", "failureRate": 0.1, "parentId": "s"},
        ], "edges": [{"from": "s", "to": "a", "type": "并联"}, {"from": "s", "to": "b", "type": "并联"}]}
        r_s = evaluate_system_reliability(build_reliability_diagram(rbd_series), 1.0)
        r_sb = evaluate_system_reliability(build_reliability_diagram(rbd_standby), 1.0)
        r_p = evaluate_system_reliability(build_reliability_diagram(rbd_parallel), 1.0)
        self.assertGreater(r_sb, r_s)
        self.assertLessEqual(r_sb, r_p)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_reliability -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement reliability module**

`independent-mesa/independent_mesa/reliability.py`:
```python
"""Reliability block diagram: series, parallel, standby connections."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ReliabilityBlock:
    id: str
    name: str
    block_type: str
    connection_type: str
    failure_rate: float
    mtbf_hours: float
    parent_id: str | None = None
    children: list["ReliabilityBlock"] = field(default_factory=list)
    weight: float = 1.0


def build_reliability_diagram(rbd: dict[str, Any]) -> dict[str, ReliabilityBlock]:
    """Build a reliability block diagram from the import package's reliabilityBlockDiagram."""
    blocks: dict[str, ReliabilityBlock] = {}
    edges = rbd.get("edges", [])
    edge_map: dict[str, float] = {}
    for edge in edges:
        edge_map[str(edge.get("to"))] = float(edge.get("weight", 1.0))

    for node in rbd.get("nodes", []):
        node_id = str(node["id"])
        block = ReliabilityBlock(
            id=node_id,
            name=str(node.get("name", node_id)),
            block_type=str(node.get("type", "component")),
            connection_type=str(node.get("connectionType", "串联")),
            failure_rate=float(node.get("failureRate", 0.0) or 0),
            mtbf_hours=float(node.get("mtbfHours", 0) or 0),
            parent_id=str(node["parentId"]) if node.get("parentId") else None,
            weight=edge_map.get(node_id, 1.0),
        )
        blocks[node_id] = block
    for block in blocks.values():
        if block.parent_id and block.parent_id in blocks:
            blocks[block.parent_id].children.append(block)
    return blocks


def evaluate_system_reliability(
    blocks: dict[str, ReliabilityBlock],
    dt_hours: float,
) -> float:
    """Evaluate top-level system reliability over dt_hours."""
    roots = [b for b in blocks.values() if b.parent_id is None]
    if not roots:
        return 1.0
    root = roots[0]
    return _evaluate_block_reliability(root, dt_hours)


def _evaluate_block_reliability(block: ReliabilityBlock, dt_hours: float) -> float:
    """Recursively evaluate a block's reliability based on its children's connection type."""
    if not block.children:
        if block.failure_rate <= 0:
            return 1.0
        return math.exp(-block.failure_rate * dt_hours)

    child_reliabilities = [_evaluate_block_reliability(child, dt_hours) for child in block.children]
    connection = block.connection_type

    if "并联" in connection or "parallel" in connection.lower():
        fail_probs = [1.0 - r for r in child_reliabilities]
        return 1.0 - math.prod(fail_probs)

    if "备用" in connection or "standby" in connection.lower():
        primary_r = child_reliabilities[0] if child_reliabilities else 1.0
        backup_r = child_reliabilities[1] if len(child_reliabilities) > 1 else 1.0
        return primary_r + (1.0 - primary_r) * backup_r * block.weight

    return math.prod(child_reliabilities)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_reliability -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/reliability.py independent-mesa/tests/test_reliability.py
git commit -m "feat: add reliability block diagram (series/parallel/standby)"
```

---

### Task 6: Mission Scheduler — Weekday Assignment + Composite Task Selection

**Files:**
- Create: `independent-mesa/independent_mesa/mission_scheduler.py`
- Test: `independent-mesa/tests/test_mission_scheduler.py`

- [ ] **Step 1: Write failing tests**

`independent-mesa/tests/test_mission_scheduler.py`:
```python
from __future__ import annotations

import unittest

from independent_mesa.mission_scheduler import (
    MissionScheduler,
    MissionWave,
)


def _sample_mission_profile() -> dict:
    return {
        "id": "mission-profile-day-night",
        "durationHours": 24,
        "basicMission": {
            "minRequiredSorties": 5,
            "taskDurationMinutes": 180,
            "preparationMinutes": 50,
            "cancelMinutes": 20,
        },
        "compositeTasks": [
            {
                "id": "composite-day-cap",
                "name": "昼间制空复合任务",
                "taskItems": [{
                    "id": "day-cap-main",
                    "basicTaskName": "近海制空巡逻任务",
                    "equipmentType": "J-15",
                    "equipmentQuantity": 4,
                    "taskDispatchTime": "07:15",
                    "firstWaveTime": "08:00",
                    "recoveryTime": "11:00",
                    "priority": 1,
                    "minRequiredSystems": 4,
                    "dailyRepeatCount": 2,
                    "intervalHours": 6,
                    "preparationMinutes": 50,
                }],
            },
            {
                "id": "composite-night-alert",
                "name": "夜间警戒复合任务",
                "taskItems": [{
                    "id": "night-alert-main",
                    "basicTaskName": "远海警戒任务",
                    "equipmentType": "J-35",
                    "equipmentQuantity": 3,
                    "taskDispatchTime": "19:30",
                    "firstWaveTime": "20:15",
                    "recoveryTime": "23:30",
                    "priority": 2,
                    "minRequiredSystems": 3,
                    "dailyRepeatCount": 1,
                    "intervalHours": 8,
                    "preparationMinutes": 55,
                }],
            },
        ],
        "periodicTasks": [{
            "id": "periodic-carrier-day-night",
            "repeatCycleDays": 7,
            "weekdayAssignments": {
                "monday": "composite-day-cap",
                "tuesday": "composite-day-cap",
                "wednesday": "composite-night-alert",
                "thursday": "composite-day-cap",
                "friday": "composite-day-cap",
                "saturday": "composite-night-alert",
                "sunday": "composite-day-cap",
            },
        }],
    }


class TestMissionScheduler(unittest.TestCase):
    def test_weekday_monday_selects_day_cap(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(0)  # day 0 = Monday
        self.assertEqual(composite["id"], "composite-day-cap")

    def test_weekday_wednesday_selects_night_alert(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(2)  # day 2 = Wednesday
        self.assertEqual(composite["id"], "composite-night-alert")

    def test_weekday_wraps_after_cycle(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(7)  # day 7 = Monday again
        self.assertEqual(composite["id"], "composite-day-cap")

    def test_generate_waves_for_day_cap(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(0)
        waves = scheduler.generate_waves_for_day(0, composite)
        self.assertEqual(len(waves), 2)  # dailyRepeatCount=2
        self.assertIsInstance(waves[0], MissionWave)
        self.assertEqual(waves[0].required_aircraft, 4)
        self.assertEqual(waves[0].aircraft_type, "J-15")
        self.assertEqual(waves[0].duration_minutes, 180)

    def test_wave_times_parsed_from_first_wave_time(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        composite = scheduler.get_composite_for_day(0)
        waves = scheduler.generate_waves_for_day(0, composite)
        # firstWaveTime "08:00" → 480 minutes
        self.assertEqual(waves[0].planned_start, 480.0)
        # second wave 480 + 6*60 = 840
        self.assertEqual(waves[1].planned_start, 840.0)

    def test_cancel_minutes_from_basic_mission(self) -> None:
        scheduler = MissionScheduler(_sample_mission_profile())
        self.assertEqual(scheduler.cancel_minutes, 20)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_mission_scheduler -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement mission scheduler**

`independent-mesa/independent_mesa/mission_scheduler.py`:
```python
"""Mission scheduler: composite tasks, periodic weekday assignments, wave generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


_WEEKDAY_KEYS = [
    "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday",
]


@dataclass
class MissionWave:
    wave_id: int
    planned_start: float
    duration_minutes: float
    required_aircraft: int
    aircraft_type: str
    preparation_minutes: float
    recovery_time: float
    priority: int
    mission_area_id: str | None = None
    threat_level: str = "中"
    status: str = "scheduled"
    actual_start: float | None = None
    return_time: float | None = None
    assigned_tail_numbers: list[str] = None


class MissionScheduler:
    """Schedules composite and periodic tasks based on weekday assignments."""

    def __init__(self, mission_profile: dict[str, Any]) -> None:
        self.mission_profile = mission_profile
        self.composite_tasks = {
            str(ct["id"]): ct for ct in mission_profile.get("compositeTasks", [])
        }
        periodic = mission_profile.get("periodicTasks", [])
        self.periodic_task = periodic[0] if periodic else {}
        self.repeat_cycle_days = int(self.periodic_task.get("repeatCycleDays", 7))
        self.weekday_assignments = self.periodic_task.get("weekdayAssignments", {})
        basic = mission_profile.get("basicMission", {})
        self.cancel_minutes = float(basic.get("cancelMinutes", 20))
        self.min_required_sorties = int(basic.get("minRequiredSorties", 1))
        self.task_duration_minutes = float(basic.get("taskDurationMinutes", 90))
        self.preparation_minutes = float(basic.get("preparationMinutes", 50))
        self._wave_counter = 0

    def get_composite_for_day(self, day_index: int) -> dict[str, Any]:
        """Return the composite task assigned to the given day (0-based, wraps over cycle)."""
        weekday_index = day_index % self.repeat_cycle_days
        weekday_key = _WEEKDAY_KEYS[weekday_index % 7]
        composite_id = str(self.weekday_assignments.get(weekday_key, ""))
        return self.composite_tasks.get(composite_id, next(iter(self.composite_tasks.values())))

    def generate_waves_for_day(self, day_index: int, composite: dict[str, Any]) -> list[MissionWave]:
        """Generate mission waves for a day based on the composite task's taskItems."""
        day_offset_minutes = day_index * 24 * 60
        waves: list[MissionWave] = []
        for task_item in composite.get("taskItems", []):
            first_wave_time = _parse_time_to_minutes(str(task_item.get("firstWaveTime", "08:00")))
            recovery_time = _parse_time_to_minutes(str(task_item.get("recoveryTime", "11:00")))
            daily_repeat = int(task_item.get("dailyRepeatCount", 1))
            interval_hours = float(task_item.get("intervalHours", 6))
            duration = float(task_item.get("taskDurationMinutes", self.task_duration_minutes))
            prep = float(task_item.get("preparationMinutes", self.preparation_minutes))
            for repeat_idx in range(daily_repeat):
                self._wave_counter += 1
                wave_start = day_offset_minutes + first_wave_time + repeat_idx * interval_hours * 60
                waves.append(MissionWave(
                    wave_id=self._wave_counter,
                    planned_start=wave_start,
                    duration_minutes=duration,
                    required_aircraft=int(task_item.get("minRequiredSystems", task_item.get("equipmentQuantity", 1))),
                    aircraft_type=str(task_item.get("equipmentType", "J-15")),
                    preparation_minutes=prep,
                    recovery_time=day_offset_minutes + recovery_time,
                    priority=int(task_item.get("priority", 1)),
                ))
        return waves


def _parse_time_to_minutes(time_str: str) -> float:
    """Parse 'HH:MM' into minutes from midnight."""
    parts = time_str.strip().split(":")
    if len(parts) < 2:
        return 480.0
    return float(parts[0]) * 60 + float(parts[1])
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_mission_scheduler -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/mission_scheduler.py independent-mesa/tests/test_mission_scheduler.py
git commit -m "feat: add mission scheduler with weekday assignment and wave generation"
```

---

### Task 7: Activity Planner — Job DAG + Duration Sampling

**Files:**
- Create: `independent-mesa/independent_mesa/activity_planner.py`
- Test: `independent-mesa/tests/test_activity_planner.py`

- [ ] **Step 1: Write failing tests**

`independent-mesa/tests/test_activity_planner.py`:
```python
from __future__ import annotations

import unittest

import numpy as np

from independent_mesa.activity_planner import (
    ActivityJob,
    ActivityPlanner,
    sample_duration,
    build_job_dag,
    topological_sort,
)


def _sample_activities() -> list[dict]:
    return [
        {
            "id": "preflight", "name": "飞行前保障", "activityType": "飞行前保障",
            "equipmentId": "j15-avionics", "resourceId": "carrier-deck",
            "durationHours": 1, "requiredPersonnel": 2, "requiredDevices": 1,
            "spareType": None, "spareQuantity": 0, "priority": 1,
            "jobs": [
                {
                    "activityCode": "OPS-001", "workName": "机务检查", "predecessors": [],
                    "durationMinutes": 45,
                    "durationProfile": {"distributionType": "三角分布", "min": 35, "mode": 45, "max": 60},
                    "personnel": "机务/航电,2", "facility": "甲板保障站位",
                    "equipment": "检测仪,DT-01,1", "spare": "无",
                },
                {
                    "activityCode": "OPS-002", "workName": "燃油加注", "predecessors": ["OPS-001"],
                    "durationMinutes": 60,
                    "durationProfile": {"distributionType": "均匀分布", "min": 50, "max": 70},
                    "personnel": "机务/油料,1", "facility": "甲板加油站位",
                    "equipment": "加油车,F-01,1", "spare": "无",
                },
            ],
        },
        {
            "id": "corrective", "name": "航电模块故障修复", "activityType": "修复性维修",
            "equipmentId": "j15-avionics", "resourceId": "carrier-deck",
            "durationHours": 3, "requiredPersonnel": 3, "requiredDevices": 1,
            "spareType": "航电模块", "spareQuantity": 1, "priority": 1,
            "repairDistribution": {"distributionType": "对数正态分布", "params": "mu=5.1, sigma=0.35"},
            "jobs": [
                {
                    "activityCode": "REP-001", "workName": "故障定位", "predecessors": [],
                    "durationMinutes": 40,
                    "durationProfile": {"distributionType": "三角分布", "min": 30, "mode": 40, "max": 55},
                    "personnel": "维修/航电,2", "facility": "维修工位",
                    "equipment": "检测仪,DT-01,1", "spare": "无",
                },
                {
                    "activityCode": "REP-002", "workName": "换件维修", "predecessors": ["REP-001"],
                    "durationMinutes": 90,
                    "durationProfile": {"distributionType": "正态分布", "mean": 90, "stdDev": 15},
                    "personnel": "维修/航电,2", "facility": "维修工位",
                    "equipment": "通用工具箱,TK-01,1", "spare": "航电模块,LRU,1",
                },
            ],
        },
    ]


class TestDurationSampling(unittest.TestCase):
    def test_triangular_in_range(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "三角分布", "min": 35, "mode": 45, "max": 60}, rng)
            self.assertGreaterEqual(d, 35)
            self.assertLessEqual(d, 60)

    def test_uniform_in_range(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "均匀分布", "min": 50, "max": 70}, rng)
            self.assertGreaterEqual(d, 50)
            self.assertLessEqual(d, 70)

    def test_normal_positive(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "正态分布", "mean": 90, "stdDev": 15}, rng)
            self.assertGreater(d, 0)

    def test_fixed_value(self) -> None:
        rng = np.random.default_rng(0)
        d = sample_duration({"distributionType": "固定值", "value": 30}, rng)
        self.assertEqual(d, 30)

    def test_lognormal_positive(self) -> None:
        rng = np.random.default_rng(0)
        for _ in range(100):
            d = sample_duration({"distributionType": "对数正态分布", "params": "mu=5.1, sigma=0.35"}, rng)
            self.assertGreater(d, 0)

    def test_unknown_falls_back_to_duration_minutes(self) -> None:
        rng = np.random.default_rng(0)
        d = sample_duration({"distributionType": "未知"}, rng, fallback_minutes=42)
        self.assertEqual(d, 42)


class TestJobDAG(unittest.TestCase):
    def test_build_dag_preserves_predecessors(self) -> None:
        dag = build_job_dag(_sample_activities()[0]["jobs"])
        self.assertIn("OPS-001", dag)
        self.assertIn("OPS-002", dag)
        self.assertEqual(list(dag.predecessors("OPS-002")), ["OPS-001"])

    def test_topological_sort_orders_predecessors_first(self) -> None:
        dag = build_job_dag(_sample_activities()[0]["jobs"])
        order = topological_sort(dag)
        self.assertEqual(order, ["OPS-001", "OPS-002"])

    def test_cycle_detected_raises(self) -> None:
        import networkx as nx
        dag = nx.DiGraph()
        dag.add_edge("A", "B")
        dag.add_edge("B", "A")
        with self.assertRaises(ValueError):
            topological_sort(dag)


class TestActivityPlanner(unittest.TestCase):
    def test_create_activity_job(self) -> None:
        planner = ActivityPlanner(_sample_activities())
        job = planner.create_activity_job("preflight", aircraft_tail="J15-101")
        self.assertIsInstance(job, ActivityJob)
        self.assertEqual(job.activity_id, "preflight")
        self.assertEqual(len(job.tasks), 2)
        self.assertEqual(job.tasks[0]["activityCode"], "OPS-001")

    def test_preventive_activity_exists(self) -> None:
        activities = _sample_activities() + [{
            "id": "preventive", "name": "8小时定检", "activityType": "预防性维修",
            "equipmentId": "j35-hydraulic", "resourceId": "carrier-deck",
            "durationHours": 2, "requiredPersonnel": 2, "requiredDevices": 1,
            "spareType": "液压备件", "spareQuantity": 1, "priority": 2,
            "calendarDayInterval": 1, "runHourInterval": 8, "takeoffLandingInterval": 6,
            "calendarDayFloatRatio": 0.1, "runHourFloatRatio": 0.15, "takeoffLandingFloatRatio": 0.1,
            "jobs": [{"activityCode": "PM-001", "workName": "定检准备", "predecessors": [],
                      "durationMinutes": 30, "durationProfile": {"distributionType": "固定值", "value": 30},
                      "personnel": "维修/机体,1", "facility": "定检工位", "equipment": "检查灯,LT-01,1", "spare": "无"}],
        }]
        planner = ActivityPlanner(activities)
        preventive = planner.get_activity("preventive")
        self.assertIsNotNone(preventive)
        self.assertEqual(preventive["calendarDayInterval"], 1)

    def test_check_preventive_due_by_flight_hours(self) -> None:
        activities = _sample_activities() + [{
            "id": "preventive", "name": "8小时定检", "activityType": "预防性维修",
            "equipmentId": "j35-hydraulic", "resourceId": "carrier-deck",
            "durationHours": 2, "requiredPersonnel": 2, "requiredDevices": 1,
            "spareType": "液压备件", "spareQuantity": 1, "priority": 2,
            "useCalendarRule": True, "calendarDayInterval": 1, "calendarDayFloatRatio": 0.1,
            "useFlightHourRule": True, "runHourInterval": 8, "runHourFloatRatio": 0.15,
            "useTakeoffLandingRule": True, "takeoffLandingInterval": 6, "takeoffLandingFloatRatio": 0.1,
            "jobs": [{"activityCode": "PM-001", "workName": "定检准备", "predecessors": [],
                      "durationMinutes": 30, "durationProfile": {"distributionType": "固定值", "value": 30},
                      "personnel": "维修/机体,1", "facility": "定检工位", "equipment": "检查灯,LT-01,1", "spare": "无"}],
        }]
        planner = ActivityPlanner(activities)
        due = planner.check_preventive_due(
            flight_hours_since_last=10.0,
            days_since_last=0.0,
            landings_since_last=0,
        )
        self.assertTrue(due)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_activity_planner -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement activity planner**

`independent-mesa/independent_mesa/activity_planner.py`:
```python
"""Support activity planner: job DAG, duration profile sampling, preventive triggers."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import networkx as nx
import numpy as np


@dataclass
class ActivityJob:
    activity_id: str
    activity_type: str
    aircraft_tail: str
    equipment_id: str
    resource_id: str
    tasks: list[dict[str, Any]]
    priority: int
    required_personnel: int
    required_devices: int
    spare_type: str | None
    spare_quantity: int
    task_index: int = 0
    state: str = "waiting"
    remaining: float = 0.0
    active_task: dict[str, Any] | None = None
    started_time: float | None = None
    completed_time: float | None = None
    created_time: float = 0.0


def sample_duration(
    profile: dict[str, Any],
    rng: np.random.Generator,
    fallback_minutes: float = 30.0,
) -> float:
    """Sample a duration in minutes from a durationProfile dict."""
    dist_type = str(profile.get("distributionType", ""))
    if "三角" in dist_type or "triangular" in dist_type.lower():
        return float(rng.triangular(
            float(profile.get("min", 0)),
            float(profile.get("max", fallback_minutes)),
            float(profile.get("mode", fallback_minutes)),
        ))
    if "均匀" in dist_type or "uniform" in dist_type.lower():
        return float(rng.uniform(
            float(profile.get("min", 0)),
            float(profile.get("max", fallback_minutes)),
        ))
    if "正态" in dist_type or "normal" in dist_type.lower():
        mean = float(profile.get("mean", fallback_minutes))
        sigma = float(profile.get("stdDev", mean * 0.1))
        return max(0.0, float(rng.normal(mean, sigma)))
    if "固定" in dist_type or "fixed" in dist_type.lower():
        return float(profile.get("value", fallback_minutes))
    if "对数正态" in dist_type or "lognormal" in dist_type.lower():
        params = str(profile.get("params", "mu=5, sigma=0.3"))
        mu = _extract_param(params, "mu", 5.0)
        sigma = _extract_param(params, "sigma", 0.3)
        return float(np.random.default_rng().lognormal(mu, sigma))
    return fallback_minutes


def _extract_param(params_str: str, key: str, fallback: float) -> float:
    match = re.search(rf"{key}\s*=\s*([0-9.eE+-]+)", params_str)
    if match:
        return float(match.group(1))
    return fallback


def build_job_dag(jobs: list[dict[str, Any]]) -> nx.DiGraph:
    """Build a networkx DAG from job list with predecessors."""
    dag = nx.DiGraph()
    for job in jobs:
        code = str(job["activityCode"])
        dag.add_node(code, job=job)
        for pred in job.get("predecessors", []):
            dag.add_edge(str(pred), code)
    if not nx.is_directed_acyclic_graph(dag):
        raise ValueError("Activity job DAG contains a cycle")
    return dag


def topological_sort(dag: nx.DiGraph) -> list[str]:
    """Return topological sort of DAG, raising on cycle."""
    if not nx.is_directed_acyclic_graph(dag):
        raise ValueError("Activity job DAG contains a cycle")
    return list(nx.topological_sort(dag))


class ActivityPlanner:
    """Manages support activities and creates ActivityJobs on demand."""

    def __init__(self, activities: list[dict[str, Any]]) -> None:
        self.activities = {str(a["id"]): a for a in activities}
        self._job_counter = 0

    def get_activity(self, activity_id: str) -> dict[str, Any] | None:
        return self.activities.get(activity_id)

    def create_activity_job(
        self,
        activity_id: str,
        aircraft_tail: str,
        sim_time: float = 0.0,
    ) -> ActivityJob:
        activity = self.activities[activity_id]
        self._job_counter += 1
        tasks_sorted = topological_sort(build_job_dag(activity["jobs"]))
        job_map = {str(j["activityCode"]): j for j in activity["jobs"]}
        tasks = [job_map[code] for code in tasks_sorted]
        return ActivityJob(
            activity_id=activity_id,
            activity_type=str(activity.get("activityType", "")),
            aircraft_tail=aircraft_tail,
            equipment_id=str(activity.get("equipmentId", "")),
            resource_id=str(activity.get("resourceId", "")),
            tasks=tasks,
            priority=int(activity.get("priority", 1)),
            required_personnel=int(activity.get("requiredPersonnel", 1)),
            required_devices=int(activity.get("requiredDevices", 1)),
            spare_type=str(activity["spareType"]) if activity.get("spareType") else None,
            spare_quantity=int(activity.get("spareQuantity", 0)),
            created_time=sim_time,
        )

    def check_preventive_due(
        self,
        flight_hours_since_last: float,
        days_since_last: float,
        landings_since_last: int,
    ) -> bool:
        """Check if preventive maintenance is due by any of the three rules."""
        for activity in self.activities.values():
            if activity.get("activityType") != "预防性维修":
                continue
            if activity.get("useCalendarRule", False):
                interval = float(activity.get("calendarDayInterval", 999))
                float_ratio = float(activity.get("calendarDayFloatRatio", 0))
                threshold = interval * (1 - float_ratio)
                if days_since_last >= threshold:
                    return True
            if activity.get("useFlightHourRule", False):
                interval = float(activity.get("runHourInterval", 999))
                float_ratio = float(activity.get("runHourFloatRatio", 0))
                threshold = interval * (1 - float_ratio)
                if flight_hours_since_last >= threshold:
                    return True
            if activity.get("useTakeoffLandingRule", False):
                interval = int(activity.get("takeoffLandingInterval", 999))
                float_ratio = float(activity.get("takeoffLandingFloatRatio", 0))
                threshold = interval * (1 - float_ratio)
                if landings_since_last >= threshold:
                    return True
        return False
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_activity_planner -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/activity_planner.py independent-mesa/tests/test_activity_planner.py
git commit -m "feat: add activity planner with DAG, duration sampling, preventive triggers"
```

---

### Task 8: Support Network — Nodes, Inventory, Transport

**Files:**
- Create: `independent-mesa/independent_mesa/support_network.py`
- Test: `independent-mesa/tests/test_support_network.py`

- [ ] **Step 1: Write failing tests**

`independent-mesa/tests/test_support_network.py`:
```python
from __future__ import annotations

import unittest

import numpy as np

from independent_mesa.support_network import (
    SupportNetwork,
    TransportOrder,
)


def _sample_resources() -> list[dict]:
    return [
        {
            "id": "carrier-deck", "name": "航母飞行甲板", "capacity": 4,
            "nodeType": "甲板保障点", "supportLevel": "一线保障",
            "personnelCapacity": 5, "equipmentCapacity": 3,
            "policy": "优先保障高优先级任务",
            "lateralSupportNodes": ["forward-sea-base"],
            "transportPolicies": [
                {"from": "carrier-stock", "to": "carrier-deck", "transportMode": "升降机转运",
                 "transportTimeHours": 1, "priority": 1, "capacity": 4}
            ],
            "inventory": {"发动机备件": 4, "航电模块": 6, "液压备件": 5},
        },
        {
            "id": "forward-sea-base", "name": "前出海上保障点", "capacity": 3,
            "nodeType": "海上保障点", "supportLevel": "前进保障",
            "personnelCapacity": 4, "equipmentCapacity": 2,
            "lateralSupportNodes": ["carrier-deck"],
            "transportPolicies": [
                {"from": "carrier-deck", "to": "forward-sea-base", "transportMode": "补给艇转运",
                 "transportTimeHours": 2, "priority": 1, "capacity": 2}
            ],
            "inventory": {"发动机备件": 2, "航电模块": 3, "液压备件": 2},
        },
        {
            "id": "carrier-stock", "name": "航母备件库", "capacity": 5,
            "nodeType": "备件库", "supportLevel": "后方保障",
            "personnelCapacity": 3, "equipmentCapacity": 2,
            "lateralSupportNodes": ["carrier-deck"],
            "transportPolicies": [
                {"from": "carrier-deck", "to": "carrier-stock", "transportMode": "返修转运",
                 "transportTimeHours": 3, "priority": 2, "capacity": 3}
            ],
            "inventory": {"发动机备件": 6, "航电模块": 8, "液压备件": 6},
        },
    ]


class TestSupportNetwork(unittest.TestCase):
    def test_init_creates_three_nodes(self) -> None:
        net = SupportNetwork(_sample_resources())
        self.assertIn("carrier-deck", net.nodes)
        self.assertIn("forward-sea-base", net.nodes)
        self.assertIn("carrier-stock", net.nodes)

    def test_initial_inventory(self) -> None:
        net = SupportNetwork(_sample_resources())
        self.assertEqual(net.nodes["carrier-deck"].inventory["发动机备件"], 4)
        self.assertEqual(net.nodes["carrier-stock"].inventory["航电模块"], 8)

    def test_consume_spare_decreases_inventory(self) -> None:
        net = SupportNetwork(_sample_resources())
        ok = net.consume_spare("carrier-deck", "航电模块", 2)
        self.assertTrue(ok)
        self.assertEqual(net.nodes["carrier-deck"].inventory["航电模块"], 4)

    def test_consume_spare_insufficient_returns_false(self) -> None:
        net = SupportNetwork(_sample_resources())
        ok = net.consume_spare("carrier-deck", "航电模块", 999)
        self.assertFalse(ok)

    def test_resource_pool_allocate_and_release(self) -> None:
        net = SupportNetwork(_sample_resources())
        pool = net.nodes["carrier-deck"].personnel_pool
        self.assertEqual(pool.available, 5)
        pool.allocate(2)
        self.assertEqual(pool.available, 3)
        pool.release(2)
        self.assertEqual(pool.available, 5)

    def test_transport_order_arrives(self) -> None:
        net = SupportNetwork(_sample_resources())
        order = net.create_transport_order(
            spare_type="发动机备件", quantity=2,
            from_node="carrier-stock", to_node="carrier-deck",
            transport_time_hours=1.0, sim_time=0.0,
        )
        self.assertIsInstance(order, TransportOrder)
        self.assertEqual(order.due_time, 60.0)
        # Before arrival
        self.assertEqual(net.nodes["carrier-deck"].inventory["发动机备件"], 4)
        # Advance to arrival
        net.process_arrivals(60.0)
        self.assertEqual(net.nodes["carrier-deck"].inventory["发动机备件"], 6)

    def test_critical_inventory_triggers_replenishment(self) -> None:
        net = SupportNetwork(_sample_resources())
        # Set critical inventory config via transport strategy
        net.check_and_trigger_replenishment(sim_time=0.0)
        # Carrier-deck has plenty, should not trigger
        self.assertEqual(len(net.pending_orders), 0)
        # Drain inventory to trigger
        net.nodes["carrier-deck"].inventory["航电模块"] = 1
        net.nodes["carrier-deck"].critical_inventory["航电模块"] = 2
        net.check_and_trigger_replenishment(sim_time=0.0)
        self.assertGreater(len(net.pending_orders), 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_support_network -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement support network**

`independent-mesa/independent_mesa/support_network.py`:
```python
"""Support network: 3-level nodes, resource pools, inventory, transport."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ResourcePool:
    capacity: int
    in_use: int = 0
    busy_time: float = 0.0
    work_count: int = 0

    @property
    def available(self) -> int:
        return self.capacity - self.in_use

    def allocate(self, amount: int) -> bool:
        if self.available < amount:
            return False
        self.in_use += amount
        self.work_count += amount
        return True

    def release(self, amount: int) -> None:
        self.in_use = max(0, self.in_use - amount)

    def charge_busy_time(self, dt: float) -> None:
        self.busy_time += self.in_use * dt

    def utilization(self, elapsed: float) -> float:
        if self.capacity <= 0 or elapsed <= 0:
            return 0.0
        return min(1.0, self.busy_time / (self.capacity * elapsed))


@dataclass
class SupportNode:
    id: str
    name: str
    node_type: str
    support_level: str
    capacity: int
    personnel_pool: ResourcePool
    equipment_pool: ResourcePool
    inventory: dict[str, int]
    critical_inventory: dict[str, int] = field(default_factory=dict)
    lateral_support_nodes: list[str] = field(default_factory=list)
    transport_policies: list[dict[str, Any]] = field(default_factory=list)
    policy: str = ""


@dataclass
class TransportOrder:
    order_id: int
    spare_type: str
    quantity: int
    from_node: str
    to_node: str
    transport_time_hours: float
    created_time: float
    due_time: float
    transport_mode: str = ""
    status: str = "in_transit"


class SupportNetwork:
    """Manages support nodes, their inventories, resource pools, and transport."""

    def __init__(self, resources: list[dict[str, Any]]) -> None:
        self.nodes: dict[str, SupportNode] = {}
        self._order_counter = 0
        self.pending_orders: list[TransportOrder] = []
        for res in resources:
            node_id = str(res["id"])
            personnel_cap = int(res.get("personnelCapacity", res.get("capacity", 1)))
            equip_cap = int(res.get("equipmentCapacity", res.get("capacity", 1)))
            self.nodes[node_id] = SupportNode(
                id=node_id,
                name=str(res.get("name", node_id)),
                node_type=str(res.get("nodeType", "")),
                support_level=str(res.get("supportLevel", "")),
                capacity=int(res.get("capacity", 1)),
                personnel_pool=ResourcePool(capacity=personnel_cap),
                equipment_pool=ResourcePool(capacity=equip_cap),
                inventory=dict(res.get("inventory", {})),
                lateral_support_nodes=list(res.get("lateralSupportNodes", [])),
                transport_policies=list(res.get("transportPolicies", [])),
                policy=str(res.get("policy", "")),
            )

    def consume_spare(self, node_id: str, spare_type: str, amount: int) -> bool:
        node = self.nodes.get(node_id)
        if node is None:
            return False
        current = node.inventory.get(spare_type, 0)
        if current < amount:
            return False
        node.inventory[spare_type] = current - amount
        return True

    def add_spare(self, node_id: str, spare_type: str, amount: int) -> None:
        node = self.nodes.get(node_id)
        if node is None:
            return
        node.inventory[spare_type] = node.inventory.get(spare_type, 0) + amount

    def create_transport_order(
        self,
        spare_type: str,
        quantity: int,
        from_node: str,
        to_node: str,
        transport_time_hours: float,
        sim_time: float,
        transport_mode: str = "",
    ) -> TransportOrder:
        self._order_counter += 1
        order = TransportOrder(
            order_id=self._order_counter,
            spare_type=spare_type,
            quantity=quantity,
            from_node=from_node,
            to_node=to_node,
            transport_time_hours=transport_time_hours,
            created_time=sim_time,
            due_time=sim_time + transport_time_hours * 60,
            transport_mode=transport_mode,
        )
        self.pending_orders.append(order)
        return order

    def process_arrivals(self, sim_time: float) -> None:
        arrived = [o for o in self.pending_orders if o.due_time <= sim_time]
        self.pending_orders = [o for o in self.pending_orders if o.due_time > sim_time]
        for order in arrived:
            order.status = "arrived"
            self.add_spare(order.to_node, order.spare_type, order.quantity)

    def check_and_trigger_replenishment(self, sim_time: float) -> None:
        """Check all nodes for critical inventory and trigger transport orders."""
        for node in self.nodes.values():
            for spare_type, quantity in node.inventory.items():
                critical = node.critical_inventory.get(spare_type, 0)
                if critical > 0 and quantity <= critical:
                    for policy in node.transport_policies:
                        from_id = str(policy.get("from", ""))
                        to_id = str(policy.get("to", ""))
                        if to_id == node.id and from_id in self.nodes:
                            source = self.nodes[from_id]
                            source_qty = source.inventory.get(spare_type, 0)
                            if source_qty > 0:
                                transfer = min(source_qty, int(policy.get("capacity", 1)))
                                self.create_transport_order(
                                    spare_type=spare_type,
                                    quantity=transfer,
                                    from_node=from_id,
                                    to_node=node.id,
                                    transport_time_hours=float(policy.get("transportTimeHours", 1)),
                                    sim_time=sim_time,
                                    transport_mode=str(policy.get("transportMode", "")),
                                )
                                source.inventory[spare_type] = source_qty - transfer
                                break

    def get_total_inventory(self, spare_type: str) -> int:
        return sum(node.inventory.get(spare_type, 0) for node in self.nodes.values())

    def charge_busy_time(self, dt: float) -> None:
        for node in self.nodes.values():
            node.personnel_pool.charge_busy_time(dt)
            node.equipment_pool.charge_busy_time(dt)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_support_network -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/support_network.py independent-mesa/tests/test_support_network.py
git commit -m "feat: add support network with nodes, inventory, transport"
```

---

### Task 9: Aircraft Agent + Model Integration

**Files:**
- Create: `independent-mesa/independent_mesa/agents.py`
- Create: `independent-mesa/independent_mesa/model.py`
- Create: `independent-mesa/independent_mesa/frames.py`
- Test: `independent-mesa/tests/test_model_integration.py`

- [ ] **Step 1: Write failing integration test**

`independent-mesa/tests/test_model_integration.py`:
```python
from __future__ import annotations

import json
import unittest
from pathlib import Path

from independent_mesa.model import IndependentMesaModel


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "import_package.json"


class TestModelIntegration(unittest.TestCase):
    def setUp(self) -> None:
        self.package = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_model_initializes_from_import_package(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        self.assertEqual(model.steps_planned, 48)
        self.assertEqual(len(model.aircraft), 6)
        self.assertIn("carrier-deck", model.support_network.nodes)

    def test_model_runs_48_steps_without_error(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        for _ in range(48):
            model.step()
        self.assertEqual(model.steps_run, 48)
        self.assertGreater(model.sim_time, 0)

    def test_snapshot_has_expected_fields(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        model.step()
        snap = model.snapshot()
        self.assertIn("time", snap)
        self.assertIn("aircraft_count", snap)
        self.assertIn("launched_sorties", snap)
        self.assertIn("spare_stock_total", snap)
        self.assertIn("sortie_completion_rate", snap)

    def test_visualization_state_has_full_structure(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        for _ in range(5):
            model.step()
        state = model.visualization_state()
        for key in ["snapshot", "aircraft", "resources", "spares", "missions", "jobs", "events"]:
            self.assertIn(key, state)

    def test_metrics_computed_at_end(self) -> None:
        model = IndependentMesaModel(self.package, steps=48, seed=20260621)
        for _ in range(48):
            model.step()
        metrics = model.compute_final_metrics()
        self.assertIn("sortie_completion_rate", metrics)
        self.assertIn("spare_fill_rate", metrics)
        self.assertGreaterEqual(metrics["sortie_completion_rate"], 0.0)
        self.assertLessEqual(metrics["sortie_completion_rate"], 1.0)

    def test_reproducible_with_same_seed(self) -> None:
        m1 = IndependentMesaModel(self.package, steps=10, seed=42)
        m2 = IndependentMesaModel(self.package, steps=10, seed=42)
        for _ in range(10):
            m1.step()
            m2.step()
        self.assertEqual(m1.snapshot()["launched_sorties"], m2.snapshot()["launched_sorties"])

    def test_threat_level_increases_failures(self) -> None:
        m_low = IndependentMesaModel(self.package, steps=48, seed=100)
        m_high = IndependentMesaModel(self.package, steps=48, seed=100, threat_multiplier_override=3.0)
        for _ in range(48):
            m_low.step()
            m_high.step()
        self.assertGreaterEqual(m_high.lru_failures, m_low.lru_failures)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_model_integration -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement AircraftAgent**

`independent-mesa/independent_mesa/agents.py`:
```python
"""AircraftAgent: Mesa agent carrying per-aircraft equipment state."""

from __future__ import annotations

from typing import Any

from mesa import Agent

from .equipment import EquipmentNode, build_equipment_tree


class AircraftAgent(Agent):
    """An aircraft with equipment tree, mission state, and history."""

    def __init__(
        self,
        model: "IndependentMesaModel",
        tail_number: str,
        aircraft_type: str,
        index: int,
        member_data: dict[str, Any],
        equipment_tree: dict[str, EquipmentNode],
    ) -> None:
        super().__init__(model)
        self.tail_number = tail_number
        self.aircraft_type = aircraft_type
        self.index = index
        self.remaining_life_hours = float(member_data.get("remainingLifeHours", 0))
        self.takeoff_landing_count = int(member_data.get("takeoffLandingCount", 0))
        self.deployment_location = str(member_data.get("deploymentLocation", ""))
        self.role = str(member_data.get("role", ""))
        self.status_label = str(member_data.get("status", "执行"))
        self.equipment_tree = equipment_tree
        self.phase = "idle"
        self.current_mission_id: int | None = None
        self.current_job_id: int | None = None
        self.scheduled_return_time: float | None = None
        self.failed_lru_id: str | None = None
        self.flight_hours_since_last_pm = 0.0
        self.days_since_last_pm = 0.0
        self.landings_since_last_pm = 0
        self.total_flight_hours = float(member_data.get("remainingLifeHours", 0))
        self.lru_failures = 0

    @property
    def is_mission_ready(self) -> bool:
        if self.phase != "ready":
            return False
        if self.failed_lru_id:
            return False
        for node in self.equipment_tree.values():
            if node.health == "failed":
                return False
        return True

    def get_failed_lrus(self) -> list[str]:
        return [n.id for n in self.equipment_tree.values() if n.health == "failed"]

    def restore_failed_lru(self, lru_id: str) -> None:
        if lru_id in self.equipment_tree:
            self.equipment_tree[lru_id].health = "healthy"
        self.failed_lru_id = None

    def equipment_snapshot(self) -> list[dict[str, Any]]:
        result = []
        for node in self.equipment_tree.values():
            if node.parent_id is None:
                result.append({
                    "id": node.id,
                    "name": node.name,
                    "health": node.health,
                    "accumulated_hours": round(node.accumulated_hours, 2),
                    "failure_count": node.failure_count,
                    "children": [
                        {
                            "id": child.id,
                            "name": child.name,
                            "health": child.health,
                            "accumulated_hours": round(child.accumulated_hours, 2),
                            "failure_count": child.failure_count,
                        }
                        for child in node.children
                    ],
                })
        return result
```

- [ ] **Step 4: Implement IndependentMesaModel**

`independent-mesa/independent_mesa/model.py`:
```python
"""IndependentMesaModel: orchestration layer consuming modeling-import-v1 data."""

from __future__ import annotations

import json
import copy
from pathlib import Path
from typing import Any

import numpy as np
from mesa import Model

from .equipment import (
    EquipmentNode,
    build_equipment_tree,
    age_and_sample_failures,
    decide_repair_or_replace,
    get_repair_duration,
    is_life_limit_exceeded,
    check_k_out_of_n,
)
from .reliability import build_reliability_diagram, evaluate_system_reliability
from .mission_scheduler import MissionScheduler, MissionWave
from .activity_planner import ActivityPlanner, ActivityJob, sample_duration
from .support_network import SupportNetwork, TransportOrder
from .agents import AircraftAgent


class IndependentMesaModel(Model):
    """Standalone Mesa model consuming a full modeling-import-v1 package."""

    def __init__(
        self,
        import_package: dict[str, Any],
        steps: int = 48,
        seed: int = 20260621,
        threat_multiplier_override: float | None = None,
    ) -> None:
        super().__init__(rng=seed)
        self.import_package = import_package
        self.steps_planned = steps
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.threat_multiplier_override = threat_multiplier_override

        objects = import_package.get("objects", {})
        mission_profile = objects.get("missionProfiles", [{}])[0]
        self.mission_profile = mission_profile
        self.duration_hours = float(mission_profile.get("durationHours", 24))
        self.tick_minutes = max(1.0, self.duration_hours * 60 / max(steps, 1))

        self.mission_scheduler = MissionScheduler(mission_profile)
        self.activity_planner = ActivityPlanner(objects.get("supportActivities", []))
        self.support_network = SupportNetwork(objects.get("supportResources", []))
        self.reliability_blocks = build_reliability_diagram(
            mission_profile.get("reliabilityBlockDiagram", {"nodes": [], "edges": []})
        )

        equipment = objects.get("equipment", {})
        self.pre_life_requirement_hours = float(equipment.get("preLifeRequirementHours", 0))
        self.min_required_sorties = int(equipment.get("minRequiredSorties", 1))

        combat_unit = mission_profile.get("combatUnit", {})
        members = combat_unit.get("members", [])
        self.aircraft_assets = objects.get("equipmentAssets", [])
        self.aircraft: list[AircraftAgent] = []
        for index, member in enumerate(members):
            tree = build_equipment_tree(copy.deepcopy(self.aircraft_assets))
            agent = AircraftAgent(
                model=self,
                tail_number=str(member.get("aircraftNo", f"AC-{index}")),
                aircraft_type=str(member.get("model", "J-15")),
                index=index,
                member_data=member,
                equipment_tree=tree,
            )
            self.aircraft.append(agent)

        self.mission_areas = {
            str(area["id"]): area for area in mission_profile.get("missionAreas", [])
        }
        self.airports = {
            str(ap["id"]): ap for ap in mission_profile.get("airports", [])
        }

        self.sim_time = 0.0
        self.steps_run = 0
        self.all_waves: list[MissionWave] = []
        self.active_waves: list[MissionWave] = []
        self.launched_sorties = 0
        self.completed_sorties = 0
        self.delayed_sorties = 0
        self.cancelled_sorties = 0
        self.lru_failures = 0
        self.repair_count = 0
        self.replace_count = 0
        self.total_departure_delay = 0.0
        self.activity_jobs: list[ActivityJob] = []
        self.completed_jobs: list[ActivityJob] = []
        self.event_log: list[dict[str, Any]] = []
        self._job_counter = 0
        self._day_index = 0
        self._waves_generated_for_days: set[int] = set()

    def step(self) -> None:
        self._generate_waves_for_current_day()
        self._return_due_aircraft()
        self._launch_due_waves()
        self._age_and_sample_failures()
        self._dispatch_support_jobs()
        self._advance_activity_jobs()
        self._check_preventive_maintenance()
        self.support_network.process_arrivals(self.sim_time)
        self.support_network.check_and_trigger_replenishment(self.sim_time)
        self.support_network.charge_busy_time(self.tick_minutes)
        self.sim_time += self.tick_minutes
        self.steps_run += 1
        for aircraft in self.aircraft:
            aircraft.days_since_last_pm += self.tick_minutes / (24 * 60)

    def _current_day_index(self) -> int:
        return int(self.sim_time / (24 * 60))

    def _generate_waves_for_current_day(self) -> None:
        day = self._current_day_index()
        if day in self._waves_generated_for_days:
            return
        composite = self.mission_scheduler.get_composite_for_day(day)
        waves = self.mission_scheduler.generate_waves_for_day(day, composite)
        self.all_waves.extend(waves)
        self._waves_generated_for_days.add(day)

    def _return_due_aircraft(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.phase != "flying":
                continue
            if aircraft.scheduled_return_time is None or aircraft.scheduled_return_time > self.sim_time:
                continue
            mission_duration_hours = 0
            wave = self._find_wave(aircraft.current_mission_id)
            if wave:
                mission_duration_hours = wave.duration_minutes / 60.0
            aircraft.total_flight_hours += mission_duration_hours
            aircraft.takeoff_landing_count += 1
            aircraft.landings_since_last_pm += 1
            aircraft.flight_hours_since_last_pm += mission_duration_hours
            aircraft.phase = "post_support"
            aircraft.scheduled_return_time = None
            wave_id = aircraft.current_mission_id
            aircraft.current_mission_id = None
            self._sample_post_mission_failure(aircraft, mission_duration_hours, wave)
            if wave and not any(a.current_mission_id == wave.wave_id for a in self.aircraft):
                wave.status = "completed"
                self.completed_sorties += len(wave.assigned_tail_numbers or [])
                self._log("wave_completed", f"wave {wave.wave_id} completed")

    def _sample_post_mission_failure(
        self,
        aircraft: AircraftAgent,
        mission_hours: float,
        wave: MissionWave | None,
    ) -> None:
        threat_multiplier = 1.0
        if wave and wave.threat_level == "高":
            threat_multiplier = 1.3
        elif wave and wave.threat_level == "中":
            threat_multiplier = 1.1
        if self.threat_multiplier_override is not None:
            threat_multiplier = self.threat_multiplier_override
        failed = age_and_sample_failures(
            aircraft.equipment_tree,
            mission_hours,
            self.rng,
            threat_multiplier,
        )
        if failed:
            aircraft.failed_lru_id = failed[0]
            aircraft.lru_failures += 1
            self.lru_failures += 1
            self._log("lru_failure", f"{aircraft.tail_number} returned with {failed[0]} fault")

    def _launch_due_waves(self) -> None:
        for wave in self.all_waves:
            if wave.status not in ("scheduled", "delayed"):
                continue
            if self.sim_time < wave.planned_start:
                continue
            ready_aircraft = [
                a for a in self.aircraft
                if a.is_mission_ready and a.aircraft_type == wave.aircraft_type
            ]
            deadline = wave.planned_start + self.mission_scheduler.cancel_minutes
            if len(ready_aircraft) < wave.required_aircraft:
                wave.status = "delayed"
                if self.sim_time >= deadline:
                    wave.status = "cancelled"
                    self.cancelled_sorties += wave.required_aircraft
                    self._log("wave_cancelled", f"wave {wave.wave_id} cancelled")
                continue
            assigned = sorted(ready_aircraft, key=lambda a: a.tail_number)[: wave.required_aircraft]
            wave.status = "flying"
            wave.actual_start = self.sim_time
            wave.return_time = self.sim_time + wave.duration_minutes
            wave.assigned_tail_numbers = [a.tail_number for a in assigned]
            delay = max(0.0, self.sim_time - wave.planned_start)
            self.total_departure_delay += delay * len(assigned)
            if delay > 0:
                self.delayed_sorties += len(assigned)
            self.launched_sorties += len(assigned)
            for a in assigned:
                a.phase = "flying"
                a.current_mission_id = wave.wave_id
                a.scheduled_return_time = wave.return_time
            self._log("wave_launched", f"wave {wave.wave_id} launched with {len(assigned)} aircraft")

    def _find_wave(self, wave_id: int | None) -> MissionWave | None:
        if wave_id is None:
            return None
        for wave in self.all_waves:
            if wave.wave_id == wave_id:
                return wave
        return None

    def _age_and_sample_failures(self) -> None:
        dt_hours = self.tick_minutes / 60.0
        for aircraft in self.aircraft:
            if aircraft.phase == "flying":
                continue
            failed = age_and_sample_failures(
                aircraft.equipment_tree,
                dt_hours,
                self.rng,
                self.threat_multiplier_override or 1.0,
            )
            if failed:
                aircraft.failed_lru_id = failed[0]
                aircraft.lru_failures += 1
                self.lru_failures += 1

    def _dispatch_support_jobs(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.phase == "post_support":
                activity_id = "corrective" if aircraft.failed_lru_id else "preflight"
                if self.activity_planner.get_activity(activity_id):
                    self._create_job(aircraft, activity_id)
            elif aircraft.phase == "idle" and aircraft.failed_lru_id:
                if self.activity_planner.get_activity("corrective"):
                    self._create_job(aircraft, "corrective")

    def _create_job(self, aircraft: AircraftAgent, activity_id: str) -> None:
        self._job_counter += 1
        job = self.activity_planner.create_activity_job(
            activity_id, aircraft.tail_number, self.sim_time,
        )
        aircraft.current_job_id = self._job_counter
        if activity_id == "corrective":
            aircraft.phase = "maintenance"
        elif activity_id == "preflight":
            aircraft.phase = "preparing"
        self.activity_jobs.append(job)
        self._log("job_created", f"{activity_id} job for {aircraft.tail_number}")

    def _advance_activity_jobs(self) -> None:
        waiting = [j for j in self.activity_jobs if j.state == "waiting"]
        waiting.sort(key=lambda j: (j.priority, j.created_time))
        for job in waiting:
            task = job.tasks[job.task_index] if job.task_index < len(job.tasks) else None
            if task is None:
                self._complete_job(job)
                continue
            node = self.support_network.nodes.get(job.resource_id)
            if node is None:
                continue
            if not self._can_allocate_resources(node, job):
                continue
            self._allocate_resources(node, job)
            if job.spare_type and job.spare_quantity > 0:
                if not self.support_network.consume_spare(job.resource_id, job.spare_type, job.spare_quantity):
                    self._release_resources(node, job)
                    continue
            job.active_task = task
            job.remaining = sample_duration(task.get("durationProfile", {}), self.rng, float(task.get("durationMinutes", 30)))
            job.state = "active"
            if job.started_time is None:
                job.started_time = self.sim_time

        active = [j for j in self.activity_jobs if j.state == "active"]
        for job in active:
            job.remaining -= self.tick_minutes
            if job.remaining > 0:
                continue
            node = self.support_network.nodes.get(job.resource_id)
            if node:
                self._release_resources(node, job)
            job.active_task = None
            job.task_index += 1
            if job.task_index >= len(job.tasks):
                self._complete_job(job)
            else:
                job.state = "waiting"

    def _can_allocate_resources(self, node: Any, job: ActivityJob) -> bool:
        return node.personnel_pool.available >= job.required_personnel

    def _allocate_resources(self, node: Any, job: ActivityJob) -> None:
        node.personnel_pool.allocate(job.required_personnel)

    def _release_resources(self, node: Any, job: ActivityJob) -> None:
        node.personnel_pool.release(job.required_personnel)

    def _complete_job(self, job: ActivityJob) -> None:
        job.state = "completed"
        job.completed_time = self.sim_time + self.tick_minutes
        aircraft = next((a for a in self.aircraft if a.tail_number == job.aircraft_tail), None)
        if aircraft:
            aircraft.current_job_id = None
            if job.activity_id == "corrective":
                if aircraft.failed_lru_id:
                    decision = decide_repair_or_replace(
                        aircraft.equipment_tree.get(aircraft.failed_lru_id, {}).special_repair_profile or {},
                        self.rng,
                    )
                    if decision == "repair":
                        self.repair_count += 1
                    else:
                        self.replace_count += 1
                    aircraft.restore_failed_lru(aircraft.failed_lru_id)
                aircraft.phase = "ready"
            elif job.activity_id == "preflight":
                aircraft.phase = "ready"
            elif job.activity_id == "preventive":
                aircraft.flight_hours_since_last_pm = 0
                aircraft.days_since_last_pm = 0
                aircraft.landings_since_last_pm = 0
                aircraft.phase = "ready"
        self.completed_jobs.append(job)
        self._log("job_completed", f"{job.activity_id} job for {job.aircraft_tail}")

    def _check_preventive_maintenance(self) -> None:
        for aircraft in self.aircraft:
            if aircraft.phase not in ("idle", "ready"):
                continue
            due = self.activity_planner.check_preventive_due(
                aircraft.flight_hours_since_last_pm,
                aircraft.days_since_last_pm,
                aircraft.landings_since_last_pm,
            )
            if due and self.activity_planner.get_activity("preventive"):
                self._create_job(aircraft, "preventive")

    def _log(self, event: str, message: str) -> None:
        self.event_log.append({"time": self.sim_time, "event": event, "message": message})
        if len(self.event_log) > 500:
            self.event_log = self.event_log[-500:]

    def snapshot(self) -> dict[str, Any]:
        planned = sum(w.required_aircraft for w in self.all_waves if w.status in ("scheduled", "delayed", "flying"))
        planned_total = sum(w.required_aircraft for w in self.all_waves)
        spare_total = sum(self.support_network.get_total_inventory(st) for st in set())
        spare_stock = sum(
            sum(node.inventory.values()) for node in self.support_network.nodes.values()
        )
        ready_count = sum(1 for a in self.aircraft if a.is_mission_ready)
        reliability = evaluate_system_reliability(self.reliability_blocks, self.tick_minutes / 60)
        return {
            "time": self.sim_time,
            "elapsed_hours": self.sim_time / 60.0,
            "aircraft_count": len(self.aircraft),
            "ready_aircraft": ready_count,
            "flying_aircraft": sum(1 for a in self.aircraft if a.phase == "flying"),
            "maintenance_aircraft": sum(1 for a in self.aircraft if a.phase == "maintenance"),
            "planned_sorties": planned_total,
            "launched_sorties": self.launched_sorties,
            "completed_sorties": self.completed_sorties,
            "delayed_sorties": self.delayed_sorties,
            "cancelled_sorties": self.cancelled_sorties,
            "sortie_completion_rate": self.completed_sorties / max(planned_total, 1),
            "avg_departure_delay": self.total_departure_delay / max(self.launched_sorties, 1),
            "lru_failures": self.lru_failures,
            "repair_count": self.repair_count,
            "replace_count": self.replace_count,
            "spare_stock_total": spare_stock,
            "system_reliability": reliability,
            "waiting_jobs": sum(1 for j in self.activity_jobs if j.state == "waiting"),
            "active_jobs": sum(1 for j in self.activity_jobs if j.state == "active"),
        }

    def visualization_state(self) -> dict[str, Any]:
        return {
            "snapshot": self.snapshot(),
            "aircraft": [
                {
                    "tail_number": a.tail_number,
                    "type": a.aircraft_type,
                    "phase": a.phase,
                    "mission_id": a.current_mission_id,
                    "flight_hours": round(a.total_flight_hours, 2),
                    "landings": a.takeoff_landing_count,
                    "failed_lru": a.failed_lru_id or "",
                    "equipment": a.equipment_snapshot(),
                }
                for a in self.aircraft
            ],
            "resources": [
                {
                    "node_id": node.id,
                    "name": node.name,
                    "personnel_available": node.personnel_pool.available,
                    "personnel_capacity": node.personnel_pool.capacity,
                    "equipment_available": node.equipment_pool.available,
                    "equipment_capacity": node.equipment_pool.capacity,
                    "inventory": dict(node.inventory),
                    "utilization": node.personnel_pool.utilization(max(self.sim_time, self.tick_minutes)),
                }
                for node in self.support_network.nodes.values()
            ],
            "spares": [
                {
                    "node_id": node.id,
                    "inventory": dict(node.inventory),
                }
                for node in self.support_network.nodes.values()
            ],
            "missions": [
                {
                    "wave_id": w.wave_id,
                    "planned_start": w.planned_start,
                    "actual_start": w.actual_start,
                    "return_time": w.return_time,
                    "required_aircraft": w.required_aircraft,
                    "aircraft_type": w.aircraft_type,
                    "status": w.status,
                    "assigned_tail_numbers": list(w.assigned_tail_numbers or []),
                }
                for w in self.all_waves
                if w.status != "completed"
            ],
            "jobs": [
                {
                    "activity_id": j.activity_id,
                    "aircraft_tail": j.aircraft_tail,
                    "state": j.state,
                    "current_task": j.active_task.get("workName", "") if j.active_task else "",
                    "remaining": max(0.0, j.remaining),
                }
                for j in self.activity_jobs
                if j.state != "completed"
            ],
            "events": list(self.event_log[-20:]),
        }

    def compute_final_metrics(self) -> dict[str, Any]:
        planned_total = sum(w.required_aircraft for w in self.all_waves)
        spare_consumed = sum(
            sum(inv.values()) for inv in (node.inventory for node in self.support_network.nodes.values())
        )
        initial_spare = sum(
            sum(node.inventory.values()) for node in self.support_network.nodes.values()
        )
        return {
            "sortie_completion_rate": self.completed_sorties / max(planned_total, 1),
            "launch_rate": self.launched_sorties / max(planned_total, 1),
            "cancelled_rate": self.cancelled_sorties / max(planned_total, 1),
            "delayed_rate": self.delayed_sorties / max(self.launched_sorties, 1),
            "spare_fill_rate": 1.0 - (self.replace_count / max(self.lru_failures, 1)) if self.lru_failures > 0 else 1.0,
            "lru_failures": self.lru_failures,
            "repair_count": self.repair_count,
            "replace_count": self.replace_count,
            "repair_to_replace_ratio": self.repair_count / max(self.repair_count + self.replace_count, 1),
            "avg_departure_delay": self.total_departure_delay / max(self.launched_sorties, 1),
            "spare_stock_remaining": initial_spare,
        }
```

- [ ] **Step 5: Implement frames.py**

`independent-mesa/independent_mesa/frames.py`:
```python
"""Frame export: collect visualization_state at intervals."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .model import IndependentMesaModel


def export_frames(
    model: IndependentMesaModel,
    steps: int,
    sample_every: int,
) -> list[dict[str, Any]]:
    """Run model for `steps` steps, sampling frames every `sample_every` steps."""
    frames = [model.visualization_state()]
    for step in range(1, steps + 1):
        model.step()
        if step % sample_every == 0 or step == steps:
            frames.append(model.visualization_state())
    return frames


def save_frames_and_metrics(
    model: IndependentMesaModel,
    steps: int,
    sample_every: int,
    output_dir: Path,
) -> None:
    """Run model, save frames.json and metrics.json to output_dir."""
    frames = export_frames(model, steps, sample_every)
    metrics = model.compute_final_metrics()
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "frames.json").write_text(
        json.dumps({"frames": frames}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "metrics.json").write_text(
        json.dumps(metrics, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_model_integration -v
```
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add independent-mesa/independent_mesa/agents.py independent-mesa/independent_mesa/model.py independent-mesa/independent_mesa/frames.py independent-mesa/tests/test_model_integration.py
git commit -m "feat: add AircraftAgent, IndependentMesaModel, frames export"
```

---

### Task 10: Monte Carlo Sweep Runner

**Files:**
- Create: `independent-mesa/independent_mesa/monte_carlo.py`
- Test: `independent-mesa/tests/test_monte_carlo.py`

- [ ] **Step 1: Write failing tests**

`independent-mesa/tests/test_monte_carlo.py`:
```python
from __future__ import annotations

import json
import unittest
from pathlib import Path

from independent_mesa.monte_carlo import MonteCarloRunner


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "import_package.json"


class TestMonteCarloRunner(unittest.TestCase):
    def setUp(self) -> None:
        self.package = json.loads(DATA_PATH.read_text(encoding="utf-8"))

    def test_param_grid_has_27_combinations(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=2)
        grid = runner.build_param_grid()
        self.assertEqual(len(grid), 27)

    def test_run_single_sample_returns_metrics(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=1)
        metrics = runner.run_single(
            failure_rate=0.055, spare_multiplier=1.0,
            support_capacity=3, seed=42,
        )
        self.assertIn("sortie_completion_rate", metrics)

    def test_run_group_returns_aggregated(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=2)
        result = runner.run_group(
            failure_rate=0.055, spare_multiplier=1.0,
            support_capacity=3,
        )
        self.assertIn("mean", result)
        self.assertIn("std", result)
        self.assertIn("samples", result)
        self.assertEqual(result["samples"], 2)

    def test_failed_sample_does_not_crash_group(self) -> None:
        runner = MonteCarloRunner(self.package, steps=4, samples=2)
        result = runner.run_group(
            failure_rate=-1.0,  # invalid, will cause issues but shouldn't crash
            spare_multiplier=1.0,
            support_capacity=3,
        )
        self.assertIn("samples", result)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_monte_carlo -v
```
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement Monte Carlo runner**

`independent-mesa/independent_mesa/monte_carlo.py`:
```python
"""Monte Carlo sweep runner over failureRates x spareMultipliers x supportCapacities."""

from __future__ import annotations

import copy
import itertools
import json
import statistics
from pathlib import Path
from typing import Any

from .model import IndependentMesaModel


class MonteCarloRunner:
    """Runs parameter sweep over the monteCarlo config from the import package."""

    def __init__(
        self,
        import_package: dict[str, Any],
        steps: int = 48,
        samples: int = 24,
        seed: int = 20260621,
    ) -> None:
        self.import_package = import_package
        self.steps = steps
        self.samples = samples
        self.seed = seed
        objects = import_package.get("objects", {})
        mission = objects.get("missionProfiles", [{}])[0]
        mc = mission.get("monteCarlo", {})
        analysis = objects.get("analysisRequests", {}).get("largeSample", {})
        sweep = analysis.get("sweep", mc)
        self.failure_rates = list(sweep.get("failureRates", [0.055]))
        self.spare_multipliers = list(sweep.get("spareMultipliers", [1.0]))
        self.support_capacities = list(sweep.get("supportCapacities", [3]))
        self.samples = int(analysis.get("samples", samples))

    def build_param_grid(self) -> list[dict[str, Any]]:
        """Build the 27-combination parameter grid (3x3x3)."""
        grid = []
        for fr, sm, sc in itertools.product(
            self.failure_rates, self.spare_multipliers, self.support_capacities
        ):
            grid.append({
                "failure_rate": float(fr),
                "spare_multiplier": float(sm),
                "support_capacity": int(sc),
            })
        return grid

    def run_single(
        self,
        failure_rate: float,
        spare_multiplier: float,
        support_capacity: int,
        seed: int,
    ) -> dict[str, Any]:
        """Run a single sample and return metrics."""
        package = copy.deepcopy(self.import_package)
        objects = package.get("objects", {})
        for asset in objects.get("equipmentAssets", []):
            if "failureRate" in asset:
                asset["failureRate"] = failure_rate
            if "failureDistribution" in asset:
                params = str(asset["failureDistribution"].get("parameters", ""))
                if "lambda" in params:
                    asset["failureDistribution"]["parameters"] = f"lambda={failure_rate}"
        for res in objects.get("supportResources", []):
            res["capacity"] = support_capacity
            res["personnelCapacity"] = support_capacity
            res["equipmentCapacity"] = max(1, support_capacity - 1)
        for res in objects.get("supportResources", []):
            if isinstance(res.get("inventory"), dict):
                for key in res["inventory"]:
                    res["inventory"][key] = max(1, int(res["inventory"][key] * spare_multiplier))
        model = IndependentMesaModel(package, steps=self.steps, seed=seed)
        for _ in range(self.steps):
            model.step()
        return model.compute_final_metrics()

    def run_group(
        self,
        failure_rate: float,
        spare_multiplier: float,
        support_capacity: int,
    ) -> dict[str, Any]:
        """Run `samples` samples for one parameter combination and aggregate."""
        results: list[dict[str, Any]] = []
        failed: int = 0
        for sample_idx in range(self.samples):
            seed = self.seed + sample_idx
            try:
                metrics = self.run_single(
                    failure_rate, spare_multiplier, support_capacity, seed,
                )
                results.append(metrics)
            except Exception:
                failed += 1
        return self._aggregate(results, failed)

    def run_sweep(self) -> list[dict[str, Any]]:
        """Run the full sweep over all parameter combinations."""
        grid = self.build_param_grid()
        results = []
        for params in grid:
            group_result = self.run_group(
                params["failure_rate"],
                params["spare_multiplier"],
                params["support_capacity"],
            )
            results.append({**params, **group_result})
        return results

    def _aggregate(
        self,
        results: list[dict[str, Any]],
        failed: int,
    ) -> dict[str, Any]:
        if not results:
            return {"mean": {}, "std": {}, "samples": 0, "failed": failed}
        keys = results[0].keys()
        mean = {}
        std = {}
        for key in keys:
            values = [float(r[key]) for r in results if key in r and isinstance(r[key], (int, float))]
            if values:
                mean[key] = statistics.mean(values)
                std[key] = statistics.stdev(values) if len(values) > 1 else 0.0
        return {
            "mean": mean,
            "std": std,
            "samples": len(results),
            "failed": failed,
        }

    def save_results(self, results: list[dict[str, Any]], output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps({"sweep_results": results}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest tests.test_monte_carlo -v
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add independent-mesa/independent_mesa/monte_carlo.py independent-mesa/tests/test_monte_carlo.py
git commit -m "feat: add Monte Carlo sweep runner with 27-combination grid"
```

---

### Task 11: CLI Entry Points (run_single.py + run_sweep.py)

**Files:**
- Create: `independent-mesa/run_single.py`
- Create: `independent-mesa/run_sweep.py`

- [ ] **Step 1: Write run_single.py**

`independent-mesa/run_single.py`:
```python
#!/usr/bin/env python3
"""Single scenario runner for the independent Mesa model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from independent_mesa.frames import save_frames_and_metrics
from independent_mesa.model import IndependentMesaModel


DATA_PATH = Path(__file__).resolve().parent / "data" / "import_package.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "single-run"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=48)
    parser.add_argument("--sample-every", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260621)
    args = parser.parse_args()

    package = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    model = IndependentMesaModel(package, steps=args.steps, seed=args.seed)
    save_frames_and_metrics(model, args.steps, args.sample_every, OUTPUT_DIR)
    print(f"Frames and metrics saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write run_sweep.py**

`independent-mesa/run_sweep.py`:
```python
#!/usr/bin/env python3
"""Monte Carlo sweep runner for the independent Mesa model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from independent_mesa.monte_carlo import MonteCarloRunner


DATA_PATH = Path(__file__).resolve().parent / "data" / "import_package.json"
OUTPUT_DIR = Path(__file__).resolve().parent / "output" / "sweep"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--steps", type=int, default=48)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--seed", type=int, default=20260621)
    parser.add_argument("--keep-frames", action="store_true", default=False)
    args = parser.parse_args()

    package = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    runner = MonteCarloRunner(package, steps=args.steps, samples=args.samples, seed=args.seed)
    results = runner.run_sweep()
    runner.save_results(results, OUTPUT_DIR / "results.json")
    print(f"Sweep results saved to {OUTPUT_DIR / 'results.json'} ({len(results)} combinations)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Verify run_single works**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python run_single.py --steps 10 --sample-every 2 --seed 42
ls -la output/single-run/
```
Expected: `frames.json` and `metrics.json` exist

- [ ] **Step 4: Verify run_sweep works (reduced samples for speed)**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python run_sweep.py --steps 4 --samples 2 --seed 42
ls -la output/sweep/
```
Expected: `results.json` exists

- [ ] **Step 5: Run full test suite**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python -m unittest discover -s tests -v
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add independent-mesa/run_single.py independent-mesa/run_sweep.py
git commit -m "feat: add run_single and run_sweep CLI entry points"
```

---

### Task 12: End-to-End Full Run + Final Commit

- [ ] **Step 1: Run full single scenario (48 steps)**

```bash
cd independent-mesa && PYTHONPATH=. ../.abm-mesa-test-env/bin/python run_single.py --steps 48 --sample-every 4 --seed 20260621
```
Expected: output saved, no errors

- [ ] **Step 2: Verify output content**

```bash
PYTHONPATH=. ../.abm-mesa-test-env/bin/python -c "
import json
f = json.load(open('output/single-run/frames.json'))
m = json.load(open('output/single-run/metrics.json'))
print(f'frames: {len(f[\"frames\"])}')
print(f'sortie_completion_rate: {m[\"sortie_completion_rate\"]:.2%}')
print(f'lru_failures: {m[\"lru_failures\"]}')
print(f'repair/replace: {m[\"repair_count\"]}/{m[\"replace_count\"]}')
"
```

- [ ] **Step 3: Add output .gitignore**

`independent-mesa/output/.gitignore`:
```
*.json
!.gitignore
```

- [ ] **Step 4: Final commit**

```bash
git add independent-mesa/
git commit -m "feat: complete independent-mesa with full data consumption"
```

"""契约测试：守护 Mesa 后台契约服务的端点、信封与所有权不变量。

在线程内启动临时端口的 ThreadingHTTPServer（绝不触碰真实端口 8521），用标准库
urllib（禁用代理，避免本机全局 HTTP 代理把 127.0.0.1 请求转发后返回 502）逐个端点断言。

本文件属于 ``agent.md``「所有权声明」第 4 条保护的资产，改动需遵循「契约变更流程」。
"""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = REPO_ROOT / "src" / "spare_mvp_abm" / "contract_server.py"

#: visualization_state 顶层 key，与 test_aviation_support_local.py 保持同一契约来源。
VISUALIZATION_KEYS = [
    "snapshot",
    "aircraft",
    "resources",
    "spares",
    "missions",
    "jobs",
    "support_tasks",
    "metrics",
    "object_relationships",
    "events",
]


def _load_server_module():
    """按文件路径加载 contract_server.py，避免依赖已安装的包布局。"""
    spec = importlib.util.spec_from_file_location("contract_server_under_test", SERVER_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ContractServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_module = _load_server_module()
        # port=0 让 OS 分配临时端口，绝不触碰真实 8521
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), cls.server_module.ContractHandler)
        cls.port = cls.httpd.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        # 禁用代理：本机存在全局 HTTP 代理，会把 loopback 请求转发后返回 502
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _get(self, path):
        try:
            with self.opener.open(self.base + path, timeout=10) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_health(self):
        status, body = self._get("/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["data"]["contract_version"], "1.0.0")
        self.assertEqual(sorted(body["data"]["models"]), ["aviation", "smoke"])

    def test_contract_self_describes_all_endpoints(self):
        status, body = self._get("/contract")
        self.assertEqual(status, 200)
        paths = {entry["path"] for entry in body["data"]["endpoints"]}
        for endpoint in [
            "/health",
            "/contract",
            "/snapshot",
            "/visualization",
            "/experiment",
        ]:
            self.assertIn(endpoint, paths)
        self.assertNotIn("/ontology-mapping", paths)
        self.assertIn("ownership", body["data"])
        self.assertIn("change_policy", body["data"])

    def test_envelope_shape_on_success(self):
        _, body = self._get("/health")
        self.assertEqual(set(body.keys()), {"ok", "contract_version", "data", "error"})

    def test_aviation_snapshot_contract(self):
        status, body = self._get("/snapshot?model=aviation&steps=0&seed=17")
        self.assertEqual(status, 200)
        data = body["data"]
        for key in [
            "aircraft_count",
            "available_aircraft",
            "sortie_completion_rate",
            "mechanic_utilization",
            "spare_stock_total",
            "elapsed_hours",
        ]:
            self.assertIn(key, data)

    def test_aviation_visualization_contract_keys(self):
        status, body = self._get("/visualization?model=aviation&steps=3")
        self.assertEqual(status, 200)
        for key in VISUALIZATION_KEYS:
            self.assertIn(key, body["data"])

    def test_smoke_snapshot_contract_does_not_include_ontology_metrics(self):
        status, body = self._get("/snapshot?model=smoke&steps=3")
        self.assertEqual(status, 200)
        data = body["data"]
        for key in [
            "mission_success_rate",
            "spare_fill_rate",
            "repair_backlog",
        ]:
            self.assertIn(key, data)
        self.assertNotIn("ontology_entity_types", data)
        self.assertNotIn("ontology_relationships", data)

    def test_experiment_default_and_named(self):
        status, body = self._get("/experiment")
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["experiment_name"], "aviation_support_resource_sweep")
        status_named, body_named = self._get("/experiment?name=spare-planning-smoke")
        self.assertEqual(status_named, 200)
        self.assertEqual(body_named["data"]["model_class"], "SmokeSpareMvpModel")

    def test_unknown_endpoint_returns_404_envelope(self):
        status, body = self._get("/nope")
        self.assertEqual(status, 404)
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "not_found")

    def test_bad_steps_returns_400(self):
        status, body = self._get("/snapshot?steps=abc")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "bad_param")

    def test_steps_over_max_returns_400(self):
        status, body = self._get("/snapshot?steps=99999")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "bad_param")

    def test_visualization_smoke_model_rejected(self):
        status, body = self._get("/visualization?model=smoke")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "bad_param")

    def test_ontology_mapping_endpoint_removed(self):
        status, body = self._get("/ontology-mapping?model=smoke")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "not_found")


if __name__ == "__main__":
    unittest.main()

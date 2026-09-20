import importlib.util
import re
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_paths_module():
    script = ROOT / "scripts" / "portable-paths.py"
    spec = importlib.util.spec_from_file_location("portable_paths_consumers", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PortablePathConsumersTest(unittest.TestCase):
    def test_instance_state_contract_exposes_pid_logs_and_evidence_directories(self):
        paths_module = load_paths_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "install"
            package.mkdir()
            result = paths_module.resolve_paths(
                str(package), environment={"LOCALAPPDATA": str(root / "local")}
            )

            instance_root = Path(result["instance_root"])
            self.assertEqual(Path(result["pid_root"]), instance_root / "pids")
            self.assertEqual(Path(result["logs_dir"]), instance_root / "logs")
            self.assertEqual(Path(result["evidence_dir"]), instance_root / "evidence")

    def test_verifier_consumes_resolved_pid_and_evidence_paths(self):
        script = (ROOT / "scripts" / "verify-portable-package.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("portable-paths.py", script)
        self.assertRegex(script, r"\$Paths\.pid_root")
        self.assertRegex(script, r"\$Paths\.evidence_dir")
        self.assertIsNone(re.search(r"data\\(?:pids|evidence|logs)", script, re.IGNORECASE))

    def test_vbs_launcher_consumes_resolved_startup_log_directory(self):
        script = (ROOT / "Start-Platform.vbs").read_text(encoding="utf-8-sig")
        self.assertIn("portable-paths.py", script)
        self.assertIn("--field logs_dir", script)
        self.assertIsNone(re.search(r"data\\logs", script, re.IGNORECASE))

    def test_packaged_windows_readme_documents_external_instance_state_and_extract_refusal(self):
        documentation = (ROOT / "docs" / "windows-portable.md").read_text(encoding="utf-8")
        self.assertIn(r"%LOCALAPPDATA%\spare_mvp\instances\<installation_id>", documentation)
        self.assertIsNone(re.search(r"`data/(?:active-ports\.json|evidence|logs|pids)", documentation))
        self.assertIn("即使为空目录也拒绝覆盖", documentation)


if __name__ == "__main__":
    unittest.main()

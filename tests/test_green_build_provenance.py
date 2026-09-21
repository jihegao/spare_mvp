import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "verify_green_inputs", ROOT / "packaging" / "green" / "verify-green-inputs.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class GreenBuildProvenanceTest(unittest.TestCase):
    def fixture(self, root, *, portable_commit="a" * 40, desktop_commit="a" * 40, green_commit="a" * 40):
        portable = root / "portable"
        desktop = root / "desktop"
        (desktop / "resources").mkdir(parents=True)
        portable.mkdir()
        (portable / "source-manifest.json").write_text(json.dumps({
            "format_version": 2,
            "source_commit": portable_commit,
        }))
        app_asar = desktop / "resources" / "app.asar"
        executable = desktop / "product.exe"
        app_asar.write_bytes(b"asar")
        executable.write_bytes(b"exe")
        source_files = {"desktop/main.mjs": "1" * 64, "desktop/package.json": "2" * 64}
        (desktop / "desktop-build-provenance.json").write_text(json.dumps({
            "format_version": 1,
            "source_commit": desktop_commit,
            "source_files": source_files,
            "app_asar_sha256": sha256(app_asar),
            "executable": executable.name,
            "executable_sha256": sha256(executable),
        }))
        green = root / "green.json"
        green.write_text(json.dumps({
            "format_version": 1,
            "source_commit": green_commit,
            "files": {**source_files, "packaging/green/GreenExtractor.cs": "3" * 64},
        }))
        return portable, desktop, green

    def test_accepts_one_commit_and_exact_desktop_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = MODULE.verify_inputs(*self.fixture(Path(tmp)))
            self.assertEqual(result["source_commit"], "a" * 40)
            self.assertEqual(result["desktop_executable"], "product.exe")

    def test_rejects_mixed_portable_desktop_and_green_commits(self):
        with tempfile.TemporaryDirectory() as tmp:
            inputs = self.fixture(Path(tmp), portable_commit="a" * 40, desktop_commit="b" * 40)
            with self.assertRaisesRegex(ValueError, "different source commits"):
                MODULE.verify_inputs(*inputs)

    def test_rejects_stale_or_modified_desktop_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            portable, desktop, green = self.fixture(Path(tmp))
            (desktop / "resources" / "app.asar").write_bytes(b"stale")
            with self.assertRaisesRegex(ValueError, "differs from build provenance"):
                MODULE.verify_inputs(portable, desktop, green)

    def test_rejects_desktop_sources_from_another_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            portable, desktop, green = self.fixture(Path(tmp))
            payload = json.loads((desktop / "desktop-build-provenance.json").read_text())
            payload["source_files"]["desktop/main.mjs"] = "f" * 64
            (desktop / "desktop-build-provenance.json").write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "source hashes differ"):
                MODULE.verify_inputs(portable, desktop, green)


if __name__ == "__main__":
    unittest.main()

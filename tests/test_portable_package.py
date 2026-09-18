import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('portable_package', ROOT / 'scripts' / 'portable-package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PortablePackageTest(unittest.TestCase):
    def test_allowlist_excludes_runtime_state_and_private_cases(self):
        for path in ('exports/private-case.json', 'runs/project.sqlite3', 'src/.env',
                     'src/__pycache__/module.pyc', 'front/../secrets.json', 'front/custom.db',
                     '/front/app.js', 'front\\app.js', 'public/private.png'):
            with self.subTest(path=path):
                self.assertFalse(package.app_file(path))
        for path in ('front/assets/aircraft.png', 'src/spare_mvp_backend/api.py',
                     'contracts/project.schema.json', 'exports/project-case-large.json'):
            self.assertTrue(package.app_file(path))

    def test_seal_detects_tampering_missing_and_extra_immutable_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source-manifest.json').write_text(json.dumps({'source_commit': 'a' * 40}))
            (root / 'app').mkdir()
            code = root / 'app' / 'module.py'
            code.write_text('original')
            package.seal(root)
            package.verify(root)
            (root / 'data').mkdir()
            (root / 'data' / 'runtime.sqlite3').write_text('mutable local state')
            package.verify(root)
            code.write_text('changed')
            with self.assertRaises(ValueError):
                package.verify(root)
            code.write_text('original')
            extra = root / 'app' / 'unreviewed.py'
            extra.write_text('unreviewed')
            with self.assertRaises(ValueError):
                package.verify(root)
            extra.unlink()
            code.unlink()
            with self.assertRaises(ValueError):
                package.verify(root)

    def test_staging_rejects_invalid_or_changed_manifest_before_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = {'source_commit': 'a' * 40, 'files': {name: 'bad' for name in package.APP_FILES}}
            with self.assertRaises((ValueError, FileNotFoundError)):
                package.stage(root, root / 'destination', manifest)
            self.assertFalse((root / 'destination').exists())


if __name__ == '__main__':
    unittest.main()

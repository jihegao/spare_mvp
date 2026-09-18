import importlib.util
import json
import subprocess
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('portable_package', ROOT / 'scripts' / 'portable-package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PortablePackageTest(unittest.TestCase):
    def source_repo(self, root):
        names = package.APP_FILES | package.PACKAGE_SUPPORT_FILES | package.BUILD_INPUTS | {'src/example.py'}
        for name in names:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('reviewed source ' + name)
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(root), '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                        'commit', '-qm', 'reviewed candidate'], check=True)

    def test_manifest_binds_every_copied_file_and_build_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.source_repo(root)
            manifest = package.source_manifest(root)
            destination = Path(tmp) / 'package'
            package.stage(root, destination, manifest)
            copied = {path.relative_to(destination).as_posix() for path in destination.rglob('*') if path.is_file()}
            self.assertEqual(copied, {package.package_destination(name) for name in manifest['files']} | {'source-manifest.json'})
            self.assertEqual(set(manifest['build_inputs']), package.BUILD_INPUTS)
            package.seal(destination)
            package.verify(destination)
            (destination / 'scripts' / 'start-portable.ps1').write_text('changed after staging')
            with self.assertRaisesRegex(ValueError, 'Staged source differs'):
                package.seal(destination)

    def test_modified_scripts_documents_and_initializer_cannot_keep_candidate_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.source_repo(root)
            manifest = package.source_manifest(root)
            for name in ('scripts/start-portable.ps1', 'Start-Platform.cmd', 'docs/windows-portable.md',
                         'scripts/initialize-case-database.py', 'packaging/requirements-windows.lock'):
                with self.subTest(path=name):
                    path = root / name
                    original = path.read_text()
                    path.write_text('unreviewed change')
                    with self.assertRaisesRegex(ValueError, 'differs from the recorded commit'):
                        package.source_manifest(root)
                    with self.assertRaisesRegex(ValueError, 'Unapproved or changed source'):
                        package.stage(root, Path(tmp) / 'rejected', manifest)
                    self.assertFalse((Path(tmp) / 'rejected').exists())
                    path.write_text(original)

    def test_stage_rejects_manifest_missing_a_required_copied_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source'
            self.source_repo(root)
            manifest = package.source_manifest(root)
            del manifest['files']['scripts/stop-portable.ps1']
            with self.assertRaisesRegex(ValueError, 'omits bound'):
                package.stage(root, Path(tmp) / 'rejected', manifest)

    def test_extra_bytecode_is_not_exempt_from_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'source-manifest.json').write_text(json.dumps({'source_commit': 'a' * 40}))
            package.seal(root)
            cache = root / 'app' / '__pycache__' / 'unreviewed.cpython-313.pyc'
            cache.parent.mkdir(parents=True)
            cache.write_bytes(b'extra bytecode')
            with self.assertRaisesRegex(ValueError, 'Package integrity mismatch'):
                package.verify(root)

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

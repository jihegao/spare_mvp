"""Content/provenance tests; native Windows preparation remains a separate check."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('portable_runtime_package', ROOT / 'scripts/portable-package.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PortableRuntimeManifestTest(unittest.TestCase):
    def bundle(self, root):
        (root / 'downloads').mkdir(parents=True)
        (root / 'downloads/python.zip').write_bytes(b'locked runtime archive')
        (root / 'windows-runtime.json').write_text(json.dumps({
            'version': sys.version.split()[0], 'archive': 'python.zip',
            'sha256': package.digest(root / 'downloads/python.zip'),
        }))
        (root / 'requirements-windows.lock').write_text('reviewed dependency lock')
        runtime = root / 'runtime'
        (runtime / 'Lib/site-packages').mkdir(parents=True)
        (runtime / 'python.exe').write_bytes(b'prepared interpreter')
        (runtime / 'Lib/site-packages/example.py').write_bytes(b'prepared installed source')
        # Exercise provenance independently of native interpreter/pip validation.
        with patch.object(package, 'verify_runtime_dependencies') as verify_dependencies:
            package.finalize_prepared_runtime(root)
            verify_dependencies.assert_called_once_with(root, runtime)
        return runtime

    def test_valid_manifest_covers_every_runtime_file_and_binds_build_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp)
            runtime = self.bundle(bundle)
            manifest = json.loads((bundle / 'runtime-manifest.json').read_text())
            self.assertEqual(set(manifest['files']), {'python.exe', 'Lib/site-packages/example.py'})
            self.assertEqual(manifest['requirements_sha256'], package.digest(bundle / 'requirements-windows.lock'))
            self.assertEqual(manifest['archive_sha256'], package.digest(bundle / 'downloads/python.zip'))
            with patch.object(package, 'verify_runtime_dependencies') as verify_dependencies:
                package.verify_runtime(bundle, runtime)
                verify_dependencies.assert_called_once_with(bundle, runtime)
            with self.assertRaisesRegex(ValueError, 'refusing to rebaseline'):
                package.finalize_prepared_runtime(bundle)

    def test_modified_source_missing_file_and_new_bytecode_fail_before_dependency_check(self):
        changes = [
            lambda root: (root / 'Lib/site-packages/example.py').write_text('modified source'),
            lambda root: (root / 'Lib/site-packages/example.py').unlink(),
            lambda root: (root / 'Lib/site-packages/injected.pyc').write_bytes(b'bytecode'),
            lambda root: (root / 'Lib/site-packages/injected.pyd').write_bytes(b'extra native module'),
        ]
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                bundle = Path(tmp)
                runtime = self.bundle(bundle)
                change(runtime)
                with patch.object(package, 'verify_runtime_dependencies') as verify_dependencies:
                    with self.assertRaises(ValueError):
                        package.verify_runtime(bundle, runtime)
                    verify_dependencies.assert_not_called()

    def test_a_runtime_cannot_be_verified_using_b_bundle_with_different_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / 'a', Path(tmp) / 'b'
            actual = self.bundle(a)
            self.bundle(b)
            (actual / 'python.exe').write_bytes(b'different runtime A')
            package.verify_runtime_manifest(b, b / 'runtime')
            with self.assertRaisesRegex(ValueError, 'Runtime content differs'):
                package.verify_runtime_manifest(b, actual)
            # Relocation is allowed only when the complete content is identical.
            shutil.copyfile(b / 'runtime/python.exe', actual / 'python.exe')
            package.verify_runtime_manifest(b, actual)

    def test_archive_lock_and_spec_changes_invalidate_the_runtime_binding(self):
        for name in ('downloads/python.zip', 'requirements-windows.lock', 'windows-runtime.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                bundle = Path(tmp)
                runtime = self.bundle(bundle)
                path = bundle / name
                if name.endswith('.json'):
                    spec = json.loads(path.read_text())
                    spec['version'] = 'different'
                    path.write_text(json.dumps(spec))
                else:
                    path.write_bytes(b'changed input')
                with self.assertRaisesRegex(ValueError, 'archive or dependency lock'):
                    package.verify_runtime_manifest(bundle, runtime)

    def test_old_runtime_without_manifest_is_not_implicitly_baselined(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp)
            runtime = self.bundle(bundle)
            (bundle / 'runtime-manifest.json').unlink()
            with self.assertRaisesRegex(ValueError, 'prepare a fresh runtime'):
                package.verify_runtime(bundle, runtime)
            self.assertFalse((bundle / 'runtime-manifest.json').exists())

    def test_seal_rechecks_copied_runtime_against_preserved_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, output = Path(tmp) / 'bundle', Path(tmp) / 'package'
            runtime = self.bundle(bundle)
            shutil.copytree(bundle, output / 'dependencies')
            shutil.rmtree(output / 'dependencies/runtime')
            shutil.copytree(runtime, output / 'runtime')
            (output / 'source-manifest.json').write_text(json.dumps({'source_commit': 'a' * 40}))
            # This fixture isolates runtime provenance; frontend cache has its own tests.
            with patch.object(package, 'verify_frontend_assets') as verify_assets:
                package.seal(output)
                verify_assets.assert_called_once()
            package.verify(output)
            (output / 'runtime/Lib/site-packages/example.py').write_text('changed after copy')
            with self.assertRaisesRegex(ValueError, 'Runtime content differs'):
                package.seal(output)

    def test_dependency_check_binds_its_interpreter_to_requested_runtime_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp)
            runtime = self.bundle(bundle)
            with patch.object(package.sys, 'platform', 'win32'), patch.object(package.sys, 'executable', str(bundle / 'other/python.exe')):
                with self.assertRaisesRegex(ValueError, 'Verifier interpreter differs'):
                    package.verify_runtime_dependencies(bundle, runtime)

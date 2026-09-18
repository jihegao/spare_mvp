from __future__ import annotations

import hashlib
from io import BytesIO
import importlib.util
import json
from pathlib import Path, PureWindowsPath
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('solara_assets', ROOT / 'scripts/prepare-solara-assets.py')
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class SolaraOfflineAssetTest(unittest.TestCase):
    def fixture(self):
        body = b'window.offline = true;'
        stream = BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            member = tarfile.TarInfo('package/dist/app.js')
            member.size = len(body)
            archive.addfile(member, BytesIO(body))
        data = stream.getvalue()
        lock = {'format_version': 1, 'packages': [{
            'name': 'reviewed', 'version': '1.0.0', 'url': 'https://registry.npmjs.org/reviewed/-/reviewed-1.0.0.tgz',
            'sha256': hashlib.sha256(data).hexdigest(), 'files': [{
                'path': 'reviewed@1.0.0/dist/app.js', 'member': member.name,
                'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body)}]}]}
        return data, lock

    def test_prepared_cache_uses_hash_locked_archives_and_offline_copy_never_downloads(self):
        data, lock = self.fixture()
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp) / 'first'
            with mock.patch.object(assets, 'urlopen', return_value=BytesIO(data)) as download:
                assets.prepare(cache, lock)
            self.assertEqual(download.call_count, 1)
            with mock.patch.object(assets, 'urlopen', side_effect=AssertionError('offline copy contacted network')):
                assets.prepare(Path(tmp) / 'second', lock, cache)
            assets.verify(Path(tmp) / 'second', lock)
            with self.assertRaisesRegex(ValueError, 'refusing to overwrite'):
                assets.prepare(cache, lock)

    def test_archive_corruption_and_cache_missing_extra_or_changed_files_fail_closed(self):
        data, lock = self.fixture()
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(assets, 'urlopen', return_value=BytesIO(b'corrupted')):
                with self.assertRaisesRegex(ValueError, 'archive hash mismatch'):
                    assets.prepare(Path(tmp) / 'bad', lock)
            cache = Path(tmp) / 'good'
            with mock.patch.object(assets, 'urlopen', return_value=BytesIO(data)):
                assets.prepare(cache, lock)
            expected = cache / lock['packages'][0]['files'][0]['path']
            original = expected.read_bytes()
            for mutation in ('missing', 'extra', 'changed'):
                with self.subTest(mutation=mutation):
                    if mutation == 'missing': expected.unlink()
                    elif mutation == 'extra': (cache / 'unexpected.js').write_bytes(b'extra')
                    else: expected.write_bytes(b'changed')
                    with self.assertRaisesRegex(ValueError, 'missing, extra or changed'):
                        assets.verify(cache, lock)
                    expected.write_bytes(original)
                    (cache / 'unexpected.js').unlink(missing_ok=True)

    def test_reviewed_lock_contains_bootstrap_dynamic_chunks_and_all_font_formats(self):
        lock = assets.read_lock(assets.DEFAULT_LOCK)
        names = {entry['path'] for package in lock['packages'] for entry in package['files']}
        prefix = '@widgetti/solara-vuetify3-app@5.0.2/dist/'
        for name in ('main8.css', 'fonts.css', 'solara-vuetify-app8.min.js',
                     '692.solara-vuetify-app8.min.js', '872.solara-vuetify-app8.min.js'):
            self.assertIn(prefix + name, names)
        for suffix in ('.woff2', '.woff', '.ttf', '.eot'):
            self.assertTrue(any(name.startswith(prefix) and name.endswith(suffix) for name in names))
        self.assertIn('font-awesome@4.5.0/fonts/fontawesome-webfont.svg', names)
        self.assertIn('requirejs@2.3.6/require.js', names)
        self.assertIn('katex@0.16.9/dist/contrib/auto-render.min.js', names)
        self.assertIn('mermaid@10.8.0/dist/mermaid.min.js', names)
        target = PureWindowsPath(r'C:\Users\user\Models\spare_mvp-acceptance-20260918T151500-1091c98\package-62a5412\assets\solara-cdn')
        self.assertLess(max(len(str(target / name)) for name in names), 260)
        self.assertEqual(len(lock['excluded_development_assets']), 2)
        self.assertTrue(set(lock['excluded_development_assets']).isdisjoint(names))

    def test_production_closure_rejects_unlocked_dynamic_edges_and_loader_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = root / 'app.min.js'
            entry.write_text('__webpack_require__.u=e=>e+".min.js";n.e(692);')
            (root / '692.min.js').write_text('loaded chunk')
            lock = {'packages': [{'files': [{'path': 'app.min.js'}, {'path': '692.min.js'}]}],
                    'production_bundles': [{'entry': 'app.min.js', 'chunks': ['692.min.js']}]}
            assets.verify_production_closure(root, lock)
            (root / '692.min.js').write_text('n.e(999);')
            with self.assertRaisesRegex(ValueError, 'closure differs'):
                assets.verify_production_closure(root, lock)
            (root / '692.min.js').write_text('loaded chunk')
            entry.write_text('__webpack_require__.u=e=>e+".development.js";n.e(692);')
            with self.assertRaisesRegex(ValueError, 'closure differs'):
                assets.verify_production_closure(root, lock)

    def test_lock_rejects_untrusted_archive_and_unsafe_or_ambiguous_paths(self):
        _, lock = self.fixture()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'lock.json'
            lock['packages'][0]['url'] = 'https://example.com/unreviewed.tgz'
            path.write_text(json.dumps(lock))
            with self.assertRaisesRegex(ValueError, 'official npm'):
                assets.read_lock(path)
        for path in ('../secret', '/absolute', 'C:/windows', 'a\\b', 'a//b'):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'Invalid asset path'):
                assets.safe_path(path)


if __name__ == '__main__':
    unittest.main()

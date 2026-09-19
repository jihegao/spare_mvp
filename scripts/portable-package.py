"""Build an allowlisted portable app and verify immutable package content."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import re
import sys
import zipfile
import email
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess

APP_FILES = {
    'exports/project-minimum-001.json', 'exports/project-case-large.json',
    'public/import-templates/canonical_platform_case.json',
    'src/spare_mvp_backend/schema.sql',
}
SCRIPT_FILES = {
    'start-portable.ps1', 'stop-portable.ps1', 'test-frontend-modules.ps1', 'initialize-case-database.py',
    'test-port-selection.ps1', 'verify-portable-package.ps1', 'portable-package.py', 'portable-process.ps1',
    'prepare-solara-assets.py',
}
ENTRYPOINTS = {'Start-Platform.cmd', 'Start-Platform.vbs', 'Stop-Platform.cmd'}
PACKAGE_SUPPORT_FILES = {f'scripts/{name}' for name in SCRIPT_FILES} | ENTRYPOINTS | {'docs/windows-portable.md'}
BUILD_INPUTS = {
    'scripts/build-portable.ps1', 'scripts/prepare-windows-runtime.ps1',
    'scripts/initialize-case-database.py', 'packaging/windows-runtime.json',
    'packaging/requirements-windows.lock',
    'packaging/solara-assets.lock.json',
}


def package_destination(name: str) -> str:
    if name == 'docs/windows-portable.md':
        return 'README-Windows.md'
    if name in PACKAGE_SUPPORT_FILES:
        return name
    if app_file(name):
        return 'app/' + name
    raise ValueError(f'Unapproved package source: {name}')


def digest(path: Path) -> str:
    with path.open('rb') as stream:
        result = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
        return result.hexdigest()


def app_file(name: str) -> bool:
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        return False
    if any(part.startswith('.') or part == '__pycache__' for part in path.parts):
        return False
    if name in APP_FILES:
        return True
    return ((path.parts[0] == 'src' and path.suffix == '.py')
            or (path.parts[0] == 'contracts' and path.suffix in {'.json', '.md'})
            or (path.parts[0] == 'front' and path.suffix in {'.html', '.css', '.js', '.mjs', '.svg', '.png', '.webp', '.jpg', '.jpeg', '.woff', '.woff2'}))


def source_manifest(repo: Path) -> dict:
    tracked = subprocess.check_output(['git', '-C', str(repo), 'ls-files', '-z']).decode().split('\0')
    files = sorted(name for name in tracked if name and (app_file(name) or name in PACKAGE_SUPPORT_FILES))
    bound = set(files) | BUILD_INPUTS
    if subprocess.run(['git', '-C', str(repo), 'diff', '--quiet', 'HEAD', '--', *sorted(bound)]).returncode:
        raise ValueError('Package source differs from the recorded commit; commit the candidate before packaging')
    missing = (APP_FILES | PACKAGE_SUPPORT_FILES | BUILD_INPUTS) - set(tracked)
    if missing:
        raise ValueError(f'Missing reviewed fixtures: {sorted(missing)}')
    return {
        'format_version': 2,
        'source_commit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD']).decode().strip(),
        'files': {name: digest(repo / name) for name in files},
        'build_inputs': {name: digest(repo / name) for name in sorted(BUILD_INPUTS)},
    }


def stage(repo: Path, destination: Path, manifest: dict) -> None:
    if destination.exists():
        raise ValueError('Destination already exists; refusing to overwrite')
    if manifest.get('format_version') != 2:
        raise ValueError('Regenerate source manifest with package source format 2')
    files = manifest['files']
    build_inputs = manifest.get('build_inputs', {})
    if not (APP_FILES | PACKAGE_SUPPORT_FILES).issubset(files) or set(build_inputs) != BUILD_INPUTS:
        raise ValueError('Source manifest omits bound package or build files')
    for name in files:
        package_destination(name)
    for name, expected in (files | build_inputs).items():
        source = repo / name
        if source.is_symlink() or not source.resolve().is_relative_to(repo.resolve()) or digest(source) != expected:
            raise ValueError(f'Unapproved or changed source: {name}')
    destination.mkdir(parents=True)
    for name in files:
        target = destination / package_destination(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / name, target)
    (destination / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def immutable_files(root: Path):
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if path.is_symlink():
            raise ValueError(f'Symlink not allowed: {relative}')
        if not path.is_file() or relative.parts[0] == 'data' or relative.as_posix() == 'manifest.json':
            continue
        yield relative.as_posix(), path


def seal(root: Path) -> None:
    source = json.loads((root / 'source-manifest.json').read_text(encoding='utf-8'))
    for name, expected in source.get('files', {}).items():
        if digest(root / package_destination(name)) != expected:
            raise ValueError(f'Staged source differs from candidate: {name}')
    if (root / 'runtime').exists():
        verify_runtime_manifest(root / 'dependencies', root / 'runtime', require_archive=False)
        verify_frontend_assets(root, source)
    manifest = {'format_version': 1, 'source_commit': source['source_commit'],
                'files': {name: digest(path) for name, path in immutable_files(root)}}
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def verify_frontend_assets(root: Path, source: dict) -> None:
    lock_path = root / 'assets' / 'solara-assets.lock.json'
    if digest(lock_path) != source['build_inputs']['packaging/solara-assets.lock.json']:
        raise ValueError('Solara frontend lock differs from the reviewed source')
    import importlib.util
    spec = importlib.util.spec_from_file_location('solara_asset_verifier', root / 'scripts' / 'prepare-solara-assets.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.verify(root / 'assets' / 'solara-cdn', module.read_lock(lock_path))


def verify(root: Path, progress: bool = False) -> None:
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    actual = {}
    total = len(manifest['files'])
    for checked, (name, path) in enumerate(immutable_files(root), 1):
        actual[name] = digest(path)
        if progress and (checked == total or checked % 250 == 0):
            print(f'VERIFY_PROGRESS {checked} {total}', flush=True)
    if actual != manifest['files']:
        differing = sorted(name for name in actual.keys() | manifest['files'].keys()
                           if actual.get(name) != manifest['files'].get(name))
        raise ValueError(f'Package integrity mismatch: {differing[:10]}')
    print(f'Verified {len(actual)} immutable files; source {manifest["source_commit"]}')


def immutable_metadata(root: Path) -> dict[str, list[int]]:
    result = {}
    for name, path in immutable_files(root):
        stat = path.stat()
        result[name] = [stat.st_size, stat.st_mtime_ns]
    return result


def critical_runtime_file(name: str) -> bool:
    return (name.startswith(('app/', 'assets/', 'scripts/', 'resources/'))
            or name in {'SpareMvpDesktop.exe', 'source-manifest.json', 'green-source-manifest.json'}
            or (name.startswith('runtime/') and Path(name).name.lower() in {
                'python.exe', 'pythonw.exe', 'python3.dll', 'python313.dll',
                'vcruntime140.dll', 'vcruntime140_1.dll',
            }))


def verify_cached(root: Path, progress: bool = False) -> None:
    manifest_path = root / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest_sha256 = digest(manifest_path)
    metadata = immutable_metadata(root)
    cache_path = root / 'data' / 'integrity-cache.json'
    try:
        cache = json.loads(cache_path.read_text(encoding='utf-8'))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        cache = None
    cache_valid = (isinstance(cache, dict) and cache.get('format_version') == 1
                   and cache.get('manifest_sha256') == manifest_sha256
                   and cache.get('files') == metadata)
    if cache_valid:
        for name, path in immutable_files(root):
            if critical_runtime_file(name) and digest(path) != manifest['files'].get(name):
                raise ValueError(f'Critical runtime file differs from manifest: {name}')
        print(f'Integrity cache valid for {len(metadata)} immutable files', flush=True)
        return
    verify(root, progress=progress)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_suffix('.tmp')
    temporary.write_text(json.dumps({
        'format_version': 1,
        'manifest_sha256': manifest_sha256,
        'files': metadata,
    }, separators=(',', ':')) + '\n', encoding='utf-8')
    temporary.replace(cache_path)



def verify_runtime_dependencies(bundle: Path, runtime_source: Path) -> None:
    spec = json.loads((bundle / 'windows-runtime.json').read_text(encoding='utf-8'))
    if sys.version.split()[0] != spec['version'] or sys.maxsize <= 2 ** 32 or sys.platform != 'win32':
        raise ValueError('Runtime interpreter does not match Windows x64 specification')
    if Path(sys.executable).resolve() != (runtime_source / 'python.exe').resolve():
        raise ValueError('Verifier interpreter differs from the requested RuntimeSource')
    expected = {}
    for line in (bundle / 'requirements-windows.lock').read_text(encoding='utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)==(\S+) --hash=sha256:([a-f0-9]{64})', line)
        if not match:
            raise ValueError('Unsupported dependency lock entry')
        name, version, sha = match.groups()
        expected[re.sub(r'[-_.]+', '-', name).lower()] = (version, sha)
    installed = {re.sub(r'[-_.]+', '-', item.metadata['Name']).lower(): item.version
                 for item in importlib.metadata.distributions()}
    if installed != {name: value[0] for name, value in expected.items()}:
        raise ValueError('Installed distributions differ from the reviewed dependency lock')
    actual = {}
    for wheel in (bundle / 'wheelhouse').iterdir():
        if wheel.suffix != '.whl' or wheel.is_symlink():
            raise ValueError('Wheelhouse may contain only wheel files')
        with zipfile.ZipFile(wheel) as archive:
            metadata = email.message_from_bytes(archive.read(next(
                name for name in archive.namelist() if name.endswith('.dist-info/METADATA'))))
        name = re.sub(r'[-_.]+', '-', metadata['Name']).lower()
        if name in actual:
            raise ValueError('Duplicate distribution in wheelhouse')
        actual[name] = (metadata['Version'], digest(wheel))
    if actual != expected:
        raise ValueError('Wheelhouse differs from the reviewed dependency lock')
    if digest(bundle / 'downloads' / spec['archive']) != spec['sha256']:
        raise ValueError('CPython archive hash mismatch')
    print(f'Verified Windows runtime and {len(expected)} locked wheels')



def runtime_file_hashes(runtime_source: Path) -> dict[str, str]:
    if runtime_source.is_symlink() or not (runtime_source / 'python.exe').is_file():
        raise ValueError('RuntimeSource must be a complete prepared runtime directory')
    files = {}
    for path in sorted(runtime_source.rglob('*')):
        relative = path.relative_to(runtime_source)
        if path.is_symlink():
            raise ValueError(f'Runtime symlink is not allowed: {relative}')
        if '__pycache__' in relative.parts or path.suffix.lower() in {'.pyc', '.pyo'}:
            raise ValueError(f'Unexpected runtime bytecode: {relative}; prepare a fresh runtime')
        if path.is_file():
            files[relative.as_posix()] = digest(path)
    return files


def runtime_bindings(bundle: Path, require_archive: bool = True) -> dict:
    spec = json.loads((bundle / 'windows-runtime.json').read_text(encoding='utf-8'))
    archive_path = bundle / 'downloads' / spec['archive']
    archive_sha256 = digest(archive_path) if require_archive else spec['sha256']
    return {
        'format_version': 1,
        'runtime_spec_sha256': digest(bundle / 'windows-runtime.json'),
        'requirements_sha256': digest(bundle / 'requirements-windows.lock'),
        'archive': spec['archive'],
        'archive_sha256': archive_sha256,
    }


def verify_runtime_manifest(bundle: Path, runtime_source: Path, require_archive: bool = True) -> None:
    manifest_path = bundle / 'runtime-manifest.json'
    if not manifest_path.is_file():
        raise ValueError('Missing runtime-manifest.json; prepare a fresh runtime from locked archive and wheels')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    bindings = runtime_bindings(bundle, require_archive=require_archive)
    if {key: manifest.get(key) for key in bindings} != bindings:
        raise ValueError('Runtime manifest differs from archive or dependency lock')
    actual = runtime_file_hashes(runtime_source)
    if actual != manifest.get('files'):
        expected = manifest.get('files') or {}
        differing = sorted(name for name in actual.keys() | expected.keys() if actual.get(name) != expected.get(name))
        raise ValueError(f'Runtime content differs from prepared manifest: {differing[:10]}')


def finalize_prepared_runtime(bundle: Path) -> None:
    """Called only after prepare has freshly extracted and installed the locked inputs."""
    target = bundle / 'runtime-manifest.json'
    if target.exists():
        raise ValueError('Runtime manifest already exists; refusing to rebaseline a prepared runtime')
    runtime_source = bundle / 'runtime'
    verify_runtime_dependencies(bundle, runtime_source)
    manifest = {**runtime_bindings(bundle), 'files': runtime_file_hashes(runtime_source)}
    with target.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(manifest, indent=2) + '\n')
    verify_runtime_manifest(bundle, runtime_source)


def verify_runtime(bundle: Path, runtime_source: Path | None = None) -> None:
    runtime_source = runtime_source or bundle / 'runtime'
    verify_runtime_manifest(bundle, runtime_source)
    verify_runtime_dependencies(bundle, runtime_source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['source-manifest', 'stage', 'seal', 'verify', 'verify-cached', 'verify-runtime', 'finalize-runtime'])
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--source-manifest', type=Path)
    parser.add_argument('--runtime-source', type=Path)
    parser.add_argument('--progress', action='store_true')
    args = parser.parse_args()
    if args.command == 'source-manifest':
        args.root.write_text(json.dumps(source_manifest(args.repo), indent=2) + '\n', encoding='utf-8')
    elif args.command == 'stage':
        manifest = (json.loads(args.source_manifest.read_text(encoding='utf-8'))
                    if args.source_manifest else source_manifest(args.repo))
        stage(args.repo, args.root, manifest)
    elif args.command == 'seal':
        seal(args.root)
    elif args.command == 'finalize-runtime':
        finalize_prepared_runtime(args.root)
    elif args.command == 'verify-runtime':
        verify_runtime(args.root, args.runtime_source)
    elif args.command == 'verify-cached':
        verify_cached(args.root, progress=args.progress)
    else:
        verify(args.root, progress=args.progress)


if __name__ == '__main__':
    main()

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
}
SCRIPT_FILES = {
    'start-portable.ps1', 'stop-portable.ps1', 'test-frontend-modules.ps1',
    'test-port-selection.ps1', 'verify-portable-package.ps1', 'portable-package.py',
}
ENTRYPOINTS = {'Start-Platform.cmd', 'Start-Platform.vbs', 'Stop-Platform.cmd'}


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
    files = sorted(name for name in tracked if name and app_file(name))
    missing = APP_FILES - set(files)
    if missing:
        raise ValueError(f'Missing reviewed fixtures: {sorted(missing)}')
    return {
        'source_commit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD']).decode().strip(),
        'files': {name: digest(repo / name) for name in files},
    }


def stage(repo: Path, destination: Path, manifest: dict) -> None:
    if destination.exists():
        raise ValueError('Destination already exists; refusing to overwrite')
    files = manifest['files']
    if not APP_FILES.issubset(files):
        raise ValueError('Source manifest omits canonical fixtures')
    for name, expected in files.items():
        source = repo / name
        if not app_file(name) or source.is_symlink() or digest(source) != expected:
            raise ValueError(f'Unapproved or changed source: {name}')
    destination.mkdir(parents=True)
    for name in files:
        target = destination / 'app' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / name, target)
    for name in SCRIPT_FILES:
        target = destination / 'scripts' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(repo / 'scripts' / name, target)
    for name in ENTRYPOINTS:
        shutil.copyfile(repo / name, destination / name)
    shutil.copyfile(repo / 'docs' / 'windows-portable.md', destination / 'README-Windows.md')
    (destination / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def immutable_files(root: Path):
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if path.is_symlink():
            raise ValueError(f'Symlink not allowed: {relative}')
        if not path.is_file() or relative.parts[0] == 'data' or relative.as_posix() == 'manifest.json':
            continue
        if '__pycache__' in relative.parts or path.suffix == '.pyc':
            continue
        yield relative.as_posix(), path


def seal(root: Path) -> None:
    source = json.loads((root / 'source-manifest.json').read_text(encoding='utf-8'))
    manifest = {'format_version': 1, 'source_commit': source['source_commit'],
                'files': {name: digest(path) for name, path in immutable_files(root)}}
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def verify(root: Path) -> None:
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    actual = {name: digest(path) for name, path in immutable_files(root)}
    if actual != manifest['files']:
        differing = sorted(name for name in actual.keys() | manifest['files'].keys()
                           if actual.get(name) != manifest['files'].get(name))
        raise ValueError(f'Package integrity mismatch: {differing[:10]}')
    print(f'Verified {len(actual)} immutable files; source {manifest["source_commit"]}')



def verify_runtime(bundle: Path) -> None:
    spec = json.loads((bundle / 'windows-runtime.json').read_text(encoding='utf-8'))
    if sys.version.split()[0] != spec['version'] or sys.maxsize <= 2 ** 32 or sys.platform != 'win32':
        raise ValueError('Runtime interpreter does not match Windows x64 specification')
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['source-manifest', 'stage', 'seal', 'verify', 'verify-runtime'])
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--source-manifest', type=Path)
    args = parser.parse_args()
    if args.command == 'source-manifest':
        args.root.write_text(json.dumps(source_manifest(args.repo), indent=2) + '\n', encoding='utf-8')
    elif args.command == 'stage':
        manifest = (json.loads(args.source_manifest.read_text(encoding='utf-8'))
                    if args.source_manifest else source_manifest(args.repo))
        stage(args.repo, args.root, manifest)
    elif args.command == 'seal':
        seal(args.root)
    elif args.command == 'verify-runtime':
        verify_runtime(args.root)
    else:
        verify(args.root)


if __name__ == '__main__':
    main()

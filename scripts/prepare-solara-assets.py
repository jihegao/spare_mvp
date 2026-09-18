"""Prepare or verify the reviewed Solara frontend cache without npm execution."""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
from urllib.parse import urlsplit
from urllib.request import urlopen

DEFAULT_LOCK = Path(__file__).resolve().parents[1] / 'packaging' / 'solara-assets.lock.json'


def safe_path(value: str) -> str:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part in {'', '.', '..'} for part in value.split('/')) or '\\' in value or ':' in value:
        raise ValueError(f'Invalid asset path: {value}')
    return value


def read_lock(path: Path) -> dict:
    lock = json.loads(path.read_text(encoding='utf-8'))
    if lock.get('format_version') != 1 or not lock.get('packages'):
        raise ValueError('Unsupported or empty Solara asset lock')
    seen = set()
    for package in lock['packages']:
        url = urlsplit(package['url'])
        if url.scheme != 'https' or url.netloc != 'registry.npmjs.org' or url.query or url.fragment:
            raise ValueError('Asset archive must come from the official npm registry')
        for entry in package['files']:
            name = safe_path(entry['path'])
            safe_path(entry['member'])
            if name.lower() in seen:
                raise ValueError(f'Duplicate asset path: {name}')
            seen.add(name.lower())
    return lock


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(root: Path, lock: dict) -> None:
    expected = {entry['path']: entry['sha256'] for package in lock['packages'] for entry in package['files']}
    actual = {}
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Missing or symlinked Solara frontend cache')
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError('Symlinks are not allowed in the frontend cache')
        if path.is_file():
            actual[path.relative_to(root).as_posix()] = file_hash(path)
    if actual != expected:
        changed = sorted(name for name in actual.keys() | expected.keys() if actual.get(name) != expected.get(name))
        raise ValueError(f'Solara frontend cache missing, extra or changed files: {changed[:10]}')


def prepare(destination: Path, lock: dict, offline_source: Path | None = None) -> None:
    if destination.exists():
        raise ValueError('Destination exists; refusing to overwrite a frontend cache')
    if offline_source is not None:
        verify(offline_source, lock)
        shutil.copytree(offline_source, destination)
    else:
        destination.mkdir(parents=True)
        for package in lock['packages']:
            with urlopen(package['url'], timeout=120) as response:
                archive_data = response.read()
            if hashlib.sha256(archive_data).hexdigest() != package['sha256']:
                raise ValueError(f'Asset archive hash mismatch: {package["name"]}')
            with tarfile.open(fileobj=BytesIO(archive_data), mode='r:gz') as archive:
                for entry in package['files']:
                    member = archive.getmember(entry['member'])
                    if not member.isfile() or member.issym() or member.islnk():
                        raise ValueError('Asset archive member is not a regular file')
                    data = archive.extractfile(member).read()
                    if hashlib.sha256(data).hexdigest() != entry['sha256']:
                        raise ValueError(f'Asset file hash mismatch: {entry["path"]}')
                    target = destination / entry['path']
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
    verify(destination, lock)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', type=Path, default=DEFAULT_LOCK)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--offline-source', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    lock = read_lock(args.lock)
    if args.verify:
        verify(args.destination, lock)
    else:
        prepare(args.destination, lock, args.offline_source)
    count = sum(len(package['files']) for package in lock['packages'])
    print(f'Verified {count} locked Solara frontend assets')


if __name__ == '__main__':
    main()

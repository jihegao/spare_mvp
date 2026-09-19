"""Create a commit-bound source manifest for the Windows green desktop layer."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    names = [line.strip() for line in (repo / "packaging/green/source-files.txt").read_text(encoding="utf-8").splitlines()
             if line.strip() and not line.lstrip().startswith("#")]
    tracked = set(subprocess.check_output(["git", "-C", str(repo), "ls-files"], text=True).splitlines())
    missing = [name for name in names if name not in tracked or not (repo / name).is_file()]
    if missing:
        raise SystemExit(f"Green source files are missing or untracked: {missing}")
    if subprocess.run(["git", "-C", str(repo), "diff", "--quiet", "HEAD", "--", *names]).returncode:
        raise SystemExit("Green desktop source differs from HEAD; commit the candidate before packaging")
    manifest = {
        "format_version": 1,
        "source_commit": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
        "files": {name: digest(repo / name) for name in names},
    }
    args.root.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

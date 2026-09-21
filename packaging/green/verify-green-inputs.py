"""Fail closed unless green-package inputs came from one reviewed source commit."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def _manifest(path: Path, *, format_version: int, label: str) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if payload.get("format_version") != format_version or not isinstance(payload.get("source_commit"), str):
        raise ValueError(f"Invalid {label} manifest: {path}")
    return payload


def verify_inputs(portable: Path, desktop: Path, green_manifest_path: Path) -> dict[str, str]:
    portable = portable.resolve()
    desktop = desktop.resolve()
    portable_manifest = _manifest(portable / "source-manifest.json", format_version=2, label="portable source")
    green_manifest = _manifest(green_manifest_path, format_version=1, label="green source")
    provenance_path = desktop / "desktop-build-provenance.json"
    provenance = _manifest(provenance_path, format_version=1, label="desktop build provenance")
    commits = {
        portable_manifest["source_commit"],
        green_manifest["source_commit"],
        provenance["source_commit"],
    }
    if len(commits) != 1:
        raise ValueError("Green-package inputs come from different source commits")

    green_files = green_manifest.get("files")
    desktop_sources = provenance.get("source_files")
    if not isinstance(green_files, dict) or not isinstance(desktop_sources, dict) or not desktop_sources:
        raise ValueError("Desktop build provenance does not contain reviewed source hashes")
    expected_desktop_sources = {
        name: expected for name, expected in green_files.items() if name.startswith("desktop/")
    }
    if desktop_sources != expected_desktop_sources:
        raise ValueError("Desktop build source hashes differ from the green source manifest")

    executable_name = provenance.get("executable")
    if (
        not isinstance(executable_name, str)
        or Path(executable_name).name != executable_name
        or not executable_name.lower().endswith(".exe")
    ):
        raise ValueError("Desktop build provenance has an invalid executable name")
    artifacts = {
        "app_asar_sha256": desktop / "resources" / "app.asar",
        "executable_sha256": desktop / executable_name,
    }
    for field, artifact in artifacts.items():
        expected = provenance.get(field)
        if not isinstance(expected, str) or len(expected) != 64 or not artifact.is_file() or digest(artifact) != expected:
            raise ValueError(f"Desktop artifact differs from build provenance: {artifact}")
    executables = sorted(path.name for path in desktop.glob("*.exe") if path.is_file())
    if executables != [executable_name]:
        raise ValueError(f"Desktop directory executable set differs from provenance: {executables}")
    return {
        "source_commit": portable_manifest["source_commit"],
        "desktop_executable": executable_name,
        "app_asar_sha256": provenance["app_asar_sha256"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable", type=Path, required=True)
    parser.add_argument("--desktop", type=Path, required=True)
    parser.add_argument("--green-manifest", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify_inputs(args.portable, args.desktop, args.green_manifest), ensure_ascii=False))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()

"""Resolve the portable desktop's persistent and per-installation paths."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path


PRODUCT_DIRECTORY = "spare_mvp"
BINDING_FILE = "data-root-binding.json"


def _absolute_path(value: str, *, label: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        raise ValueError(f"{label} must be an absolute path: {value}")
    return candidate.resolve(strict=False)


def _normalized_key(path: Path) -> str:
    return os.path.normcase(os.path.realpath(path)).replace("\\", "/")


def _installation_id(package_root: Path) -> str:
    return hashlib.sha256(("spare-mvp-installation-v1\0" + _normalized_key(package_root)).encode("utf-8")).hexdigest()[:24]


def _overlaps(left: Path, right: Path) -> bool:
    left_key = _normalized_key(left).rstrip("/")
    right_key = _normalized_key(right).rstrip("/")
    return left_key == right_key or left_key.startswith(right_key + "/") or right_key.startswith(left_key + "/")


def _read_binding(binding_file: Path) -> Path | None:
    if not binding_file.exists():
        return None
    payload = json.loads(binding_file.read_text(encoding="utf-8-sig"))
    if (
        payload.get("format_version") != 1
        or not isinstance(payload.get("data_root"), str)
        or payload.get("installation_id") != binding_file.parent.name
        or not isinstance(payload.get("package_root"), str)
    ):
        raise ValueError(f"Invalid portable data binding: {binding_file}")
    bound_package_root = _absolute_path(payload["package_root"], label="bound package root")
    if _installation_id(bound_package_root) != payload["installation_id"]:
        raise ValueError(f"Portable data binding installation identity changed: {binding_file}")
    return _absolute_path(payload["data_root"], label="bound data root")


def _write_binding(binding_file: Path, installation_id: str, package_root: Path, data_root: Path) -> None:
    binding_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format_version": 1,
        "installation_id": installation_id,
        "package_root": str(package_root),
        "data_root": str(data_root),
    }
    temporary = binding_file.with_name(binding_file.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, binding_file)


def resolve_paths(
    package_root_value: str,
    *,
    explicit_data_root: str | None = None,
    environment: dict[str, str] | None = None,
    write_binding: bool = False,
) -> dict[str, object]:
    environment = os.environ if environment is None else environment
    package_root = _absolute_path(package_root_value, label="package root")
    local_app_data_value = environment.get("LOCALAPPDATA", "").strip()
    if not local_app_data_value:
        raise ValueError("LOCALAPPDATA is required for portable desktop path resolution")
    local_app_data = _absolute_path(local_app_data_value, label="LOCALAPPDATA")
    product_root = local_app_data / PRODUCT_DIRECTORY
    if not package_root.is_dir():
        raise ValueError(f"Package root is not an existing directory: {package_root}")
    installation_id = _installation_id(package_root)
    instance_root = (product_root / "instances" / installation_id).resolve(strict=False)
    binding_file = instance_root / BINDING_FILE
    bound_data_root = _read_binding(binding_file)

    requested = explicit_data_root
    if requested is None:
        override = environment.get("SPARE_MVP_DATA_ROOT", "").strip()
        requested = override or None
    if requested is not None:
        data_root = _absolute_path(requested, label="data root override")
        data_source = "explicit" if explicit_data_root is not None else "environment"
    elif bound_data_root is not None:
        data_root = bound_data_root
        data_source = "binding"
    else:
        data_root = (product_root / "data").resolve(strict=False)
        data_source = "default"

    if _overlaps(package_root, data_root):
        raise ValueError("Persistent data root must be outside the installation directory")
    if _overlaps(package_root, instance_root):
        raise ValueError("Instance state root must be outside the installation directory")
    if _overlaps(data_root, instance_root):
        raise ValueError("Persistent data and instance state roots must not overlap")
    if data_root == Path(data_root.anchor) or data_root in {local_app_data, product_root}:
        raise ValueError("Persistent data root is too broad for safe lifecycle management")
    data_text = str(data_root)
    if data_text.startswith("\\\\") or data_text.startswith("\\\\?\\") or data_text.startswith("\\\\.\\"):
        raise ValueError("Persistent data root must use a local non-device path")

    data_key = _normalized_key(data_root)
    lock_key = hashlib.sha256((data_key + "\0" + _normalized_key(local_app_data)).encode("utf-8")).hexdigest()[:32]
    data_lock = product_root / "locks" / (lock_key + ".json")
    data_mutex = "Local\\SpareMvpData_" + lock_key
    other_bindings: list[dict[str, str]] = []
    binding_scan_errors: list[str] = []
    instances_root = product_root / "instances"
    if instances_root.exists():
        for candidate in sorted(instances_root.glob(f"*/{BINDING_FILE}")):
            if candidate == binding_file:
                continue
            try:
                candidate_root = _read_binding(candidate)
                if candidate_root is not None and _normalized_key(candidate_root) == data_key:
                    other_bindings.append({
                        "installation_id": candidate.parent.name,
                        "binding_file": str(candidate.resolve(strict=False)),
                    })
            except (OSError, ValueError, json.JSONDecodeError) as error:
                binding_scan_errors.append(f"{candidate}: {error}")

    if write_binding:
        _write_binding(binding_file, installation_id, package_root, data_root)
        bound_data_root = data_root

    binding_matches_selected = (
        bound_data_root is not None and _normalized_key(bound_data_root) == _normalized_key(data_root)
    )

    return {
        "package_root": str(package_root),
        "installation_id": installation_id,
        "data_root": str(data_root),
        "database": str(data_root / "spare_mvp.sqlite3"),
        "instance_root": str(instance_root),
        "state_file": str(instance_root / "active-ports.json"),
        "pid_root": str(instance_root / "pids"),
        "logs_dir": str(instance_root / "logs"),
        "diagnostics_dir": str(instance_root / "diagnostics"),
        "integrity_cache": str(instance_root / "integrity-cache.json"),
        "output_root": str(data_root / "outputs"),
        "matplotlib_root": str(instance_root / "matplotlib"),
        "startup_lock": str(instance_root / "startup.lock"),
        "startup_mutex": "Local\\SpareMvpInstance_" + installation_id,
        "data_lock": str(data_lock.resolve(strict=False)),
        "data_mutex": data_mutex,
        "binding_file": str(binding_file.resolve(strict=False)),
        "binding_exists": bound_data_root is not None,
        "binding_matches_selected": binding_matches_selected,
        "data_root_source": data_source,
        "other_bindings": other_bindings,
        "binding_scan_errors": binding_scan_errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", required=True)
    parser.add_argument("--data-root")
    parser.add_argument("--write-binding", action="store_true")
    parser.add_argument("--field")
    args = parser.parse_args()
    try:
        result = resolve_paths(
            args.package_root,
            explicit_data_root=args.data_root,
            write_binding=args.write_binding,
        )
        if args.field:
            if args.field not in result or not isinstance(result[args.field], (str, int, bool)):
                raise ValueError(f"Unknown scalar path field: {args.field}")
            print(result[args.field])
        else:
            print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()

"""Optional Rust Monte Carlo backend boundary.

The product repository does not depend on the compiler wheel at import time.
The default runner imports it only when an ExperimentPlan explicitly selects
the Rust backend; tests can inject a fake implementing the same protocol.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any, Protocol


class RustMonteCarloBackendError(RuntimeError):
    """Stable error emitted by the optional Rust backend boundary."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class RustMonteCarloBackend(Protocol):
    """Injectable canonical batch execution boundary."""

    def run_canonical_batch(
        self,
        samples: list[dict[str, Any]],
        *,
        worker_threads: int,
        cache_dir: Path,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        """Execute canonical samples and return stable-indexed outcomes."""


class DefaultRustMonteCarloBackend:
    """Lazy adapter around the optional sim_engine_compiler wheel."""

    def run_canonical_batch(
        self,
        samples: list[dict[str, Any]],
        *,
        worker_threads: int,
        cache_dir: Path,
    ) -> dict[str, Any] | list[dict[str, Any]]:
        try:
            module = importlib.import_module("sim_engine_compiler")
        except (ImportError, ModuleNotFoundError) as exc:
            raise RustMonteCarloBackendError(
                "rust_backend_unavailable",
                "sim_engine_compiler is not installed",
                module="sim_engine_compiler",
            ) from exc
        entrypoint = getattr(module, "run_canonical_batch", None)
        if not callable(entrypoint):
            raise RustMonteCarloBackendError(
                "rust_backend_unavailable",
                "sim_engine_compiler.run_canonical_batch is unavailable",
                module="sim_engine_compiler",
            )
        cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            return entrypoint(
                samples,
                worker_threads=worker_threads,
                cache_dir=str(cache_dir),
            )
        except RustMonteCarloBackendError:
            raise
        except Exception as exc:  # extension exceptions are intentionally opaque here
            raw_code = str(getattr(exc, "code", "") or "")
            if raw_code in {
                "rust_compile_failed",
                "rust_execution_failed",
                "rust_result_contract_mismatch",
            }:
                code = raw_code
            elif "compile" in f"{type(exc).__name__} {exc}".lower():
                code = "rust_compile_failed"
            else:
                code = "rust_execution_failed"
            raise RustMonteCarloBackendError(
                code,
                str(exc) or "Rust Monte Carlo execution failed",
                exception_type=type(exc).__name__,
            ) from exc

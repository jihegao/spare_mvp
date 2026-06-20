"""Shared structured backend service errors."""

from __future__ import annotations

from typing import Any


class BackendApiError(ValueError):
    """Structured API facade error."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class RunServiceError(ValueError):
    """Structured error raised by the run service and run config normalizers."""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details

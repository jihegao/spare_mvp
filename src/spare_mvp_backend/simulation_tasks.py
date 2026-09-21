"""Process-local execution state for user-visible simulation tasks."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import json
import threading
import time
from typing import Any, Callable, Protocol
from uuid import uuid4

from src.spare_mvp_backend.errors import BackendApiError


TERMINAL_RETENTION_SECONDS = 30 * 60


class SimulationEngine(Protocol):
    """Execution boundary used by ``EngineRunner``."""

    def run(
        self,
        request: dict[str, Any],
        progress_callback: Callable[[dict[str, Any]], None],
    ) -> dict[str, Any]: ...


class SimulationEngineAdapter:
    """Adapt the current formal backend execution chain to ``SimulationEngine``."""

    def __init__(
        self,
        execute: Callable[[dict[str, Any], Callable[[dict[str, Any]], None]], dict[str, Any]],
    ) -> None:
        self._execute = execute

    def run(
        self,
        request: dict[str, Any],
        progress_callback: Callable[[dict[str, Any]], None],
    ) -> dict[str, Any]:
        return self._execute(copy.deepcopy(request), progress_callback)


class EngineRunner:
    """Stable runner interface above the currently selected simulation engine."""

    def __init__(self, engine: SimulationEngine) -> None:
        self._engine = engine

    def run(
        self,
        request: dict[str, Any],
        progress_callback: Callable[[dict[str, Any]], None],
    ) -> dict[str, Any]:
        return self._engine.run(request, progress_callback)


@dataclass
class _SimulationTask:
    task_id: str
    owner_user_id: str
    input_fingerprint: str
    request: dict[str, Any]
    created_at: datetime
    started_at: datetime
    status: str = "running"
    progress: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    completed_at: datetime | None = None
    expires_at: datetime | None = None


class SimulationTaskService:
    """Thread-safe, process-local task store with one heavy task at a time."""

    def __init__(
        self,
        runner: EngineRunner,
        *,
        terminal_retention_seconds: int = TERMINAL_RETENTION_SECONDS,
        clock: Callable[[], datetime] | None = None,
        monotonic: Callable[[], float] | None = None,
    ) -> None:
        self._runner = runner
        self._retention = timedelta(seconds=terminal_retention_seconds)
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._monotonic = monotonic or time.monotonic
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._tasks: dict[str, _SimulationTask] = {}
        self._active_task_id: str | None = None

    def submit(self, owner_user_id: str, request: dict[str, Any]) -> dict[str, Any]:
        frozen_request = copy.deepcopy(request)
        fingerprint = simulation_task_input_fingerprint(frozen_request)
        with self._condition:
            self._purge_expired_locked()
            active = self._tasks.get(self._active_task_id or "")
            if active is not None and active.status == "running":
                if active.owner_user_id == owner_user_id and active.input_fingerprint == fingerprint:
                    return self._status_locked(active)
                raise BackendApiError(
                    "simulation_task_busy",
                    "另一个仿真任务正在运行，请等待其完成后重试。",
                    retryable=True,
                )

            now = self._clock()
            task = _SimulationTask(
                task_id=f"simulation-task-{uuid4().hex}",
                owner_user_id=str(owner_user_id),
                input_fingerprint=fingerprint,
                request=frozen_request,
                created_at=now,
                started_at=now,
                progress=_initial_progress(frozen_request),
            )
            self._tasks[task.task_id] = task
            self._active_task_id = task.task_id
            thread = threading.Thread(
                target=self._execute,
                args=(task.task_id,),
                name=f"simulation-task-{task.task_id[-8:]}",
                daemon=True,
            )
            thread.start()
            return self._status_locked(task)

    def status(self, owner_user_id: str, task_id: str) -> dict[str, Any]:
        with self._condition:
            task = self._owned_task_locked(owner_user_id, task_id)
            return self._status_locked(task)

    def result(self, owner_user_id: str, task_id: str) -> dict[str, Any]:
        with self._condition:
            task = self._owned_task_locked(owner_user_id, task_id)
            if task.status == "running":
                raise BackendApiError(
                    "simulation_task_not_completed",
                    "仿真任务仍在运行。",
                    task_id=task.task_id,
                    status=task.status,
                )
            payload = {
                "task_id": task.task_id,
                "status": task.status,
                "result": copy.deepcopy(task.result),
            }
            if task.error is not None:
                payload["error"] = copy.deepcopy(task.error)
            return payload

    def wait_result(
        self,
        owner_user_id: str,
        task_id: str,
        *,
        timeout_seconds: float | None = None,
    ) -> dict[str, Any]:
        deadline = None if timeout_seconds is None else self._monotonic() + timeout_seconds
        with self._condition:
            while True:
                task = self._owned_task_locked(owner_user_id, task_id)
                if task.status != "running":
                    if task.status == "failed":
                        error = task.error or {}
                        raise BackendApiError(
                            str(error.get("code") or "simulation_task_failed"),
                            str(error.get("message") or "仿真任务执行失败。"),
                            **copy.deepcopy(error.get("details") or {}),
                        )
                    return copy.deepcopy(task.result or {})
                remaining = None if deadline is None else deadline - self._monotonic()
                if remaining is not None and remaining <= 0:
                    raise BackendApiError(
                        "simulation_task_wait_timeout",
                        "等待仿真任务完成超时。",
                        task_id=task_id,
                    )
                self._condition.wait(timeout=remaining)

    def _execute(self, task_id: str) -> None:
        def report(progress: dict[str, Any]) -> None:
            with self._condition:
                task = self._tasks.get(task_id)
                if task is None or task.status != "running":
                    return
                task.progress = _normalize_progress(progress, task.progress)
                self._condition.notify_all()

        with self._condition:
            task = self._tasks[task_id]
            request = copy.deepcopy(task.request)
        try:
            result = self._runner.run(request, report)
        except Exception as exc:  # noqa: BLE001 - async boundary must retain failure state.
            error = _structured_failure(exc)
            with self._condition:
                task = self._tasks[task_id]
                self._finish_locked(task, status="failed", error=error)
            return
        with self._condition:
            task = self._tasks[task_id]
            self._finish_locked(task, status="completed", result=copy.deepcopy(result))

    def _finish_locked(
        self,
        task: _SimulationTask,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
    ) -> None:
        now = self._clock()
        task.status = status
        task.result = result
        task.error = error
        task.completed_at = now
        task.expires_at = now + self._retention
        task.progress = {
            **task.progress,
            "stage": status,
            "elapsed_seconds": max(0.0, (now - task.started_at).total_seconds()),
            "eta_seconds": None,
        }
        if self._active_task_id == task.task_id:
            self._active_task_id = None
        self._condition.notify_all()

    def _owned_task_locked(self, owner_user_id: str, task_id: str) -> _SimulationTask:
        self._purge_expired_locked()
        task = self._tasks.get(str(task_id))
        if task is None or task.owner_user_id != str(owner_user_id):
            raise BackendApiError(
                "simulation_task_not_found",
                "仿真任务不存在、已过期或不可访问。",
            )
        return task

    def _purge_expired_locked(self) -> None:
        now = self._clock()
        expired_ids = [
            task_id
            for task_id, task in self._tasks.items()
            if task.status != "running" and task.expires_at is not None and task.expires_at <= now
        ]
        for task_id in expired_ids:
            del self._tasks[task_id]

    def _status_locked(self, task: _SimulationTask) -> dict[str, Any]:
        now = self._clock()
        progress = copy.deepcopy(task.progress)
        if task.status == "running":
            progress["elapsed_seconds"] = max(0.0, (now - task.started_at).total_seconds())
            processed = int(progress.get("processed") or 0)
            total = int(progress.get("total") or 0)
            if processed > 0 and total > processed:
                progress["eta_seconds"] = progress["elapsed_seconds"] / processed * (total - processed)
        return {
            "task_id": task.task_id,
            "status": task.status,
            "stage": progress.get("stage", task.status),
            "processed": int(progress.get("processed") or 0),
            "total": int(progress.get("total") or 0),
            "succeeded": int(progress.get("succeeded") or 0),
            "failed": int(progress.get("failed") or 0),
            "elapsed_seconds": float(progress.get("elapsed_seconds") or 0.0),
            "eta_seconds": progress.get("eta_seconds"),
            "input_fingerprint": task.input_fingerprint,
            "created_at": _iso(task.created_at),
            "started_at": _iso(task.started_at),
            "completed_at": _iso(task.completed_at),
            "expires_at": _iso(task.expires_at),
        }


def simulation_task_input_fingerprint(request: dict[str, Any]) -> str:
    canonical = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _initial_progress(request: dict[str, Any]) -> dict[str, Any]:
    settings = request.get("settings") if isinstance(request.get("settings"), dict) else {}
    try:
        total = max(0, int(settings.get("samples") or 0))
    except (TypeError, ValueError):
        total = 0
    return {
        "stage": "running",
        "processed": 0,
        "total": total,
        "succeeded": 0,
        "failed": 0,
        "elapsed_seconds": 0.0,
        "eta_seconds": None,
    }


def _normalize_progress(progress: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    normalized = copy.deepcopy(previous)
    for key in ("stage", "processed", "total", "succeeded", "failed", "elapsed_seconds", "eta_seconds"):
        if key in progress:
            normalized[key] = copy.deepcopy(progress[key])
    return normalized


def _structured_failure(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, BackendApiError):
        return {"code": exc.code, "message": str(exc), "details": copy.deepcopy(exc.details)}
    return {"code": "simulation_task_failed", "message": str(exc), "details": {}}


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value is not None else None

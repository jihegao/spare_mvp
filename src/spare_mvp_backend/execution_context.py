"""Shared execution-context fingerprints and in-memory visualization sessions."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Any, Callable
from uuid import uuid4


DEFAULT_CONTEXT_SAMPLES = 4
DEFAULT_CONTEXT_PARALLEL_CORES = 4
DEFAULT_CONTEXT_SEED = 20260621
DEFAULT_VISUALIZATION_SESSION_TTL_SECONDS = 30 * 60
DEFAULT_VISUALIZATION_SESSION_GLOBAL_LIMIT = 256
DEFAULT_VISUALIZATION_SESSION_OWNER_LIMIT = 32


def canonical_fingerprint(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class ResolvedExecutionContext:
    context: dict[str, Any]
    project: dict[str, Any]
    runtime_settings: dict[str, int]
    fingerprint: str
    experiment_plan_id: str | None = None


@dataclass
class _StoredVisualizationSession:
    expires_at: float
    last_accessed_at: float
    lru_sequence: int
    experiment_plan_id: str | None
    owner_user_id: str
    access_token_hash: str
    payload: dict[str, Any]


class VisualizationSessionStore:
    """Thread-safe process-local TTL storage shared by HTTP request handlers."""

    def __init__(
        self,
        ttl_seconds: int = DEFAULT_VISUALIZATION_SESSION_TTL_SECONDS,
        *,
        max_sessions: int = DEFAULT_VISUALIZATION_SESSION_GLOBAL_LIMIT,
        max_sessions_per_owner: int = DEFAULT_VISUALIZATION_SESSION_OWNER_LIMIT,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.ttl_seconds = max(1, int(ttl_seconds))
        self.max_sessions = max(1, int(max_sessions))
        self.max_sessions_per_owner = max(1, min(int(max_sessions_per_owner), self.max_sessions))
        self._clock = clock
        self._lock = threading.Lock()
        self._lru_sequence = 0
        self._sessions: dict[str, _StoredVisualizationSession] = {}

    def create(
        self,
        payload: dict[str, Any],
        *,
        owner_user_id: str,
        experiment_plan_id: str | None = None,
    ) -> dict[str, Any]:
        owner_user_id = str(owner_user_id or "").strip()
        if not owner_user_id:
            raise ValueError("visualization session owner_user_id is required")
        now = datetime.now(timezone.utc)
        now_monotonic = self._clock()
        visualization_session_id = f"visualization-session-{uuid4().hex}"
        session_access_token = secrets.token_urlsafe(48)
        stored = {
            **copy.deepcopy(payload),
            "visualization_session_id": visualization_session_id,
            "session_id": visualization_session_id,
            "created_at": now.isoformat().replace("+00:00", "Z"),
            "expires_at": (now + timedelta(seconds=self.ttl_seconds)).isoformat().replace("+00:00", "Z"),
        }
        with self._lock:
            self._purge_expired_locked()
            self._evict_owner_lru_locked(owner_user_id)
            self._evict_global_lru_locked()
            self._sessions[visualization_session_id] = _StoredVisualizationSession(
                expires_at=now_monotonic + self.ttl_seconds,
                last_accessed_at=now_monotonic,
                lru_sequence=self._next_lru_sequence_locked(),
                experiment_plan_id=experiment_plan_id,
                owner_user_id=owner_user_id,
                access_token_hash=_access_token_hash(session_access_token),
                payload=stored,
            )
        return {**copy.deepcopy(stored), "session_access_token": session_access_token}

    def get(
        self,
        visualization_session_id: str,
        *,
        actor_user_id: str | None = None,
        actor_role: str | None = None,
        session_access_token: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            self._purge_expired_locked()
            entry = self._sessions.get(visualization_session_id)
            if entry is None:
                raise KeyError(visualization_session_id)
            if session_access_token is not None:
                supplied_hash = _access_token_hash(session_access_token)
                allowed = hmac.compare_digest(entry.access_token_hash, supplied_hash)
            else:
                allowed = (
                    str(actor_user_id or "") == entry.owner_user_id
                    or str(actor_role or "") == "系统管理员"
                )
            if not allowed:
                raise PermissionError(visualization_session_id)
            entry.last_accessed_at = self._clock()
            entry.lru_sequence = self._next_lru_sequence_locked()
            return copy.deepcopy(entry.payload)

    def delete_for_experiment_plan(self, experiment_plan_id: str) -> list[str]:
        with self._lock:
            self._purge_expired_locked()
            removed = sorted(
                session_id
                for session_id, entry in self._sessions.items()
                if entry.experiment_plan_id == experiment_plan_id
            )
            for session_id in removed:
                self._sessions.pop(session_id, None)
            return removed

    def _purge_expired_locked(self) -> None:
        now = self._clock()
        expired = [
            session_id
            for session_id, entry in self._sessions.items()
            if entry.expires_at <= now
        ]
        for session_id in expired:
            self._sessions.pop(session_id, None)

    def _evict_owner_lru_locked(self, owner_user_id: str) -> None:
        owner_sessions = [
            (entry.last_accessed_at, entry.lru_sequence, session_id)
            for session_id, entry in self._sessions.items()
            if entry.owner_user_id == owner_user_id
        ]
        while len(owner_sessions) >= self.max_sessions_per_owner:
            _, _, session_id = min(owner_sessions)
            self._sessions.pop(session_id, None)
            owner_sessions = [item for item in owner_sessions if item[2] != session_id]

    def _evict_global_lru_locked(self) -> None:
        while len(self._sessions) >= self.max_sessions:
            session_id = min(
                self._sessions,
                key=lambda candidate: (
                    self._sessions[candidate].last_accessed_at,
                    self._sessions[candidate].lru_sequence,
                    candidate,
                ),
            )
            self._sessions.pop(session_id, None)

    def _next_lru_sequence_locked(self) -> int:
        self._lru_sequence += 1
        return self._lru_sequence


def _access_token_hash(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()

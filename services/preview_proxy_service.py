from __future__ import annotations

import os
import secrets
import threading
import time
from dataclasses import dataclass

from ..core import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS

_TOKEN_TTL_SECONDS = 3600
_MIN_TTL_SECONDS = 60
_MAX_TOKEN_ENTRIES = 20000
_GC_INTERVAL_SECONDS = 30


@dataclass
class _PreviewTokenEntry:
    path: str
    expires_at: float


_preview_tokens: dict[str, _PreviewTokenEntry] = {}
_path_to_token: dict[str, str] = {}
_token_lock = threading.Lock()
_last_gc = 0.0


_PREVIEWABLE_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def _is_valid_preview_file(path: str) -> bool:
    ext = os.path.splitext(path)[1].lower()
    return ext in _PREVIEWABLE_EXTENSIONS and os.path.isfile(path)


def _remove_token(token: str) -> None:
    entry = _preview_tokens.pop(token, None)
    if not entry:
        return
    indexed = _path_to_token.get(entry.path)
    if indexed == token:
        _path_to_token.pop(entry.path, None)


def _prune_expired(now: float) -> None:
    global _last_gc
    if now - _last_gc < _GC_INTERVAL_SECONDS and len(_preview_tokens) <= _MAX_TOKEN_ENTRIES:
        return
    _last_gc = now

    expired = [token for token, entry in _preview_tokens.items() if entry.expires_at <= now or not _is_valid_preview_file(entry.path)]
    for token in expired:
        _remove_token(token)

    overflow = len(_preview_tokens) - _MAX_TOKEN_ENTRIES
    if overflow <= 0:
        return

    oldest = sorted(_preview_tokens.items(), key=lambda item: item[1].expires_at)[:overflow]
    for token, _ in oldest:
        _remove_token(token)


def register_preview_file(file_path: str, ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str | None:
    abs_path = os.path.abspath(file_path or "")
    if not _is_valid_preview_file(abs_path):
        return None

    ttl = max(int(ttl_seconds), _MIN_TTL_SECONDS)
    now = time.time()
    expires_at = now + ttl

    with _token_lock:
        _prune_expired(now)

        existing = _path_to_token.get(abs_path)
        if existing:
            entry = _preview_tokens.get(existing)
            if entry and entry.expires_at > now:
                entry.expires_at = expires_at
                return existing
            _remove_token(existing)

        token = secrets.token_urlsafe(18)
        _preview_tokens[token] = _PreviewTokenEntry(path=abs_path, expires_at=expires_at)
        _path_to_token[abs_path] = token
        return token


def resolve_preview_file(token: str, refresh_ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str | None:
    clean_token = (token or "").strip()
    if not clean_token:
        return None

    now = time.time()
    refresh_ttl = max(int(refresh_ttl_seconds), _MIN_TTL_SECONDS)

    with _token_lock:
        _prune_expired(now)

        entry = _preview_tokens.get(clean_token)
        if not entry or entry.expires_at <= now:
            _remove_token(clean_token)
            return None

        if not _is_valid_preview_file(entry.path):
            _remove_token(clean_token)
            return None

        entry.expires_at = now + refresh_ttl
        return entry.path

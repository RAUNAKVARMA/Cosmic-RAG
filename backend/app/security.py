"""Optional API authentication and rate limiting for production deployments."""

from __future__ import annotations

import os
import time
from collections import defaultdict
from threading import Lock
from typing import Optional

from fastapi import Header, HTTPException, Request


def api_secret() -> str:
    """Shared secret for Bearer auth. Empty = auth disabled (local dev)."""
    return (os.getenv("API_SECRET") or "").strip()


def verify_api_auth(authorization: Optional[str] = Header(default=None)) -> None:
    """FastAPI dependency: require ``Authorization: Bearer <API_SECRET>`` when configured."""
    secret = api_secret()
    if not secret:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Send Authorization: Bearer <API_SECRET>.",
        )
    token = authorization[7:].strip()
    if token != secret:
        raise HTTPException(status_code=403, detail="Invalid API credentials.")


def client_ip(request: Request) -> str:
    """Best-effort client IP (respects Render/Vercel ``X-Forwarded-For``)."""
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class _SlidingWindowLimiter:
    """In-memory per-key rate limiter (single-process; sufficient for Render free tier)."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._hits[key] if t > now - self._window]
            if len(recent) >= self._max:
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Rate limit exceeded ({self._max} requests per "
                        f"{self._window}s). Try again later."
                    ),
                )
            recent.append(now)
            self._hits[key] = recent


_image_gen_limiter: Optional[_SlidingWindowLimiter] = None


def check_image_gen_rate_limit(request: Request) -> None:
    """Limit expensive image generation per client IP."""
    global _image_gen_limiter
    max_requests = int(os.getenv("IMAGE_GEN_RATE_LIMIT", "10"))
    window_seconds = int(os.getenv("IMAGE_GEN_RATE_WINDOW_SECONDS", "3600"))
    if max_requests <= 0:
        return
    if _image_gen_limiter is None:
        _image_gen_limiter = _SlidingWindowLimiter(max_requests, window_seconds)
    _image_gen_limiter.check(client_ip(request))

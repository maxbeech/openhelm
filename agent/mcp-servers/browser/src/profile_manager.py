"""
Manages named Chrome user-data directories for persistent browser sessions.

Profiles live under ~/.openhelm/profiles/<name>/ and are standard Chrome
user-data directories. A sidecar profiles.json stores metadata (name,
created_at, last_used, notes).

Profile locking prevents two Chrome instances from sharing the same
user-data directory simultaneously (Chrome enforces this at the file
level and will error otherwise).
"""

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

PROFILES_ROOT = os.path.expanduser("~/.openhelm/profiles")
PROFILES_META = os.path.join(PROFILES_ROOT, "profiles.json")

# Known auth cookies per domain — used by check_session_cookies to determine
# whether a persistent session is likely valid.
KNOWN_AUTH_COOKIES: Dict[str, Dict[str, Any]] = {
    "x.com": {"required": ["auth_token", "ct0"], "domain": ".x.com"},
    "twitter.com": {"required": ["auth_token", "ct0"], "domain": ".twitter.com"},
    "reddit.com": {"required": ["reddit_session"], "domain": ".reddit.com"},
    "github.com": {"required": ["user_session"], "domain": ".github.com"},
    "linkedin.com": {"required": ["li_at"], "domain": ".linkedin.com"},
}


def _ensure_root() -> None:
    os.makedirs(PROFILES_ROOT, exist_ok=True)


def _read_meta() -> Dict[str, Any]:
    _ensure_root()
    if not os.path.exists(PROFILES_META):
        return {}
    with open(PROFILES_META, "r") as f:
        return json.load(f)


def _write_meta(meta: Dict[str, Any]) -> None:
    _ensure_root()
    with open(PROFILES_META, "w") as f:
        json.dump(meta, f, indent=2, default=str)


def _lock_path(name: str) -> str:
    return os.path.join(PROFILES_ROOT, name, ".openhelm.lock")


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------


def list_profiles() -> List[Dict[str, Any]]:
    """Return metadata for every profile."""
    meta = _read_meta()
    result = []
    for name, info in meta.items():
        result.append({
            "name": name,
            "path": get_profile_path(name),
            "created_at": info.get("created_at"),
            "last_used": info.get("last_used"),
            "notes": info.get("notes", ""),
            "locked": is_profile_locked(name),
        })
    return result


def create_profile(name: str, notes: str = "") -> str:
    """
    Create a new named profile directory and register it in metadata.

    Returns the absolute path to the profile's user-data directory.
    Raises if a profile with the same name already exists.
    """
    meta = _read_meta()
    if name in meta:
        raise ValueError(f"Profile '{name}' already exists")

    profile_dir = os.path.join(PROFILES_ROOT, name)
    os.makedirs(profile_dir, exist_ok=True)

    now = datetime.now(timezone.utc).isoformat()
    meta[name] = {
        "created_at": now,
        "last_used": now,
        "notes": notes,
    }
    _write_meta(meta)
    return profile_dir


def delete_profile(name: str) -> bool:
    """
    Remove a profile directory and its metadata entry.

    Returns True if deleted, False if not found.
    Raises if the profile is currently locked.
    """
    if is_profile_locked(name):
        raise RuntimeError(f"Profile '{name}' is currently in use — cannot delete")

    meta = _read_meta()
    if name not in meta:
        return False

    import shutil
    profile_dir = os.path.join(PROFILES_ROOT, name)
    if os.path.isdir(profile_dir):
        shutil.rmtree(profile_dir, ignore_errors=True)

    del meta[name]
    _write_meta(meta)
    return True


def get_profile_path(name: str) -> str:
    """Resolve a profile name to its absolute directory path."""
    return os.path.join(PROFILES_ROOT, name)


def profile_exists(name: str) -> bool:
    meta = _read_meta()
    return name in meta


def touch_last_used(name: str) -> None:
    """Update the last_used timestamp for a profile."""
    meta = _read_meta()
    if name in meta:
        meta[name]["last_used"] = datetime.now(timezone.utc).isoformat()
        _write_meta(meta)


# ------------------------------------------------------------------
# Locking
# ------------------------------------------------------------------


def is_profile_locked(name: str) -> bool:
    """Check whether a profile is currently locked by another process."""
    lp = _lock_path(name)
    if not os.path.exists(lp):
        return False
    # Stale lock detection: if lock file is older than 2 hours, treat as stale
    try:
        mtime = os.path.getmtime(lp)
        if time.time() - mtime > 7200:
            os.remove(lp)
            return False
    except OSError:
        pass
    return True


def acquire_lock(name: str) -> None:
    """
    Acquire an exclusive lock on a profile.

    Raises RuntimeError if the profile is already locked.
    """
    if is_profile_locked(name):
        raise RuntimeError(
            f"Profile '{name}' is already in use by another task. "
            "It will be available once the current task completes."
        )
    lp = _lock_path(name)
    os.makedirs(os.path.dirname(lp), exist_ok=True)
    with open(lp, "w") as f:
        f.write(json.dumps({
            "locked_at": datetime.now(timezone.utc).isoformat(),
            "pid": os.getpid(),
        }))


def release_lock(name: str) -> None:
    """Release the lock on a profile (idempotent)."""
    lp = _lock_path(name)
    try:
        os.remove(lp)
    except FileNotFoundError:
        pass


@contextmanager
def profile_lock(name: str):
    """Context manager that acquires and releases a profile lock."""
    acquire_lock(name)
    try:
        yield
    finally:
        release_lock(name)


# ------------------------------------------------------------------
# Session checking
# ------------------------------------------------------------------


async def check_session_cookies(
    tab,
    domain: str,
    network_interceptor=None,
    timeout_seconds: float = 20.0,
) -> Dict[str, Any]:
    """
    Check whether a persistent session is likely valid for a domain.

    Uses CDP to inspect cookies. If the domain is in KNOWN_AUTH_COOKIES,
    checks for the required cookie names. Otherwise falls back to checking
    whether any cookies exist for the domain.

    Returns dict with:
      - logged_in: bool  (best guess)
      - cookies_present: list of cookie names found
      - required_cookies: list of required cookie names (if known)
      - missing_cookies: list of missing required cookies
    """
    import asyncio

    urls = [f"https://{domain}", f"https://www.{domain}"]

    cookies = []
    try:
        if network_interceptor:
            cookies = await asyncio.wait_for(
                network_interceptor.get_cookies(tab, urls),
                timeout=timeout_seconds,
            )
        else:
            import nodriver as uc
            raw = await asyncio.wait_for(
                tab.send(uc.cdp.network.get_cookies(urls=urls)),
                timeout=timeout_seconds,
            )
            cookies = raw if isinstance(raw, list) else []
    except asyncio.TimeoutError:
        return {
            "logged_in": False,
            "cookies_present": [],
            "required_cookies": [],
            "missing_cookies": [],
            "error": f"Cookie retrieval timed out after {timeout_seconds}s — browser may be unresponsive",
        }
    except Exception as e:
        return {
            "logged_in": False,
            "cookies_present": [],
            "required_cookies": [],
            "missing_cookies": [],
            "error": f"Cookie retrieval failed: {str(e)}",
        }

    cookie_names = set()
    for c in cookies:
        if isinstance(c, dict):
            cookie_names.add(c.get("name", ""))
        elif hasattr(c, "name"):
            cookie_names.add(c.name)

    # Check against known auth cookies
    clean_domain = domain.lstrip("www.").lstrip(".")
    known = KNOWN_AUTH_COOKIES.get(clean_domain, {})
    required = known.get("required", [])
    missing = [r for r in required if r not in cookie_names]

    if required:
        logged_in = len(missing) == 0
    else:
        # Unknown domain: assume logged in if any cookies exist
        logged_in = len(cookie_names) > 0

    return {
        "logged_in": logged_in,
        "cookies_present": sorted(cookie_names),
        "required_cookies": required,
        "missing_cookies": missing,
    }

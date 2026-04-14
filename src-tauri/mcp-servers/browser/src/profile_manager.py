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

try:
    import psutil  # type: ignore
except ImportError:  # pragma: no cover — psutil is a hard dep in practice
    psutil = None  # type: ignore

PROFILES_ROOT = os.path.expanduser("~/.openhelm/profiles")
PROFILES_META = os.path.join(PROFILES_ROOT, "profiles.json")

# Maximum number of seconds `wait_for_unlock` will poll before giving up.
# Long enough to cover a typical short run's cleanup tail but short enough
# that we don't deadlock the scheduler.
#
# Round 12 (2026-04-13): raised from 15s -> 45s. In the manual-run incident
# on 2026-04-13 eight runs fired within the same 30-second window, all
# targeting the same Reddit/default profiles, and the 15s ceiling dropped
# us into the "Profile X is already in use" error immediately after the
# first contender grabbed the lock. 45s is long enough for any realistic
# 2-3-way contention to serialise through cleanly (per-run spawn takes
# ~8-15s once Chrome is warm) while still short enough that a true
# deadlocked lock holder surfaces as an error within a minute.
LOCK_WAIT_DEFAULT_SECONDS = 45.0
LOCK_WAIT_POLL_INTERVAL_SECONDS = 0.5


def _pid_start_time(pid: int) -> Optional[float]:
    """Return the process start time for *pid*, or None if unavailable.

    Used together with the PID itself to detect PID reuse: two processes
    may share a PID over time, but they cannot share a start time.
    """
    if psutil is None:
        return None
    try:
        return float(psutil.Process(pid).create_time())
    except Exception:  # ProcessLookupError, AccessDenied, ...
        return None

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
    """Check whether a profile is currently locked by a live owning process.

    A lock is considered *stale* (and is silently cleared) if any of these
    are true:

    - The lock file is older than 2 minutes (Round 13: reduced from 10 min).
    - The recorded PID is no longer alive.
    - The recorded PID is alive but belongs to a *different* process than
      the one that originally took the lock (PID reuse). We detect this by
      comparing the recorded ``pid_start_time`` against the live process's
      actual start time via psutil — if they disagree, the lock holder has
      already died and its PID was recycled.
    """
    lp = _lock_path(name)
    if not os.path.exists(lp):
        return False
    try:
        mtime = os.path.getmtime(lp)
        if time.time() - mtime > 120:
            os.remove(lp)
            return False

        with open(lp, "r") as f:
            lock_data = json.load(f)
        lock_pid = lock_data.get("pid")
        if not lock_pid:
            return True  # Malformed but present — treat as locked conservatively

        # Step 1: is the PID even alive?
        try:
            os.kill(lock_pid, 0)
        except (ProcessLookupError, PermissionError):
            os.remove(lp)
            return False

        # Step 2: PID-reuse detection — if we recorded a start time, verify
        # the live process's start time still matches. If it doesn't, the
        # original locker died and an unrelated process has inherited the
        # PID, so the lock is stale.
        recorded_start = lock_data.get("pid_start_time")
        if recorded_start is not None:
            live_start = _pid_start_time(int(lock_pid))
            if live_start is None:
                # Process vanished between the kill(0) and the psutil call
                os.remove(lp)
                return False
            # Compare with a 1-second tolerance — psutil and /proc round
            # differently and we only care about coarse identity.
            if abs(float(recorded_start) - live_start) > 1.0:
                os.remove(lp)
                return False
    except (OSError, json.JSONDecodeError, KeyError, ValueError):
        # Any unexpected state → leave the file in place and report locked;
        # the 10-minute staleness check will eventually clear it.
        pass
    return True


def acquire_lock(name: str) -> None:
    """
    Acquire an exclusive lock on a profile.

    Raises RuntimeError if the profile is already locked. Callers that can
    tolerate a short wait should use :func:`wait_for_unlock` first.
    """
    if is_profile_locked(name):
        raise RuntimeError(
            f"Profile '{name}' is already in use by another task. "
            "It will be available once the current task completes."
        )
    lp = _lock_path(name)
    os.makedirs(os.path.dirname(lp), exist_ok=True)
    pid = os.getpid()
    payload: Dict[str, Any] = {
        "locked_at": datetime.now(timezone.utc).isoformat(),
        "pid": pid,
    }
    start = _pid_start_time(pid)
    if start is not None:
        payload["pid_start_time"] = start
    with open(lp, "w") as f:
        f.write(json.dumps(payload))


def release_lock(name: str) -> None:
    """Release the lock on a profile (idempotent)."""
    lp = _lock_path(name)
    try:
        os.remove(lp)
    except FileNotFoundError:
        pass


def wait_for_unlock(
    name: str,
    timeout_seconds: float = LOCK_WAIT_DEFAULT_SECONDS,
    poll_interval_seconds: float = LOCK_WAIT_POLL_INTERVAL_SECONDS,
) -> bool:
    """Poll ``is_profile_locked`` until *name* is free or *timeout* elapses.

    Returns True as soon as the lock is available, or False if the timeout
    is reached. Each poll also re-runs the staleness detection in
    ``is_profile_locked``, so a lock whose owning process has died in the
    meantime will be cleared on the next tick.

    This is the critical missing piece that turns "Profile 'default' is
    already in use by another task" from a fatal error into a short,
    transparent wait when two concurrent runs briefly overlap. The
    previous behaviour forced the agent to fall back to an ephemeral
    profile, losing cookies/auth and tripping every site's bot detection.
    """
    if timeout_seconds <= 0:
        return not is_profile_locked(name)
    deadline = time.monotonic() + timeout_seconds
    while True:
        if not is_profile_locked(name):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(poll_interval_seconds)


def release_all_held_by(pid: int) -> List[str]:
    """Best-effort: release every profile lock whose owning PID matches *pid*.

    Used during MCP subprocess shutdown so the lock files we wrote during
    this process's lifetime are cleared even if the idle-cleanup loop or
    the per-instance close path missed them. Returns the list of profile
    names whose lock file was removed.
    """
    released: List[str] = []
    if not os.path.isdir(PROFILES_ROOT):
        return released
    try:
        entries = os.listdir(PROFILES_ROOT)
    except OSError:
        return released
    for entry in entries:
        lp = _lock_path(entry)
        if not os.path.exists(lp):
            continue
        try:
            with open(lp, "r") as f:
                lock_data = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        if lock_data.get("pid") == pid:
            try:
                os.remove(lp)
                released.append(entry)
            except OSError:
                pass
    return released


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

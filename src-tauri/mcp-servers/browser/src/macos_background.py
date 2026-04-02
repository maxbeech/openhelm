"""macOS-specific background browser launch utilities.

Launches Chrome via macOS Launch Services (``open -g -n -a``) so the
browser window never steals focus or appears on top of other windows.

On non-macOS platforms every function is a safe no-op that returns None/False.
"""

import asyncio
import os
import platform
import socket
import subprocess
from typing import List, Optional

from debug_logger import debug_logger

_MOD = "macos_background"


def is_macos() -> bool:
    """Return True when running on macOS."""
    return platform.system().lower() == "darwin"


def free_port() -> int:
    """Reserve and return a free TCP port."""
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def get_app_bundle_path(executable_path: str) -> Optional[str]:
    """Extract the ``.app`` bundle path from a browser executable path.

    Example::

        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        -> '/Applications/Google Chrome.app'
    """
    parts = executable_path.split("/")
    for i, part in enumerate(parts):
        if part.endswith(".app"):
            return "/".join(parts[: i + 1])
    return None


def get_app_name(bundle_path: str) -> str:
    """Extract the app name from a bundle path.

    Example::

        '/Applications/Google Chrome.app' -> 'Google Chrome'
    """
    return os.path.basename(bundle_path).replace(".app", "")


# ------------------------------------------------------------------
# Port scanning
# ------------------------------------------------------------------

async def find_pid_on_port(
    port: int,
    retries: int = 20,
    delay: float = 0.25,
) -> Optional[int]:
    """Return the PID of the first process listening on *port*.

    Retries up to *retries* times with *delay* seconds between attempts
    to accommodate Chrome's startup time.
    """
    for _ in range(retries):
        try:
            # Use -sTCP:LISTEN to return only the process listening on the
            # port (Chrome), not processes connected to it (e.g. the Python
            # MCP server acting as a CDP client).
            proc = await asyncio.create_subprocess_exec(
                "lsof", "-t", "-i", f"TCP:{port}", "-sTCP:LISTEN",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            stdout, _ = await proc.communicate()
            if stdout and stdout.strip():
                pids = stdout.decode().strip().split("\n")
                if pids:
                    return int(pids[0])
        except Exception:
            pass
        await asyncio.sleep(delay)
    return None


# ------------------------------------------------------------------
# AppleScript helper
# ------------------------------------------------------------------

async def deactivate_app(app_name: str) -> None:
    """Hide a macOS app via AppleScript (safety-net for focus reclaim)."""
    script = (
        'tell application "System Events" to '
        f'set visible of process "{app_name}" to false'
    )
    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=3.0)
    except Exception:
        pass


# ------------------------------------------------------------------
# Background launch
# ------------------------------------------------------------------

async def launch_browser_background(
    executable_path: str,
    chrome_args: List[str],
    port: int,
) -> Optional[int]:
    """Launch Chrome in the background on macOS without stealing focus.

    Uses ``open -g -n -a`` (Launch Services) so the window never
    appears on top.  Returns the Chrome PID, or ``None`` on failure so
    the caller can fall back to the normal nodriver launch path.

    Args:
        executable_path: Full path to the Chrome binary.
        chrome_args: Complete Chrome CLI arguments (including
            ``--remote-debugging-port``).
        port: The debugging port Chrome will listen on (used to
            discover the PID after launch).

    Returns:
        The PID of the launched Chrome process, or ``None``.
    """
    if not is_macos():
        return None

    bundle_path = get_app_bundle_path(executable_path)
    if not bundle_path:
        debug_logger.log_warning(
            _MOD, "launch_browser_background",
            f"Could not derive .app bundle from: {executable_path}",
        )
        return None

    app_name = get_app_name(bundle_path)

    # -g  = do NOT bring to foreground
    # -n  = open a new instance (separate from user's personal Chrome)
    # -a  = specify application by path
    # --args = pass remaining tokens to the application
    cmd = ["open", "-g", "-n", "-a", bundle_path, "--args"] + chrome_args

    debug_logger.log_info(
        _MOD, "launch_browser_background",
        f"Launching {app_name} in background on port {port}",
    )

    try:
        proc = subprocess.Popen(  # noqa: S603 — args are not user-supplied
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # ``open`` dispatches to Launch Services and returns quickly
        proc.wait(timeout=10)
    except Exception as e:
        debug_logger.log_warning(
            _MOD, "launch_browser_background",
            f"`open` command failed: {e}",
        )
        return None

    # Wait for Chrome to start listening on the debugging port
    pid = await find_pid_on_port(port)
    if pid is None:
        debug_logger.log_warning(
            _MOD, "launch_browser_background",
            f"Chrome did not start on port {port} within timeout",
        )
        return None

    debug_logger.log_info(
        _MOD, "launch_browser_background",
        f"Chrome launched in background (PID {pid}, port {port})",
    )

    # Safety net: hide Chrome in case it briefly activated despite -g
    await deactivate_app(app_name)

    return pid

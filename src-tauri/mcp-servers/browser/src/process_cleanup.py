"""Robust process cleanup system for browser instances."""

import atexit
import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Dict, List, Set
import psutil
from debug_logger import debug_logger


class ProcessCleanup:
    """Manages browser process tracking and cleanup."""

    def __init__(self):
        self.pid_file = Path(os.path.expanduser("~/.stealth_browser_pids.json"))
        self._run_id: str | None = None
        self.tracked_pids: Set[int] = set()
        self.browser_processes: Dict[str, int] = {}
        self._setup_cleanup_handlers()
        self._recover_orphaned_processes()

    def set_run_id(self, run_id: str) -> None:
        """Switch to per-run PID file for concurrent-run safety.

        Called after CLI args are parsed when ``--run-id`` is provided.
        Migrates any already-tracked PIDs to the new per-run file.
        """
        self._run_id = run_id
        per_run_dir = Path(os.path.expanduser("~/.openhelm/browser-pids"))
        os.makedirs(per_run_dir, mode=0o700, exist_ok=True)
        self.pid_file = per_run_dir / f"run-{run_id}.json"
        # Persist any PIDs already tracked (usually none at this point)
        if self.browser_processes:
            self._save_tracked_pids()
        debug_logger.log_info(
            "process_cleanup", "set_run_id",
            f"Switched to per-run PID file: {self.pid_file}",
        )
    
    def _setup_cleanup_handlers(self):
        """Setup signal handlers and atexit cleanup."""
        atexit.register(self._cleanup_all_tracked)
        
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, self._signal_handler)
        if hasattr(signal, 'SIGINT'):
            signal.signal(signal.SIGINT, self._signal_handler)
        
        if sys.platform == "win32":
            if hasattr(signal, 'SIGBREAK'):
                signal.signal(signal.SIGBREAK, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        """Handle termination signals."""
        debug_logger.log_info("process_cleanup", "signal_handler", f"Received signal {signum}, initiating cleanup...")
        self._cleanup_all_tracked()
        sys.exit(0)
    
    def _load_tracked_pids(self) -> Dict[str, int]:
        """Load tracked PIDs from disk."""
        try:
            if self.pid_file.exists():
                with open(self.pid_file, 'r') as f:
                    data = json.load(f)
                    return data.get('browser_processes', {})
        except Exception as e:
            debug_logger.log_warning("process_cleanup", "load_pids", f"Failed to load PID file: {e}")
        return {}
    
    def _save_tracked_pids(self):
        """Save tracked PIDs to disk."""
        try:
            os.makedirs(self.pid_file.parent, mode=0o700, exist_ok=True)
            data = {
                'browser_processes': self.browser_processes,
                'timestamp': time.time()
            }
            with open(self.pid_file, 'w') as f:
                json.dump(data, f)
        except Exception as e:
            debug_logger.log_warning("process_cleanup", "save_pids", f"Failed to save PID file: {e}")
    
    def _recover_orphaned_processes(self):
        """Kill any orphaned browser processes from previous runs."""
        saved_processes = self._load_tracked_pids()
        killed_count = 0
        
        for instance_id, pid in saved_processes.items():
            if self._kill_process_by_pid(pid, instance_id):
                killed_count += 1
        
        if killed_count > 0:
            debug_logger.log_info("process_cleanup", "recovery", f"Killed {killed_count} orphaned browser processes")
        
        self._clear_pid_file()
    
    def track_browser_process(self, instance_id: str, browser_process) -> bool:
        """Track a browser process for cleanup.
        
        Args:
            instance_id: Browser instance identifier
            browser_process: Browser process object with .pid attribute
            
        Returns:
            bool: True if tracking was successful
        """
        try:
            if hasattr(browser_process, 'pid') and browser_process.pid:
                pid = browser_process.pid
                self.browser_processes[instance_id] = pid
                self.tracked_pids.add(pid)
                self._save_tracked_pids()
                
                debug_logger.log_info("process_cleanup", "track_process", 
                                    f"Tracking browser process {pid} for instance {instance_id}")
                return True
            else:
                debug_logger.log_warning("process_cleanup", "track_process", 
                                       f"Browser process for {instance_id} has no PID")
                return False
                
        except Exception as e:
            debug_logger.log_error("process_cleanup", "track_process", 
                                 f"Failed to track process for {instance_id}: {e}")
            return False
    
    def track_browser_process_by_pid(self, instance_id: str, pid: int) -> bool:
        """Track a browser process by raw PID.

        Used when Chrome was launched externally (e.g. via macOS ``open``
        command) and we only have the PID, not a process object.
        """
        try:
            if not psutil.pid_exists(pid):
                debug_logger.log_warning(
                    "process_cleanup", "track_process_by_pid",
                    f"PID {pid} does not exist",
                )
                return False

            self.browser_processes[instance_id] = pid
            self.tracked_pids.add(pid)
            self._save_tracked_pids()

            debug_logger.log_info(
                "process_cleanup", "track_process_by_pid",
                f"Tracking browser PID {pid} for instance {instance_id}",
            )
            return True
        except Exception as e:
            debug_logger.log_error(
                "process_cleanup", "track_process_by_pid",
                f"Failed to track PID {pid} for {instance_id}: {e}",
            )
            return False

    def untrack_browser_process(self, instance_id: str) -> bool:
        """Stop tracking a browser process.
        
        Args:
            instance_id: Browser instance identifier
            
        Returns:
            bool: True if untracking was successful
        """
        try:
            if instance_id in self.browser_processes:
                pid = self.browser_processes[instance_id]
                self.tracked_pids.discard(pid)
                del self.browser_processes[instance_id]
                self._save_tracked_pids()
                
                debug_logger.log_info("process_cleanup", "untrack_process", 
                                    f"Stopped tracking process {pid} for instance {instance_id}")
                return True
            return False
            
        except Exception as e:
            debug_logger.log_error("process_cleanup", "untrack_process", 
                                 f"Failed to untrack process for {instance_id}: {e}")
            return False
    
    def kill_browser_process(self, instance_id: str) -> bool:
        """Kill a specific browser process.
        
        Args:
            instance_id: Browser instance identifier
            
        Returns:
            bool: True if process was killed successfully
        """
        if instance_id not in self.browser_processes:
            return False
        
        pid = self.browser_processes[instance_id]
        success = self._kill_process_by_pid(pid, instance_id)
        
        if success:
            self.untrack_browser_process(instance_id)
        
        return success
    
    def _kill_process_by_pid(self, pid: int, instance_id: str = "unknown") -> bool:
        """Kill a process by PID using multiple methods.
        
        Args:
            pid: Process ID to kill
            instance_id: Instance identifier for logging
            
        Returns:
            bool: True if process was killed successfully
        """
        try:
            if not psutil.pid_exists(pid):
                debug_logger.log_info("process_cleanup", "kill_process", 
                                    f"Process {pid} for {instance_id} already terminated")
                return True
            
            try:
                proc = psutil.Process(pid)
                proc_name = proc.name()
                
                if not any(name in proc_name.lower() for name in ['chrome', 'chromium', 'msedge']):
                    debug_logger.log_warning("process_cleanup", "kill_process", 
                                           f"PID {pid} is not a browser process ({proc_name}), skipping")
                    return False
                    
            except psutil.NoSuchProcess:
                debug_logger.log_info("process_cleanup", "kill_process", 
                                    f"Process {pid} for {instance_id} no longer exists")
                return True
            except Exception as e:
                debug_logger.log_warning("process_cleanup", "kill_process", 
                                       f"Could not verify process {pid}: {e}")
            
            try:
                proc = psutil.Process(pid)
                proc.terminate()
                
                try:
                    proc.wait(timeout=3)
                    debug_logger.log_info("process_cleanup", "kill_process", 
                                        f"Process {pid} for {instance_id} terminated gracefully")
                    return True
                except psutil.TimeoutExpired:
                    pass
                    
            except psutil.NoSuchProcess:
                return True
            except Exception as e:
                debug_logger.log_warning("process_cleanup", "kill_process", 
                                       f"Failed to terminate process {pid} gracefully: {e}")
            
            try:
                proc = psutil.Process(pid)
                proc.kill()
                
                try:
                    proc.wait(timeout=2)
                    debug_logger.log_info("process_cleanup", "kill_process", 
                                        f"Process {pid} for {instance_id} force killed")
                    return True
                except psutil.TimeoutExpired:
                    debug_logger.log_error("process_cleanup", "kill_process", 
                                         f"Process {pid} for {instance_id} did not die after force kill")
                    return False
                    
            except psutil.NoSuchProcess:
                return True
            except Exception as e:
                debug_logger.log_error("process_cleanup", "kill_process", 
                                     f"Failed to force kill process {pid}: {e}")
                return False
                
        except Exception as e:
            debug_logger.log_error("process_cleanup", "kill_process", 
                                 f"Failed to kill process {pid} for {instance_id}: {e}")
            return False
    
    def _find_nodriver_chrome_pids(self, own_only: bool = False) -> List[int]:
        """Find Chrome processes spawned by nodriver (uc_* temp user-data-dir).

        This is a safety-net that catches instances whose PID was tracked
        incorrectly (e.g. when find_pid_on_port returned the Python MCP
        server PID instead of the Chrome PID).

        Args:
            own_only: If True and a run_id is set, only return Chrome
                processes that were launched by THIS run (identified by
                the ``--openhelm-run=<run_id>`` Chrome arg).  This
                prevents one run's cleanup from killing browsers owned
                by other concurrent runs.
        """
        pids: List[int] = []
        try:
            for proc in psutil.process_iter(["pid", "name", "cmdline"]):
                try:
                    name = (proc.info.get("name") or "").lower()
                    if not any(n in name for n in ["chrome", "chromium", "msedge"]):
                        continue
                    # Skip helper/renderer sub-processes
                    if "helper" in name:
                        continue
                    cmdline = proc.info.get("cmdline") or []
                    cmd_str = " ".join(cmdline)
                    # Must have nodriver temp dir AND remote debugging port
                    if "/uc_" not in cmd_str:
                        continue
                    if "--remote-debugging-port" not in cmd_str:
                        continue
                    # When own_only is set, only match processes tagged
                    # with this run's unique marker arg.
                    if own_only and self._run_id:
                        marker = f"--openhelm-run={self._run_id}"
                        if marker not in cmd_str:
                            continue
                    pids.append(proc.info["pid"])
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except Exception as e:
            debug_logger.log_warning(
                "process_cleanup", "_find_nodriver_chrome_pids",
                f"Error scanning for nodriver Chrome processes: {e}",
            )
        return pids

    def _cleanup_all_tracked(self):
        """Clean up all tracked browser processes and this run's orphaned instances.

        When a ``run_id`` is set (concurrent-run mode), the orphan scan is
        scoped to only Chrome processes tagged with this run's marker arg
        (``--openhelm-run=<run_id>``).  This prevents one run's exit from
        killing Chrome instances that belong to other concurrent runs.
        """
        killed_count = 0

        # 1. Kill tracked PIDs (if they are actually Chrome)
        if self.browser_processes:
            debug_logger.log_info("process_cleanup", "cleanup_all",
                                f"Cleaning up {len(self.browser_processes)} tracked browser processes...")
            for instance_id, pid in list(self.browser_processes.items()):
                if self._kill_process_by_pid(pid, instance_id):
                    killed_count += 1

        # 2. Fallback: scan for nodriver Chrome processes that were not
        #    tracked correctly.  Use own_only=True so we never kill
        #    browsers belonging to other concurrent runs.
        orphan_pids = self._find_nodriver_chrome_pids(own_only=True)
        for pid in orphan_pids:
            if self._kill_process_by_pid(pid, "orphan-scan"):
                killed_count += 1

        if killed_count > 0:
            debug_logger.log_info("process_cleanup", "cleanup_all",
                                f"Cleaned up {killed_count} browser processes total"
                                f" ({len(orphan_pids)} from orphan scan)")
        else:
            debug_logger.log_info("process_cleanup", "cleanup_all", "No browser processes to clean up")

        self.browser_processes.clear()
        self.tracked_pids.clear()
        self._clear_pid_file()
    
    def _clear_pid_file(self):
        """Clear the PID tracking file."""
        try:
            if self.pid_file.exists():
                self.pid_file.unlink()
        except Exception as e:
            debug_logger.log_warning("process_cleanup", "clear_pid_file", f"Failed to clear PID file: {e}")
    
    def kill_all_nodriver_chrome(self) -> int:
        """Kill this run's nodriver Chrome processes.

        Called before spawning a new browser on retry to ensure no stale
        processes from THIS run interfere with port binding or profile
        locking.  Also cleans up stale PID files from the
        ``~/.openhelm/browser-pids/`` directory (only files whose
        processes are all dead).

        When a ``run_id`` is set, the orphan scan is scoped to only
        Chrome processes tagged with this run's marker arg so that
        concurrent runs are never affected.

        Returns the number of processes killed.
        """
        killed = 0

        # 1. Kill tracked processes (current run)
        for instance_id, pid in list(self.browser_processes.items()):
            if self._kill_process_by_pid(pid, instance_id):
                killed += 1
        self.browser_processes.clear()
        self.tracked_pids.clear()

        # 2. Kill orphans found via process scan (scoped to own run)
        for pid in self._find_nodriver_chrome_pids(own_only=True):
            if self._kill_process_by_pid(pid, "pre-spawn-cleanup"):
                killed += 1

        # 3. Clean stale PID files from other runs (only if ALL their
        #    processes are dead — never kill live processes from other runs)
        pid_dir = Path(os.path.expanduser("~/.openhelm/browser-pids"))
        if pid_dir.is_dir():
            for f in pid_dir.iterdir():
                if f.suffix == ".json" and f != self.pid_file:
                    try:
                        data = json.loads(f.read_text())
                        all_dead = True
                        for inst_id, pid in data.get("browser_processes", {}).items():
                            if psutil.pid_exists(pid):
                                all_dead = False
                        if all_dead:
                            f.unlink(missing_ok=True)
                    except Exception:
                        f.unlink(missing_ok=True)

        # 4. Clean stale profile locks
        profiles_dir = Path(os.path.expanduser("~/.openhelm/profiles"))
        if profiles_dir.is_dir():
            for lock in profiles_dir.rglob(".openhelm.lock"):
                try:
                    lock.unlink(missing_ok=True)
                except Exception:
                    pass

        if killed:
            debug_logger.log_info(
                "process_cleanup", "kill_all_nodriver_chrome",
                f"Pre-spawn cleanup: killed {killed} stale Chrome processes",
            )
        return killed

    def kill_stale_nodriver_chrome(self) -> int:
        """Kill only THIS instance's tracked Chrome processes and stale PID files.

        Unlike ``kill_all_nodriver_chrome()``, this does NOT scan for and kill
        ALL nodriver Chrome processes system-wide. This prevents destroying
        browsers from other concurrent runs (e.g. ones where the user is
        solving a CAPTCHA).

        Returns the number of processes killed.
        """
        killed = 0

        # 1. Kill processes tracked by THIS MCP instance
        for instance_id, pid in list(self.browser_processes.items()):
            if self._kill_process_by_pid(pid, instance_id):
                killed += 1
        self.browser_processes.clear()
        self.tracked_pids.clear()

        # 2. Clean stale PID files from OTHER runs (only if the process is dead)
        pid_dir = Path(os.path.expanduser("~/.openhelm/browser-pids"))
        if pid_dir.is_dir():
            for f in pid_dir.iterdir():
                if f.suffix == ".json" and f != self.pid_file:
                    try:
                        data = json.loads(f.read_text())
                        all_dead = True
                        for inst_id, pid in data.get("browser_processes", {}).items():
                            if psutil.pid_exists(pid):
                                all_dead = False
                        # Only remove stale PID files (all processes dead)
                        if all_dead:
                            f.unlink(missing_ok=True)
                    except Exception:
                        f.unlink(missing_ok=True)

        if killed:
            debug_logger.log_info(
                "process_cleanup", "kill_stale_nodriver_chrome",
                f"Pre-spawn cleanup: killed {killed} own tracked Chrome processes",
            )
        return killed

    def get_tracked_processes(self) -> Dict[str, int]:
        """Get currently tracked processes.
        
        Returns:
            Dict mapping instance_id to PID
        """
        return self.browser_processes.copy()
    
    def is_process_alive(self, instance_id: str) -> bool:
        """Check if a tracked process is still alive.
        
        Args:
            instance_id: Browser instance identifier
            
        Returns:
            bool: True if process is alive
        """
        if instance_id not in self.browser_processes:
            return False
        
        pid = self.browser_processes[instance_id]
        return psutil.pid_exists(pid)


process_cleanup = ProcessCleanup()
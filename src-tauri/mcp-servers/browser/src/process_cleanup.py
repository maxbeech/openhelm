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
    
    def _find_nodriver_chrome_pids(self) -> List[int]:
        """Find Chrome processes spawned by nodriver (uc_* temp user-data-dir).

        This is a safety-net that catches instances whose PID was tracked
        incorrectly (e.g. when find_pid_on_port returned the Python MCP
        server PID instead of the Chrome PID).
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
        """Clean up all tracked browser processes and any orphaned nodriver instances."""
        killed_count = 0

        # 1. Kill tracked PIDs (if they are actually Chrome)
        if self.browser_processes:
            debug_logger.log_info("process_cleanup", "cleanup_all",
                                f"Cleaning up {len(self.browser_processes)} tracked browser processes...")
            for instance_id, pid in list(self.browser_processes.items()):
                if self._kill_process_by_pid(pid, instance_id):
                    killed_count += 1

        # 2. Fallback: scan for any nodriver Chrome processes that were not
        #    tracked correctly (e.g. PID file had the Python MCP server PID).
        orphan_pids = self._find_nodriver_chrome_pids()
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
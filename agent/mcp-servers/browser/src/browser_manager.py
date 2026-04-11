"""Browser instance management with nodriver."""

import asyncio
import json
import uuid
from typing import Dict, Optional, List
from datetime import datetime, timedelta

import nodriver as uc
from nodriver import Browser, Tab

from debug_logger import debug_logger
from models import BrowserInstance, BrowserState, BrowserOptions, PageState
from persistent_storage import persistent_storage
from dynamic_hook_system import dynamic_hook_system
from platform_utils import get_platform_info, check_browser_executable, merge_browser_args
from process_cleanup import process_cleanup
from stealth import inject_stealth
from macos_background import (
    is_macos,
    free_port as macos_free_port,
    launch_browser_background,
    find_pid_on_port,
)


class BrowserManager:
    """Manages multiple browser instances."""

    # Idle timeout in seconds — instances unused for this long are auto-closed.
    IDLE_TIMEOUT_SECONDS = 300  # 5 minutes

    # Heartbeat interval — how often to check CDP connections
    HEARTBEAT_INTERVAL_SECONDS = 30

    def __init__(self):
        self._instances: Dict[str, dict] = {}
        self._lock = asyncio.Lock()
        self._heartbeat_task: Optional[asyncio.Task] = None

    def start_heartbeat(self):
        """Start the background CDP heartbeat task."""
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.ensure_future(self._heartbeat_loop())

    async def _heartbeat_loop(self):
        """
        Periodically ping all active CDP connections and reconnect if needed.

        This catches degrading connections early — before a tool call hits
        the dead connection and fails. If a connection is found dead, we
        attempt reconnection while the Chrome process is still warm.
        """
        while True:
            try:
                await asyncio.sleep(self.HEARTBEAT_INTERVAL_SECONDS)
                await self._heartbeat_tick()
            except asyncio.CancelledError:
                break
            except Exception as e:
                debug_logger.log_warning(
                    "browser_manager", "_heartbeat_loop",
                    f"Heartbeat error: {e}"
                )

    async def _heartbeat_tick(self):
        """Run one heartbeat check across all instances."""
        async with self._lock:
            instance_ids = list(self._instances.keys())

        for instance_id in instance_ids:
            try:
                data = await self.get_instance(instance_id)
                if not data:
                    continue

                tab = data['tab']
                # Quick probe — 3s timeout is enough for a healthy connection
                try:
                    await asyncio.wait_for(tab.evaluate("1"), timeout=3.0)
                except (OSError, ConnectionError):
                    # Connection dead — try to reconnect proactively
                    debug_logger.log_info(
                        "browser_manager", "_heartbeat_tick",
                        f"Heartbeat: CDP dead for {instance_id}, reconnecting"
                    )
                    await self._reconnect_tab(instance_id, data)
                except asyncio.TimeoutError:
                    debug_logger.log_info(
                        "browser_manager", "_heartbeat_tick",
                        f"Heartbeat: CDP slow for {instance_id}"
                    )
                except Exception:
                    pass  # Non-connection errors are fine
            except Exception:
                pass

    # Maximum spawn retries when Chrome fails to start.  4 attempts handles
    # the transient "Browser window not found [code: -32000]" case where the
    # first couple of starts land on a half-alive profile; by the 3rd/4th
    # attempt the stale Chrome has been killed and the profile lock cleared.
    MAX_SPAWN_RETRIES = 4

    async def spawn_browser(self, options: BrowserOptions) -> BrowserInstance:
        """
        Spawn a new browser instance with given options.

        On macOS (non-headless, background=True) uses a two-phase launch:
        1. Chrome is launched via ``open -g -n -a`` so it never steals focus.
        2. nodriver connects to the already-running instance via CDP.

        Falls back to normal nodriver launch if the background launch fails
        or on non-macOS platforms.

        Retries up to MAX_SPAWN_RETRIES times with aggressive stale-process
        cleanup between attempts.
        """
        instance_id = str(uuid.uuid4())

        instance = BrowserInstance(
            instance_id=instance_id,
            headless=options.headless,
            user_agent=options.user_agent,
            viewport={"width": options.viewport_width, "height": options.viewport_height}
        )

        last_error = None
        for attempt in range(self.MAX_SPAWN_RETRIES):
            try:
                if attempt > 0:
                    debug_logger.log_info(
                        "browser_manager", "spawn_browser",
                        f"Spawn retry {attempt + 1}/{self.MAX_SPAWN_RETRIES} "
                        f"after: {last_error}"
                    )
                    # Aggressive cleanup before retry.  On -32000 failures
                    # the profile lock or a half-alive Chrome is usually
                    # the culprit, so always run the full kill path.
                    process_cleanup.kill_all_nodriver_chrome()
                    await asyncio.sleep(1.5 + attempt * 1.5)  # 1.5s, 3s, 4.5s

                browser, tab, used_background = await self._do_spawn(
                    instance_id, options
                )
                break  # Success
            except Exception as e:
                last_error = e
                if attempt == self.MAX_SPAWN_RETRIES - 1:
                    instance.state = BrowserState.ERROR
                    raise Exception(f"Failed to spawn browser: {str(e)}")
                continue

        await self._configure_tab(tab, options)
        await self._setup_dynamic_hooks(tab, instance_id)

        async with self._lock:
            self._instances[instance_id] = {
                'browser': browser,
                'tab': tab,
                'instance': instance,
                'options': options,
                'network_data': []
            }

        instance.state = BrowserState.READY
        instance.update_activity()

        persistent_storage.store_instance(instance_id, {
            'state': instance.state.value,
            'created_at': instance.created_at.isoformat(),
            'current_url': getattr(tab, 'url', ''),
            'title': 'Browser Instance'
        })

        # Start the heartbeat if not already running
        self.start_heartbeat()

        return instance

    async def _do_spawn(self, instance_id: str, options: BrowserOptions):
        """
        Internal spawn logic — launches Chrome and returns (browser, tab, used_background).
        Separated so spawn_browser can retry on failure.
        """
        # Only kill stale nodriver Chrome processes owned by THIS MCP instance.
        # Previously killed ALL nodriver Chrome, which destroyed browsers from
        # other runs (including ones where the user is solving a CAPTCHA).
        process_cleanup.kill_stale_nodriver_chrome()

        platform_info = get_platform_info()
        browser_executable = check_browser_executable()
        if not browser_executable:
            raise Exception("No compatible browser found")

        browser_type = self._identify_browser_type(browser_executable)
        debug_logger.log_info(
            "browser_manager", "spawn_browser",
            f"Platform: {platform_info['system']} | Sandbox: {options.sandbox} "
            f"| Background: {options.background} | Browser: {browser_type}"
        )

        browser_args = merge_browser_args()
        # Tag Chrome with this run's ID so the orphan-scan in
        # process_cleanup can distinguish this run's browsers from
        # those of other concurrent runs.
        run_id = process_cleanup._run_id
        if run_id:
            browser_args.append(f"--openhelm-run={run_id}")

        config = uc.Config(
            headless=options.headless,
            user_data_dir=options.user_data_dir,
            sandbox=options.sandbox,
            browser_executable_path=browser_executable,
            browser_args=browser_args
        )

        # --- Two-phase background launch (macOS only) ---
        used_background = await self._try_background_launch(
            config, browser_executable, options
        )

        try:
            browser = await asyncio.wait_for(uc.start(config=config), timeout=30.0)
        except asyncio.TimeoutError:
            raise Exception("Browser failed to start within 30 seconds (port conflict or Chrome init hang)")

        # --- Validate a usable page target exists ---
        # Occasionally Chrome reports the browser target before a page target
        # is registered, or the initial page target is destroyed during
        # profile restore.  main_tab can then return a stale/unusable target
        # whose first CDP call fails with "Browser window not found
        # [code: -32000]".  Refresh targets and probe the tab briefly; if it
        # still does not respond, raise so spawn_browser retries cleanly.
        tab = None
        probe_error: Optional[Exception] = None
        for probe_attempt in range(4):  # ~6s total budget
            try:
                await asyncio.wait_for(browser.update_targets(), timeout=2.0)
            except Exception as e:
                probe_error = e
            candidate = browser.main_tab
            if candidate is None:
                probe_error = Exception("Browser has no main_tab yet")
                await asyncio.sleep(0.5 + probe_attempt * 0.5)
                continue
            try:
                await asyncio.wait_for(candidate.evaluate("1"), timeout=3.0)
                tab = candidate
                break
            except Exception as e:
                probe_error = e
                await asyncio.sleep(0.5 + probe_attempt * 0.5)
        if tab is None:
            # Tear down this half-alive Chrome so the retry path has a clean
            # slate — otherwise the stale process keeps the profile locked.
            try:
                await asyncio.wait_for(browser.stop(), timeout=2.0)
            except Exception:
                pass
            raise Exception(
                f"Browser started but no CDP-reachable page target: {probe_error}"
            )

        # --- Process tracking ---
        if used_background:
            # Increased retries (30 × 0.5s = 15s) to handle slow profile loads.
            # Named Chrome profiles with large history can take >4.5s to start,
            # which was causing PID tracking to silently fail and leaving orphans.
            pid = await find_pid_on_port(config.port, retries=30, delay=0.5)
            if pid:
                process_cleanup.track_browser_process_by_pid(instance_id, pid)
            else:
                debug_logger.log_warning(
                    "browser_manager", "spawn_browser",
                    f"Could not find PID for background browser {instance_id} — "
                    f"process scan fallback will handle cleanup at run end"
                )
        elif hasattr(browser, '_process') and browser._process:
            process_cleanup.track_browser_process(instance_id, browser._process)
        else:
            debug_logger.log_warning(
                "browser_manager", "spawn_browser",
                f"Browser {instance_id} has no process to track"
            )

        return browser, tab, used_background

    # ------------------------------------------------------------------
    # Background launch helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _identify_browser_type(executable: str) -> str:
        lower = executable.lower()
        if 'edge' in lower or 'msedge' in lower:
            return "Microsoft Edge"
        if 'chromium' in lower:
            return "Chromium"
        if 'chrome' in lower:
            return "Google Chrome"
        return "Unknown"

    async def _try_background_launch(
        self,
        config,
        browser_executable: str,
        options: BrowserOptions,
    ) -> bool:
        """Attempt macOS background launch.  Returns True on success.

        On success ``config.host`` / ``config.port`` are set so nodriver
        connects to the already-running Chrome instead of spawning one.
        """
        if not (is_macos() and not options.headless and options.background):
            return False

        try:
            port = macos_free_port()
            config.host = "127.0.0.1"
            config.port = port

            # Build the exact arg list nodriver would normally use
            chrome_args = config()

            pid = await launch_browser_background(
                browser_executable, chrome_args, port
            )

            if pid is None:
                debug_logger.log_warning(
                    "browser_manager", "_try_background_launch",
                    "Background launch failed — falling back to standard launch"
                )
                config.host = None
                config.port = None
                return False

            debug_logger.log_info(
                "browser_manager", "_try_background_launch",
                f"Background launch OK (PID {pid}, port {port})"
            )
            return True

        except Exception as e:
            debug_logger.log_warning(
                "browser_manager", "_try_background_launch",
                f"Background launch error: {e}"
            )
            config.host = None
            config.port = None
            return False

    @staticmethod
    async def _configure_tab(tab, options: BrowserOptions):
        """Apply stealth JS, user-agent, headers, and viewport to a connected tab."""
        # Inject stealth patches before any page JS runs
        try:
            await inject_stealth(tab)
        except Exception as e:
            debug_logger.log_warning(
                "browser_manager", "_configure_tab",
                f"Failed to inject stealth script: {e}"
            )

        if options.user_agent:
            await tab.send(uc.cdp.emulation.set_user_agent_override(
                user_agent=options.user_agent
            ))

        if options.extra_headers:
            await tab.send(uc.cdp.network.set_extra_http_headers(
                headers=options.extra_headers
            ))

        await tab.set_window_size(
            left=0, top=0,
            width=options.viewport_width,
            height=options.viewport_height,
        )
        debug_logger.log_info(
            "browser_manager", "_configure_tab",
            f"Viewport: {options.viewport_width}x{options.viewport_height}, stealth injected"
        )
    
    async def _setup_dynamic_hooks(self, tab: Tab, instance_id: str):
        """Setup dynamic hook system for browser instance."""
        try:
            dynamic_hook_system.add_instance(instance_id)
            
            await dynamic_hook_system.setup_interception(tab, instance_id)
            
            debug_logger.log_info("browser_manager", "_setup_dynamic_hooks", f"Dynamic hook system setup complete for instance {instance_id}")
            
        except Exception as e:
            debug_logger.log_error("browser_manager", "_setup_dynamic_hooks", f"Failed to setup dynamic hooks for {instance_id}: {e}")

    async def get_instance(self, instance_id: str) -> Optional[dict]:
        """
        Get browser instance by ID.

        Also refreshes the instance's last-activity timestamp so the idle
        cleanup task knows the instance is still in use.

        Args:
            instance_id (str): The ID of the browser instance.

        Returns:
            Optional[dict]: The browser instance data if found, else None.
        """
        async with self._lock:
            data = self._instances.get(instance_id)
            if data:
                data['instance'].update_activity()
            return data

    async def list_instances(self) -> List[BrowserInstance]:
        """
        List all browser instances.

        Returns:
            List[BrowserInstance]: List of all browser instances.
        """
        async with self._lock:
            return [data['instance'] for data in self._instances.values()]

    async def close_instance(self, instance_id: str) -> bool:
        """
        Close and remove a browser instance.

        Args:
            instance_id (str): The ID of the browser instance to close.

        Returns:
            bool: True if closed successfully, False otherwise.
        """
        import asyncio
        
        async def _do_close():
            async with self._lock:
                if instance_id not in self._instances:
                    return False

                data = self._instances[instance_id]
                browser = data['browser']
                instance = data['instance']

                try:
                    if hasattr(browser, 'tabs') and browser.tabs:
                        for tab in browser.tabs[:]:
                            try:
                                await tab.close()
                            except Exception:
                                pass
                except Exception:
                    pass

                try:
                    import asyncio
                    if hasattr(browser, 'connection') and browser.connection:
                        asyncio.get_event_loop().create_task(browser.connection.disconnect())
                        debug_logger.log_info("browser_manager", "close_connection", "closed connection using get_event_loop().create_task()")
                except RuntimeError:
                    try:
                        import asyncio
                        if hasattr(browser, 'connection') and browser.connection:
                            await asyncio.wait_for(browser.connection.disconnect(), timeout=2.0)
                            debug_logger.log_info("browser_manager", "close_connection", "closed connection with direct await and timeout")
                    except (asyncio.TimeoutError, Exception) as e:
                        debug_logger.log_info("browser_manager", "close_connection", f"connection disconnect failed or timed out: {e}")
                        pass
                except Exception as e:
                    debug_logger.log_info("browser_manager", "close_connection", f"connection disconnect failed: {e}")
                    pass

                try:
                    import nodriver.cdp.browser as cdp_browser
                    if hasattr(browser, 'connection') and browser.connection:
                        await browser.connection.send(cdp_browser.close())
                except Exception:
                    pass

                try:
                    process_cleanup.kill_browser_process(instance_id)
                except Exception as e:
                    debug_logger.log_warning("browser_manager", "close_instance", 
                                           f"Process cleanup failed for {instance_id}: {e}")

                try:
                    await browser.stop()
                except Exception:
                    pass

                if hasattr(browser, '_process') and browser._process and browser._process.returncode is None:
                    import os

                    for attempt in range(3):
                        try:
                            browser._process.terminate()
                            debug_logger.log_info("browser_manager", "terminate_process", f"terminated browser with pid {browser._process.pid} successfully on attempt {attempt + 1}")
                            break
                        except Exception:
                            try:
                                browser._process.kill()
                                debug_logger.log_info("browser_manager", "kill_process", f"killed browser with pid {browser._process.pid} successfully on attempt {attempt + 1}")
                                break
                            except Exception:
                                try:
                                    if hasattr(browser, '_process_pid') and browser._process_pid:
                                        os.kill(browser._process_pid, 15)
                                        debug_logger.log_info("browser_manager", "kill_process", f"killed browser with pid {browser._process_pid} using signal 15 successfully on attempt {attempt + 1}")
                                        break
                                except (PermissionError, ProcessLookupError) as e:
                                    debug_logger.log_info("browser_manager", "kill_process", f"browser already stopped or no permission to kill: {e}")
                                    break
                                except Exception as e:
                                    if attempt == 2:
                                        debug_logger.log_error("browser_manager", "kill_process", e)

                try:
                    if hasattr(browser, '_process'):
                        browser._process = None
                    if hasattr(browser, '_process_pid'):
                        browser._process_pid = None

                    instance.state = BrowserState.CLOSED
                except Exception:
                    pass

                del self._instances[instance_id]

                persistent_storage.remove_instance(instance_id)

                return True
        
        try:
            return await asyncio.wait_for(_do_close(), timeout=5.0)
        except asyncio.TimeoutError:
            debug_logger.log_info("browser_manager", "close_instance", f"Close timeout for {instance_id}, forcing cleanup")
            # Kill the Chrome process even if CDP operations timed out
            try:
                process_cleanup.kill_browser_process(instance_id)
            except Exception:
                pass
            try:
                async with self._lock:
                    if instance_id in self._instances:
                        data = self._instances[instance_id]
                        data['instance'].state = BrowserState.CLOSED
                        del self._instances[instance_id]
                        persistent_storage.remove_instance(instance_id)
            except Exception:
                pass
            return True
        except Exception as e:
            debug_logger.log_error("browser_manager", "close_instance", e)
            return False

    async def _reconnect_tab(self, instance_id: str, data: dict) -> Optional[Tab]:
        """
        Attempt to reconnect to a browser whose CDP WebSocket dropped.

        The Chrome process often survives even when the WebSocket connection
        is lost (e.g. heavy SPA JS overwhelmed the event loop, macOS
        sleep/wake, or site-triggered disconnection). This method:

        1. Checks if the Chrome process is still alive
        2. Fetches the current tab list from Chrome's HTTP debug endpoint
        3. Creates a fresh WebSocket connection to the first page target
        4. Re-injects stealth patches and updates the stored tab reference

        Returns the reconnected Tab, or None if reconnection failed.
        """
        browser = data['browser']
        options = data.get('options')

        # Check the browser process is still alive
        if not self._is_browser_alive(browser, instance_id):
            debug_logger.log_info(
                "browser_manager", "_reconnect_tab",
                f"Browser process dead for {instance_id} — cannot reconnect"
            )
            return None

        try:
            host = browser.config.host or "127.0.0.1"
            port = browser.config.port
            if not port:
                return None

            debug_logger.log_info(
                "browser_manager", "_reconnect_tab",
                f"Attempting CDP reconnect to {host}:{port} for {instance_id}"
            )

            # Fetch available targets from Chrome's JSON debug endpoint
            import urllib.request
            req = urllib.request.Request(f"http://{host}:{port}/json/list")
            with urllib.request.urlopen(req, timeout=5) as resp:
                targets = json.loads(resp.read().decode())

            # Find a page target to reconnect to
            page_target = None
            for t in targets:
                if t.get("type") == "page":
                    page_target = t
                    break

            if not page_target:
                debug_logger.log_warning(
                    "browser_manager", "_reconnect_tab",
                    f"No page targets found on {host}:{port}"
                )
                return None

            ws_url = page_target.get("webSocketDebuggerUrl")
            if not ws_url:
                return None

            # Create a new Tab connected to the existing page
            import nodriver.cdp as cdp
            target_info = cdp.target.TargetInfo(
                target_id=cdp.target.TargetID(page_target["id"]),
                type_=page_target.get("type", "page"),
                title=page_target.get("title", ""),
                url=page_target.get("url", ""),
                attached=False,
                can_access_opener=False,
            )

            new_tab = Tab(ws_url, target=target_info, browser=browser)
            await new_tab.connect()

            # Re-inject stealth patches
            await self._configure_tab(new_tab, options or BrowserOptions())

            # Update stored references
            async with self._lock:
                if instance_id in self._instances:
                    self._instances[instance_id]['tab'] = new_tab
                    instance = self._instances[instance_id]['instance']
                    instance.state = BrowserState.READY
                    instance.update_activity()

            debug_logger.log_info(
                "browser_manager", "_reconnect_tab",
                f"CDP reconnected successfully for {instance_id}"
            )
            return new_tab

        except Exception as e:
            debug_logger.log_warning(
                "browser_manager", "_reconnect_tab",
                f"Reconnection failed for {instance_id}: {e}"
            )
            return None

    @staticmethod
    def _is_browser_alive(browser, instance_id: str) -> bool:
        """Check if the Chrome process is still running."""
        # Check via subprocess handle
        if hasattr(browser, '_process') and browser._process:
            if browser._process.returncode is None:
                return True
            return False

        # Check via tracked PID
        if hasattr(browser, '_process_pid') and browser._process_pid:
            try:
                import os
                os.kill(browser._process_pid, 0)  # Signal 0 = alive check
                return True
            except (ProcessLookupError, PermissionError):
                return False

        # Check via process_cleanup tracker
        tracked = process_cleanup.get_tracked_processes()
        pid = tracked.get(instance_id)
        if pid:
            try:
                import os
                os.kill(pid, 0)
                return True
            except (ProcessLookupError, PermissionError):
                return False

        # No process info available — assume dead to avoid wasting time on
        # reconnection attempts against a browser that may not exist.
        return False

    async def get_tab(self, instance_id: str) -> Optional[Tab]:
        """
        Get the main tab for a browser instance.
        Validates the CDP connection is still alive before returning.

        Uses a retry with backoff to handle transient states (e.g. page
        navigation in progress after form submission where the old page
        context is torn down but the new one hasn't loaded yet).

        If the CDP WebSocket has dropped but the Chrome process is still
        alive, attempts automatic reconnection before giving up.

        Args:
            instance_id (str): The ID of the browser instance.

        Returns:
            Optional[Tab]: The main tab if found and connected, else None.

        Raises:
            Exception: If the CDP connection has dropped after retries
                and reconnection also failed.
        """
        data = await self.get_instance(instance_id)
        if not data:
            return None

        tab = data['tab']

        # Validate that the CDP connection is still alive by sending a
        # lightweight probe. If the connection has dropped (e.g. after
        # macOS sleep/wake or browser crash), this will raise an OSError
        # with a clear message instead of failing deep inside a tool.
        #
        # We retry up to 3 times with increasing delays to handle the
        # common case where auto_login just submitted a form and the
        # page is mid-navigation (old context torn down, new one loading).
        last_error = None
        for attempt in range(3):
            try:
                timeout = 4.0 + attempt * 2.0  # 4s, 6s, 8s (~18s total)
                await asyncio.wait_for(
                    tab.evaluate("1"),
                    timeout=timeout,
                )
                return tab  # Connection is alive
            except (OSError, ConnectionError) as e:
                # Hard connection errors (socket refused, pipe broken) —
                # WebSocket dropped, but Chrome process may still be alive
                last_error = e
                break
            except asyncio.TimeoutError as e:
                # Timeout could mean active navigation — retry after a pause
                last_error = e
                if attempt < 2:
                    await asyncio.sleep(2.0)
                    continue
            except Exception:
                # Non-connection errors (e.g. page context issues) are fine —
                # the connection itself is still alive.
                return tab

        # --- CDP connection lost — attempt reconnection ---
        debug_logger.log_warning(
            "browser_manager", "get_tab",
            f"CDP connection lost for {instance_id}: {last_error} — attempting reconnect"
        )

        reconnected_tab = await self._reconnect_tab(instance_id, data)
        if reconnected_tab:
            # Verify the reconnected tab works
            try:
                await asyncio.wait_for(
                    reconnected_tab.evaluate("1"),
                    timeout=5.0,
                )
                return reconnected_tab
            except Exception as e:
                debug_logger.log_warning(
                    "browser_manager", "get_tab",
                    f"Reconnected tab failed verification: {e}"
                )

        # Mark instance as errored so the caller knows to respawn
        instance = data.get('instance')
        if instance:
            instance.state = BrowserState.ERROR
        raise Exception(
            f"Browser CDP connection lost for instance {instance_id}. "
            f"The browser process may have crashed or the connection timed out. "
            f"Please close this instance and spawn a new one."
        )

    async def get_browser(self, instance_id: str) -> Optional[Browser]:
        """
        Get the browser object for an instance.

        Args:
            instance_id (str): The ID of the browser instance.

        Returns:
            Optional[Browser]: The browser object if found, else None.
        """
        data = await self.get_instance(instance_id)
        if data:
            return data['browser']
        return None

    async def list_tabs(self, instance_id: str) -> List[Dict[str, str]]:
        """
        List all tabs for a browser instance.

        Args:
            instance_id (str): The ID of the browser instance.

        Returns:
            List[Dict[str, str]]: List of tab information dictionaries.
        """
        browser = await self.get_browser(instance_id)
        if not browser:
            return []

        await browser.update_targets()

        tabs = []
        for tab in browser.tabs:
            await tab
            tabs.append({
                'tab_id': str(tab.target.target_id),
                'url': getattr(tab, 'url', '') or '',
                'title': getattr(tab.target, 'title', '') or 'Untitled',
                'type': getattr(tab.target, 'type_', 'page')
            })

        return tabs

    async def switch_to_tab(self, instance_id: str, tab_id: str) -> bool:
        """
        Switch to a specific tab by bringing it to front.

        Args:
            instance_id (str): The ID of the browser instance.
            tab_id (str): The target ID of the tab to switch to.

        Returns:
            bool: True if switched successfully, False otherwise.
        """
        browser = await self.get_browser(instance_id)
        if not browser:
            return False

        await browser.update_targets()

        target_tab = None
        for tab in browser.tabs:
            if str(tab.target.target_id) == tab_id:
                target_tab = tab
                break

        if not target_tab:
            return False

        try:
            await target_tab.bring_to_front()
            async with self._lock:
                if instance_id in self._instances:
                    self._instances[instance_id]['tab'] = target_tab

            return True
        except Exception:
            return False

    async def get_active_tab(self, instance_id: str) -> Optional[Tab]:
        """
        Get the currently active tab.

        Args:
            instance_id (str): The ID of the browser instance.

        Returns:
            Optional[Tab]: The active tab if found, else None.
        """
        return await self.get_tab(instance_id)

    async def close_tab(self, instance_id: str, tab_id: str) -> bool:
        """
        Close a specific tab.

        Args:
            instance_id (str): The ID of the browser instance.
            tab_id (str): The target ID of the tab to close.

        Returns:
            bool: True if closed successfully, False otherwise.
        """
        browser = await self.get_browser(instance_id)
        if not browser:
            return False

        target_tab = None
        for tab in browser.tabs:
            if str(tab.target.target_id) == tab_id:
                target_tab = tab
                break

        if not target_tab:
            return False

        try:
            await target_tab.close()
            return True
        except Exception:
            return False

    async def update_instance_state(self, instance_id: str, url: str = None, title: str = None):
        """
        Update instance state after navigation or action.

        Args:
            instance_id (str): The ID of the browser instance.
            url (str, optional): The current URL to update.
            title (str, optional): The title to update.
        """
        async with self._lock:
            if instance_id in self._instances:
                instance = self._instances[instance_id]['instance']
                if url:
                    instance.current_url = url
                if title:
                    instance.title = title
                instance.update_activity()

    async def get_page_state(self, instance_id: str) -> Optional[PageState]:
        """
        Get complete page state for an instance.

        Args:
            instance_id (str): The ID of the browser instance.

        Returns:
            Optional[PageState]: The page state if available, else None.
        """
        tab = await self.get_tab(instance_id)
        if not tab:
            return None

        try:
            url = await tab.evaluate("window.location.href")
            title = await tab.evaluate("document.title")
            ready_state = await tab.evaluate("document.readyState")

            cookies = await tab.send(uc.cdp.network.get_cookies())

            local_storage = {}
            session_storage = {}

            try:
                local_storage_keys = await tab.evaluate("Object.keys(localStorage)")
                for key in local_storage_keys:
                    # json.dumps ensures the key is safely quoted, preventing JS injection
                    # via storage keys that contain quotes or other special characters.
                    value = await tab.evaluate(f"localStorage.getItem({json.dumps(key)})")
                    local_storage[key] = value

                session_storage_keys = await tab.evaluate("Object.keys(sessionStorage)")
                for key in session_storage_keys:
                    value = await tab.evaluate(f"sessionStorage.getItem({json.dumps(key)})")
                    session_storage[key] = value
            except Exception:
                pass

            viewport = await tab.evaluate("""
                ({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio
                })
            """)

            return PageState(
                instance_id=instance_id,
                url=url,
                title=title,
                ready_state=ready_state,
                cookies=cookies.get('cookies', []),
                local_storage=local_storage,
                session_storage=session_storage,
                viewport=viewport
            )

        except Exception as e:
            raise Exception(f"Failed to get page state: {str(e)}")

    async def cleanup_inactive(self, timeout_seconds: int = IDLE_TIMEOUT_SECONDS):
        """
        Close browser instances that have been idle longer than *timeout_seconds*.

        Called periodically by the server's background cleanup task to prevent
        Chrome processes from accumulating when Claude forgets to close them.
        """
        now = datetime.now()
        timeout = timedelta(seconds=timeout_seconds)

        to_close = []
        async with self._lock:
            for instance_id, data in self._instances.items():
                instance = data['instance']
                if now - instance.last_activity > timeout:
                    to_close.append(instance_id)

        for instance_id in to_close:
            debug_logger.log_info(
                "browser_manager", "cleanup_inactive",
                f"Auto-closing idle browser instance {instance_id}",
            )
            await self.close_instance(instance_id)

    async def close_all(self):
        """
        Close all browser instances.

        Closes all currently managed browser instances.
        """
        instance_ids = list(self._instances.keys())
        for instance_id in instance_ids:
            await self.close_instance(instance_id)
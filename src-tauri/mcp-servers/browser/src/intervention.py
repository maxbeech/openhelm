"""
User intervention request system for CAPTCHA resolution.

Writes a signal file to ~/.openhelm/interventions/ that the OpenHelm agent
detects, creating a dashboard alert with native notification. The MCP tool
returns immediately so Claude can enter a polling loop while the user solves
the CAPTCHA in the visible Chrome window.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


def _interventions_dir() -> Path:
    """Return the interventions directory, creating it if needed."""
    base = os.environ.get("OPENHELM_DATA_DIR", os.path.join(Path.home(), ".openhelm"))
    d = Path(base) / "interventions"
    d.mkdir(parents=True, exist_ok=True)
    return d


async def write_intervention_request(
    run_id: Optional[str],
    instance_id: str,
    reason: str,
    browser_manager: Any,
) -> Dict[str, Any]:
    """
    Take a screenshot and write an intervention request file.

    Args:
        run_id: OpenHelm run ID (from --run-id arg). May be None in standalone mode.
        instance_id: Browser instance ID for taking the screenshot.
        reason: Human-readable reason for the intervention request.
        browser_manager: BrowserManager instance to get the tab and screenshot.

    Returns:
        Structured dict for Claude with the request ID and polling instructions.
    """
    request_id = str(uuid.uuid4())
    interventions_dir = _interventions_dir()

    # Take screenshot
    screenshot_path: Optional[str] = None
    page_url: Optional[str] = None
    try:
        tab = await browser_manager.get_tab(instance_id)
        page_url = await tab.evaluate("window.location.href")

        # Save screenshot to interventions dir
        screenshot_filename = f"screenshot-{request_id}.png"
        screenshot_full_path = str(interventions_dir / screenshot_filename)
        await tab.save_screenshot(screenshot_full_path)
        screenshot_path = screenshot_full_path
    except Exception as e:
        # Non-fatal: proceed without screenshot
        screenshot_path = None
        page_url = page_url or "unknown"

    # Write request file
    request_data = {
        "id": request_id,
        "runId": run_id,
        "reason": reason,
        "screenshotPath": screenshot_path,
        "pageUrl": page_url or "unknown",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    request_file = interventions_dir / f"req-{request_id}.json"
    with open(request_file, "w") as f:
        json.dump(request_data, f, indent=2)

    return {
        "success": True,
        "request_id": request_id,
        "screenshot_path": screenshot_path,
        "page_url": page_url,
        "message": (
            f"Help request sent. The user has been notified to solve the CAPTCHA "
            f"at {page_url}. Poll every 30 seconds by taking a screenshot and "
            f"checking if the CAPTCHA is gone. Output a status message each time "
            f"to prevent silence timeout. Give up after 15 minutes."
        ),
    }

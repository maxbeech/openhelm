import { useState, useEffect, useCallback } from "react";
import type { LicenseStatus } from "@openhelm/shared";
import * as api from "@/lib/api";

export function useLicense() {
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await api.getLicenseStatus();
      setLicenseStatus(status);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void refresh();

    // Listen for status change events from the agent
    const handleEvent = (e: Event) => {
      const data = (e as CustomEvent).detail as LicenseStatus;
      if (data) setLicenseStatus(data);
    };
    window.addEventListener("agent:license.statusChanged", handleEvent);
    return () => window.removeEventListener("agent:license.statusChanged", handleEvent);
  }, [refresh]);

  return { licenseStatus, refresh };
}

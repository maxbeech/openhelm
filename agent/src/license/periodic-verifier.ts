import { verifyLicense, getLicenseStatus } from "./license-manager.js";
import { emit } from "../ipc/emitter.js";

const VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let verifierInterval: NodeJS.Timeout | null = null;

/** Start the periodic license verifier (runs every 24h) */
export function startPeriodicVerifier(): void {
  if (verifierInterval) return;

  verifierInterval = setInterval(async () => {
    try {
      const before = getLicenseStatus();
      const after = await verifyLicense();

      // Emit event if status changed
      if (before.stripeSubscriptionStatus !== after.stripeSubscriptionStatus ||
          before.isValid !== after.isValid) {
        emit("license.statusChanged", after);
      }
    } catch (err) {
      console.error("[license] periodic verification failed:", err);
    }
  }, VERIFY_INTERVAL_MS);

  // Don't block process exit
  verifierInterval.unref();
}

/** Stop the periodic verifier */
export function stopPeriodicVerifier(): void {
  if (verifierInterval) {
    clearInterval(verifierInterval);
    verifierInterval = null;
  }
}

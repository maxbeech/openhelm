import type {
  LicenseStatus,
  LicenseTier,
  UsageType,
  EmployeeCount,
} from "@openhelm/shared";
import {
  getSetting,
  setSetting,
} from "../db/queries/settings.js";
import { verifySubscription } from "./stripe-client.js";

const GRACE_PERIOD_DAYS = 7;

/** Determine if usage type + employee count requires a paid license */
export function needsPayment(
  usageType: UsageType,
  employeeCount: EmployeeCount,
): boolean {
  if (usageType !== "business") return false;
  return employeeCount !== "1-3";
}

/** Compute the license tier based on usage type and employee count */
export function determineTier(
  usageType: UsageType,
  employeeCount: EmployeeCount | null,
): LicenseTier {
  if (usageType !== "business") return "community";
  if (!employeeCount || employeeCount === "1-3") return "community";
  return "business";
}

/** Check if the locally stored license is within the grace period */
function isWithinGracePeriod(): boolean {
  const verifiedAt = getSetting("license_verified_at");
  if (!verifiedAt?.value) return false;
  const verifiedMs = new Date(verifiedAt.value).getTime();
  const nowMs = Date.now();
  const diffDays = (nowMs - verifiedMs) / (1000 * 60 * 60 * 24);
  return diffDays <= GRACE_PERIOD_DAYS;
}

/** Get the current license status from local settings */
export function getLicenseStatus(): LicenseStatus {
  const usageTypeSetting = getSetting("usage_type");
  const employeeCountSetting = getSetting("employee_count");
  const emailSetting = getSetting("user_email");
  const emailVerifiedSetting = getSetting("email_verified");
  const licenceTierSetting = getSetting("license_tier");
  const subStatusSetting = getSetting("stripe_subscription_status");
  const verifiedAtSetting = getSetting("license_verified_at");

  const usageType = (usageTypeSetting?.value as UsageType | undefined) ?? null;
  const employeeCount =
    (employeeCountSetting?.value as EmployeeCount | undefined) ?? null;
  const email = emailSetting?.value ?? null;
  const emailVerified = emailVerifiedSetting?.value === "true";
  const subStatus = subStatusSetting?.value ?? null;

  // Determine tier: prefer stored value, fall back to computed
  let tier: LicenseTier = "community";
  if (licenceTierSetting?.value === "business") {
    tier = "business";
  } else if (usageType && employeeCount) {
    tier = determineTier(usageType, employeeCount);
  }

  // Determine validity
  let isValid = true;
  if (tier === "business") {
    const activeStatuses = ["active", "trialing"];
    if (subStatus && !activeStatuses.includes(subStatus)) {
      // Check grace period before marking invalid
      isValid = isWithinGracePeriod();
    } else if (!subStatus) {
      // No subscription recorded but tier is business — allow (newly set up)
      isValid = true;
    }
  }

  // Compute trial end
  let trialEndsAt: string | null = null;
  const trialEndSetting = getSetting("stripe_trial_end");
  if (trialEndSetting?.value) trialEndsAt = trialEndSetting.value;

  return {
    tier,
    usageType,
    employeeCount,
    email,
    emailVerified,
    stripeSubscriptionStatus: subStatus,
    trialEndsAt,
    isValid,
  };
}

/** Verify the license against Stripe (called periodically and on demand) */
export async function verifyLicense(): Promise<LicenseStatus> {
  const subIdSetting = getSetting("stripe_subscription_id");
  if (!subIdSetting?.value) {
    return getLicenseStatus();
  }

  try {
    const result = await verifySubscription(subIdSetting.value);
    setSetting("stripe_subscription_status", result.status);
    setSetting("license_verified_at", new Date().toISOString());
    if (result.trialEnd) {
      setSetting("stripe_trial_end", result.trialEnd);
    }
  } catch (err) {
    console.error("[license] verification failed (using grace period):", err);
  }

  return getLicenseStatus();
}

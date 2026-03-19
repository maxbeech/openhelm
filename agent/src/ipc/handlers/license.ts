import { registerHandler } from "../handler.js";
import { getSetting, setSetting } from "../../db/queries/settings.js";
import {
  getLicenseStatus,
  verifyLicense,
} from "../../license/license-manager.js";
import {
  requestEmailVerification,
  checkEmailVerification,
} from "../../license/email-verification.js";
import {
  createCheckoutSession,
  pollCheckoutSession,
  createPortalSession,
} from "../../license/stripe-client.js";
import type {
  RequestEmailVerificationParams,
  CheckEmailVerificationParams,
  CreateCheckoutSessionParams,
  PollCheckoutSessionParams,
} from "@openhelm/shared";

export function registerLicenseHandlers() {
  /** Get the current license status */
  registerHandler("license.getStatus", () => {
    return getLicenseStatus();
  });

  /** Request an email verification link */
  registerHandler("license.requestEmailVerification", async (params) => {
    const p = params as RequestEmailVerificationParams;
    if (!p?.email) throw new Error("email is required");

    const result = await requestEmailVerification(
      p.email,
      p.usageType,
      p.newsletterOptIn ?? false,
    );

    // Store token locally so the frontend can poll
    if (result.token) {
      setSetting("email_verification_token", result.token);
    }

    return result;
  });

  /** Poll verification status for a token */
  registerHandler("license.checkEmailVerification", async (params) => {
    const p = params as CheckEmailVerificationParams;
    const token = p?.token ?? getSetting("email_verification_token")?.value;
    if (!token) throw new Error("token is required");

    const status = await checkEmailVerification(token);

    if (status.verified) {
      setSetting("email_verified", "true");
    }

    return status;
  });

  /** Create a Stripe Checkout Session */
  registerHandler("license.createCheckoutSession", async (params) => {
    const p = params as CreateCheckoutSessionParams;
    if (!p?.email) throw new Error("email is required");
    if (!p?.employeeCount) throw new Error("employeeCount is required");

    return createCheckoutSession(p.email, p.employeeCount);
  });

  /** Poll a Stripe Checkout Session for completion */
  registerHandler("license.pollCheckoutSession", async (params) => {
    const p = params as PollCheckoutSessionParams;
    if (!p?.sessionId) throw new Error("sessionId is required");

    const result = await pollCheckoutSession(p.sessionId);

    if (result.complete) {
      if (result.customerId) {
        setSetting("stripe_customer_id", result.customerId);
      }
      if (result.subscriptionId) {
        setSetting("stripe_subscription_id", result.subscriptionId);
        setSetting("stripe_subscription_status", "trialing");
      }
      setSetting("license_tier", "business");
      setSetting("license_verified_at", new Date().toISOString());
    }

    return result;
  });

  /** Open the Stripe Customer Portal */
  registerHandler("license.createPortalSession", async () => {
    const customerId = getSetting("stripe_customer_id")?.value;
    if (!customerId) throw new Error("No Stripe customer ID found");

    return createPortalSession(customerId);
  });

  /** Force re-verify the license against Stripe */
  registerHandler("license.verify", async () => {
    return verifyLicense();
  });
}

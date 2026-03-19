import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "./helpers.js";
import { setSetting } from "../src/db/queries/settings.js";
import {
  determineTier,
  needsPayment,
  getLicenseStatus,
} from "../src/license/license-manager.js";
import type { UsageType, EmployeeCount } from "@openhelm/shared";

let cleanup: () => void;

beforeAll(() => {
  cleanup = setupTestDb();
});

afterAll(() => {
  cleanup();
});

beforeEach(() => {
  // Clear relevant settings before each test
  const keys = [
    "usage_type", "employee_count", "user_email", "email_verified",
    "license_tier", "stripe_subscription_id", "stripe_subscription_status", "license_verified_at",
  ] as any[];
  for (const key of keys) {
    try { setSetting(key, ""); } catch {}
  }
});

describe("determineTier", () => {
  it("returns community for personal use", () => {
    expect(determineTier("personal", "1-3")).toBe("community");
    expect(determineTier("personal", "200+")).toBe("community");
  });

  it("returns community for education use", () => {
    expect(determineTier("education", "1-3")).toBe("community");
    expect(determineTier("education", "51-200")).toBe("community");
  });

  it("returns community for business with 1-3 team members", () => {
    expect(determineTier("business", "1-3")).toBe("community");
  });

  it("returns business for larger business teams", () => {
    const largeCounts: EmployeeCount[] = ["4-10", "11-50", "51-200", "200+"];
    for (const count of largeCounts) {
      expect(determineTier("business", count)).toBe("business");
    }
  });

  it("returns community for business with no employee count", () => {
    expect(determineTier("business", null as unknown as EmployeeCount)).toBe("community");
  });
});

describe("needsPayment", () => {
  it("never requires payment for personal or education", () => {
    const counts: EmployeeCount[] = ["1-3", "4-10", "11-50", "51-200", "200+"];
    for (const type of ["personal", "education"] as UsageType[]) {
      for (const count of counts) {
        expect(needsPayment(type, count)).toBe(false);
      }
    }
  });

  it("does not require payment for business with 1-3 members", () => {
    expect(needsPayment("business", "1-3")).toBe(false);
  });

  it("requires payment for business with more than 3 members", () => {
    const counts: EmployeeCount[] = ["4-10", "11-50", "51-200", "200+"];
    for (const count of counts) {
      expect(needsPayment("business", count)).toBe(true);
    }
  });
});

describe("getLicenseStatus", () => {
  it("returns community tier with no settings", () => {
    const status = getLicenseStatus();
    expect(status.tier).toBe("community");
    expect(status.isValid).toBe(true);
    expect(status.emailVerified).toBe(false);
  });

  it("computes business tier from stored settings", () => {
    setSetting("usage_type", "business");
    setSetting("employee_count", "11-50");
    const status = getLicenseStatus();
    expect(status.tier).toBe("business");
    expect(status.usageType).toBe("business");
    expect(status.employeeCount).toBe("11-50");
  });

  it("computes community tier when business has 1-3 members", () => {
    setSetting("usage_type", "business");
    setSetting("employee_count", "1-3");
    const status = getLicenseStatus();
    expect(status.tier).toBe("community");
  });

  it("returns isValid=false for lapsed business subscription outside grace period", () => {
    setSetting("usage_type", "business");
    setSetting("employee_count", "11-50");
    setSetting("license_tier", "business");
    setSetting("stripe_subscription_id", "sub_test");
    setSetting("stripe_subscription_status", "canceled");
    // Set license_verified_at to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    setSetting("license_verified_at", tenDaysAgo);

    const status = getLicenseStatus();
    expect(status.tier).toBe("business");
    expect(status.stripeSubscriptionStatus).toBe("canceled");
    expect(status.isValid).toBe(false);
  });

  it("returns isValid=true for lapsed subscription within grace period", () => {
    setSetting("usage_type", "business");
    setSetting("employee_count", "11-50");
    setSetting("license_tier", "business");
    setSetting("stripe_subscription_id", "sub_test");
    setSetting("stripe_subscription_status", "canceled");
    // Set license_verified_at to 3 days ago (within 7-day grace)
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    setSetting("license_verified_at", threeDaysAgo);

    const status = getLicenseStatus();
    expect(status.isValid).toBe(true);
  });

  it("reflects email verification status", () => {
    setSetting("user_email", "test@company.com");
    setSetting("email_verified", "true");
    const status = getLicenseStatus();
    expect(status.email).toBe("test@company.com");
    expect(status.emailVerified).toBe(true);
  });
});

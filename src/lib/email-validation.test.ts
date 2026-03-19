import { describe, it, expect } from "vitest";
import { validateEmailForUsageType, isCommercialEmail } from "./email-validation";

describe("validateEmailForUsageType", () => {
  describe("personal use", () => {
    it("accepts any valid email", () => {
      expect(validateEmailForUsageType("user@gmail.com", "personal").valid).toBe(true);
      expect(validateEmailForUsageType("user@company.com", "personal").valid).toBe(true);
      expect(validateEmailForUsageType("user@university.edu", "personal").valid).toBe(true);
    });

    it("rejects invalid email format", () => {
      expect(validateEmailForUsageType("notanemail", "personal").valid).toBe(false);
      expect(validateEmailForUsageType("@nodomain", "personal").valid).toBe(false);
      expect(validateEmailForUsageType("no@", "personal").valid).toBe(false);
    });
  });

  describe("business use", () => {
    it("accepts work email domains", () => {
      expect(validateEmailForUsageType("user@company.com", "business").valid).toBe(true);
      expect(validateEmailForUsageType("user@startup.io", "business").valid).toBe(true);
      expect(validateEmailForUsageType("user@enterprise.co.uk", "business").valid).toBe(true);
    });

    it("rejects free email providers", () => {
      const freeEmails = [
        "user@gmail.com",
        "user@yahoo.com",
        "user@hotmail.com",
        "user@outlook.com",
        "user@icloud.com",
        "user@protonmail.com",
        "user@hey.com",
      ];
      for (const email of freeEmails) {
        const result = validateEmailForUsageType(email, "business");
        expect(result.valid, `Expected ${email} to be rejected`).toBe(false);
        expect(result.error).toContain("work email");
      }
    });
  });

  describe("education use", () => {
    it("accepts .edu domains", () => {
      expect(validateEmailForUsageType("student@mit.edu", "education").valid).toBe(true);
      expect(validateEmailForUsageType("faculty@stanford.edu", "education").valid).toBe(true);
    });

    it("accepts .ac.uk domains", () => {
      expect(validateEmailForUsageType("student@ox.ac.uk", "education").valid).toBe(true);
      expect(validateEmailForUsageType("user@student.cam.ac.uk", "education").valid).toBe(true);
    });

    it("accepts other education TLDs", () => {
      expect(validateEmailForUsageType("user@uni.edu.au", "education").valid).toBe(true);
    });

    it("rejects non-education domains", () => {
      expect(validateEmailForUsageType("user@gmail.com", "education").valid).toBe(false);
      expect(validateEmailForUsageType("user@company.com", "education").valid).toBe(false);
    });

    it("provides a helpful error message for non-edu emails", () => {
      const result = validateEmailForUsageType("user@gmail.com", "education");
      expect(result.error).toContain("institutional email");
    });
  });
});

describe("isCommercialEmail", () => {
  it("returns true for corporate domains", () => {
    expect(isCommercialEmail("user@company.com")).toBe(true);
    expect(isCommercialEmail("john@acmecorp.com")).toBe(true);
    expect(isCommercialEmail("alice@startup.io")).toBe(true);
  });

  it("returns false for free email providers", () => {
    expect(isCommercialEmail("user@gmail.com")).toBe(false);
    expect(isCommercialEmail("user@yahoo.com")).toBe(false);
    expect(isCommercialEmail("user@hotmail.com")).toBe(false);
    expect(isCommercialEmail("user@protonmail.com")).toBe(false);
  });

  it("returns false for education domains", () => {
    expect(isCommercialEmail("student@mit.edu")).toBe(false);
    expect(isCommercialEmail("user@ox.ac.uk")).toBe(false);
    expect(isCommercialEmail("user@uni.edu.au")).toBe(false);
  });

  it("returns false for invalid email format", () => {
    expect(isCommercialEmail("notanemail")).toBe(false);
    expect(isCommercialEmail("@nodomain")).toBe(false);
    expect(isCommercialEmail("")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { createRedactor, extractSecretStrings } from "../src/credentials/redactor.js";

describe("createRedactor", () => {
  it("replaces a single secret", () => {
    const redact = createRedactor(["sk-abc123"]);
    expect(redact("Token is sk-abc123 here")).toBe("Token is [REDACTED] here");
  });

  it("replaces multiple secrets", () => {
    const redact = createRedactor(["secret1", "secret2"]);
    expect(redact("a=secret1 b=secret2")).toBe("a=[REDACTED] b=[REDACTED]");
  });

  it("replaces all occurrences of the same secret", () => {
    const redact = createRedactor(["mypassword"]);
    expect(redact("pw=mypassword confirm=mypassword")).toBe("pw=[REDACTED] confirm=[REDACTED]");
  });

  it("replaces longer secrets before shorter substrings", () => {
    const redact = createRedactor(["abc", "abcdef"]);
    expect(redact("value=abcdef")).toBe("value=[REDACTED]");
  });

  it("escapes regex special characters in secrets", () => {
    const redact = createRedactor(["p@ss.w0rd!"]);
    expect(redact("password=p@ss.w0rd!")).toBe("password=[REDACTED]");
  });

  it("returns no-op for empty secrets", () => {
    const redact = createRedactor([]);
    expect(redact("nothing to redact")).toBe("nothing to redact");
  });

  it("ignores secrets shorter than 3 characters", () => {
    const redact = createRedactor(["ab", "abc"]);
    expect(redact("ab abc")).toBe("ab [REDACTED]");
  });

  it("handles text with no matches", () => {
    const redact = createRedactor(["secret"]);
    expect(redact("no match here")).toBe("no match here");
  });
});

describe("extractSecretStrings", () => {
  it("extracts value from token type", () => {
    const secrets = extractSecretStrings({ type: "token", value: "sk-abc123" });
    expect(secrets).toEqual(["sk-abc123"]);
  });

  it("extracts username and password from username_password type", () => {
    const secrets = extractSecretStrings({
      type: "username_password",
      username: "user@test.com",
      password: "p4ssw0rd",
    });
    expect(secrets).toContain("user@test.com");
    expect(secrets).toContain("p4ssw0rd");
  });

  it("ignores values shorter than 3 characters", () => {
    const secrets = extractSecretStrings({ type: "token", value: "ab" });
    expect(secrets).toEqual([]);
  });

  it("returns empty array for null/undefined", () => {
    expect(extractSecretStrings(null)).toEqual([]);
    expect(extractSecretStrings(undefined)).toEqual([]);
  });
});

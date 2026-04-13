import { describe, it, expect } from "vitest";
import { isDemoPath, getDemoSlug } from "./mode";

describe("isDemoPath", () => {
  it("matches /demo/:slug style paths", () => {
    expect(isDemoPath("/demo/nike")).toBe(true);
    expect(isDemoPath("/demo/acme/dashboard")).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(isDemoPath("/")).toBe(false);
    expect(isDemoPath("/dashboard")).toBe(false);
    expect(isDemoPath("/login")).toBe(false);
    expect(isDemoPath("/demonstrate")).toBe(false);
  });

  it("does not match bare /demo without a slug segment", () => {
    // `/demo` without a trailing slash is ambiguous and not a valid route
    expect(isDemoPath("/demo")).toBe(false);
  });
});

describe("getDemoSlug", () => {
  it("extracts the slug from a demo URL", () => {
    expect(getDemoSlug("/demo/nike")).toBe("nike");
    expect(getDemoSlug("/demo/nike/")).toBe("nike");
    expect(getDemoSlug("/demo/acme/dashboard")).toBe("acme");
  });

  it("URL-decodes the slug", () => {
    expect(getDemoSlug("/demo/hello%20world")).toBe("hello world");
  });

  it("returns null when the path is not a demo URL", () => {
    expect(getDemoSlug("/")).toBeNull();
    expect(getDemoSlug("/dashboard")).toBeNull();
    expect(getDemoSlug("/demo")).toBeNull();
  });
});

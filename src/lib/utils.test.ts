import { describe, it, expect } from "vitest";
import { friendlyError } from "./utils";

describe("friendlyError", () => {
  it("returns agent timeout message for timeout errors", () => {
    const err = new Error("request timed out after 5000ms");
    expect(friendlyError(err, "Failed to load")).toBe(
      "The agent is not responding. Try again or restart the app.",
    );
  });

  it("handles uppercase 'Timed Out' variants", () => {
    const err = new Error("Connection Timed Out");
    expect(friendlyError(err, "Loading")).toBe(
      "The agent is not responding. Try again or restart the app.",
    );
  });

  it("extracts message from JSON-RPC error code with colon format", () => {
    const err = new Error("-32001: API key not configured. Add it in Settings.");
    expect(friendlyError(err, "Failed")).toBe(
      "API key not configured. Add it in Settings.",
    );
  });

  it("extracts message from another 5-digit negative code", () => {
    const err = new Error("-32603: Something broke internally");
    expect(friendlyError(err, "Oops")).toBe("Something broke internally");
  });

  it("prefixes with context for regular errors", () => {
    const err = new Error("SQLITE_BUSY");
    expect(friendlyError(err, "Failed to save job")).toBe(
      "Failed to save job: SQLITE_BUSY",
    );
  });

  it("handles non-Error values", () => {
    expect(friendlyError("plain string", "Context")).toBe(
      "Context: plain string",
    );
  });

  it("handles null/undefined error values", () => {
    expect(friendlyError(undefined, "Context")).toBe("Context: undefined");
  });

  it("detects auth/login errors and returns friendly message", () => {
    const err = new Error("[-32001] Claude Code exited with code 1: Error: not logged in");
    expect(friendlyError(err, "Failed")).toBe(
      "Claude Code is not logged in. Run `claude` in your terminal to log in, then try again.",
    );
  });

  it("detects unauthenticated errors", () => {
    const err = new Error("Unauthenticated: session expired");
    expect(friendlyError(err, "Failed")).toBe(
      "Claude Code is not logged in. Run `claude` in your terminal to log in, then try again.",
    );
  });

  it("detects expired session errors", () => {
    const err = new Error("Error: expired session token");
    expect(friendlyError(err, "Failed")).toBe(
      "Claude Code is not logged in. Run `claude` in your terminal to log in, then try again.",
    );
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../src/db/init.js";
import { createConnection, getConnection } from "../src/db/queries/connections.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "oh-plaintext-test-"));
  initDatabase(join(dir, "test.db"));
});

describe("plain_text connection behaviour (plan 14c)", () => {
  it("forces allowPromptInjection=true regardless of caller input", () => {
    const conn = createConnection({
      name: "DB login",
      type: "plain_text",
      allowPromptInjection: false,
      allowBrowserInjection: true,
    });
    expect(conn.allowPromptInjection).toBe(true);
    expect(conn.allowBrowserInjection).toBe(false);
  });

  it("does not generate an env var name for plain_text", () => {
    const conn = createConnection({ name: "Random creds", type: "plain_text" });
    expect(conn.envVarName).toBe("");
  });

  it("still generates env var names for token type", () => {
    const conn = createConnection({ name: "GitHub", type: "token" });
    expect(conn.envVarName).toBe("OPENHELM_GITHUB");
  });

  it("persists the flipped flags so they're readable after insert", () => {
    const conn = createConnection({
      name: "X",
      type: "plain_text",
      allowPromptInjection: false,
      allowBrowserInjection: true,
    });
    const fetched = getConnection(conn.id);
    expect(fetched?.allowPromptInjection).toBe(true);
    expect(fetched?.allowBrowserInjection).toBe(false);
  });
});

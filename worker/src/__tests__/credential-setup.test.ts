/**
 * Unit tests for worker/src/credential-setup.ts.
 *
 * Mocks @e2b/desktop and Supabase so we can exercise the setup → finalize
 * → cancel flow end-to-end without hitting real infrastructure.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const USER_ID = "user-abc";
const OTHER_USER = "user-xyz";
const CRED_ID = "cred-123";

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockUpload = jest
  .fn<(key: string, bytes: Uint8Array, opts: unknown) => Promise<{ error: null }>>()
  .mockResolvedValue({ error: null });

const mockStorageFrom = jest.fn().mockReturnValue({ upload: mockUpload });

function resolvedFn<T>(value: T): any {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}

function ownedFrom(exists = true): any {
  const single = exists
    ? resolvedFn({ data: { id: CRED_ID }, error: null })
    : resolvedFn({ data: null, error: { message: "not found" } });
  const updateEq = jest.fn().mockReturnValue({ eq: resolvedFn({ error: null }) });
  return jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ single }),
      }),
    }),
    update: jest.fn().mockReturnValue({ eq: updateEq }),
  });
}

const mockSupabase: any = { from: ownedFrom(), storage: { from: mockStorageFrom } };

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => mockSupabase,
}));

// ─── @e2b/desktop mock ────────────────────────────────────────────────────────

let nextSandboxId = 0;
const runMock = jest.fn<(cmd: string, opts?: unknown) => Promise<{ stdout: string }>>();
runMock.mockImplementation(async (cmd: string) => {
  if (cmd.startsWith("stat -c")) return { stdout: "4096\n" }; // logged-in heuristic
  return { stdout: "" };
});

const readMock = jest
  .fn<(path: string, opts?: unknown) => Promise<Uint8Array>>()
  .mockResolvedValue(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]));

const killMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

const streamStartMock = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const streamGetUrlMock = jest.fn<() => string>().mockReturnValue("https://sbx.example/stream?token=abc");

function makeFakeSandbox(id: string) {
  return {
    sandboxId: id,
    commands: { run: runMock },
    files: { read: readMock },
    stream: { start: streamStartMock, getUrl: streamGetUrlMock },
    kill: killMock,
  };
}

const createMock = jest.fn<() => Promise<ReturnType<typeof makeFakeSandbox>>>();
const connectMock = jest.fn<(id: string) => Promise<ReturnType<typeof makeFakeSandbox>>>();

jest.unstable_mockModule("@e2b/desktop", () => ({
  Sandbox: {
    create: createMock,
    connect: connectMock,
  },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const {
  setupBrowserSession,
  finalizeBrowserSession,
  cancelBrowserSession,
} = await import("../credential-setup.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("credential-setup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    nextSandboxId = 0;
    createMock.mockImplementation(async () => makeFakeSandbox(`sbx-${++nextSandboxId}`));
    connectMock.mockImplementation(async (id: string) => makeFakeSandbox(id));
    runMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("stat -c")) return { stdout: "4096\n" };
      return { stdout: "" };
    });
    mockSupabase.from = ownedFrom();
  });

  describe("setupBrowserSession", () => {
    it("spawns a desktop sandbox, launches Chromium, returns the stream URL", async () => {
      const result = await setupBrowserSession({ credentialId: CRED_ID }, USER_ID);

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(streamStartMock).toHaveBeenCalledTimes(1);
      // Chromium was launched with the per-credential profile dir
      const chromiumCalls = runMock.mock.calls
        .map((c) => c[0])
        .filter((c) => typeof c === "string" && c.includes("chromium"));
      expect(chromiumCalls.length).toBeGreaterThan(0);
      expect(chromiumCalls[0]).toContain(`--user-data-dir=/home/user/profiles/conn-${CRED_ID}`);

      expect(result.launched).toBe(true);
      expect(result.sandboxId).toMatch(/^sbx-/);
      expect(result.streamUrl).toBe("https://sbx.example/stream?token=abc");
      expect(result.profileName).toBe(`conn-${CRED_ID}`);
    });

    it("rejects credentials not owned by the caller", async () => {
      mockSupabase.from = ownedFrom(false);
      await expect(setupBrowserSession({ credentialId: CRED_ID }, OTHER_USER)).rejects.toThrow(
        /not owned/i,
      );
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("finalizeBrowserSession", () => {
    it("tars the profile, uploads to storage, and kills the sandbox", async () => {
      const setup = await setupBrowserSession({ credentialId: CRED_ID }, USER_ID);

      const result = await finalizeBrowserSession({ sandboxId: setup.sandboxId }, USER_ID);

      expect(connectMock).toHaveBeenCalledWith(setup.sandboxId, expect.any(Object));
      // tar command was issued
      expect(runMock.mock.calls.some((c) => String(c[0]).startsWith("tar -czf"))).toBe(true);
      // Upload happened to the correct storage key
      expect(mockStorageFrom).toHaveBeenCalledWith("browser-profiles");
      expect(mockUpload).toHaveBeenCalledWith(
        `${USER_ID}/${CRED_ID}.tar.gz`,
        expect.any(Uint8Array),
        expect.objectContaining({ contentType: "application/gzip", upsert: true }),
      );
      expect(killMock).toHaveBeenCalled();

      expect(result.credentialId).toBe(CRED_ID);
      expect(result.storageKey).toBe(`${USER_ID}/${CRED_ID}.tar.gz`);
      expect(result.status).toBe("likely_logged_in");
    });

    it("classifies as no_cookies_detected when Cookies file is tiny", async () => {
      const setup = await setupBrowserSession({ credentialId: CRED_ID }, USER_ID);

      runMock.mockImplementation(async (cmd: string) => {
        if (cmd.startsWith("stat -c")) return { stdout: "512\n" };
        return { stdout: "" };
      });

      const result = await finalizeBrowserSession({ sandboxId: setup.sandboxId }, USER_ID);
      expect(result.status).toBe("no_cookies_detected");
    });

    it("rejects finalize from a different user", async () => {
      const setup = await setupBrowserSession({ credentialId: CRED_ID }, USER_ID);
      await expect(
        finalizeBrowserSession({ sandboxId: setup.sandboxId }, OTHER_USER),
      ).rejects.toThrow(/not owned/i);
    });

    it("rejects finalize for unknown sandbox", async () => {
      await expect(
        finalizeBrowserSession({ sandboxId: "sbx-nope" }, USER_ID),
      ).rejects.toThrow(/Unknown sandbox/i);
    });
  });

  describe("cancelBrowserSession", () => {
    it("kills the sandbox when the owner cancels", async () => {
      const setup = await setupBrowserSession({ credentialId: CRED_ID }, USER_ID);
      const result = await cancelBrowserSession({ sandboxId: setup.sandboxId }, USER_ID);
      expect(result.cancelled).toBe(true);
      expect(killMock).toHaveBeenCalled();
    });

    it("rejects cancel from a different user", async () => {
      const setup = await setupBrowserSession({ credentialId: CRED_ID }, USER_ID);
      await expect(
        cancelBrowserSession({ sandboxId: setup.sandboxId }, OTHER_USER),
      ).rejects.toThrow(/not owned/i);
    });

    it("is a no-op for unknown sandbox (best-effort)", async () => {
      const result = await cancelBrowserSession({ sandboxId: "sbx-nope" }, USER_ID);
      expect(result.cancelled).toBe(true);
    });
  });
});

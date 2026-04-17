/**
 * Tests for profile-hydration.ts.
 *
 * Confirms that:
 *   - Only credentials in scope for the run are loaded.
 *   - Credentials without a saved profile are skipped.
 *   - Download + extract commands run against the sandbox.
 *   - The first hydrated profile's path is returned so the executor can
 *     pass it to the openhelm-browser MCP.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const USER_ID = "u1";
const PROJECT_ID = "p1";
const JOB_ID = "j1";

// ─── Supabase mock ────────────────────────────────────────────────────────────

const credentialRows = [
  {
    id: "abc1",
    scope_type: "global",
    scope_id: null,
    browser_profile_storage_key: `${USER_ID}/abc1.tar.gz`,
  },
  {
    id: "def2",
    scope_type: "project",
    scope_id: PROJECT_ID,
    browser_profile_storage_key: `${USER_ID}/def2.tar.gz`,
  },
  {
    id: "ghi3",
    scope_type: "project",
    scope_id: "p-other",
    browser_profile_storage_key: `${USER_ID}/ghi3.tar.gz`,
  },
];

function chain(result: unknown): any {
  const c: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    then: (fn: (v: unknown) => unknown) => Promise.resolve(result).then(fn),
  };
  return c;
}

const mockDownload = jest
  .fn<(key: string) => Promise<{ data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: null }>>()
  .mockImplementation(async () => ({
    data: { arrayBuffer: async () => new ArrayBuffer(16) },
    error: null,
  }));

const mockSupabase: any = {
  from: jest.fn((table: string) => {
    if (table === "connections") {
      return chain({ data: credentialRows, error: null });
    }
    if (table === "connection_scope_bindings") {
      return chain({ data: [], error: null });
    }
    return chain({ data: null, error: null });
  }),
  storage: {
    from: jest.fn().mockReturnValue({ download: mockDownload }),
  },
};

jest.unstable_mockModule("../supabase.js", () => ({
  getSupabase: () => mockSupabase,
}));

// ─── Sandbox mock ─────────────────────────────────────────────────────────────

const runMock = jest
  .fn<(cmd: string) => Promise<{ stdout: string }>>()
  .mockResolvedValue({ stdout: "" });
const writeMock = jest
  .fn<(path: string, bytes: ArrayBuffer) => Promise<void>>()
  .mockResolvedValue(undefined);

const fakeSandbox = {
  commands: { run: runMock },
  files: { write: writeMock },
} as unknown as Parameters<
  typeof import("../profile-hydration.js").hydrateBrowserProfiles
>[0];

// ─── Import after mocks ───────────────────────────────────────────────────────

const { hydrateBrowserProfiles } = await import("../profile-hydration.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("hydrateBrowserProfiles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDownload.mockImplementation(async () => ({
      data: { arrayBuffer: async () => new ArrayBuffer(16) },
      error: null,
    }));
  });

  it("hydrates in-scope profiles and skips out-of-scope ones", async () => {
    const log = jest.fn<(line: string) => void>();
    const result = await hydrateBrowserProfiles(
      fakeSandbox,
      { userId: USER_ID, projectId: PROJECT_ID, jobId: JOB_ID },
      log,
    );

    // abc1 (global) and def2 (scope=project, matching p1) in;
    // ghi3 (project p-other) excluded.
    expect(result.map((p) => p.credentialId)).toEqual(
      expect.arrayContaining(["abc1", "def2"]),
    );
    expect(result.map((p) => p.credentialId)).not.toContain("ghi3");
    // Each hydrated profile should have a matching directory path.
    for (const p of result) {
      expect(p.profileDir).toBe(`/home/user/profiles/conn-${p.credentialId}`);
    }
    // Each profile should have triggered a tar -xzf in the sandbox.
    const tarCalls = runMock.mock.calls.filter((c) =>
      String(c[0]).startsWith("tar -xzf"),
    );
    expect(tarCalls.length).toBe(result.length);
  });

  it("skips profiles whose download errors out but does not throw", async () => {
    const log = jest.fn<(line: string) => void>();
    mockDownload.mockImplementation(async () => ({
      data: null,
      error: { message: "not found" } as any,
    }));

    const result = await hydrateBrowserProfiles(
      fakeSandbox,
      { userId: USER_ID, projectId: PROJECT_ID, jobId: JOB_ID },
      log,
    );
    expect(result).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("skip profile"),
    );
  });
});

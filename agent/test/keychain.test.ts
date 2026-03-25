import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execFile before importing the module
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Import after mocking
const { setKeychainItem, getKeychainItem, deleteKeychainItem } = await import("../src/keychain/index.js");

describe("Keychain wrapper", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  describe("setKeychainItem", () => {
    it("calls security add-generic-password with correct args", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "", "");
        return { stdin: null };
      });

      await setKeychainItem("test-id", '{"value":"secret"}');

      expect(mockExecFile).toHaveBeenCalledOnce();
      const [cmd, args] = mockExecFile.mock.calls[0];
      expect(cmd).toBe("/usr/bin/security");
      expect(args).toContain("add-generic-password");
      expect(args).toContain("-U");
      expect(args).toContain("test-id");
    });

    it("throws on Keychain locked (exit 36)", async () => {
      const err = Object.assign(new Error("locked"), { code: 36 });
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(err, "", "User interaction is not allowed");
        return { stdin: null };
      });

      await expect(setKeychainItem("id", "val")).rejects.toThrow("Keychain is locked");
    });
  });

  describe("getKeychainItem", () => {
    it("returns the password value", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, '{"value":"sk-123"}\n', "");
        return { stdin: null };
      });

      const result = await getKeychainItem("test-id");
      expect(result).toBe('{"value":"sk-123"}');
    });

    it("returns null when not found (exit 44)", async () => {
      const err = Object.assign(new Error("not found"), { code: 44 });
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(err, "", "The specified item could not be found");
        return { stdin: null };
      });

      const result = await getKeychainItem("missing-id");
      expect(result).toBeNull();
    });
  });

  describe("deleteKeychainItem", () => {
    it("returns true on success", async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "", "");
        return { stdin: null };
      });

      const result = await deleteKeychainItem("test-id");
      expect(result).toBe(true);
    });

    it("returns false when not found (exit 44)", async () => {
      const err = Object.assign(new Error("not found"), { code: 44 });
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(err, "", "");
        return { stdin: null };
      });

      const result = await deleteKeychainItem("missing-id");
      expect(result).toBe(false);
    });
  });
});

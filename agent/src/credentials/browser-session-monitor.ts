/**
 * Monitors a Chrome profile launched for credential browser-profile setup.
 *
 * Rather than tracking a Chrome PID (unreliable on macOS where the app
 * stays running after the last window closes), this watches Chrome's
 * `SingletonLock` file inside the profile directory. Chrome creates this
 * symlink when it opens the profile and removes it when it releases the
 * profile (e.g. on quit). This is the accurate "profile is in use" signal.
 */

import { join } from "node:path";
import { statSync, existsSync, lstatSync } from "node:fs";
import { emit } from "../ipc/emitter.js";

export class BrowserSessionMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly credentialId: string;
  private readonly profileDir: string;
  private readonly cookiesBaseline: number;
  private readonly singletonPath: string;
  private stopped = false;
  private lockAppeared = false;
  private readonly startTime = Date.now();

  constructor(credentialId: string, profileDir: string) {
    this.credentialId = credentialId;
    this.profileDir = profileDir;
    this.singletonPath = join(profileDir, "SingletonLock");
    this.cookiesBaseline = this.getCookiesSize();
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.poll(), 1500);
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private poll(): void {
    if (this.stopped) return;

    const lockExists = this.singletonLockExists();

    if (!this.lockAppeared) {
      if (lockExists) {
        this.lockAppeared = true;
      } else if (Date.now() - this.startTime > 30_000) {
        // Lock never appeared — Chrome failed to start, stop monitoring
        this.stop();
      }
      return;
    }

    // Lock previously appeared; if it's gone now, Chrome released the profile
    if (!lockExists) {
      this.stop();
      emit("credential.browserClosed", { credentialId: this.credentialId });
      this.verify();
    }
  }

  private singletonLockExists(): boolean {
    try {
      // SingletonLock is a symlink; lstatSync works even if the target is invalid
      lstatSync(this.singletonPath);
      return true;
    } catch {
      return existsSync(this.singletonPath);
    }
  }

  private verify(): void {
    const currentSize = this.getCookiesSize();
    const loginDataModified = this.wasLoginDataModified();
    const cookiesSizeKb = Math.round(currentSize / 1024);

    const grew = currentSize - this.cookiesBaseline > 2048;
    const status = grew || loginDataModified
      ? "likely_logged_in" as const
      : currentSize > 0
        ? "no_cookies_detected" as const
        : "unknown" as const;

    emit("credential.sessionVerified", {
      credentialId: this.credentialId,
      status,
      cookiesSizeKb,
    });
  }

  private getCookiesSize(): number {
    try {
      return statSync(join(this.profileDir, "Default", "Cookies")).size;
    } catch {
      return 0;
    }
  }

  private wasLoginDataModified(): boolean {
    try {
      const stat = statSync(join(this.profileDir, "Default", "Login Data"));
      return stat.mtimeMs > this.startTime;
    } catch {
      return false;
    }
  }
}

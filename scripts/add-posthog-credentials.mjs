/**
 * One-time script: adds PostHog API key and Project ID as OpenHelm credentials.
 * Stores metadata in ~/.openhelm/openhelm.db and secrets in macOS Keychain.
 *
 * Usage: node scripts/add-posthog-credentials.mjs
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);
const DB_PATH = join(homedir(), ".openhelm", "openhelm.db");
const SERVICE = "com.maxbeech.openhelm";

async function setKeychain(id, value) {
  await execFileAsync("/usr/bin/security", [
    "add-generic-password", "-U",
    "-s", SERVICE,
    "-a", id,
    "-w", value,
  ]);
}

function insertCredential(db, { id, name, envVarName, value }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO credentials
      (id, name, type, env_var_name, allow_prompt_injection, allow_browser_injection,
       scope_type, scope_id, is_enabled, created_at, updated_at)
    VALUES
      (?, ?, 'token', ?, 1, 0, 'global', NULL, 1, ?, ?)
  `).run(id, name, envVarName, now, now);
  console.log(`  ✓ DB row inserted: ${name} (${envVarName})`);
  return { id, value };
}

async function main() {
  const db = new Database(DB_PATH);

  const apiKey = process.env.POSTHOG_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey) {
    console.error("Error: POSTHOG_API_KEY environment variable is required.");
    process.exit(1);
  }
  if (!projectId) {
    console.error("Error: POSTHOG_PROJECT_ID environment variable is required.");
    process.exit(1);
  }

  const creds = [
    {
      id: randomUUID(),
      name: "PostHog API Key",
      envVarName: "OPENHELM_POSTHOG_API_KEY",
      value: apiKey,
    },
    {
      id: randomUUID(),
      name: "PostHog Project ID",
      envVarName: "OPENHELM_POSTHOG_PROJECT_ID",
      value: projectId,
    },
  ];

  console.log("Adding PostHog credentials to OpenHelm...\n");

  for (const cred of creds) {
    insertCredential(db, cred);
    await setKeychain(cred.id, cred.value);
    console.log(`  ✓ Keychain entry stored for: ${cred.name}\n`);
  }

  db.close();
  console.log("Done. Both credentials are now available to all OpenHelm jobs.");
  console.log('Restart the OpenHelm agent (or trigger a run) to pick them up.\n');
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

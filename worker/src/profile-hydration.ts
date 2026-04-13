/**
 * Hydrate persisted Chromium user-data-dir tarballs into a run sandbox.
 *
 * For every credential that is in scope for the run (global, or bound to
 * this project/goal/job) AND has a saved browser profile from an earlier
 * credential-setup session, download the tarball from Supabase Storage
 * and extract it under /home/user/profiles/ so the openhelm-browser MCP
 * can reuse the same login state inside the run.
 *
 * Returns the list of profile directories hydrated so the executor can
 * pass OPENHELM_BROWSER_PROFILE_DIR (or a colon-joined list) to the MCP.
 */

import type Sandbox from "e2b";
import { getSupabase } from "./supabase.js";

const PROFILE_BUCKET = "browser-profiles";

export interface HydratedProfile {
  credentialId: string;
  profileDir: string;
}

/** Look up credentials with saved browser profiles that apply to this run. */
async function loadInScopeProfiles(
  userId: string,
  projectId: string,
  jobId: string,
): Promise<Array<{ id: string; storage_key: string }>> {
  const supabase = getSupabase();

  // Start with every credential the user owns that has a saved profile.
  const { data: creds, error } = await supabase
    .from("credentials")
    .select("id, scope_type, scope_id, browser_profile_storage_key")
    .eq("user_id", userId)
    .eq("is_enabled", true)
    .eq("allow_browser_injection", true)
    .not("browser_profile_storage_key", "is", null);
  if (error) throw new Error(`loadInScopeProfiles: ${error.message}`);

  // Keep globals + anything whose primary scope matches the run.
  const matchingByPrimary = (creds ?? []).filter((c) => {
    if (c.scope_type === "global") return true;
    if (c.scope_type === "project") return c.scope_id === projectId;
    if (c.scope_type === "job") return c.scope_id === jobId;
    return false;
  });

  // Also pick up credentials bound to this job/project via the junction.
  const { data: bindings } = await supabase
    .from("credential_scope_bindings")
    .select("credential_id")
    .eq("user_id", userId)
    .or(
      `and(scope_type.eq.project,scope_id.eq.${projectId}),and(scope_type.eq.job,scope_id.eq.${jobId})`,
    );

  const bindingIds = new Set((bindings ?? []).map((b) => b.credential_id));
  const byBinding = (creds ?? []).filter((c) => bindingIds.has(c.id));

  const unique = new Map<string, { id: string; storage_key: string }>();
  for (const c of [...matchingByPrimary, ...byBinding]) {
    if (c.browser_profile_storage_key) {
      unique.set(c.id, {
        id: c.id,
        storage_key: c.browser_profile_storage_key,
      });
    }
  }
  return [...unique.values()];
}

export async function hydrateBrowserProfiles(
  sandbox: InstanceType<typeof Sandbox>,
  opts: { userId: string; projectId: string; jobId: string },
  log: (line: string) => void,
): Promise<HydratedProfile[]> {
  const profiles = await loadInScopeProfiles(opts.userId, opts.projectId, opts.jobId);
  if (profiles.length === 0) return [];

  const supabase = getSupabase();
  await sandbox.commands.run("mkdir -p /home/user/profiles");

  const hydrated: HydratedProfile[] = [];
  for (const p of profiles) {
    log(`[openhelm] hydrating browser profile for credential ${p.id}`);
    const { data: blob, error } = await supabase.storage
      .from(PROFILE_BUCKET)
      .download(p.storage_key);
    if (error || !blob) {
      // Don't fail the run — the profile is a best-effort optimisation. Log
      // and move on; the agent can re-prompt for login if needed.
      log(`[openhelm] skip profile ${p.id}: ${error?.message ?? "missing"}`);
      continue;
    }
    const buffer = await blob.arrayBuffer();
    await sandbox.files.write("/tmp/profile.tar.gz", buffer);
    await sandbox.commands.run(
      "tar -xzf /tmp/profile.tar.gz -C /home/user/profiles",
    );
    hydrated.push({
      credentialId: p.id,
      profileDir: `/home/user/profiles/cred-${p.id}`,
    });
  }
  return hydrated;
}

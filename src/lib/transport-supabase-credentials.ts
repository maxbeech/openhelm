/**
 * Supabase CRUD handler for credentials.
 *
 * Secrets are stored in the `secret_value` TEXT column (JSON-serialised CredentialValue).
 * secret_value is NEVER included in list/get responses — only returned by `credentials.getValue`.
 * RLS (user_id = auth.uid()) enforces tenant isolation.
 */

import { getSupabaseClient } from "./supabase-client.js";
import type { CredentialValue } from "@openhelm/shared";

type Params = Record<string, unknown>;

// ─── Key transforms ───────────────────────────────────────────────────────────

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        snakeToCamel(k),
        camelizeKeys(v),
      ]),
    );
  }
  return obj;
}

// ─── Env var name helpers ─────────────────────────────────────────────────────

function toEnvVarBase(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
  return `OPENHELM_${slug || "CREDENTIAL"}`;
}

async function resolveEnvVarName(base: string, excludeId?: string): Promise<string> {
  const supabase = getSupabaseClient();
  let q = supabase.from("credentials").select("env_var_name");
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  const taken = new Set((data ?? []).map((r) => (r as { env_var_name: string }).env_var_name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ─── Column select strings ────────────────────────────────────────────────────

const CRED_COLS = [
  "id", "name", "type", "env_var_name",
  "allow_prompt_injection", "allow_browser_injection", "browser_profile_name",
  "scope_type", "scope_id", "is_enabled", "last_used_at", "created_at", "updated_at",
  "scopes:credential_scope_bindings(scope_type,scope_id)",
].join(",");

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleCredentials<T>(
  method: string,
  p: Params,
  userId: string,
): Promise<T> {
  const supabase = getSupabaseClient();

  function ok<D>(data: D | null, error: { message: string } | null): D {
    if (error) throw new Error(`Supabase error (${method}): ${error.message}`);
    if (data === null) throw new Error(`No data returned for ${method}`);
    return camelizeKeys(data) as D;
  }

  switch (method) {

    // ─── List ─────────────────────────────────────────────────────────────
    case "credentials.list":
    case "credentials.listAll": {
      const q = supabase.from("credentials").select(CRED_COLS).order("updated_at", { ascending: false });

      if (p.projectId) {
        // Step 1: global + legacy project-scoped
        const { data: direct, error: e1 } = await q.or(
          `scope_type.eq.global,and(scope_type.eq.project,scope_id.eq.${p.projectId as string})`,
        );
        if (e1) throw new Error(e1.message);

        // Step 2: binding-based — credentials explicitly assigned to this project
        const { data: bindings } = await supabase
          .from("credential_scope_bindings")
          .select("credential_id")
          .eq("scope_type", "project")
          .eq("scope_id", p.projectId as string);

        const boundIds = (bindings ?? []).map((r) => (r as { credential_id: string }).credential_id);
        const result = camelizeKeys(direct ?? []) as Array<{ id: string }>;

        if (boundIds.length > 0) {
          const seen = new Set(result.map((c) => c.id));
          const { data: bound } = await supabase.from("credentials").select(CRED_COLS).in("id", boundIds);
          for (const c of camelizeKeys(bound ?? []) as Array<{ id: string }>) {
            if (!seen.has(c.id)) result.push(c);
          }
        }
        return result as T;
      }

      const { data, error } = await q;
      return ok(data, error) as T;
    }

    // ─── Get ──────────────────────────────────────────────────────────────
    case "credentials.get": {
      const { data, error } = await supabase
        .from("credentials").select(CRED_COLS).eq("id", p.id as string).single();
      return ok(data, error) as T;
    }

    case "credentials.getValue": {
      const { data, error } = await supabase
        .from("credentials").select(`${CRED_COLS},secret_value`).eq("id", p.id as string).single();
      if (error) throw new Error(`Supabase error (credentials.getValue): ${error.message}`);
      if (!data) throw new Error(`Credential not found: ${String(p.id)}`);
      const cred = camelizeKeys(data) as Record<string, unknown>;
      const raw = cred.secretValue as string | null;
      cred.value = raw ? (JSON.parse(raw) as CredentialValue) : null;
      delete cred.secretValue;
      return cred as T;
    }

    // ─── Create ───────────────────────────────────────────────────────────
    case "credentials.create": {
      if (!p.name) throw new Error("name is required");
      if (!p.type) throw new Error("type is required");
      if (!p.value) throw new Error("value is required");

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const envVarName = await resolveEnvVarName(toEnvVarBase(p.name as string));
      const scopes = (p.scopes as Array<{ scopeType: string; scopeId: string }> | undefined) ?? [];

      const { error: ie } = await supabase.from("credentials").insert({
        id, user_id: userId,
        name: p.name, type: p.type,
        env_var_name: envVarName,
        allow_prompt_injection: p.allowPromptInjection ?? false,
        allow_browser_injection: p.allowBrowserInjection ?? false,
        scope_type: scopes.length > 0 ? "global" : (p.scopeType ?? "global"),
        scope_id: scopes.length > 0 ? null : (p.scopeId ?? null),
        is_enabled: true,
        secret_value: JSON.stringify(p.value),
        created_at: now, updated_at: now,
      });
      if (ie) throw new Error(`Failed to create credential: ${ie.message}`);

      if (scopes.length > 0) {
        const { error: be } = await supabase.from("credential_scope_bindings").insert(
          scopes.map((s) => ({ credential_id: id, scope_type: s.scopeType, scope_id: s.scopeId, user_id: userId })),
        );
        if (be) throw new Error(`Failed to write scope bindings: ${be.message}`);
      }

      const { data, error } = await supabase.from("credentials").select(CRED_COLS).eq("id", id).single();
      return ok(data, error) as T;
    }

    // ─── Update ───────────────────────────────────────────────────────────
    case "credentials.update": {
      if (!p.id) throw new Error("id is required");
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (p.name !== undefined) {
        patch.name = p.name;
        patch.env_var_name = await resolveEnvVarName(toEnvVarBase(p.name as string), p.id as string);
      }
      if (p.allowPromptInjection !== undefined) patch.allow_prompt_injection = p.allowPromptInjection;
      if (p.allowBrowserInjection !== undefined) patch.allow_browser_injection = p.allowBrowserInjection;
      if (p.browserProfileName !== undefined) patch.browser_profile_name = p.browserProfileName;
      if (p.isEnabled !== undefined) patch.is_enabled = p.isEnabled;
      if (p.scopeType !== undefined) patch.scope_type = p.scopeType;
      if (p.scopeId !== undefined) patch.scope_id = p.scopeId;
      if (p.value !== undefined) patch.secret_value = JSON.stringify(p.value);

      const { error: ue } = await supabase.from("credentials").update(patch).eq("id", p.id as string);
      if (ue) throw new Error(ue.message);

      if (p.scopes !== undefined) {
        const { error: de } = await supabase.from("credential_scope_bindings").delete().eq("credential_id", p.id as string);
        if (de) throw new Error(de.message);
        const newScopes = p.scopes as Array<{ scopeType: string; scopeId: string }> | null;
        if (newScopes && newScopes.length > 0) {
          const { error: be } = await supabase.from("credential_scope_bindings").insert(
            newScopes.map((s) => ({ credential_id: p.id, scope_type: s.scopeType, scope_id: s.scopeId, user_id: userId })),
          );
          if (be) throw new Error(`Failed to write scope bindings: ${be.message}`);
        }
      }

      const { data, error } = await supabase.from("credentials").select(CRED_COLS).eq("id", p.id as string).single();
      return ok(data, error) as T;
    }

    // ─── Delete ───────────────────────────────────────────────────────────
    case "credentials.delete": {
      const { error } = await supabase.from("credentials").delete().eq("id", p.id as string);
      if (error) throw new Error(error.message);
      return { deleted: true } as T;
    }

    // ─── Count ────────────────────────────────────────────────────────────
    case "credentials.count":
    case "credentials.countAll": {
      const { count, error } = await supabase
        .from("credentials").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return { count: count ?? 0 } as T;
    }

    // ─── Scope queries ────────────────────────────────────────────────────
    case "credentials.listForScope": {
      if (!p.scopeType || !p.scopeId) throw new Error("scopeType and scopeId are required");

      const { data: bindings } = await supabase
        .from("credential_scope_bindings").select("credential_id")
        .eq("scope_type", p.scopeType as string).eq("scope_id", p.scopeId as string);
      const boundIds = (bindings ?? []).map((r) => (r as { credential_id: string }).credential_id);

      const { data: legacy, error: le } = await supabase
        .from("credentials").select(CRED_COLS)
        .eq("scope_type", p.scopeType as string).eq("scope_id", p.scopeId as string)
        .order("updated_at", { ascending: false });
      if (le) throw new Error(le.message);

      const result = camelizeKeys(legacy ?? []) as Array<{ id: string }>;
      if (boundIds.length > 0) {
        const seen = new Set(result.map((c) => c.id));
        const { data: bound } = await supabase.from("credentials").select(CRED_COLS).in("id", boundIds);
        for (const c of camelizeKeys(bound ?? []) as Array<{ id: string }>) {
          if (!seen.has(c.id)) result.push(c);
        }
      }
      return result as T;
    }

    case "credentials.setScopesForEntity": {
      const { scopeType, scopeId, credentialIds } = p as { scopeType: string; scopeId: string; credentialIds: string[] };
      if (!scopeType || !scopeId) throw new Error("scopeType and scopeId are required");
      if (!Array.isArray(credentialIds)) throw new Error("credentialIds must be an array");

      const { data: existing } = await supabase
        .from("credential_scope_bindings").select("credential_id")
        .eq("scope_type", scopeType).eq("scope_id", scopeId);
      const existingIds = new Set((existing ?? []).map((r) => (r as { credential_id: string }).credential_id));
      const newIds = new Set(credentialIds);

      const toAdd = credentialIds.filter((id) => !existingIds.has(id));
      const toRemove = [...existingIds].filter((id) => !newIds.has(id));

      if (toRemove.length > 0) {
        const { error } = await supabase.from("credential_scope_bindings")
          .delete().eq("scope_type", scopeType).eq("scope_id", scopeId).in("credential_id", toRemove);
        if (error) throw new Error(error.message);
      }
      if (toAdd.length > 0) {
        const { error } = await supabase.from("credential_scope_bindings").insert(
          toAdd.map((credentialId) => ({ credential_id: credentialId, scope_type: scopeType, scope_id: scopeId, user_id: userId })),
        );
        if (error) throw new Error(error.message);
      }
      return { added: toAdd.length, removed: toRemove.length } as T;
    }

    default:
      throw new Error(`[transport-supabase-credentials] Method not implemented: ${method}`);
  }
}

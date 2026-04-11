/**
 * Supabase PostgREST CRUD handler for SupabaseTransport.
 *
 * Maps IPC method names (e.g. "projects.list") to Supabase client queries.
 * All queries run under the user's anon JWT — RLS enforces tenant isolation.
 *
 * Key transforms applied here:
 *  - Reads:  Supabase returns snake_case column names → camelized for the frontend.
 *  - Writes: Frontend params arrive in camelCase → decamelized before DB insert/update.
 */

import { getSupabaseClient } from "./supabase-client.js";
import { handleCredentials } from "./transport-supabase-credentials.js";

type Params = Record<string, unknown>;

// ─── Key transforms ───────────────────────────────────────────────────────────

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Recursively camelize all keys in a Supabase response object or array. */
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

/** Recursively decamelize all keys in a params object before DB insertion/update. */
function decamelizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(decamelizeKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        camelToSnake(k),
        // Don't recurse into JSONB values — they're stored as-is
        typeof v === "object" && v !== null ? v : v,
      ]),
    );
  }
  return obj;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleCrudRequest<T>(
  method: string,
  params: unknown,
  userId: string,
): Promise<T> {
  const p = (params ?? {}) as Params;
  const supabase = getSupabaseClient();

  /** Throw on Supabase error, then camelize the response keys. */
  function ok<D>(data: D | null, error: { message: string } | null): D {
    if (error) throw new Error(`Supabase error (${method}): ${error.message}`);
    if (data === null) throw new Error(`No data returned for ${method}`);
    return camelizeKeys(data) as D;
  }

  /** Convert camelCase param keys to snake_case for DB insertion/update. */
  function dbParams(src: Params): Record<string, unknown> {
    return decamelizeKeys(src) as Record<string, unknown>;
  }

  switch (method) {
    // ─── Projects ──────────────────────────────────────────────────────────
    case "projects.list": {
      const { data, error } = await supabase.from("projects").select("*");
      return ok(data, error) as T;
    }
    case "projects.get": {
      const { data, error } = await supabase.from("projects").select("*").eq("id", p.id).single();
      return ok(data, error) as T;
    }
    case "projects.create": {
      const { data, error } = await supabase
        .from("projects")
        .insert({ id: crypto.randomUUID(), ...dbParams(p), user_id: userId })
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "projects.update": {
      const { id, ...rest } = p;
      const { data, error } = await supabase
        .from("projects")
        .update({ ...dbParams(rest), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "projects.delete": {
      const { error } = await supabase.from("projects").delete().eq("id", p.id);
      if (error) throw new Error(error.message);
      return { deleted: true } as T;
    }

    // ─── Goals ─────────────────────────────────────────────────────────────
    case "goals.list": {
      let q = supabase.from("goals").select("*");
      if (p.projectId) q = q.eq("project_id", p.projectId);
      const { data, error } = await q.order("sort_order");
      return ok(data, error) as T;
    }
    case "goals.get": {
      const { data, error } = await supabase.from("goals").select("*").eq("id", p.id).single();
      return ok(data, error) as T;
    }
    case "goals.create": {
      const { data, error } = await supabase
        .from("goals")
        .insert({ id: crypto.randomUUID(), ...dbParams(p), user_id: userId })
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "goals.update": {
      const { id, ...rest } = p;
      const { data, error } = await supabase
        .from("goals")
        .update({ ...dbParams(rest), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "goals.archive": {
      const { data, error } = await supabase
        .from("goals")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "goals.unarchive": {
      const { data, error } = await supabase
        .from("goals")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "goals.delete": {
      const { error } = await supabase.from("goals").delete().eq("id", p.id);
      if (error) throw new Error(error.message);
      return { deleted: true, snapshot: {} } as T;
    }
    case "goals.children": {
      const { data, error } = await supabase
        .from("goals")
        .select("*")
        .eq("parent_id", p.id)
        .order("sort_order");
      return ok(data, error) as T;
    }
    case "goals.ancestors": {
      // Simple single-level ancestor fetch (full tree traversal deferred)
      const { data, error } = await supabase.from("goals").select("*").eq("id", p.id).single();
      return ok([data], error) as T;
    }

    // ─── Jobs ──────────────────────────────────────────────────────────────
    case "jobs.list": {
      let q = supabase.from("jobs").select("*").eq("is_archived", false);
      if (p.projectId) q = q.eq("project_id", p.projectId);
      if (p.goalId) q = q.eq("goal_id", p.goalId);
      const { data, error } = await q.order("sort_order");
      return ok(data, error) as T;
    }
    case "jobs.get": {
      const { data, error } = await supabase.from("jobs").select("*").eq("id", p.id).single();
      return ok(data, error) as T;
    }
    case "jobs.create": {
      const { data, error } = await supabase
        .from("jobs")
        .insert({ id: crypto.randomUUID(), ...dbParams(p), user_id: userId })
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "jobs.update": {
      const { id, ...rest } = p;
      const { data, error } = await supabase
        .from("jobs")
        .update({ ...dbParams(rest), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "jobs.archive": {
      const { data, error } = await supabase
        .from("jobs")
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "jobs.delete": {
      const { error } = await supabase.from("jobs").delete().eq("id", p.id);
      if (error) throw new Error(error.message);
      return { deleted: true } as T;
    }

    // ─── Runs ──────────────────────────────────────────────────────────────
    case "runs.list": {
      let q = supabase.from("runs").select("*");
      if (p.jobId) q = q.eq("job_id", p.jobId);
      const { data, error } = await q
        .order("created_at", { ascending: false })
        .limit(Number(p.limit ?? 50));
      return ok(data, error) as T;
    }
    case "runs.get": {
      const { data, error } = await supabase.from("runs").select("*").eq("id", p.id).single();
      return ok(data, error) as T;
    }
    case "runs.logs": {
      const { data, error } = await supabase
        .from("run_logs")
        .select("*")
        .eq("run_id", p.runId)
        .order("sequence");
      return ok(data, error) as T;
    }

    // ─── Settings ──────────────────────────────────────────────────────────
    case "settings.get": {
      const { data, error } = await supabase
        .from("settings")
        .select("key, value, updated_at")
        .eq("key", p.key)
        .single();
      // PGRST116 = no rows — return null (caller should handle)
      if (error?.code === "PGRST116") return null as T;
      return ok(data, error) as T;
    }
    case "settings.set": {
      const { data, error } = await supabase
        .from("settings")
        .upsert({
          user_id: userId,
          key: p.key,
          value: p.value,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      return ok(data, error) as T;
    }

    // ─── Memories ──────────────────────────────────────────────────────────
    case "memories.list": {
      let q = supabase.from("memories").select("*");
      if (p.projectId) q = q.eq("project_id", p.projectId);
      const { data, error } = await q.order("created_at", { ascending: false });
      return ok(data, error) as T;
    }
    case "memories.create": {
      const { data, error } = await supabase
        .from("memories")
        .insert({ id: crypto.randomUUID(), ...dbParams(p), user_id: userId })
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "memories.update": {
      const { id, ...rest } = p;
      const { data, error } = await supabase
        .from("memories")
        .update({ ...dbParams(rest), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "memories.delete": {
      const { error } = await supabase.from("memories").delete().eq("id", p.id);
      if (error) throw new Error(error.message);
      return { deleted: true } as T;
    }

    // ─── Inbox ─────────────────────────────────────────────────────────────
    case "dashboard.listItems": {
      const { data, error } = await supabase
        .from("inbox_items")
        .select("*")
        .order("created_at", { ascending: false });
      return ok(data, error) as T;
    }
    case "inbox.listEvents": {
      let q = supabase.from("inbox_events").select("*");
      if (p.limit) q = q.limit(Number(p.limit));
      const { data, error } = await q.order("created_at", { ascending: false });
      return ok(data, error) as T;
    }

    // ─── Chat Conversations ────────────────────────────────────────────────
    case "chat.createConversation": {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          project_id: p.projectId ?? null,
          channel: "app",
          title: p.title ?? null,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "chat.listConversations": {
      let q = supabase.from("conversations").select("*");
      if (p.projectId !== undefined) q = q.eq("project_id", p.projectId);
      const { data, error } = await q.order("sort_order", { ascending: true });
      return ok(data, error) as T;
    }
    case "chat.listMessages": {
      let q = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", p.conversationId);
      if (p.limit) q = q.limit(Number(p.limit));
      if (p.beforeId) q = q.lt("id", p.beforeId);
      const { data, error } = await q.order("created_at", { ascending: true });
      return ok(data, error) as T;
    }
    case "chat.renameConversation": {
      const { data, error } = await supabase
        .from("conversations")
        .update({ title: p.title, updated_at: new Date().toISOString() })
        .eq("id", p.conversationId)
        .select()
        .single();
      return ok(data, error) as T;
    }
    case "chat.deleteConversation": {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", p.conversationId);
      if (error) throw new Error(error.message);
      return { deleted: true } as T;
    }
    case "chat.reorderConversations": {
      const ids = p.conversationIds as string[];
      // Upsert sort_order for each conversation in the ordered list
      const updates = ids.map((id, i) =>
        supabase
          .from("conversations")
          .update({ sort_order: i, updated_at: new Date().toISOString() })
          .eq("id", id),
      );
      await Promise.all(updates);
      return { reordered: true } as T;
    }
    case "chat.clear": {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", p.conversationId);
      if (error) throw new Error(error.message);
      return { cleared: true } as T;
    }

    default:
      if (method.startsWith("credentials.")) {
        return handleCredentials<T>(method, p, userId);
      }
      throw new Error(`[transport-supabase] Method not implemented in cloud mode: ${method}`);
  }
}

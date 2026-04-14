/**
 * Worker Service entry point.
 *
 * Responsibilities:
 *  - Validate config at startup (fail fast on missing env vars)
 *  - Recover orphaned runs from a previous crash
 *  - Start the scheduler tick loop
 *  - Execute runs via E2B sandboxes
 *  - Expose /health and /rpc HTTP endpoints
 *  - Shut down cleanly on SIGTERM
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { config } from "./config.js";
import { startScheduler, recoverOrphanedRuns } from "./scheduler.js";
import { executeRun, cancelRun } from "./executor.js";
import { getSupabase } from "./supabase.js";
import { createCheckoutSession, createPortalSession } from "./stripe-billing.js";
import { handleChatSend, handleChatCancel } from "./chat-handler.js";
import {
  setupBrowserSession,
  finalizeBrowserSession,
  cancelBrowserSession,
} from "./credential-setup.js";
import {
  DemoRateLimitError,
  checkDemoRateLimit,
  extractClientIp,
  hashIp,
} from "./demo-rate-limit.js";

// Validate config at import time — throws if required vars are missing
void config;

// Global crash guards. A single bad async error (e.g. a known upstream
// regression inside @supabase/realtime-js teardown) must not kill the whole
// worker and cascade into a restart-count limit on Fly. Log and keep going.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  console.error("[worker] unhandledRejection:", msg);
});
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err.stack ?? err.message);
});

// ─── Run queue ───────────────────────────────────────────────────────────────

// Minimal in-process queue; the real queue is the runs table in Supabase.
// The scheduler creates the DB record first, then calls this callback.
async function onRunReady(runId: string): Promise<void> {
  executeRun(runId).catch((err: Error) =>
    console.error(`[worker] executeRun ${runId} error:`, err.message),
  );
}

// ─── HTTP server (health + RPC) ───────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

interface RpcContext {
  authUserId: string;
  isAnonymous: boolean;
  clientIp: string | null;
}

async function handleRpc(
  body: Record<string, unknown>,
  ctx: RpcContext,
  res: ServerResponse,
): Promise<void> {
  const { id, method, params } = body as {
    id: string;
    method: string;
    params: Record<string, unknown>;
  };
  const authUserId = ctx.authUserId;

  console.error(`[worker] rpc → ${method} (user: ${authUserId.slice(0, 8)}…${ctx.isAnonymous ? " anon" : ""})`);
  const t0 = Date.now();

  try {
    let result: unknown;

    switch (method) {
      case "runs.trigger": {
        const { runId } = params as { runId: string };
        onRunReady(runId).catch(() => {});
        result = { ok: true };
        break;
      }

      case "runs.cancel": {
        const { runId } = params as { runId: string };
        await cancelRun(runId);
        result = { ok: true };
        break;
      }

      case "health": {
        const supabase = getSupabase();
        const { error } = await supabase.from("settings").select("key").limit(1);
        result = { ok: !error, uptime: process.uptime() };
        break;
      }

      case "scheduler.status": {
        const supabase = getSupabase();
        const { count: activeCount } = await supabase
          .from("runs")
          .select("id", { count: "exact", head: true })
          .in("status", ["running", "queued"])
          .eq("user_id", authUserId);
        result = {
          running: true,
          paused: false,
          activeRuns: activeCount ?? 0,
          queuedRuns: 0,
        };
        break;
      }

      case "ping": {
        result = { ok: true };
        break;
      }

      case "claudeCode.detect":
      case "claudeCode.verify": {
        // Not applicable in cloud mode — agent runs inside E2B sandboxes
        result = { available: true, version: null };
        break;
      }

      case "billing.createCheckout": {
        const { plan, successUrl, cancelUrl } = params as {
          plan: string;
          successUrl?: string;
          cancelUrl?: string;
        };
        const supabase = getSupabase();
        const { data: userData } = await supabase.auth.admin.getUserById(authUserId);
        const checkout = await createCheckoutSession({
          userId: authUserId,
          plan,
          userEmail: userData?.user?.email,
          successUrl: successUrl ?? `${config.appUrl}?billing=success`,
          cancelUrl: cancelUrl ?? `${config.appUrl}?billing=cancelled`,
        });
        result = { url: checkout.url, sessionId: checkout.sessionId };
        break;
      }

      case "billing.createPortalSession": {
        const { returnUrl } = params as { returnUrl?: string };
        const supabase = getSupabase();
        const { data: sub } = await supabase
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("user_id", authUserId)
          .single();

        if (!sub?.stripe_customer_id) {
          return json(res, 400, {
            id,
            error: { code: -32600, message: "No active subscription found" },
          });
        }
        const portal = await createPortalSession(
          sub.stripe_customer_id as string,
          returnUrl ?? `${config.appUrl}/settings`,
        );
        result = { url: portal.url };
        break;
      }

      case "chat.send": {
        const { conversationId, content, model, modelEffort, permissionMode, context, demoSlug } =
          params as {
            conversationId: string;
            content: string;
            model?: string;
            modelEffort?: string;
            permissionMode?: string;
            context?: unknown;
            demoSlug?: string;
          };

        // Demo rate limiting — only enforced for anonymous sessions. Real
        // authenticated users who happen to be visiting a demo URL bypass
        // this check (they have their own subscription / usage metering).
        if (ctx.isAnonymous) {
          if (!demoSlug) {
            return json(res, 400, {
              id,
              error: { code: -32602, message: "Anonymous chat requires a demoSlug" },
            });
          }
          const ipHash = hashIp(ctx.clientIp);
          const verdict = await checkDemoRateLimit({
            sessionId: authUserId,
            ipHash,
            slug: demoSlug,
          });
          if (!verdict.ok) {
            throw new DemoRateLimitError(verdict.reason);
          }
        }

        // Force plan (read-only) permission mode for demo visitors so the
        // chat tool loop cannot accidentally mutate demo state. Real users
        // on /demo/:slug keep their requested mode — they're not gated.
        const effectiveMode = ctx.isAnonymous ? "plan" : permissionMode;

        result = await handleChatSend(
          {
            conversationId,
            content,
            model,
            modelEffort,
            permissionMode: effectiveMode,
            context,
            demoContext: ctx.isAnonymous && demoSlug
              ? { slug: demoSlug, ipHash: hashIp(ctx.clientIp) }
              : undefined,
          },
          authUserId,
        );
        break;
      }

      case "chat.cancel": {
        result = await handleChatCancel();
        break;
      }

      case "credential.setupBrowserProfile": {
        result = await setupBrowserSession(
          params as { credentialId: string; loginUrl?: string },
          authUserId,
        );
        break;
      }

      case "credential.finalizeBrowserProfile": {
        result = await finalizeBrowserSession(
          params as { sandboxId: string },
          authUserId,
        );
        break;
      }

      case "credential.cancelBrowserSetup": {
        result = await cancelBrowserSession(
          params as { sandboxId: string },
          authUserId,
        );
        break;
      }

      case "jobs.create": {
        const { projectId, name, description, prompt, scheduleType, scheduleConfig, isEnabled } =
          params as {
            projectId: string;
            name: string;
            description?: string;
            prompt: string;
            scheduleType: string;
            scheduleConfig: Record<string, unknown>;
            isEnabled: boolean;
          };
        const supabase = getSupabase();
        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const { error: insertErr } = await supabase.from("jobs").insert({
          id: jobId,
          user_id: authUserId,
          project_id: projectId,
          name,
          description: description ?? "",
          prompt,
          schedule_type: scheduleType,
          schedule_config: scheduleConfig,
          is_enabled: isEnabled,
          is_archived: false,
          next_fire_at: scheduleType === "once" && isEnabled ? now : null,
          created_at: now,
          updated_at: now,
        });
        if (insertErr) {
          return json(res, 500, { id, error: { code: -32603, message: insertErr.message } });
        }
        result = { id: jobId };
        break;
      }

      default:
        return json(res, 400, {
          id,
          error: { code: -32601, message: `Unknown method: ${method}` },
        });
    }

    console.error(`[worker] rpc ✓ ${method} (${Date.now() - t0}ms)`);
    json(res, 200, { id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Demo rate limit errors use a dedicated code (4290) so the frontend
    // can intercept them and open the signup modal with the rate-limit copy.
    if (err instanceof DemoRateLimitError) {
      console.error(`[worker] rpc ⊗ ${method} demo rate limit: ${err.reason}`);
      json(res, 200, {
        id: body.id,
        error: { code: 4290, message: err.reason },
      });
      return;
    }
    console.error(`[worker] rpc ✗ ${method} (${Date.now() - t0}ms):`, message);
    json(res, 500, { id: body.id, error: { code: -32603, message } });
  }
}

function createHttpServer() {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";

    // CORS preflight
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (url === "/health" && req.method === "GET") {
      json(res, 200, { ok: true, uptime: process.uptime() });
      return;
    }

    if (url === "/rpc" && req.method === "POST") {
      // Validate Bearer JWT (Supabase access token)
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) { json(res, 401, { error: "Unauthorized" }); return; }

      // Decode JWT to extract user ID + anonymous flag. We don't verify
      // the signature here because the service-role client it fans out
      // to still enforces RLS via `user_id` comparisons — and the worker
      // already runs behind Supabase's own auth. Demo rate limiting uses
      // `is_anonymous` which Supabase Auth stamps into the JWT payload
      // for sessions created via signInAnonymously().
      let userId: string;
      let isAnonymous = false;
      try {
        const payload = JSON.parse(
          Buffer.from(token.split(".")[1], "base64url").toString(),
        ) as { sub?: string; is_anonymous?: boolean };
        userId = payload.sub as string;
        if (!userId) throw new Error("missing sub");
        isAnonymous = payload.is_anonymous === true;
      } catch {
        json(res, 401, { error: "Invalid token" });
        return;
      }

      const clientIp = extractClientIp(
        (req.headers["x-forwarded-for"] as string | undefined) ?? undefined,
      );

      try {
        const body = await readBody(req);
        await handleRpc(
          body as Record<string, unknown>,
          { authUserId: userId, isAnonymous, clientIp },
          res,
        );
      } catch (err) {
        json(res, 400, { error: "Bad request" });
      }
      return;
    }

    json(res, 404, { error: "Not found" });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error(`[worker] starting (pid ${process.pid})`);

  // Crash recovery: mark orphaned runs from previous instance as failed
  await recoverOrphanedRuns();

  // Start scheduler
  const stopScheduler = startScheduler(onRunReady);

  // Start HTTP server
  const server = createHttpServer();
  server.listen(config.port, () => {
    console.error(`[worker] HTTP server listening on :${config.port}`);
  });

  // Graceful shutdown.
  //
  // Must complete in well under tsx watch's force-kill grace period (~5s) or
  // the process gets SIGKILL'd mid-flight and concurrently cascades the kill
  // across the whole dev stack. `server.close()` on its own waits for every
  // in-flight request and keep-alive socket to close naturally — a long RPC
  // like credential.setupBrowserProfile (~8s to spawn an E2B sandbox) would
  // hang shutdown forever — so we also force-close existing connections.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[worker] shutting down (${signal})`);
    stopScheduler();
    // Stop accepting new connections AND kill existing ones. Without the
    // second call Node will wait indefinitely for keep-alive sockets.
    server.close(() => process.exit(0));
    server.closeAllConnections();
    // Belt-and-braces: if something in the close path is still blocking
    // after 2s (well inside tsx watch's force-kill window), exit anyway.
    // unref() so this timer never keeps the event loop alive on its own.
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.error("[worker] ready");
}

main().catch((err: Error) => {
  console.error("[worker] fatal startup error:", err.message);
  process.exit(1);
});

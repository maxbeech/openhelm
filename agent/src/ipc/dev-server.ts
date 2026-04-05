/**
 * dev-server.ts
 * HTTP+SSE bridge that lets the browser access the agent without Tauri IPC.
 * Used for browser-based UI testing at http://localhost:1420.
 *
 * POST /ipc  → accepts an IpcRequest JSON body, returns IpcResponse JSON
 * GET  /events → SSE stream; the agent emitter calls broadcastEvent() to push lines
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { handleRequest } from "./handler.js";
import type { IpcRequest } from "@openhelm/shared";

export const DEV_SERVER_PORT = 1421;

const clients = new Set<ServerResponse>();

/** Broadcast a raw JSON line to all connected SSE clients */
export function broadcastEvent(line: string): void {
  const payload = `data: ${line}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://localhost:1422", // npx serve static (used by browser-based E2E testing)
  "http://localhost:4173", // vite preview (used by browser-based E2E testing)
]);

function setCorsHeaders(res: ServerResponse, req?: IncomingMessage): void {
  const origin = req?.headers?.origin ?? "http://localhost:1420";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:1420";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function handleSse(req: IncomingMessage, res: ServerResponse): void {
  setCorsHeaders(res, req);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  // Initial heartbeat so the client sees the connection is alive
  res.write(": ping\n\n");
  clients.add(res);
  res.on("error", () => clients.delete(res));
  req.on("close", () => clients.delete(res));
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

async function handleIpcPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(res, req);
  let body = "";
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", resolve);
  });
  try {
    const ipcReq: IpcRequest = JSON.parse(body);
    const response = await handleRequest(ipcReq);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
  }
}

export function startDevServer(): void {
  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      setCorsHeaders(res, req);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/events") {
      handleSse(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/ipc") {
      handleIpcPost(req, res).catch((err) => {
        console.error("[dev-server] unhandled error in /ipc:", err);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `[dev-server] port ${DEV_SERVER_PORT} already in use — dev bridge disabled (non-fatal)`,
      );
    } else {
      console.error("[dev-server] listen error (non-fatal):", err.message);
    }
  });

  server.listen(DEV_SERVER_PORT, "127.0.0.1", () => {
    console.error(`[agent] dev HTTP bridge listening on port ${DEV_SERVER_PORT}`);
  });
}

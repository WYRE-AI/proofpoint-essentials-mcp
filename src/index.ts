#!/usr/bin/env node
/**
 * Proofpoint Essentials MCP server — flat 20-tool surface.
 *
 * Transports:
 * - stdio (default): local Claude Desktop / CLI usage. `serveStdio` owns the
 *   era decision: a 2025-era `initialize` pins the connection legacy; modern
 *   2026-07-28 envelope openings are served natively.
 * - http: hosted deployment. `createMcpHandler({ legacy: 'stateless' })` is
 *   the dual-era posture — 2025-era traffic answered per-request statelessly,
 *   modern envelope traffic natively. NEVER `legacy: 'reject'`.
 *
 * Credentials via environment variables (env mode):
 * - PROOFPOINT_ESSENTIALS_USERNAME / PROOFPOINT_ESSENTIALS_PASSWORD / PROOFPOINT_ESSENTIALS_REGION
 * Or via gateway headers (AUTH_MODE=gateway):
 * - X-Proofpoint-Essentials-Username / X-Proofpoint-Essentials-Password / X-Proofpoint-Essentials-Region
 * Gateway mode never falls back to PROOFPOINT_ESSENTIALS_* env credentials.
 *
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real value.
 * Known placeholders are rejected even when MCP_ALLOW_INSECURE_DEV=1, so a
 * copied example cannot become the HMAC key. That flag is local development
 * only: it skips X-Gateway-S2S and listens on 127.0.0.1. A configured secret
 * honors MCP_HTTP_HOST; otherwise the bind address is 127.0.0.1.
 * /health and /healthz stay unauthenticated and do not read credentials.
 * stdio does not use S2S auth.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  GATEWAY_HEADERS,
  SERVER_VERSION,
  createMcpServer,
  makeMcpServerFactory,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "./mcp-server.js";
import { logger } from "./utils/logger.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

const LOOPBACK_HOST = "127.0.0.1";

/**
 * Public example values. Exact match after trim and lower-casing, so a
 * copied `.env.example` cannot become the HMAC key. A real secret that
 * merely contains one of these words is not a placeholder.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const MISSING_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
  "Set CONDUIT_S2S_SECRET to the gateway-provisioned secret (openssl rand -hex 32), or set MCP_ALLOW_INSECURE_DEV=1 for local development only.";

const PLACEHOLDER_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
  "Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.";

const INSECURE_DEV_WARNING =
  "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
  "The HTTP server is starting WITHOUT service-to-service authentication and listens on 127.0.0.1 only. " +
  "Do not use MCP_ALLOW_INSECURE_DEV outside local development.";

const S2S_UNAUTHORIZED = {
  error:
    "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
};

/** Set when the HTTP server closes, so shutdown can finish the MCP handler. */
let httpMcpClosed: Promise<void> = Promise.resolve();

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Hosts that count as loopback when deciding whether to warn about an override. */
function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

/**
 * Fail closed on an empty or placeholder secret. MCP_ALLOW_INSECURE_DEV=1
 * bypasses only an empty secret, and that bypass always binds 127.0.0.1.
 * A configured secret honors MCP_HTTP_HOST, defaulting to 127.0.0.1.
 * The secret is read here, at HTTP startup, and is never logged.
 */
function resolveHttpListen(): { s2sSecret: string; host: string } {
  const raw = (process.env.CONDUIT_S2S_SECRET ?? "").trim();
  if (KNOWN_PLACEHOLDER_SECRETS.has(raw.toLowerCase())) {
    logger.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }

  const configuredHost = (process.env.MCP_HTTP_HOST ?? "").trim();

  if (!raw) {
    if (process.env.MCP_ALLOW_INSECURE_DEV === "1") {
      if (configuredHost && !isLoopbackHost(configuredHost)) {
        logger.error(
          `WARNING: MCP_HTTP_HOST=${configuredHost} is not a loopback address. ` +
            "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. " +
            `Binding ${LOOPBACK_HOST} only.`
        );
      }
      // error level so LOG_LEVEL=warn|error cannot hide the bypass.
      logger.error(INSECURE_DEV_WARNING);
      return { s2sSecret: "", host: LOOPBACK_HOST };
    }

    logger.error(MISSING_S2S_SECRET_ERROR);
    process.exit(1);
  }

  return {
    s2sSecret: raw,
    host: configuredHost || LOOPBACK_HOST,
  };
}

const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "Mcp-Session-Id",
  "Mcp-Protocol-Version",
  ...GATEWAY_HEADERS,
].join(", ");

/** stdio (default). Fresh server per process; env-mode credentials. */
function startStdioTransport(): void {
  serveStdio(() => createMcpServer(resolveEnvCredentials().creds), {
    onerror: (error) => logger.error("stdio serving error", { error: error.message }),
  });
  logger.info("Proofpoint Essentials MCP server running on stdio");
}

export async function startHttpTransport(): Promise<HttpServer> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const { s2sSecret, host } = resolveHttpListen();
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const mcpHandler = createMcpHandler(makeMcpServerFactory({ gatewayMode: isGatewayMode }), {
    legacy: "stateless",
    onerror: (error) => logger.error("MCP serving error", { error: error.message }),
  });
  const handleMcpRequest = toNodeHandler(mcpHandler, {
    onerror: (error) => logger.error("MCP request adapter error", { error: error.message }),
  });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for claude.ai custom connectors — set on every response, before routing.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint — shallow, unauthenticated liveness probe. Must NOT
    // touch credentials or any upstream: in gateway mode credentials only
    // arrive per-request via headers, so a credential check here would
    // always fail and crash-loop the container.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          version: SERVER_VERSION,
          mcpTransport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1;
    // startup refuses otherwise. A configured secret is always enforced,
    // before any vendor credential is read.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify(S2S_UNAUTHORIZED));
      return;
    }

    if (url.pathname === "/mcp") {
      // 401 gate: reject unauthenticated gateway traffic BEFORE serving —
      // falling through to env-configured credentials would serve the
      // operator's tenant data to whoever asked (cross-tenant leak).
      if (isGatewayMode) {
        const { error } = resolveGatewayCredentials((name) => headerValue(req.headers[name]));
        if (error) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: `Unauthorized: ${error}`,
                data: { required: GATEWAY_HEADERS },
              },
              id: null,
            })
          );
          return;
        }
      }

      // Per-request credential binding happens inside the factory (it reads
      // the gateway headers from ctx.requestInfo on every request).
      await handleMcpRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  httpServer.on("close", () => {
    httpMcpClosed = mcpHandler.close().then(
      () => undefined,
      (error: unknown) => {
        logger.error("Error closing MCP handler", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    httpServer.once("error", onError);
    httpServer.listen(port, host, () => {
      httpServer.off("error", onError);
      logger.info(`Proofpoint Essentials MCP server listening on http://${host}:${port}/mcp`);
      logger.info(`Health check available at http://${host}:${port}/health`);
      logger.info(`Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env"}`);
      resolve();
    });
  });

  return httpServer;
}

async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";
  logger.info("Starting Proofpoint Essentials MCP server", {
    transport: transportType,
    nodeVersion: process.version,
  });

  if (transportType === "http") {
    const httpServer = await startHttpTransport();
    const shutdown = async () => {
      logger.info("Shutting down Proofpoint Essentials MCP server...");
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      await httpMcpClosed;
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    startStdioTransport();
  }
}

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint there. `node dist/index.js` still starts stdio or HTTP.
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    logger.error("Fatal startup error", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

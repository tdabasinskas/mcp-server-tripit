import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server";

export type HttpServerOptions = {
  host: string;
  port: number;
  /** Path that serves the MCP Streamable HTTP endpoint. */
  path?: string;
};

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function jsonRpcError(status: number, message: string): { status: number; body: unknown } {
  return {
    status,
    body: { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds maximum allowed size.");
    }
    chunks.push(buffer);
  }

  if (size === 0) return undefined;

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

/**
 * Handles a single MCP request in stateless mode: a fresh server and transport
 * are created per request and torn down once the response is sent. TripIt
 * credentials are read from the environment, so no per-session state is needed.
 */
async function handleMcpPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readBody(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON body.";
    const { status, body: errorBody } = jsonRpcError(400, message);
    sendJson(res, status, errorBody);
    return;
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function requestListener(req: IncomingMessage, res: ServerResponse, mcpPath: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (url.pathname === "/health" && method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (url.pathname === mcpPath) {
    if (method === "POST") {
      await handleMcpPost(req, res);
      return;
    }
    // Stateless mode has no session streams, so GET (SSE) and DELETE are unsupported.
    const { status, body } = jsonRpcError(405, "Method not allowed. Use POST for MCP requests.");
    res.setHeader("Allow", "POST");
    sendJson(res, status, body);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export function startHttpServer(options: HttpServerOptions): Promise<void> {
  const mcpPath = options.path ?? "/mcp";

  return new Promise((resolve, reject) => {
    const httpServer = createHttpServer((req, res) => {
      requestListener(req, res, mcpPath).catch((error) => {
        console.error("Unhandled error while handling MCP request:", error);
        if (!res.headersSent) {
          const { status, body } = jsonRpcError(500, "Internal server error.");
          sendJson(res, status, body);
        } else {
          res.end();
        }
      });
    });

    httpServer.on("error", reject);

    httpServer.listen(options.port, options.host, () => {
      console.error(
        `TripIt MCP server listening on http://${options.host}:${options.port}${mcpPath} (stateless Streamable HTTP)`,
      );
      resolve();
    });
  });
}

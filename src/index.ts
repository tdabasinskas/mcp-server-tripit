import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpServer } from "./http";
import { createServer } from "./server";

type TransportKind = "stdio" | "http";

type Config = {
  transport: TransportKind;
  host: string;
  port: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

/**
 * Resolves runtime configuration from environment variables and CLI flags.
 * CLI flags take precedence over environment variables. stdio remains the
 * default transport so existing integrations keep working unchanged.
 */
export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  let transport: TransportKind = env.MCP_TRANSPORT?.trim().toLowerCase() === "http" ? "http" : "stdio";
  let host = env.HOST?.trim() || DEFAULT_HOST;
  let port = env.PORT ? parsePort(env.PORT.trim()) : DEFAULT_PORT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--http") {
      transport = "http";
    } else if (arg === "--stdio") {
      transport = "stdio";
    } else if (arg === "--port") {
      port = parsePort(argv[++i] ?? "");
      transport = "http";
    } else if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
      transport = "http";
    } else if (arg === "--host") {
      host = argv[++i] ?? host;
      transport = "http";
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length) || host;
      transport = "http";
    }
  }

  return { transport, host, port };
}

async function main(): Promise<void> {
  const config = resolveConfig(process.argv.slice(2), process.env);

  if (config.transport === "http") {
    await startHttpServer({ host: config.host, port: config.port });
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start TripIt MCP server:", error);
  process.exit(1);
});

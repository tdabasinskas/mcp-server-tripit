- Repo: dvcrn/mcp-server-tripit

# Development Notes

## Package Manager

- Use `bun` for this repository. The repo has `bun.lock` and existing package scripts in `package.json`.
- Do not edit `package.json` directly for dependency changes; use the package manager.

## Secrets

- TripIt credentials are managed with `fnox`.
- Required live-test secrets are `TRIPIT_USERNAME` and `TRIPIT_PASSWORD`.
- `TRIPIT_CLIENT_ID` is optional.
- Run commands that need credentials through `fnox x -- ...`.

## MCP Testing

### Static Checks

Run TypeScript checks and build before testing MCP behavior:

```bash
bun run check
bun run build
```

### Protocol Handshake And Tool Listing

This verifies the built stdio MCP server starts correctly and exposes its tools. It does not call TripIt and does not require TripIt credentials:

```bash
bun run build
npx -y @modelcontextprotocol/inspector --cli bun run dist/index.js --method tools/list
```

Expected result: the command returns the registered `tripit_*` tools.

### HTTP Transport Handshake

This verifies the Streamable HTTP transport starts and exposes its tools. It
does not call TripIt and does not require TripIt credentials:

```bash
bun run build
MCP_TRANSPORT=http PORT=3111 bun run dist/index.js &
SERVER_PID=$!
curl -s http://127.0.0.1:3111/health
curl -s -X POST http://127.0.0.1:3111/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
kill $SERVER_PID
```

Expected result: `/health` returns `{"status":"ok"}` and the initialize call
returns the `tripit` server info. Swap `initialize` for a `tools/list` call to
confirm the registered `tripit_*` tools are exposed over HTTP.

### Read-Only Live TripIt Test

This verifies end-to-end MCP transport, TripIt authentication, and a read-only API call:

```bash
fnox x -- npx -y @modelcontextprotocol/inspector --cli bun run dist/index.js \
  --method tools/call \
  --tool-name tripit_list_trips \
  --tool-arg pageSize=1 \
  --tool-arg pageNum=1
```

Expected result: the command returns a TripIt response with `page_size` set to `1` and trip/profile data for the authenticated account.

### OpenAI MCP Conformance

This validates verb-first tool names, server instructions, normalized output envelopes, typed inputs, output schemas, complete annotations, invalid-input handling, and the maintained prompt-selection matrix for every tool:

```bash
bun run test:conformance
```

### Full Mutating Smoke Test

The repo has a full smoke test in `scripts/smoke-test.ts`:

```bash
bun run build
fnox x -- bun run smoke
```

This creates a temporary TripIt trip plus hotel, flight, transport, and activity objects, verifies they can be fetched, then attempts to delete them in cleanup. Treat this as a mutating integration test.

### Interactive Inspector

For manual tool exploration in the MCP Inspector UI:

```bash
fnox x -- npx -y @modelcontextprotocol/inspector bun run dist/index.js
```

Open the Inspector URL printed by the command, connect to the stdio server, and use the Tools tab to inspect schemas or call individual tools.

## Git Practices

- Never use `git stash`, `git checkout .`, `git reset --hard`, `git clean`, or commands that discard uncommitted work.
- Never use `git add .` or `git add -A`; stage specific files only.
- Do not include assistant/tool attribution in commit messages.

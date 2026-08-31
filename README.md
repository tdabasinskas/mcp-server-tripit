# mcp-server-tripit

`mcp-server-tripit` exposes the TripIt API as an MCP server.

It is built on top of the [`tripit-cli`](https://github.com/dvcrn/tripit-cli) project and uses the published [`tripit`](https://www.npmjs.com/package/tripit) package to access the full TripIt API.

Deploy this server directly to [MCP Nest](https://mcpnest.dev)

<a href="https://mcpnest.dev/deploy?server=mcp-server-tripit&package-manager=npx&env[TRIPIT_USERNAME]=&env[TRIPIT_PASSWORD]=">
    <img src="https://mcpnest.dev/images/deploy-on-mcpnest.png" alt="Deploy on MCP Nest" height="32" />
  </a>

## Install

Run it directly with:

```bash
npx -y mcp-server-tripit
```

## Usage with Claude

Add it to your MCP configuration:

```json
{
  "mcpServers": {
    "tripit": {
      "command": "npx",
      "args": ["-y", "mcp-server-tripit"],
      "env": {
        "TRIPIT_USERNAME": "your-tripit-username",
        "TRIPIT_PASSWORD": "your-tripit-password"
      }
    }
  }
}
```

If you want to supply the optional client id too:

```json
{
  "mcpServers": {
    "tripit": {
      "command": "npx",
      "args": ["-y", "mcp-server-tripit"],
      "env": {
        "TRIPIT_USERNAME": "your-tripit-username",
        "TRIPIT_PASSWORD": "your-tripit-password",
        "TRIPIT_CLIENT_ID": "your-tripit-client-id"
      }
    }
  }
}
```

## Configuration

The server reads TripIt credentials from environment variables:

Required:

- `TRIPIT_USERNAME`
- `TRIPIT_PASSWORD`

Optional:

- `TRIPIT_CLIENT_ID`

If `TRIPIT_CLIENT_ID` is set, it is passed through to the `tripit` client. If it is omitted, the server does not pass it.

If you use `fnox`, you can also run it like this:

```bash
fnox x -- npx -y mcp-server-tripit
```

## Transport

The server speaks MCP over **stdio** by default. It can also serve the
**Streamable HTTP** transport for clients that connect over HTTP.

Select the transport with an environment variable or a CLI flag (flags take
precedence over environment variables):

| Setting | Environment variable | CLI flag | Default |
| --- | --- | --- | --- |
| Transport | `MCP_TRANSPORT=http` | `--http` (or `--stdio`) | `stdio` |
| Bind host | `HOST` | `--host <host>` | `127.0.0.1` |
| Bind port | `PORT` | `--port <port>` | `3000` |

Passing `--host`, `--port`, or `--http` implies HTTP mode. Start an HTTP server
with either form:

```bash
MCP_TRANSPORT=http PORT=3000 npx -y mcp-server-tripit
# or
npx -y mcp-server-tripit --http --port 3000
```

The MCP endpoint is served at `POST /mcp` and a liveness probe is available at
`GET /health`. TripIt credentials are still read from the environment, so every
request is authenticated with the same account. Sessions are stateless: each
request is handled independently and no session ID is issued, so `GET`/`DELETE`
on `/mcp` return `405`.

## What it can do

Built on top of [`dvcrn/tripit-cli`](https://github.com/dvcrn/tripit-cli), this MCP server exposes the TripIt API for common travel workflows, including:

- listing and fetching trips
- creating, updating, and deleting trips
- managing hotel reservations
- managing flights
- managing transport segments
- managing activities
- creating any writable typed itinerary item directly in a trip
- reading any TripIt plan object by type and numeric ID or UUID
- listing, fetching, creating, replacing, assigning, converting, and deleting unfiled travel items
- converting raw unfiled items into typed air, activity, car, parking, cruise, directions, lodging, map, note, rail, restaurant, or transport objects
- attaching and removing documents from supported TripIt objects

## Tool contract

Tool names are verb-first, for example `tripit_list_trips`, `tripit_get_trip`, and `tripit_create_lodging`.
Every tool returns the same structured envelope:

```json
{
  "ok": true,
  "operation": "tripit_get_trip",
  "data": {},
  "warnings": []
}
```

Failures set `isError: true` and return `ok: false` with a stable error code, message, retryability flag, and optional upstream HTTP status. Do not retry writes unless `error.retryable` is true. Conversion results with `partial_success` must be inspected before retrying to avoid duplicates.

Create-without-trip, replacement, and conversion accept typed discriminated item schemas for air, activity, car, parking, cruise, directions, lodging, map, note, rail, restaurant, and transport. Weather remains read-only.

`tripit_create_trip_item` accepts a destination trip ID or UUID plus the same typed item schema. Direct, unfiled, and conversion creates use TripIt's typed v2 endpoints, preserve UUID trip associations, and verify the resulting association before reporting success.

Car inputs support structured `pickupLocation`, `dropoffLocation`, and `vehicle` objects. Unknown car fields are rejected rather than silently removed, so a successful create preserves supplied airport/location names, addresses, vehicle descriptions, and vehicle classes.

Air inputs preserve distinct marketing-airline names and codes, plus optional operating-carrier details for codeshares. Air, car, and lodging writes use strict typed inputs aligned with the documented v2 frontend models; response-only fields remain read-only.

Run `bun run test:live` with the TripIt credentials loaded to exercise every registered tool through MCP. The test creates isolated temporary objects and a trip, removes them, and verifies that the trip no longer appears afterward.

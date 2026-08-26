# API MCP Server

A **stateless** Cloudflare Worker that publishes a tenant HTTP API to MCP clients as two [Cloudflare Code Mode](https://developers.cloudflare.com/agents/model-context-protocol/codemode/) tools:

- **`search`** — model-written JavaScript inspects a sanitized OpenAPI document through `codemode.spec()`. The document stays out of the model context until search code returns a slice of it. Search has no network access.
- **`execute`** — the same `codemode.spec()` helper plus a host-provided `codemode.request()` callback. Credentials and the upstream origin stay in the Worker.

MCP clients connect with [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) at `/mcp`. The Worker serves the Code Mode SDK v1 server with `createLegacyMcpHandler` from `agents/mcp`, matching the current [search and execute guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-openapi-mcp-server/).

## What it is

```
MCP client  -- Streamable HTTP /mcp -->  this Worker
                                          ├─ search  → isolated JS, spec() only
                                          └─ execute → isolated JS, spec() + host request()
                                                         └─ fetch(API_BASE + path)
```

`DynamicWorkerExecutor` runs generated JavaScript in an isolated Worker (`globalOutbound: null`, 30s timeout). The host `request` callback:

1. Requires `path` to start with `/`.
2. Resolves the URL only against `API_BASE`.
3. Allows only paths that exist on the sanitized OpenAPI document, including `{param}` templates.
4. Forwards the inbound bearer token to the upstream API.
5. Returns `{ status, ok, result }` so non-2xx bodies are not discarded. A `204` response uses `result: null`.

The bearer token never enters the sandbox, tool results, or the OpenAPI document.

### Write gating

Default access is **GET only**. Send `X-MCP-Access-Mode: read_write` on the `/mcp` request to allow `POST`, `PUT`, `PATCH`, and `DELETE` as well. Other methods are rejected. In the default mode the spec passed to `search` also has mutating operations removed so the model does not plan writes it cannot run.

### OpenAPI ingest

On each isolate, the Worker fetches `GET ${API_BASE}/openapi.json` (no auth) and caches the raw document in memory for five minutes. Before `search` / `execute` see it, the Worker:

- Sets `info.title` to `API` and `info.description` to `HTTP API for accounts, symbols, and market data.`
- Drops `/health`, `/v1/auth`, `/v1/auth/*`, `/v1/stock-backfills`, and `/v1/stock-backfills/*`
- Keeps remaining tenant routes such as `/v1/health`, `/v1/accounts`, `/v1/symbols/{ticker}/latest-price`, and `/v1/symbols/{ticker}/bars`
- Injects `servers: [{ url: API_BASE }]`
- Inlines local `$ref` values (`#/…`). External refs are left unchanged.

Upstream is OpenAPI 3.1, typically from a Hono zod-openapi Worker. A local origin is often `http://localhost:8787`. Bars (`GET /v1/symbols/{ticker}/bars`) require `from` / `to`, enforce a max 7-day window, and use cursor pagination.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars
# Set API_BASE to your upstream origin, for example http://localhost:8787
npm run dev
```

The Worker listens on `http://localhost:8788`. Liveness: `GET /health` (no auth).

## Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `API_BASE` | `.dev.vars` locally, `wrangler secret put API_BASE` in production | Upstream origin. Example placeholder: `https://api.example.com`. |

There is no branded hostname in `wrangler.jsonc` `vars`.

Inbound `/mcp` requests must include:

```http
Authorization: Bearer <token>
```

Optional write enablement:

```http
X-MCP-Access-Mode: read_write
```

## Cursor config

If the client supports HTTP MCP servers and custom headers:

```json
{
  "mcpServers": {
    "API": {
      "type": "http",
      "url": "http://localhost:8788/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Add `"X-MCP-Access-Mode": "read_write"` to that `headers` object when the client should be allowed to call mutating methods. If the client cannot send headers, it can only connect after some other trusted proxy injects `Authorization`.

After deploy, replace the URL with `https://<your-worker>.<your-subdomain>.workers.dev/mcp`.

## Inspector

```bash
npm run dev
npm run inspector
```

`mcp-inspector.json` points the Inspector at `http://localhost:8788/mcp` (`type: http`). Paste the bearer token in the Inspector header UI (or `--header "Authorization: Bearer <token>"` on the CLI). Confirm the advertised tools are `search` and `execute`.

## search vs execute

Call `search` first. Search code can inspect the document without making API requests:

```js
async () => {
  const spec = await codemode.spec();
  return Object.entries(spec.paths)
    .filter(([path]) => path.includes("/symbols"))
    .map(([path, operations]) => ({
      path,
      methods: Object.keys(operations),
    }));
};
```

`execute` includes the same `codemode.spec()` method and the host-provided `codemode.request()` method:

```js
async () => {
  const response = await codemode.request({
    method: "GET",
    path: "/v1/symbols/AAPL/bars",
    query: { from: "2026-08-19T00:00:00Z", to: "2026-08-26T00:00:00Z" },
  });

  return response.result;
};
```

`codemode.request()` receives `method`, `path`, optional `query`, optional `body`, optional `contentType`, and optional `rawBody` (see the [`openApiMcpServer()` API](https://developers.cloudflare.com/agents/tools/codemode/api-reference/)). This Worker returns `{ status, ok, result }` instead of the raw JSON body so error payloads remain visible to model-written code.

## Deploy

```bash
npx wrangler secret put API_BASE
npm run deploy
```

Connect MCP clients to `https://<your-worker>.<your-subdomain>.workers.dev/mcp` with the same bearer header the upstream API expects.

## Scripts

| Script | Command |
| --- | --- |
| `dev` | `wrangler dev` |
| `deploy` | `wrangler deploy` |
| `test` | `vitest run` |
| `typecheck` | `wrangler types && tsc --noEmit` |
| `cf-typegen` | `wrangler types` |
| `inspector` | MCP Inspector against `mcp-inspector.json` |

## References

- [Code Mode MCP server patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)
- [Build a search and execute MCP server](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-openapi-mcp-server/)
- [Code Mode API reference](https://developers.cloudflare.com/agents/tools/codemode/api-reference/)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification)

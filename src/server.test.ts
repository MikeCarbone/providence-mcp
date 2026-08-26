import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Executor } from "@cloudflare/codemode";
import {
  createApiMcpServer,
  prepareSpec,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "./server";
import { SPEC_TITLE } from "./openapi/sanitize";

function mockExecutor(): Executor {
  return {
    execute: async () => ({ result: null }),
  };
}

const rawSpec = {
  openapi: "3.1.0",
  info: { title: "Upstream", version: "1.0.0" },
  paths: {
    "/v1/accounts": {
      get: { summary: "list" },
      post: { summary: "create" },
    },
    "/v1/auth/token": { post: { summary: "token" } },
    "/v1/symbols/{ticker}/bars": { get: { summary: "bars" } },
  },
};

describe("prepareSpec", () => {
  it("strips write operations in default read mode so search cannot plan them", () => {
    const spec = prepareSpec(rawSpec, "https://api.example.com", "read");
    const accounts = (spec.paths as Record<string, Record<string, unknown>>)[
      "/v1/accounts"
    ];
    expect(accounts.get).toBeTruthy();
    expect(accounts.post).toBeUndefined();
    expect((spec.paths as Record<string, unknown>)["/v1/auth/token"]).toBeUndefined();
    expect((spec.info as { title: string }).title).toBe(SPEC_TITLE);
  });

  it("keeps write operations when access mode is read_write", () => {
    const spec = prepareSpec(rawSpec, "https://api.example.com", "read_write");
    const accounts = (spec.paths as Record<string, Record<string, unknown>>)[
      "/v1/accounts"
    ];
    expect(accounts.post).toBeTruthy();
  });
});

describe("MCP server metadata", () => {
  it("uses the public API server name", () => {
    expect(MCP_SERVER_NAME).toBe("API");
    expect(MCP_SERVER_VERSION).toBe("1.0.0");
  });
});

describe("createApiMcpServer", () => {
  it("advertises the official search and execute tools", async () => {
    const server = createApiMcpServer({
      spec: rawSpec,
      executor: mockExecutor(),
      authorization: "Bearer test-token",
      apiBase: "https://api.example.com",
      accessMode: "read",
    });

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "execute",
      "search",
    ]);

    await client.close();
    await server.close();
  });
});

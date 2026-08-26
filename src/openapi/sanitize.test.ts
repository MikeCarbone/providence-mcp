import { describe, expect, it } from "vitest";
import {
  isDeniedPath,
  resolveLocalRefs,
  sanitizeSpec,
  SPEC_DESCRIPTION,
  SPEC_TITLE,
  stripMutatingOperations,
} from "./sanitize";

function forbiddenTokens(): string[] {
  return [
    ["provi", "dence"].join(""),
    ["kno", "ck"].join(""),
    ["kno", "cklabs"].join(""),
    ["ma", "pi"].join(""),
    ["Auth", "Kit"].join(""),
    ["Work", "OS"].join(""),
  ];
}

function sampleSpec(overrides: Record<string, unknown> = {}) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Upstream Tenant API",
      description: "Internal document",
      version: "2.4.0",
      contact: { name: "Upstream" },
    },
    paths: {
      "/health": { get: { summary: "process liveness" } },
      "/v1/health": { get: { summary: "api liveness" } },
      "/v1/auth": { post: { summary: "login" } },
      "/v1/auth/token": { post: { summary: "token" } },
      "/v1/stock-backfills": { get: { summary: "list backfills" } },
      "/v1/stock-backfills/{runId}/retry": {
        post: { summary: "retry backfill" },
      },
      "/v1/accounts": {
        get: { summary: "list accounts" },
        post: { summary: "create account" },
      },
      "/v1/symbols/{ticker}/latest-price": {
        get: { summary: "latest price" },
      },
      "/v1/symbols/{ticker}/bars": {
        get: {
          summary: "bars",
          parameters: [
            { name: "from", in: "query", required: true },
            { name: "to", in: "query", required: true },
          ],
        },
      },
    },
    ...overrides,
  };
}

describe("isDeniedPath", () => {
  it("drops the process health path but keeps /v1/health", () => {
    expect(isDeniedPath("/health")).toBe(true);
    expect(isDeniedPath("/v1/health")).toBe(false);
  });

  it("drops /v1/auth and nested auth routes", () => {
    expect(isDeniedPath("/v1/auth")).toBe(true);
    expect(isDeniedPath("/v1/auth/token")).toBe(true);
    expect(isDeniedPath("/v1/author")).toBe(false);
  });

  it("drops stock-backfill routes including nested retry", () => {
    expect(isDeniedPath("/v1/stock-backfills")).toBe(true);
    expect(isDeniedPath("/v1/stock-backfills/{runId}/retry")).toBe(true);
  });
});

describe("sanitizeSpec", () => {
  it("rewrites title and description and keeps version", () => {
    const out = sanitizeSpec(sampleSpec(), {
      apiBase: "https://api.example.com",
    });
    expect(out.info).toEqual({
      title: SPEC_TITLE,
      description: SPEC_DESCRIPTION,
      version: "2.4.0",
    });
  });

  it("drops denied paths including nested auth and backfill routes", () => {
    const out = sanitizeSpec(sampleSpec(), {
      apiBase: "https://api.example.com",
    });
    const paths = out.paths as Record<string, unknown>;
    expect(paths["/health"]).toBeUndefined();
    expect(paths["/v1/auth"]).toBeUndefined();
    expect(paths["/v1/auth/token"]).toBeUndefined();
    expect(paths["/v1/stock-backfills"]).toBeUndefined();
    expect(paths["/v1/stock-backfills/{runId}/retry"]).toBeUndefined();
  });

  it("keeps allowed market and account paths", () => {
    const out = sanitizeSpec(sampleSpec(), {
      apiBase: "https://api.example.com",
    });
    const paths = out.paths as Record<string, unknown>;
    expect(paths["/v1/health"]).toBeTruthy();
    expect(paths["/v1/accounts"]).toBeTruthy();
    expect(paths["/v1/symbols/{ticker}/latest-price"]).toBeTruthy();
    expect(paths["/v1/symbols/{ticker}/bars"]).toBeTruthy();
  });

  it("injects servers from API_BASE and strips a trailing slash", () => {
    const out = sanitizeSpec(sampleSpec(), {
      apiBase: "https://api.example.com/",
    });
    expect(out.servers).toEqual([{ url: "https://api.example.com" }]);
  });

  it("GET-only filter removes POST/PUT/PATCH/DELETE but keeps GET", () => {
    const spec = sampleSpec({
      paths: {
        "/v1/accounts": {
          get: { summary: "list" },
          post: { summary: "create" },
          put: { summary: "replace" },
          patch: { summary: "update" },
          delete: { summary: "remove" },
          parameters: [{ name: "limit", in: "query" }],
        },
        "/v1/only-write": {
          post: { summary: "write only" },
        },
      },
    });
    const out = sanitizeSpec(spec, {
      apiBase: "https://api.example.com",
      readOnly: true,
    });
    const accounts = (out.paths as Record<string, Record<string, unknown>>)[
      "/v1/accounts"
    ];
    expect(accounts.get).toEqual({ summary: "list" });
    expect(accounts.parameters).toEqual([{ name: "limit", in: "query" }]);
    expect(accounts.post).toBeUndefined();
    expect(accounts.put).toBeUndefined();
    expect(accounts.patch).toBeUndefined();
    expect(accounts.delete).toBeUndefined();
    expect(
      (out.paths as Record<string, unknown>)["/v1/only-write"],
    ).toBeUndefined();
  });

  it("does not leave forbidden brand strings in info", () => {
    const tokens = forbiddenTokens();
    const spec = sampleSpec({
      info: {
        title: tokens.join(" "),
        description: tokens.join(" / "),
        version: "9.0.0",
        contact: { name: tokens[0] },
        "x-brand": tokens[1],
      },
    });
    const info = JSON.stringify(
      sanitizeSpec(spec, { apiBase: "https://api.example.com" }).info,
    ).toLowerCase();
    for (const token of tokens) {
      expect(info.includes(token.toLowerCase())).toBe(false);
    }
    expect(info).toContain("api");
    expect(info).toContain("accounts");
  });

  it("handles missing paths and info safely", () => {
    const empty = sanitizeSpec(undefined, {
      apiBase: "https://api.example.com",
    });
    expect(empty.info).toMatchObject({
      title: SPEC_TITLE,
      description: SPEC_DESCRIPTION,
      version: "1.0.0",
    });
    expect(empty.paths).toEqual({});
    expect(empty.servers).toEqual([{ url: "https://api.example.com" }]);

    const noPaths = sanitizeSpec(
      { openapi: "3.1.0" },
      { apiBase: "http://localhost:8787" },
    );
    expect(noPaths.paths).toEqual({});
    expect(noPaths.servers).toEqual([{ url: "http://localhost:8787" }]);
  });

  it("inlines local $refs and leaves external refs alone", () => {
    const spec = sampleSpec({
      paths: {
        "/v1/accounts": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Account" },
                  },
                },
              },
            },
          },
        },
        "/v1/external": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: { $ref: "https://schemas.example.com/tick.json" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Account: {
            type: "object",
            properties: { id: { type: "string" } },
          },
        },
      },
    });

    const out = sanitizeSpec(spec, { apiBase: "https://api.example.com" });
    const paths = out.paths as {
      "/v1/accounts": {
        get: {
          responses: {
            "200": {
              content: { "application/json": { schema: Record<string, unknown> } };
            };
          };
        };
      };
      "/v1/external": {
        get: {
          responses: {
            "200": {
              content: { "application/json": { schema: Record<string, unknown> } };
            };
          };
        };
      };
    };

    expect(paths["/v1/accounts"].get.responses["200"].content["application/json"].schema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
    });
    expect(
      paths["/v1/external"].get.responses["200"].content["application/json"].schema,
    ).toEqual({ $ref: "https://schemas.example.com/tick.json" });
  });

  it("keeps remaining non-denied tenant routes", () => {
    const out = sanitizeSpec(
      sampleSpec({
        paths: {
          "/v1/accounts/{id}": { get: { summary: "one account" } },
        },
      }),
      { apiBase: "https://api.example.com" },
    );
    expect(
      (out.paths as Record<string, unknown>)["/v1/accounts/{id}"],
    ).toBeTruthy();
  });
});

describe("stripMutatingOperations", () => {
  it("returns non-objects unchanged", () => {
    expect(stripMutatingOperations("x")).toBe("x");
    expect(stripMutatingOperations(null)).toBe(null);
  });
});

describe("resolveLocalRefs", () => {
  it("resolves JSON pointer escapes and merges siblings", () => {
    const doc = resolveLocalRefs({
      components: {
        schemas: {
          "Foo/Bar": { type: "string" },
        },
      },
      item: {
        $ref: "#/components/schemas/Foo~1Bar",
        description: "escaped",
      },
    });
    expect(doc.item).toEqual({ type: "string", description: "escaped" });
  });

  it("does not recurse forever on circular local refs", () => {
    const doc = resolveLocalRefs({
      components: {
        schemas: {
          A: { properties: { b: { $ref: "#/components/schemas/B" } } },
          B: { properties: { a: { $ref: "#/components/schemas/A" } } },
        },
      },
      item: { $ref: "#/components/schemas/A" },
    });
    const item = doc.item as {
      properties: { b: { properties: { a: { $ref: string } } } };
    };
    expect(item.properties.b.properties.a).toEqual({
      $ref: "#/components/schemas/A",
    });
  });

  it("leaves missing local pointers intact", () => {
    const doc = resolveLocalRefs({
      item: { $ref: "#/components/schemas/Missing" },
    });
    expect(doc.item).toEqual({ $ref: "#/components/schemas/Missing" });
  });

  it("returns an object for non-object input", () => {
    expect(resolveLocalRefs(null)).toEqual({});
  });
});

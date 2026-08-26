import { describe, expect, it, vi } from "vitest";
import {
  assertSafeRelativePath,
  buildApiUrl,
  createHostRequest,
  isPathInSpec,
  pathMatchesTemplate,
} from "./proxy";

const SPEC = {
  paths: {
    "/v1/accounts": { get: {} },
    "/v1/symbols/{ticker}/bars": { get: {} },
    "/v1/symbols/{ticker}/latest-price": { get: {} },
  },
};

const TOKEN = "secret-token-value-42";

function hostRequest(
  fetchImpl: typeof fetch,
  accessMode: "read" | "read_write" = "read",
) {
  return createHostRequest({
    apiBase: "https://api.example.com",
    authorization: `Bearer ${TOKEN}`,
    spec: SPEC,
    accessMode,
    fetchImpl,
  });
}

describe("path matching", () => {
  it("matches templated OpenAPI paths", () => {
    expect(
      pathMatchesTemplate(
        "/v1/symbols/AAPL/bars",
        "/v1/symbols/{ticker}/bars",
      ),
    ).toBe(true);
    expect(
      pathMatchesTemplate(
        "/v1/symbols/AAPL/latest-price",
        "/v1/symbols/{ticker}/latest-price",
      ),
    ).toBe(true);
    expect(pathMatchesTemplate("/v1/accounts", "/v1/accounts")).toBe(true);
    expect(
      pathMatchesTemplate("/v1/symbols/AAPL/bars", "/v1/accounts"),
    ).toBe(false);
    expect(
      pathMatchesTemplate("/v1/symbols/AAPL", "/v1/symbols/{ticker}/bars"),
    ).toBe(false);
  });

  it("requires a concrete parameter segment", () => {
    expect(
      pathMatchesTemplate("/v1/symbols//bars", "/v1/symbols/{ticker}/bars"),
    ).toBe(false);
  });
});

describe("assertSafeRelativePath", () => {
  it("rejects a path without a leading slash", () => {
    expect(() => assertSafeRelativePath("v1/accounts")).toThrow(
      "API path must start with a slash",
    );
  });

  it("rejects absolute URLs and protocol-relative hosts", () => {
    expect(() =>
      assertSafeRelativePath("https://evil.example.com/v1/accounts"),
    ).toThrow("API path must be a relative URL path");
    expect(() => assertSafeRelativePath("//evil.example.com/v1")).toThrow(
      "API path must be a relative URL path",
    );
  });

  it("rejects query, fragment, and traversal segments", () => {
    expect(() => assertSafeRelativePath("/v1/accounts?x=1")).toThrow(
      "API path must not include a query or fragment",
    );
    expect(() => assertSafeRelativePath("/v1/accounts#top")).toThrow(
      "API path must not include a query or fragment",
    );
    expect(() => assertSafeRelativePath("/v1/../openapi.json")).toThrow(
      "API path must not contain traversal segments",
    );
    expect(() => assertSafeRelativePath("/v1/%2e%2e/openapi.json")).toThrow(
      "API path must not contain traversal segments",
    );
  });
});

describe("isPathInSpec", () => {
  it("accepts concrete paths that match sanitized templates", () => {
    expect(isPathInSpec("/v1/symbols/AAPL/bars", SPEC)).toBe(true);
    expect(isPathInSpec("/v1/missing", SPEC)).toBe(false);
    expect(isPathInSpec("/v1/accounts", { paths: undefined })).toBe(false);
  });
});

describe("buildApiUrl", () => {
  it("encodes query string values", () => {
    const url = buildApiUrl("https://api.example.com", "/v1/symbols/AAPL/bars", {
      from: "2026-08-01T00:00:00Z",
      to: "2026-08-02T00:00:00Z",
      q: "a b&c",
      skip: undefined,
    });
    expect(url.origin).toBe("https://api.example.com");
    expect(url.pathname).toBe("/v1/symbols/AAPL/bars");
    expect(url.searchParams.get("q")).toBe("a b&c");
    expect(url.search).toContain("a+b%26c");
    expect(url.searchParams.has("skip")).toBe(false);
  });
});

describe("createHostRequest", () => {
  it("rejects a path that is not on the sanitized spec", async () => {
    const fetchImpl = vi.fn();
    const request = hostRequest(fetchImpl);
    await expect(
      request({ method: "GET", path: "/v1/auth/token" }),
    ).rejects.toThrow("API path is not available on this server");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("only fetches API_BASE + path and forwards host Authorization", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.toString()).toBe(
        "https://api.example.com/v1/symbols/AAPL/bars?from=2026-08-01",
      );
      return new Response(JSON.stringify({ close: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const request = hostRequest(fetchImpl);
    const result = await request({
      method: "GET",
      path: "/v1/symbols/AAPL/bars",
      query: { from: "2026-08-01" },
      headers: {
        Authorization: "Bearer sandbox-secret",
        Cookie: "session=1",
        Host: "evil.example.com",
      },
    });

    expect(result).toEqual({ status: 200, ok: true, result: { close: 1 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("Host")).toBeNull();
  });

  it("sends JSON bodies and raw bodies", async () => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      return new Response(String(init?.body ?? ""), {
        status: 201,
        headers: { "content-type": "text/plain" },
      });
    });
    const request = hostRequest(fetchImpl, "read_write");

    const json = await request({
      method: "POST",
      path: "/v1/accounts",
      body: { name: "primary" },
    });
    expect(json.result).toBe(JSON.stringify({ name: "primary" }));
    const jsonHeaders = new Headers(fetchImpl.mock.calls[0]![1]!.headers);
    expect(jsonHeaders.get("Content-Type")).toBe("application/json");

    const raw = await request({
      method: "POST",
      path: "/v1/accounts",
      body: "plain-text",
      rawBody: true,
      contentType: "text/plain",
    });
    expect(raw.result).toBe("plain-text");
    const rawHeaders = new Headers(fetchImpl.mock.calls[1]![1]!.headers);
    expect(rawHeaders.get("Content-Type")).toBe("text/plain");
  });

  it("maps 204 to a null result and still returns non-2xx bodies", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "nope" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );

    const request = hostRequest(fetchImpl);
    await expect(request({ method: "GET", path: "/v1/accounts" })).resolves.toEqual({
      status: 204,
      ok: true,
      result: null,
    });
    await expect(request({ method: "GET", path: "/v1/accounts" })).resolves.toEqual({
      status: 409,
      ok: false,
      result: { error: "nope" },
    });
  });

  it("never includes the bearer token in thrown Error messages", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`upstream failed for Bearer ${TOKEN}`);
    });
    const request = hostRequest(fetchImpl);
    await expect(request({ method: "GET", path: "/v1/accounts" })).rejects.toThrow(
      "Upstream request failed",
    );
    try {
      await request({ method: "GET", path: "/v1/accounts" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(TOKEN);
      expect((error as Error).message).not.toContain(`Bearer ${TOKEN}`);
    }
  });

  it("rejects write methods in the default access mode", async () => {
    const request = hostRequest(vi.fn());
    await expect(
      request({ method: "POST", path: "/v1/accounts", body: {} }),
    ).rejects.toThrow(/read-only mode/);
  });

  it("returns null for empty non-JSON bodies", async () => {
    const request = hostRequest(async () => new Response("", { status: 200 }));
    await expect(request({ method: "GET", path: "/v1/accounts" })).resolves.toEqual({
      status: 200,
      ok: true,
      result: null,
    });
  });

  it("returns raw text when JSON content is malformed", async () => {
    const request = hostRequest(
      async () =>
        new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(request({ method: "GET", path: "/v1/accounts" })).resolves.toEqual({
      status: 200,
      ok: true,
      result: "{not-json",
    });
  });
});

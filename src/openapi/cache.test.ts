import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOpenApiCache,
  loadOpenApiSpec,
  normalizeApiBase,
  SPEC_TTL_MS,
} from "./cache";
import { sanitizeSpec } from "./sanitize";

afterEach(() => {
  clearOpenApiCache();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("normalizeApiBase", () => {
  it("trims trailing slashes and keeps the origin", () => {
    expect(normalizeApiBase("https://api.example.com/")).toBe(
      "https://api.example.com",
    );
    expect(normalizeApiBase("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
  });

  it("rejects non-HTTP values", () => {
    expect(() => normalizeApiBase("not a url")).toThrow(
      "API_BASE is not a valid URL",
    );
    expect(() => normalizeApiBase("ftp://files.example.com")).toThrow(
      "API_BASE must be an HTTP URL",
    );
  });
});

describe("loadOpenApiSpec", () => {
  it("fetches the unsanitized document and caches it within the TTL", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      expect(input).toBe("https://api.example.com/openapi.json");
      return jsonResponse({
        info: { title: "Upstream", version: "1" },
        paths: { "/v1/accounts": { get: {} } },
      });
    });
    const now = vi.fn(() => 1_000);

    const first = await loadOpenApiSpec(
      "https://api.example.com",
      fetchImpl,
      now,
    );
    const second = await loadOpenApiSpec(
      "https://api.example.com",
      fetchImpl,
      now,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect((first.info as { title: string }).title).toBe("Upstream");

    const sanitized = sanitizeSpec(first, {
      apiBase: "https://api.example.com",
    });
    expect((sanitized.info as { title: string }).title).toBe("API");
  });

  it("refetches after the TTL expires", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ info: { title: "first", version: "1" }, paths: {} }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ info: { title: "second", version: "1" }, paths: {} }),
      );
    const now = vi.fn(() => 10_000);

    await loadOpenApiSpec("https://api.example.com", fetchImpl, now);
    now.mockReturnValue(10_000 + SPEC_TTL_MS + 1);
    const next = await loadOpenApiSpec("https://api.example.com", fetchImpl, now);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((next.info as { title: string }).title).toBe("second");
  });

  it("does not reuse a cache entry from a different API_BASE", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      jsonResponse({ info: { title: input, version: "1" }, paths: {} }),
    );

    await loadOpenApiSpec("https://api.example.com", fetchImpl);
    await loadOpenApiSpec("http://localhost:8787", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8787/openapi.json",
    );
  });

  it("throws on non-OK fetches and invalid JSON objects", async () => {
    await expect(
      loadOpenApiSpec("https://api.example.com", async () =>
        new Response("nope", { status: 503 }),
      ),
    ).rejects.toThrow("OpenAPI request failed: 503");

    await expect(
      loadOpenApiSpec("https://api.example.com", async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toThrow("OpenAPI document is not valid JSON");

    await expect(
      loadOpenApiSpec("https://api.example.com", async () =>
        jsonResponse(["not", "an", "object"]),
      ),
    ).rejects.toThrow("OpenAPI document must be an object");
  });
});

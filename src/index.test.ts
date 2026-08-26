import { describe, expect, it, vi } from "vitest";
import worker from "./index";

const loader = {} as WorkerLoader;

function fetchWorker(
  path: string,
  init?: RequestInit,
  env: Partial<Env> = { API_BASE: "https://api.example.com", LOADER: loader },
): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost:8788${path}`, init),
    env as Env,
    {} as ExecutionContext,
  );
}

describe("HTTP handler", () => {
  it("returns 401 from /mcp without Authorization", async () => {
    const response = await fetchWorker("/mcp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Bearer token required");
  });

  it("returns 401 from /mcp for a non-bearer Authorization header", async () => {
    const response = await fetchWorker("/mcp", {
      method: "POST",
      headers: { Authorization: "Basic abc" },
    });
    expect(response.status).toBe(401);
  });

  it("returns 200 from /health without auth", async () => {
    const response = await fetchWorker("/health");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("rejects missing API_BASE before constructing the MCP server", async () => {
    const response = await fetchWorker(
      "/mcp",
      {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      },
      { API_BASE: "", LOADER: loader },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("API_BASE is not configured");
  });

  it("returns 404 for unknown paths", async () => {
    const response = await fetchWorker("/");
    expect(response.status).toBe(404);
  });
});

describe("handler isolation", () => {
  it("does not import a live network client for the 401 path", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await fetchWorker("/mcp", { method: "POST" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

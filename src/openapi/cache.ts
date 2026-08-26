export const SPEC_TTL_MS = 5 * 60 * 1000;

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type CacheEntry = {
  apiBase: string;
  spec: Record<string, unknown>;
  expiresAt: number;
};

let cache: CacheEntry | undefined;

export function clearOpenApiCache(): void {
  cache = undefined;
}

export function normalizeApiBase(apiBase: string): string {
  let parsed: URL;
  try {
    parsed = new URL(apiBase);
  } catch {
    throw new Error("API_BASE is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API_BASE must be an HTTP URL");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export async function loadOpenApiSpec(
  apiBase: string,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<Record<string, unknown>> {
  const normalized = normalizeApiBase(apiBase);
  const timestamp = now();
  if (cache && cache.apiBase === normalized && cache.expiresAt > timestamp) {
    return cache.spec;
  }

  const url = `${normalized}/openapi.json`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`OpenAPI request failed: ${response.status}`);
  }

  let spec: unknown;
  try {
    spec = await response.json();
  } catch {
    throw new Error("OpenAPI document is not valid JSON");
  }

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("OpenAPI document must be an object");
  }

  cache = {
    apiBase: normalized,
    spec: spec as Record<string, unknown>,
    expiresAt: timestamp + SPEC_TTL_MS,
  };
  return cache.spec;
}

import type {
  OpenApiMcpRequestContext,
  RequestOptions,
} from "@cloudflare/codemode/mcp";
import { normalizeApiBase } from "../openapi/cache";
import {
  assertMethodAllowed,
  type AccessMode,
} from "./access";

export type HostRequestOptions = RequestOptions & {
  headers?: Record<string, string>;
};

export type HostRequestResult = {
  status: number;
  ok: boolean;
  result: unknown;
};

export type HostRequestConfig = {
  apiBase: string;
  authorization: string;
  spec: Record<string, unknown>;
  accessMode: AccessMode;
  fetchImpl?: typeof fetch;
};

const BLOCKED_SANDBOX_HEADERS = new Set(["authorization", "cookie", "host"]);

export function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export function pathMatchesTemplate(actual: string, template: string): boolean {
  const actualParts = splitPath(actual);
  const templateParts = splitPath(template);
  if (actualParts.length !== templateParts.length) return false;
  return templateParts.every((part, index) => {
    if (part.startsWith("{") && part.endsWith("}") && part.length > 2) {
      return actualParts[index]!.length > 0;
    }
    return part === actualParts[index];
  });
}

export function listSpecPaths(spec: Record<string, unknown>): string[] {
  const paths = spec.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return [];
  return Object.keys(paths);
}

export function isPathInSpec(
  path: string,
  spec: Record<string, unknown>,
): boolean {
  return listSpecPaths(spec).some((template) =>
    pathMatchesTemplate(path, template),
  );
}

export function assertSafeRelativePath(path: string): string {
  if (typeof path !== "string") {
    throw new Error("API path must start with a slash");
  }
  if (path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("API path must be a relative URL path");
  }
  if (!path.startsWith("/")) {
    throw new Error("API path must start with a slash");
  }
  if (path.includes("?") || path.includes("#")) {
    throw new Error("API path must not include a query or fragment");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error("API path is not a valid URL path");
  }

  // WHATWG http(s) parsers treat `\` as `/` and then resolve `.` / `..`.
  if (
    decoded.includes("\\") ||
    splitPath(decoded).some((segment) => segment === ".." || segment === ".")
  ) {
    throw new Error("API path must not contain traversal segments");
  }
  return path;
}

export function buildApiUrl(
  apiBase: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): URL {
  const normalized = normalizeApiBase(apiBase);
  const url = new URL(`${normalized}${path}`);
  if (url.origin !== new URL(normalized).origin) {
    throw new Error("API path must resolve to the configured API host");
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url;
}

export function createHostRequest(config: HostRequestConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiBase = normalizeApiBase(config.apiBase);

  return async (
    options: HostRequestOptions,
    context?: OpenApiMcpRequestContext,
  ): Promise<HostRequestResult> => {
    void context;
    try {
      assertMethodAllowed(options.method, config.accessMode);
      const path = assertSafeRelativePath(options.path);
      if (!isPathInSpec(path, config.spec)) {
        throw new Error("API path is not available on this server");
      }

      const url = buildApiUrl(apiBase, path, options.query);
      const headers = new Headers();
      headers.set("Authorization", config.authorization);

      if (options.contentType) {
        headers.set("Content-Type", options.contentType);
      } else if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }

      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          if (BLOCKED_SANDBOX_HEADERS.has(key.toLowerCase())) continue;
          void value;
        }
      }

      const body =
        options.body === undefined
          ? undefined
          : options.rawBody
            ? (options.body as BodyInit)
            : JSON.stringify(options.body);

      const response = await fetchImpl(url, {
        method: options.method.toUpperCase(),
        headers,
        body,
      });

      if (response.status === 204) {
        return { status: 204, ok: response.ok, result: null };
      }

      return {
        status: response.status,
        ok: response.ok,
        result: await readResponseBody(response),
      };
    } catch (error) {
      throw sanitizeError(error, config.authorization);
    }
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (text.length === 0) return null;
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function sanitizeError(error: unknown, authorization: string): Error {
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (error instanceof Error) {
    const leaked =
      (token.length > 0 && error.message.includes(token)) ||
      error.message.includes(authorization);
    if (leaked) {
      return new Error("Upstream request failed");
    }
    return error;
  }
  return new Error("Upstream request failed");
}

import type { Executor } from "@cloudflare/codemode";
import {
  openApiMcpServer,
  type OpenApiMcpRequestContext,
  type RequestOptions,
} from "@cloudflare/codemode/mcp";
import { loadOpenApiSpec } from "./openapi/cache";
import { sanitizeSpec } from "./openapi/sanitize";
import { getAccessMode, type AccessMode } from "./request/access";
import { createHostRequest } from "./request/proxy";

export const MCP_SERVER_NAME = "API";
export const MCP_SERVER_VERSION = "1.0.0";
export const EXECUTOR_TIMEOUT_MS = 30_000;

export function prepareSpec(
  raw: Record<string, unknown>,
  apiBase: string,
  accessMode: AccessMode,
): Record<string, unknown> {
  return sanitizeSpec(raw, {
    apiBase,
    readOnly: accessMode !== "read_write",
  });
}

export function createApiMcpServer(options: {
  spec: Record<string, unknown>;
  executor: Executor;
  authorization: string;
  apiBase: string;
  accessMode: AccessMode;
  fetchImpl?: typeof fetch;
}) {
  const spec = prepareSpec(options.spec, options.apiBase, options.accessMode);
  const request = createHostRequest({
    apiBase: options.apiBase,
    authorization: options.authorization,
    spec,
    accessMode: options.accessMode,
    fetchImpl: options.fetchImpl,
  });

  return openApiMcpServer({
    spec,
    executor: options.executor,
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    description:
      "Call search to inspect the OpenAPI document with codemode.spec(), then execute to call the API with codemode.request(). Writes require X-MCP-Access-Mode: read_write.",
    request: (opts: RequestOptions, context: OpenApiMcpRequestContext) =>
      request(opts, context),
  });
}

export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  authorization: string,
): Promise<Response> {
  const accessMode = getAccessMode(request.headers);
  const rawSpec = await loadOpenApiSpec(env.API_BASE);
  const { DynamicWorkerExecutor } = await import("@cloudflare/codemode");
  const { createLegacyMcpHandler } = await import("agents/mcp");
  const executor = new DynamicWorkerExecutor({
    loader: env.LOADER,
    timeout: EXECUTOR_TIMEOUT_MS,
    globalOutbound: null,
  });
  const server = createApiMcpServer({
    spec: rawSpec,
    executor,
    authorization,
    apiBase: env.API_BASE,
    accessMode,
  });
  return createLegacyMcpHandler(server, { route: "/mcp" })(request, env, ctx);
}

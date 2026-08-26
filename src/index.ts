import { getBearerAuthorization } from "./request/access";
import { handleMcp } from "./server";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/mcp") {
      if (!env.API_BASE) {
        return new Response("API_BASE is not configured", { status: 500 });
      }
      const authorization = getBearerAuthorization(request.headers);
      if (!authorization) {
        return new Response("Bearer token required", { status: 401 });
      }
      return handleMcp(request, env, ctx, authorization);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

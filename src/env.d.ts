/**
 * Worker bindings.
 * `LOADER` comes from `worker_loaders` in wrangler.jsonc.
 * `API_BASE` comes from `.dev.vars` or `wrangler secret put API_BASE`.
 */
interface Env {
  LOADER: WorkerLoader;
  API_BASE: string;
}

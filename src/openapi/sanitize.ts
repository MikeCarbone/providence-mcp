export const SPEC_TITLE = "API";
export const SPEC_DESCRIPTION =
  "HTTP API for accounts, symbols, and market data.";

const DENIED_EXACT = new Set(["/health", "/v1/auth", "/v1/stock-backfills"]);
const DENIED_PREFIXES = ["/v1/auth/", "/v1/stock-backfills/"];

const MUTATING_METHODS = ["post", "put", "patch", "delete"] as const;
const OPERATION_KEYS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

export type SanitizeOptions = {
  apiBase: string;
  readOnly?: boolean;
};

export function isDeniedPath(path: string): boolean {
  if (DENIED_EXACT.has(path)) return true;
  return DENIED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function sanitizeSpec(
  input: unknown,
  options: SanitizeOptions,
): Record<string, unknown> {
  const source = isPlainObject(input) ? input : {};
  const infoIn = isPlainObject(source.info) ? source.info : {};
  const version = typeof infoIn.version === "string" ? infoIn.version : "1.0.0";

  const rawPaths = isPlainObject(source.paths) ? source.paths : {};
  const paths: Record<string, unknown> = {};

  for (const [path, item] of Object.entries(rawPaths)) {
    if (isDeniedPath(path)) continue;
    const next = options.readOnly ? stripMutatingOperations(item) : item;
    if (options.readOnly && !hasHttpOperations(next)) continue;
    paths[path] = next;
  }

  const doc: Record<string, unknown> = {
    ...source,
    info: {
      title: SPEC_TITLE,
      description: SPEC_DESCRIPTION,
      version,
    },
    servers: [{ url: normalizeServerUrl(options.apiBase) }],
    paths,
  };

  return resolveLocalRefs(doc);
}

export function stripMutatingOperations(item: unknown): unknown {
  if (!isPlainObject(item)) return item;
  const next = { ...item };
  for (const method of MUTATING_METHODS) {
    delete next[method];
  }
  return next;
}

export function resolveLocalRefs(document: unknown): Record<string, unknown> {
  const root = structuredClone(document);
  const resolved = walkRefs(root, root, new Set());
  return isPlainObject(resolved) ? resolved : {};
}

function hasHttpOperations(item: unknown): boolean {
  if (!isPlainObject(item)) return false;
  return Object.keys(item).some((key) => OPERATION_KEYS.has(key.toLowerCase()));
}

function walkRefs(node: unknown, root: unknown, seen: Set<string>): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) => walkRefs(entry, root, seen));
  }
  if (!isPlainObject(node)) return node;

  const ref = node.$ref;
  if (typeof ref === "string") {
    if (!ref.startsWith("#")) {
      return { ...node };
    }
    if (seen.has(ref)) {
      return { $ref: ref };
    }

    const target = getJsonPointer(root, ref);
    if (target === undefined) {
      return { ...node };
    }

    seen.add(ref);
    const resolved = walkRefs(target, root, seen);
    seen.delete(ref);

    const siblings = { ...node };
    delete siblings.$ref;
    if (isPlainObject(resolved) && Object.keys(siblings).length > 0) {
      return { ...resolved, ...siblings };
    }
    return resolved;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = walkRefs(value, root, seen);
  }
  return out;
}

function getJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === "#" || pointer === "#/") return root;
  if (!pointer.startsWith("#/")) return undefined;

  const parts = pointer
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = root;
  for (const part of parts) {
    if (!isPlainObject(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function normalizeServerUrl(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

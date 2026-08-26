export type AccessMode = "read" | "read_write";

export const ACCESS_MODE_HEADER = "X-MCP-Access-Mode";
export const READ_WRITE_VALUE = "read_write";

const READ_METHODS = new Set(["GET"]);
const WRITE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

export function getAccessMode(headers: Headers): AccessMode {
  return headers.get(ACCESS_MODE_HEADER) === READ_WRITE_VALUE
    ? "read_write"
    : "read";
}

export function isMethodAllowed(
  method: string,
  accessMode: AccessMode,
): boolean {
  const upper = method.toUpperCase();
  return accessMode === "read_write"
    ? WRITE_METHODS.has(upper)
    : READ_METHODS.has(upper);
}

export function assertMethodAllowed(
  method: string,
  accessMode: AccessMode,
): void {
  if (isMethodAllowed(method, accessMode)) return;
  const normalized = method.toUpperCase();
  if (accessMode === "read") {
    throw new Error(
      `Method ${normalized} is not allowed in read-only mode. Send ${ACCESS_MODE_HEADER}: ${READ_WRITE_VALUE} to enable writes.`,
    );
  }
  throw new Error(`Method ${normalized} is not allowed`);
}

export function getBearerAuthorization(headers: Headers): string | null {
  const header = headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  return `Bearer ${match[1]}`;
}

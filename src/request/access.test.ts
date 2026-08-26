import { describe, expect, it } from "vitest";
import {
  ACCESS_MODE_HEADER,
  assertMethodAllowed,
  getAccessMode,
  getBearerAuthorization,
  isMethodAllowed,
  READ_WRITE_VALUE,
} from "./access";

describe("getAccessMode", () => {
  it("defaults to GET-only read mode", () => {
    expect(getAccessMode(new Headers())).toBe("read");
  });

  it("enables writes only for the exact read_write header value", () => {
    expect(
      getAccessMode(new Headers({ [ACCESS_MODE_HEADER]: READ_WRITE_VALUE })),
    ).toBe("read_write");
  });

  it("does not enable writes for unknown header values", () => {
    expect(
      getAccessMode(new Headers({ [ACCESS_MODE_HEADER]: "read-write" })),
    ).toBe("read");
    expect(getAccessMode(new Headers({ [ACCESS_MODE_HEADER]: "write" }))).toBe(
      "read",
    );
    expect(
      getAccessMode(new Headers({ [ACCESS_MODE_HEADER]: "READ_WRITE" })),
    ).toBe("read");
    expect(getAccessMode(new Headers({ [ACCESS_MODE_HEADER]: "" }))).toBe(
      "read",
    );
  });
});

describe("isMethodAllowed", () => {
  it("allows only GET by default", () => {
    expect(isMethodAllowed("GET", "read")).toBe(true);
    expect(isMethodAllowed("get", "read")).toBe(true);
    expect(isMethodAllowed("POST", "read")).toBe(false);
    expect(isMethodAllowed("PUT", "read")).toBe(false);
    expect(isMethodAllowed("PATCH", "read")).toBe(false);
    expect(isMethodAllowed("DELETE", "read")).toBe(false);
  });

  it("allows mutating methods when read_write is enabled", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(isMethodAllowed(method, "read_write")).toBe(true);
    }
  });

  it("rejects TRACE, OPTIONS, HEAD, and CONNECT", () => {
    for (const method of ["TRACE", "OPTIONS", "HEAD", "CONNECT"]) {
      expect(isMethodAllowed(method, "read")).toBe(false);
      expect(isMethodAllowed(method, "read_write")).toBe(false);
    }
  });
});

describe("assertMethodAllowed", () => {
  it("throws a read-only message for writes without the header", () => {
    expect(() => assertMethodAllowed("POST", "read")).toThrow(
      /read-only mode/,
    );
    expect(() => assertMethodAllowed("TRACE", "read_write")).toThrow(
      "Method TRACE is not allowed",
    );
  });
});

describe("getBearerAuthorization", () => {
  it("returns a normalized Bearer value", () => {
    expect(
      getBearerAuthorization(new Headers({ Authorization: "Bearer abc.def" })),
    ).toBe("Bearer abc.def");
    expect(
      getBearerAuthorization(new Headers({ Authorization: "bearer abc.def" })),
    ).toBe("Bearer abc.def");
  });

  it("rejects missing or non-bearer credentials", () => {
    expect(getBearerAuthorization(new Headers())).toBeNull();
    expect(
      getBearerAuthorization(new Headers({ Authorization: "Basic abc" })),
    ).toBeNull();
    expect(
      getBearerAuthorization(new Headers({ Authorization: "Bearer" })),
    ).toBeNull();
    expect(
      getBearerAuthorization(new Headers({ Authorization: "Bearer " })),
    ).toBeNull();
  });
});
